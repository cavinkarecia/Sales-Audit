import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 5175;
const HOST = process.env.HOST || '0.0.0.0';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

const app = express();
app.use(compression());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'sales-audit-2.0',
    build: '2026-06-01-jsx-fix-v7',
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

  const ariaRe = /aria-label="([^"]+)"[^>]*data-gid="(\d+)"/gi;
  while ((m = ariaRe.exec(html)) !== null) add(m[2], m[1]);

  const unique = new Map();
  tabs.forEach((t) => {
    if (!unique.has(t.gid)) unique.set(t.gid, t.name || `gid-${t.gid}`);
  });
  return Array.from(unique.entries()).map(([gid, name]) => ({ gid, name }));
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

const fetchStandardMultiTabAsXlsx = async (id) => {
  const htmlUrls = [
    `https://docs.google.com/spreadsheets/d/${id}/htmlview`,
    `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`,
  ];
  let tabs = [];
  for (const htmlUrl of htmlUrls) {
    const htmlResp = await fetch(htmlUrl, { redirect: 'follow' });
    if (!htmlResp.ok) continue;
    const html = await htmlResp.text();
    tabs = parseHtmlTabs(html);
    if (tabs.length > 1) break;
  }
  if (!tabs.length) tabs = [{ gid: '0', name: 'Sheet1' }];
  const csvBase = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=`;
  return fetchTabsAsXlsx(id, tabs, csvBase);
};

const fetchSheetXlsx = async (id) => {
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

  const fullUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  const r = await fetch(fullUrl, { redirect: 'follow' });
  if (r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 100) {
      const sheetCount = countXlsxSheets(buf);
      if (sheetCount > 1) return { ok: true, buf, sheetCount };
      const multi = await fetchStandardMultiTabAsXlsx(id);
      if (multi && countXlsxSheets(multi) > sheetCount) {
        return { ok: true, buf: Buffer.from(multi), sheetCount: countXlsxSheets(multi) };
      }
      return { ok: true, buf, sheetCount };
    }
  }

  const multi = await fetchStandardMultiTabAsXlsx(id);
  if (multi) {
    return { ok: true, buf: Buffer.from(multi), sheetCount: countXlsxSheets(multi) };
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

app.get('/api/sheet', async (req, res) => {
  const id = sanitizeSpreadsheetId(req.query.id);
  if (!id) {
    return res.status(400).json({
      error: 'Invalid spreadsheet id',
      hint: 'Paste the full Google Sheets URL from your browser address bar.',
    });
  }
  try {
    const result = await fetchSheetXlsx(id);
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

const distDir = path.resolve(__dirname, '..', 'dist');

/** Block old Allowance route even if a cached SPA bundle is still loaded. */
app.get(/^\/allowance(\/.*)?$/i, (_req, res) => {
  res.redirect(301, '/');
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
