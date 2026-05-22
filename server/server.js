import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 5175;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(compression());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'sales-audit-2.0',
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    time: new Date().toISOString(),
  });
});

// Lightweight proxy so the frontend can pull a public Google Sheet
// through our own backend instead of hitting Google directly.
// Usage: GET /api/sheet?id=<spreadsheetId>
app.get('/api/sheet', async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!/^[a-zA-Z0-9-_]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid spreadsheet id' });
  }
  const upstream = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  try {
    const r = await fetch(upstream);
    if (!r.ok) return res.status(r.status).json({ error: `Upstream HTTP ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch upstream sheet', detail: String(err?.message || err) });
  }
});

const distDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));

// SPA fallback — anything that isn't /api/* or a static asset returns index.html
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const [name, ifaces] of Object.entries(nets)) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    }
  }
  return out;
}

app.listen(PORT, HOST, () => {
  const banner = '='.repeat(60);
  console.log(banner);
  console.log(`  Sales Audit 2.0 backend is live`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const a of lanAddresses()) {
    console.log(`  LAN:     http://${a.address}:${PORT}    (${a.name})`);
  }
  console.log(`  Health:  /api/health`);
  console.log(banner);
});
