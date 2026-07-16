import { getCachedOcr, setCachedOcr, sha256 } from './ocrCache.js';
import {
  getEmbeddedImageAt,
  loadTabImagesFromXlsx,
  parseEmbeddedImageUrl,
  loadTabImagesBatch,
  DEFAULT_SHEET_FETCH_HEADERS,
} from './tabImageCache.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OCR_CONCURRENCY = Number(process.env.OCR_CONCURRENCY) || 4;
const MAX_IMAGES_PER_VOUCHER = Number(process.env.OCR_MAX_IMAGES_PER_TAB) || 4;
const ENABLE_TAMPER = process.env.ENABLE_BILL_TAMPER_SCAN === 'true';
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const OCR_PROMPT = `You are reading Indian expense bills/tickets (bus, train, fuel, taxi, hotel).
Return ONLY a single JSON object (no markdown) with this exact schema:
{
  "billType": "bus_ticket | train_ticket | fuel_receipt | taxi_receipt | hotel_bill | other",
  "vendorName": "string or null",
  "gstin": "string or null (15-char Indian GSTIN if printed)",
  "billNumber": "string or null",
  "date": "DD/MM/YY or null",
  "amount": number,
  "lineItems": [{ "label": "string", "amount": number }],
  "taxAmount": number or null,
  "paymentMode": "cash | upi | card | null",
  "fromLocation": "string or null",
  "toLocation": "string or null",
  "ocrConfidence": number between 0 and 1,
  "suspiciousNotes": "string or null"
}`;

const failedBill = (imageUrl, note) => ({
  imageUrl,
  billType: 'other',
  vendorName: null,
  gstin: null,
  billNumber: null,
  date: null,
  amount: 0,
  lineItems: [],
  taxAmount: null,
  paymentMode: null,
  fromLocation: null,
  toLocation: null,
  ocrConfidence: 0,
  suspiciousNotes: note || 'OCR failed to parse',
  contentHash: null,
  dHash: null,
  tamperScore: null,
  fromCache: false,
});

const parseJsonObject = (text) => {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
};

const normalizeBill = (parsed, imageUrl, meta = {}) => {
  if (!parsed || typeof parsed !== 'object') {
    return failedBill(imageUrl, 'OCR failed to parse');
  }
  const amount = Number(parsed.amount);
  return {
    imageUrl,
    billType: String(parsed.billType || 'other'),
    vendorName: parsed.vendorName ?? null,
    gstin: parsed.gstin ? String(parsed.gstin).trim().toUpperCase() : null,
    billNumber: parsed.billNumber ?? null,
    date: parsed.date ?? null,
    amount: Number.isFinite(amount) ? amount : 0,
    lineItems: Array.isArray(parsed.lineItems)
      ? parsed.lineItems.map((li) => ({
          label: String(li?.label || ''),
          amount: Number(li?.amount) || 0,
        }))
      : [],
    taxAmount: parsed.taxAmount == null ? null : Number(parsed.taxAmount) || 0,
    paymentMode: parsed.paymentMode ?? null,
    fromLocation: parsed.fromLocation ?? null,
    toLocation: parsed.toLocation ?? null,
    ocrConfidence: Math.max(0, Math.min(1, Number(parsed.ocrConfidence) || 0)),
    suspiciousNotes: parsed.suspiciousNotes ?? null,
    contentHash: meta.contentHash || null,
    dHash: meta.dHash || null,
    tamperScore: meta.tamperScore ?? null,
    fromCache: Boolean(meta.fromCache),
  };
};

const runPool = async (items, worker, concurrency = 4) => {
  if (!items.length) return [];
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
};

/** Resize once for OCR + compute dHash in a single Jimp pass. */
const prepareBillImage = async (buf) => {
  const Jimp = (await import('jimp')).default;
  const img = await Jimp.read(buf);

  const hashImg = img.clone().greyscale().resize(9, 8);
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = Jimp.intToRGBA(hashImg.getPixelColor(x, y)).r;
      const right = Jimp.intToRGBA(hashImg.getPixelColor(x + 1, y)).r;
      bits += left < right ? '1' : '0';
    }
  }
  const dHash = BigInt(`0b${bits}`).toString(16).padStart(16, '0');

  if (img.bitmap.width > 1024 || img.bitmap.height > 1024) {
    img.scaleToFit(1024, 1024);
  }
  const ocrBuf = await img.quality(82).getBufferAsync(Jimp.MIME_JPEG);
  return { ocrBuf, mime: 'image/jpeg', dHash };
};

const fetchImageBytes = async (url) => {
  const raw = String(url || '').trim();
  if (!raw) throw new Error('Missing image URL');

  if (raw.startsWith('data:')) {
    const match = raw.match(/^data:([^;,]+)?(?:;base64)?,(.+)$/i);
    if (!match) throw new Error('Invalid data URL');
    const mime = (match[1] || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
    const buf = Buffer.from(match[2], 'base64');
    if (buf.byteLength < 50) throw new Error('Image too small');
    return { buf, mime };
  }

  const embedded = parseEmbeddedImageUrl(raw);
  if (embedded?.id) {
    let image = getEmbeddedImageAt(embedded.id, embedded.gid, embedded.index);
    if (!image) {
      await loadTabImagesFromXlsx(embedded.id, embedded.gid, DEFAULT_SHEET_FETCH_HEADERS);
      image = getEmbeddedImageAt(embedded.id, embedded.gid, embedded.index);
    }
    if (!image?.data) throw new Error('Embedded sheet image not found');
    return { buf: image.data, mime: image.mime || 'image/jpeg' };
  }

  const resp = await fetch(raw, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; SalesAudit/2.0; +https://sales-audit-2-0.onrender.com)',
    },
  });
  if (!resp.ok) throw new Error(`Image fetch HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength < 50) throw new Error('Image too small');
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  const mime = contentType.split(';')[0].trim() || 'image/jpeg';
  return { buf, mime };
};

const callGemini = async (apiKey, mime, base64, context = {}) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `${OCR_PROMPT}\nAuditor context: ${context.auditorName || 'unknown'} / ${context.sheetName || ''}`,
          },
          { inline_data: { mime_type: mime, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini HTTP ${resp.status}: ${errText.slice(0, 240)}`);
  }
  const result = await resp.json();
  const text =
    result?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return parseJsonObject(text);
};

const billToTicketCompat = (bill) => {
  const type =
    bill.billType === 'bus_ticket'
      ? 'bus'
      : bill.billType === 'train_ticket'
        ? 'train'
        : bill.billType === 'fuel_receipt'
          ? 'fuel'
          : 'ticket';
  return {
    type,
    amount: bill.amount || 0,
    date: bill.date || '',
    from: bill.fromLocation || '',
    to: bill.toLocation || '',
    note: bill.suspiciousNotes || '',
    imageUrl: bill.imageUrl,
    ocrConfidence: bill.ocrConfidence,
    billNumber: bill.billNumber,
    vendorName: bill.vendorName,
    gstin: bill.gstin,
  };
};

const packAnalysis = (bills, imageCount, cacheHits) => {
  const tickets = bills.filter((b) => (b.amount || 0) > 0).map(billToTicketCompat);
  const totalFromTickets = tickets.reduce((s, t) => s + (t.amount || 0), 0);
  return {
    bills,
    tickets,
    totalFromTickets,
    imageCount,
    cacheHits,
    provider: 'gemini',
    model: GEMINI_MODEL,
    raw: `OCR ${imageCount} image(s) via Gemini · ${tickets.length} amount(s) · ${cacheHits} cache hit(s)`,
  };
};

const ocrOneImage = async (apiKey, imageUrl, context) => {
  try {
    const { buf } = await fetchImageBytes(imageUrl);
    const contentHash = sha256(buf);
    const cached = getCachedOcr(contentHash);
    if (cached?.bill) {
      return {
        imageUrl,
        bill: {
          ...cached.bill,
          imageUrl,
          contentHash,
          dHash: cached.dHash || cached.bill.dHash || null,
          tamperScore: cached.tamperScore ?? cached.bill.tamperScore ?? null,
          fromCache: true,
        },
        fromCache: true,
      };
    }

    const { ocrBuf, mime, dHash } = await prepareBillImage(buf);
    const parsed = await callGemini(apiKey, mime, ocrBuf.toString('base64'), context);
    const bill = normalizeBill(parsed, imageUrl, {
      contentHash,
      dHash,
      tamperScore: null,
      fromCache: false,
    });

    setCachedOcr(contentHash, {
      bill: { ...bill, imageUrl: undefined },
      dHash,
      tamperScore: null,
    });
    return { imageUrl, bill, fromCache: false };
  } catch (e) {
    return { imageUrl, bill: failedBill(imageUrl, e?.message || 'OCR failed to parse'), fromCache: false };
  }
};

const preloadEmbeddedUrls = async (urls) => {
  const bySpreadsheet = new Map();
  for (const url of urls) {
    const parsed = parseEmbeddedImageUrl(url);
    if (!parsed?.id) continue;
    const gid = String(parsed.gid).replace(/\D/g, '') || '0';
    if (!bySpreadsheet.has(parsed.id)) bySpreadsheet.set(parsed.id, new Set());
    bySpreadsheet.get(parsed.id).add(gid);
  }
  const jobs = [];
  for (const [spreadsheetId, gids] of bySpreadsheet.entries()) {
    jobs.push(loadTabImagesBatch(spreadsheetId, [...gids], DEFAULT_SHEET_FETCH_HEADERS, 2));
  }
  await Promise.all(jobs);
};

/**
 * OCR bill images for one auditor tab (legacy single-batch API).
 */
export const analyzeBillsWithGemini = async (imageUrls, context = {}) => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    const err = new Error('Set GEMINI_API_KEY on Render for bill OCR.');
    err.status = 503;
    throw err;
  }

  const urls = (imageUrls || []).slice(0, MAX_IMAGES_PER_VOUCHER);
  await preloadEmbeddedUrls(urls);

  let cacheHits = 0;
  const results = await runPool(
    urls,
    async (imageUrl) => {
      const r = await ocrOneImage(apiKey, imageUrl, context);
      if (r.fromCache) cacheHits += 1;
      return r.bill;
    },
    OCR_CONCURRENCY,
  );

  return packAnalysis(results, urls.length, cacheHits);
};

/**
 * Fast bulk OCR for an entire expense workbook.
 * Dedupes identical images, preloads each tab XLSX once, runs Gemini in parallel.
 */
export const analyzeBillsBulk = async (batches = []) => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    const err = new Error('Set GEMINI_API_KEY on Render for bill OCR.');
    err.status = 503;
    throw err;
  }

  const trimmedBatches = (batches || []).map((batch) => ({
    key: String(batch.key || ''),
    imageUrls: (batch.imageUrls || []).slice(0, MAX_IMAGES_PER_VOUCHER),
    context: batch.context || {},
  }));

  const urlJobs = new Map();
  for (const batch of trimmedBatches) {
    for (const imageUrl of batch.imageUrls) {
      if (!urlJobs.has(imageUrl)) {
        urlJobs.set(imageUrl, batch.context);
      }
    }
  }

  const allUrls = [...urlJobs.keys()];
  await preloadEmbeddedUrls(allUrls);

  let cacheHits = 0;
  const billsByUrl = new Map();
  await runPool(
    allUrls,
    async (imageUrl) => {
      const result = await ocrOneImage(apiKey, imageUrl, urlJobs.get(imageUrl) || {});
      if (result.fromCache) cacheHits += 1;
      billsByUrl.set(imageUrl, result.bill);
    },
    OCR_CONCURRENCY,
  );

  const byKey = {};
  for (const batch of trimmedBatches) {
    const bills = batch.imageUrls.map((url) => billsByUrl.get(url)).filter(Boolean);
    byKey[batch.key] = packAnalysis(bills, batch.imageUrls.length, 0);
    if (!batch.imageUrls.length) {
      byKey[batch.key].note = 'No bill images found in this tab (paste images in sheet or share as Viewer).';
    }
  }

  return {
    byKey,
    totals: {
      uniqueImages: allUrls.length,
      cacheHits,
      vouchers: trimmedBatches.length,
      tamperScan: ENABLE_TAMPER,
    },
  };
};

export const GSTIN_REGEX = GSTIN_RE;
export { MAX_IMAGES_PER_VOUCHER, OCR_CONCURRENCY };
