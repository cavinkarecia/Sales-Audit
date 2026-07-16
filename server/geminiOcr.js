import { getCachedOcr, setCachedOcr, sha256 } from './ocrCache.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
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

  if (raw.startsWith('/api/sheet/embedded-image')) {
    const { getEmbeddedImage, loadTabImagesFromXlsx } = await import('./tabImageCache.js');
    const parsed = new URL(raw, 'http://local');
    const id = parsed.searchParams.get('id') || '';
    const gid = parsed.searchParams.get('gid') || '0';
    const index = Number.parseInt(parsed.searchParams.get('i') || '0', 10);
    let image = getEmbeddedImage(id, gid, index);
    if (!image) {
      await loadTabImagesFromXlsx(id, gid, {
        'User-Agent':
          'Mozilla/5.0 (compatible; SalesAudit/2.0; +https://sales-audit-2-0.onrender.com)',
        Accept: '*/*',
      });
      image = getEmbeddedImage(id, gid, index);
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

/** Simple difference hash (dHash) via jimp — Hamming distance ≤ 5 ≈ duplicate. */
const computeDHash = async (buf) => {
  try {
    const Jimp = (await import('jimp')).default;
    const img = await Jimp.read(buf);
    img.greyscale().resize(9, 8);
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = Jimp.intToRGBA(img.getPixelColor(x, y)).r;
        const right = Jimp.intToRGBA(img.getPixelColor(x + 1, y)).r;
        bits += left < right ? '1' : '0';
      }
    }
    return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
  } catch {
    return null;
  }
};

/** Lightweight ELA-style score (0–1). Higher = more likely local edit. */
const computeTamperScore = async (buf) => {
  try {
    const Jimp = (await import('jimp')).default;
    const original = await Jimp.read(buf);
    const w = Math.min(original.bitmap.width, 400);
    const h = Math.min(original.bitmap.height, 400);
    original.resize(w, h);

    const jpeg = await original.quality(90).getBufferAsync(Jimp.MIME_JPEG);
    const resaved = await Jimp.read(jpeg);
    resaved.resize(w, h);

    let sum = 0;
    let count = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const a = Jimp.intToRGBA(original.getPixelColor(x, y));
        const b = Jimp.intToRGBA(resaved.getPixelColor(x, y));
        sum += Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
        count += 1;
      }
    }
    const avg = count ? sum / count / (255 * 3) : 0;
    return Math.min(1, Number(avg.toFixed(4)));
  } catch {
    return null;
  }
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
      maxOutputTokens: 1024,
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

const runPool = async (items, worker, concurrency = 4) => {
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

/**
 * OCR every bill image with Gemini (cached by content hash).
 * Returns structured bills + ticket-compat array for existing date matching.
 */
export const analyzeBillsWithGemini = async (imageUrls, context = {}) => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    const err = new Error('Set GEMINI_API_KEY on Render for bill OCR.');
    err.status = 503;
    throw err;
  }

  const urls = (imageUrls || []).slice(0, 24);
  let cacheHits = 0;

  const bills = await runPool(
    urls,
    async (imageUrl) => {
      try {
        const { buf, mime } = await fetchImageBytes(imageUrl);
        const contentHash = sha256(buf);
        const cached = getCachedOcr(contentHash);
        if (cached?.bill) {
          cacheHits += 1;
          return {
            ...cached.bill,
            imageUrl,
            contentHash,
            dHash: cached.dHash || cached.bill.dHash || null,
            tamperScore: cached.tamperScore ?? cached.bill.tamperScore ?? null,
            fromCache: true,
          };
        }

        const [dHash, tamperScore, parsed] = await Promise.all([
          computeDHash(buf),
          computeTamperScore(buf),
          callGemini(apiKey, mime, buf.toString('base64'), context),
        ]);

        const bill = normalizeBill(parsed, imageUrl, {
          contentHash,
          dHash,
          tamperScore,
          fromCache: false,
        });

        setCachedOcr(contentHash, {
          bill: { ...bill, imageUrl: undefined },
          dHash,
          tamperScore,
        });
        return bill;
      } catch (e) {
        return failedBill(imageUrl, e?.message || 'OCR failed to parse');
      }
    },
    4,
  );

  const tickets = bills.filter((b) => (b.amount || 0) > 0).map(billToTicketCompat);
  const totalFromTickets = tickets.reduce((s, t) => s + (t.amount || 0), 0);

  return {
    bills,
    tickets,
    totalFromTickets,
    imageCount: urls.length,
    cacheHits,
    provider: 'gemini',
    model: GEMINI_MODEL,
    raw: `OCR ${urls.length} image(s) via Gemini · ${tickets.length} amount(s) · ${cacheHits} cache hit(s)`,
  };
};

export const GSTIN_REGEX = GSTIN_RE;
