import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { syncExpenseWorkbook } from './expenseSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

const PORT = Number(process.env.PORT) || 5175;
const HOST = process.env.HOST || '0.0.0.0';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

const app = express();
app.use(compression());
app.use(express.json({ limit: '5mb' }));

const readBuildId = () => {
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(distDir, 'build-meta.json'), 'utf8'),
    );
    return meta.build || 'unknown';
  } catch {
    return '2026-06-03-expense-check-2-v2-fallback';
  }
};

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'sales-audit-2.0',
    build: readBuildId(),
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    aiConfigured: Boolean(DEEPSEEK_API_KEY),
    time: new Date().toISOString(),
  });
});

const sanitizeSpreadsheetId = (raw) => {
  const id = String(raw || '').trim();
  const m = id.match(/([a-zA-Z0-9-_]{20,})/);
  const cleaned = m ? m[1] : id;
  if (!/^[a-zA-Z0-9-_]+$/.test(cleaned)) return null;
  return cleaned;
};

const countXlsxSheets = (buf) => {
  try {
    const wb = XLSX.read(buf, { type: 'buffer' });
    return wb.SheetNames?.length || 0;
  } catch {
    return 0;
  }
};

const mergeTabLists = (...lists) => {
  const map = new Map();
  for (const list of lists) {
    for (const t of list || []) {
      const gid = String(t?.gid ?? '').trim();
      if (!gid || !/^\d+$/.test(gid)) continue;
      const name = String(t.name || '').trim();
      if (!map.has(gid)) map.set(gid, name);
      else if (!map.get(gid) && name) map.set(gid, name);
    }
  }
  return Array.from(map.entries()).map(([gid, name]) => ({
    gid,
    name: name || `Sheet-${gid}`,
  }));
};

const parseHtmlTabs = (html) => {
  const tabs = [];
  const add = (gid, name) => {
    if (gid && /^\d+$/.test(String(gid))) {
      tabs.push({ gid: String(gid), name: String(name || '').trim() });
    }
  };

  let m;
  const gidLinkRe = /[?&]gid=(\d+)[^"'>\s]*["'][^>]*>([^<]+)</gi;
  while ((m = gidLinkRe.exec(html)) !== null) add(m[1], m[2]);

  const sheetMetaRe = /data-sheet-id="(\d+)"[^>]*data-sheet-name="([^"]+)"/gi;
  while ((m = sheetMetaRe.exec(html)) !== null) add(m[1], m[2]);

  const sheetMetaRev = /data-sheet-name="([^"]+)"[^>]*data-sheet-id="(\d+)"/gi;
  while ((m = sheetMetaRev.exec(html)) !== null) add(m[2], m[1]);

  const ariaRe = /aria-label="([^"]+)"[^>]*data-gid="(\d+)"/gi;
  while ((m = ariaRe.exec(html)) !== null) add(m[2], m[1]);

  const tabBarRe =
    /docs-sheet-tab[^>]*data-sheet-id="(\d+)"[\s\S]{0,500}?docs-sheet-tab-name[^>]*>\s*([^<]+?)\s*</gi;
  while ((m = tabBarRe.exec(html)) !== null) add(m[1], m[2]);

  const sheetIdTitleRe =
    /"sheetId"\s*:\s*(\d+)\s*,\s*"(?:title|name)"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  while ((m = sheetIdTitleRe.exec(html)) !== null) {
    add(m[1], m[2].replace(/\\"/g, '"'));
  }

  const gidTitleRe =
    /"gid"\s*:\s*"?(\d+)"?[\s\S]{0,120}?"(?:title|name)"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  while ((m = gidTitleRe.exec(html)) !== null) {
    add(m[1], m[2].replace(/\\"/g, '"'));
  }

  return mergeTabLists(tabs);
};

const parseTabsFromEmbeddedJson = (html) => {
  const tabs = [];
  const add = (gid, name) => {
    if (gid && /^\d+$/.test(String(gid))) {
      tabs.push({ gid: String(gid), name: String(name || '').trim() });
    }
  };

  const sheetsChunk = html.match(/"sheets"\s*:\s*\[([\s\S]{0,80000}?)\]\s*,/);
  if (sheetsChunk?.[1]) {
    const inner = sheetsChunk[1];
    const pair =
      /"sheetId"\s*:\s*(\d+)[\s\S]{0,400}?"(?:title|name)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    let m;
    while ((m = pair.exec(inner)) !== null) {
      add(m[1], m[2].replace(/\\"/g, '"'));
    }
  }

  const modelRe =
    /"(\d{6,})"\s*:\s*\{[^{}]{0,200}?"name"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = modelRe.exec(html)) !== null) {
    add(m[1], m[2].replace(/\\"/g, '"'));
  }

  return mergeTabLists(tabs);
};

const parseTabsFromGoogleFeed = async (id) => {
  const feedUrls = [
    `https://spreadsheets.google.com/feeds/worksheets/${id}/public/full?alt=json`,
    `https://spreadsheets.google.com/feeds/worksheets/${id}/public/full`,
  ];
  const tabs = [];

  for (const feedUrl of feedUrls) {
    try {
      const resp = await fetch(feedUrl, { redirect: 'follow' });
      if (!resp.ok) continue;
      const body = await resp.text();
      if (body.trim().startsWith('{')) {
        const data = JSON.parse(body);
        const entries = data?.feed?.entry || [];
        for (const entry of entries) {
          const title = entry?.title?.$t || entry?.title?.[0] || '';
          const links = entry?.link || [];
          const linkList = Array.isArray(links) ? links : [links];
          for (const link of linkList) {
            const href = link?.href || link?.$?.href || '';
            const gidM = href.match(/[?&#]gid=(\d+)/);
            if (gidM) tabs.push({ gid: gidM[1], name: title });
          }
        }
      } else {
        const parts = body.split('<entry>');
        for (let i = 1; i < parts.length; i++) {
          const chunk = parts[i];
          const gidM = chunk.match(/gid=(\d+)/);
          const titleM = chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([^\]<]+)/);
          if (gidM) tabs.push({ gid: gidM[1], name: titleM?.[1]?.trim() || '' });
        }
      }
      if (tabs.length) break;
    } catch {
      /* try next feed format */
    }
  }

  return mergeTabLists(tabs);
};

const SHEET_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SalesAudit/2.0; +https://sales-audit-2-0.onrender.com)',
  Accept: 'text/html,application/xhtml+xml',
};

const fetchTabsAsXlsx = async (id, tabs, csvBasePath) => {
  const workbook = XLSX.utils.book_new();
  let loaded = 0;
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    const csvUrl = `${csvBasePath}${t.gid}&single=true&output=csv`;
    const csvResp = await fetch(csvUrl, { redirect: 'follow' });
    if (!csvResp.ok) continue;
    const csv = await csvResp.text();
    if (!csv || csv.trim().length === 0) continue;
    const parsed = XLSX.read(csv, { type: 'string' });
    const first = parsed.SheetNames[0];
    if (!first) continue;
    XLSX.utils.book_append_sheet(workbook, parsed.Sheets[first], sanitizeSheetName(t.name, i));
    loaded++;
  }
  if (loaded === 0) return null;
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const fetchStandardMultiTabAsXlsx = async (id, tabsIn) => {
  const tabs =
    tabsIn?.length > 0 ? tabsIn : await listWorkbookTabs(id);
  if (!tabs.length) return null;
  const csvBase = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=`;
  return fetchTabsAsXlsx(id, tabs, csvBase);
};

const fetchSheetXlsx = async (id, { forceAllTabs = false } = {}) => {
  const isPublishedId = id.startsWith('2PACX-');
  if (isPublishedId) {
    const urls = [
      `https://docs.google.com/spreadsheets/d/e/${id}/pub?output=xlsx`,
      `https://docs.google.com/spreadsheets/d/e/${id}/pub?single=true&output=xlsx`,
    ];
    let lastStatus = 0;
    let lastBody = '';
    for (const upstream of urls) {
      const r = await fetch(upstream, { redirect: 'follow' });
      lastStatus = r.status;
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 100) return { ok: true, buf, sheetCount: countXlsxSheets(buf) };
      }
      lastBody = await r.text().catch(() => '');
    }
    return { ok: false, status: lastStatus, body: lastBody.slice(0, 200) };
  }

  const tabList = await listWorkbookTabs(id);
  const csvBase = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=`;

  // One shared link (any gid) → download every tab in the workbook via per-tab CSV.
  if (tabList.length > 1 || forceAllTabs) {
    const multi = await fetchTabsAsXlsx(id, tabList, csvBase);
    if (multi) {
      const sc = countXlsxSheets(multi);
      return {
        ok: true,
        buf: Buffer.from(multi),
        sheetCount: sc,
        tabCount: tabList.length,
        mode: 'multi-csv',
      };
    }
  }

  const fullUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  const r = await fetch(fullUrl, { redirect: 'follow' });
  if (r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 100) {
      const sheetCount = countXlsxSheets(buf);
      const needMulti = tabList.length > 1 && sheetCount < tabList.length;
      if (!needMulti && sheetCount > 0 && !forceAllTabs) {
        return {
          ok: true,
          buf,
          sheetCount: Math.max(sheetCount, tabList.length),
          tabCount: tabList.length,
          mode: 'xlsx-export',
        };
      }
    }
  }

  const multi = await fetchStandardMultiTabAsXlsx(id, tabList);
  if (multi) {
    return {
      ok: true,
      buf: Buffer.from(multi),
      sheetCount: countXlsxSheets(multi),
      tabCount: tabList.length,
      mode: 'multi-csv-fallback',
    };
  }

  const lastBody = await r.text().catch(() => '');
  return { ok: false, status: r.status, body: lastBody.slice(0, 200) };
};

const sanitizeSheetName = (name, index) => {
  const cleaned = String(name || `Sheet${index + 1}`)
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim();
  return (cleaned || `Sheet${index + 1}`).slice(0, 31);
};

const parsePublishedTabs = (html) => {
  const tabs = [];
  const re = /[?&]gid=(\d+)[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    tabs.push({ gid: m[1], name: m[2].trim() });
  }
  const unique = new Map();
  tabs.forEach((t) => {
    if (!unique.has(t.gid)) unique.set(t.gid, t.name || `gid-${t.gid}`);
  });
  return Array.from(unique.entries()).map(([gid, name]) => ({ gid, name }));
};

const fetchPublishedAsXlsx = async (id) => {
  const pubHtmlUrl = `https://docs.google.com/spreadsheets/d/e/${id}/pubhtml`;
  const htmlResp = await fetch(pubHtmlUrl, { redirect: 'follow' });
  if (!htmlResp.ok) {
    return { ok: false, status: htmlResp.status, body: 'Failed to open published html' };
  }
  const html = await htmlResp.text();
  let tabs = parsePublishedTabs(html);
  if (!tabs.length) tabs = [{ gid: '0', name: 'Sheet1' }];

  const workbook = XLSX.utils.book_new();
  let loaded = 0;

  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    const csvUrl = `https://docs.google.com/spreadsheets/d/e/${id}/pub?gid=${t.gid}&single=true&output=csv`;
    const csvResp = await fetch(csvUrl, { redirect: 'follow' });
    if (!csvResp.ok) continue;
    const csv = await csvResp.text();
    if (!csv || csv.trim().length === 0) continue;
    const parsed = XLSX.read(csv, { type: 'string' });
    const first = parsed.SheetNames[0];
    if (!first) continue;
    XLSX.utils.book_append_sheet(workbook, parsed.Sheets[first], sanitizeSheetName(t.name, i));
    loaded++;
  }

  if (loaded === 0) {
    return { ok: false, status: 404, body: 'Published sheet tabs could not be downloaded as csv' };
  }

  const out = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return { ok: true, buf: Buffer.from(out) };
};

const parseGidsFromHtmlview = (html) => {
  const gids = [...new Set([...html.matchAll(/[?&#]gid=(\d+)/g)].map((m) => m[1]))];
  return gids.map((gid, i) => ({
    gid,
    name: gid === '0' ? 'Sheet1' : `Tab-${i + 1}`,
  }));
};

const listWorkbookTabs = async (id) => {
  const htmlUrls = [
    `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`,
    `https://docs.google.com/spreadsheets/d/${id}/edit`,
    `https://docs.google.com/spreadsheets/d/${id}/htmlview`,
    `https://docs.google.com/spreadsheets/d/${id}/htmlview?gid=0`,
  ];

  const collected = [];
  for (const htmlUrl of htmlUrls) {
    try {
      const htmlResp = await fetch(htmlUrl, {
        redirect: 'follow',
        headers: SHEET_FETCH_HEADERS,
      });
      if (!htmlResp.ok) continue;
      const html = await htmlResp.text();
      collected.push(parseHtmlTabs(html));
      collected.push(parseTabsFromEmbeddedJson(html));
    } catch {
      /* try next URL */
    }
  }

  try {
    collected.push(await parseTabsFromGoogleFeed(id));
  } catch {
    /* feed optional */
  }

  let merged = mergeTabLists(...collected);

  // Always merge htmlview gids — workbook may have 30+ auditor tabs
  for (const htmlUrl of [
    `https://docs.google.com/spreadsheets/d/${id}/htmlview`,
    `https://docs.google.com/spreadsheets/d/${id}/htmlview?gid=0`,
  ]) {
    try {
      const htmlResp = await fetch(htmlUrl, {
        redirect: 'follow',
        headers: SHEET_FETCH_HEADERS,
      });
      if (!htmlResp.ok) continue;
      const html = await htmlResp.text();
      merged = mergeTabLists(merged, parseGidsFromHtmlview(html));
    } catch {
      /* try next */
    }
  }

  if (merged.length) return merged;
  return [{ gid: '0', name: 'Sheet1' }];
};

const extractImagesFromHtml = (html) => {
  const urls = new Set();
  const patterns = [
    /<img[^>]+src=["']([^"']+)["']/gi,
    /src=["'](https:\/\/[^"']+googleusercontent[^"']+)["']/gi,
    /src=["'](https:\/\/[^"']+ggpht[^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = m[1];
      if (!/favicon|logo|icon|s\d{2,}-p-k-no/i.test(u)) urls.add(u);
    }
  }
  return [...urls];
};

app.get('/api/sheet/tabs', async (req, res) => {
  const id = sanitizeSpreadsheetId(req.query.id);
  if (!id) return res.status(400).json({ error: 'Invalid spreadsheet id' });
  try {
    const tabs = await listWorkbookTabs(id);
    res.json({ tabs, count: tabs.length });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

app.get('/api/sheet/tab-images', async (req, res) => {
  const id = sanitizeSpreadsheetId(req.query.id);
  const gid = String(req.query.gid || '0');
  if (!id) return res.status(400).json({ error: 'Invalid spreadsheet id' });
  try {
    const url = `https://docs.google.com/spreadsheets/d/${id}/htmlview?gid=${gid}`;
    const htmlResp = await fetch(url, { redirect: 'follow' });
    if (!htmlResp.ok) {
      return res.json({ images: [], embeddedCount: 0, note: 'Could not open tab HTML view' });
    }
    const html = await htmlResp.text();
    const images = extractImagesFromHtml(html);
    res.json({ images, embeddedCount: images.length, gid });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

const parseTicketJsonFromAi = (text) => {
  const tickets = [];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const arr = JSON.parse(jsonMatch[0]);
      arr.forEach((t) => {
        const amount = Number(t.amount || t.fare || t.total || 0);
        if (amount > 0) {
          tickets.push({
            type: t.type || 'ticket',
            amount,
            date: t.date || '',
            from: t.from || '',
            to: t.to || '',
            note: t.note || '',
          });
        }
      });
      return tickets;
    }
  } catch {
    /* fall through */
  }
  const amountMatches = text.match(/₹?\s*(\d+(?:\.\d+)?)/g) || [];
  amountMatches.forEach((m) => {
    const amount = parseFloat(m.replace(/[^\d.]/g, ''));
    if (amount > 10 && amount < 50000) {
      tickets.push({ type: 'ticket', amount, date: '', from: '', to: '', note: 'extracted from text' });
    }
  });
  return tickets;
};

app.post('/api/ai/analyze-bill-images', async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return res.status(503).json({ error: 'Set DEEPSEEK_API_KEY on Render for image analysis.' });
  }
  const { imageUrls = [], context = {} } = req.body || {};
  if (!imageUrls.length) {
    return res.json({ tickets: [], totalFromTickets: 0, raw: 'No images' });
  }

  const allTickets = [];
  const batches = [];
  for (let i = 0; i < imageUrls.length; i += 2) {
    batches.push(imageUrls.slice(i, i + 2));
  }

  try {
    for (const batch of batches) {
      const content = [
        {
          type: 'text',
          text: `Analyze bus/train ticket images for auditor ${context.auditorName || 'unknown'}.
Extract each ticket: type (bus|train), amount in INR (number only), date (DD/MM/YY), from, to.
Return ONLY a JSON array like [{"type":"bus","amount":330,"date":"01/04/26","from":"Kurnool","to":"Wanaparthi"}].
If not a ticket, skip it.`,
        },
        ...batch.map((url) => ({
          type: 'image_url',
          image_url: { url },
        })),
      ];

      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You read Indian bus and train tickets. Return strict JSON only.',
            },
            { role: 'user', content },
          ],
          temperature: 0.1,
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({
          error: `Vision API failed: ${errText.slice(0, 300)}`,
          tickets: allTickets,
          totalFromTickets: allTickets.reduce((s, t) => s + t.amount, 0),
        });
      }

      const result = await response.json();
      const raw = result.choices?.[0]?.message?.content || '';
      allTickets.push(...parseTicketJsonFromAi(raw));
    }

    const totalFromTickets = allTickets.reduce((s, t) => s + (t.amount || 0), 0);
    res.json({
      tickets: allTickets,
      totalFromTickets,
      imageCount: imageUrls.length,
      raw: `Analyzed ${imageUrls.length} image(s), found ${allTickets.length} ticket amount(s)`,
    });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

app.post('/api/expense/sync', async (req, res) => {
  const url = String(req.body?.url || req.body?.id || '').trim();
  if (!url) return res.status(400).json({ error: 'Missing spreadsheet url' });
  try {
    const result = await syncExpenseWorkbook(url, listWorkbookTabs);
    res.json({ ...result, build: readBuildId() });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

app.get('/api/sheet/tab-csv', async (req, res) => {
  const id = sanitizeSpreadsheetId(req.query.id);
  const gid = String(req.query.gid || '0').replace(/\D/g, '') || '0';
  if (!id) return res.status(400).json({ error: 'Invalid spreadsheet id' });
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}&single=true&output=csv`;
    const upstream = await fetch(csvUrl, { redirect: 'follow' });
    if (!upstream.ok) {
      return res.status(upstream.status >= 400 ? upstream.status : 502).json({
        error: `Could not export tab gid=${gid}`,
      });
    }
    const csv = await upstream.text();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(csv);
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

app.get('/api/sheet', async (req, res) => {
  const id = sanitizeSpreadsheetId(req.query.id);
  if (!id) {
    return res.status(400).json({
      error: 'Invalid spreadsheet id',
      hint: 'Paste the full Google Sheets URL from your browser address bar.',
    });
  }
  try {
    const forceAllTabs =
      req.query.allTabs === '1' ||
      req.query.allTabs === 'true' ||
      req.query.forceAllTabs === '1';
    const result = await fetchSheetXlsx(id, { forceAllTabs });
    if (!result.ok && id.startsWith('2PACX-')) {
      const fallback = await fetchPublishedAsXlsx(id);
      if (fallback.ok) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.send(fallback.buf);
      }
    }
    if (!result.ok) {
      const msg =
        result.status === 404
          ? 'Spreadsheet not found'
          : result.status === 403 || result.status === 401
            ? 'Sheet not shared publicly — set to Anyone with the link can view'
            : `Google export failed (HTTP ${result.status})`;
      return res.status(result.status >= 400 ? result.status : 502).json({ error: msg });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(result.buf);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch upstream sheet', detail: String(err?.message || err) });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return res.status(503).json({
      error: 'AI not configured. Set DEEPSEEK_API_KEY on the server.',
    });
  }
  const { prompt, systemInstruction } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: systemInstruction || 'You are an expert field sales operations assistant.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        stream: false,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }
    const result = await response.json();
    res.json({ content: result.choices?.[0]?.message?.content || '' });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

});

/** State-aware online geocoding via OpenStreetMap Nominatim (India). */
app.get('/api/geocode', async (req, res) => {
  const town = String(req.query.town || '').trim();
  const state = String(req.query.state || '').trim();
  const pincode = String(req.query.pincode || '').trim();

  if (!town && !pincode) {
    return res.status(400).json({ mapped: false, error: 'town or pincode required' });
  }

  let query = '';
  if (/^\d{6}$/.test(pincode)) {
    query = `${pincode}, India`;
  } else if (town && state) {
    query = `${town}, ${state}, India`;
  } else if (town) {
    query = `${town}, India`;
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'in');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'SalesAudit/2.0 (field-audit travel map; contact: sales-audit@render.com)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ mapped: false, rawTown: town, rawState: state });
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json({ mapped: false, rawTown: town, rawState: state });
    }

    const hit = rows[0];
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.json({ mapped: false, rawTown: town, rawState: state });
    }

    const addr = hit.address || {};
    res.json({
      mapped: true,
      lat,
      lng,
      matchedCity: addr.city || addr.town || addr.village || addr.county || town,
      matchedState: addr.state || state,
      rawTown: town,
      rawState: state,
      source: 'nominatim',
    });
  } catch (err) {
    res.status(502).json({ mapped: false, rawTown: town, rawState: state, error: String(err?.message || err) });
  }
});

/** Legacy allowance URL → Expense Check 2 */
app.get(/^\/allowance(\/.*)?$/i, (_req, res) => {
  res.redirect(301, '/expense-check-2');
});

app.use(
  express.static(distDir, {
    index: false,
    maxAge: 0,
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Pragma', 'no-cache');
      }
    },
  }),
);

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(distDir, 'index.html'));
});

function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const [, ifaces] of Object.entries(nets)) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name: i.name, address: i.address });
    }
  }
  return out;
}

app.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log(' Sales Audit 2.0 backend is live');
  console.log(` Local: http://localhost:${PORT}`);
  for (const a of lanAddresses()) {
    console.log(` LAN: http://${a.address}:${PORT} (${a.name})`);
  }
  console.log(` AI: ${DEEPSEEK_API_KEY ? 'enabled' : 'disabled'}`);
  console.log('='.repeat(60));
});
