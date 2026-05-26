import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

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
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    aiConfigured: Boolean(DEEPSEEK_API_KEY),
    time: new Date().toISOString(),
  });
});

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
app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));

app.get(/^(?!\/api\/).*/, (_req, res) => {
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
