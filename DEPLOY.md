# Deploy to live (Render)

**Live URL:** https://sales-audit-2-0.onrender.com

## One-time: push this folder to GitHub

From a machine with **Git** and **Node.js** installed:

```powershell
cd "C:\Users\901842-Ezhil Rajan\Projects\Sales-Audit"

git init
git remote add origin https://github.com/cavinkarecia/Sales-Audit.git
git fetch origin master
git checkout -b master
git add .
git commit -m "Add attendance/PJP uploads, allowance audit, full dashboard, secure AI proxy"
git push -u origin master
```

Render will auto-build from `render.yaml` when `master` updates.

## Render environment

In [Render Dashboard](https://dashboard.render.com/) → **sales-audit-2-0** → **Environment**:

| Key | Value |
|-----|--------|
| `DEEPSEEK_API_KEY` | Your DeepSeek API key (server-side only — text insights) |
| `GEMINI_API_KEY` | Your Google AI Studio key for bill OCR (Gemini 2.0 Flash) |
| `GEMINI_MODEL` | Optional — defaults to `gemini-2.0-flash` |

Do **not** commit the keys to Git.

Get a free Gemini key at [Google AI Studio](https://aistudio.google.com/apikey). Without `GEMINI_API_KEY`, expense sync still works but bill OCR / fraud checks will show an error note.

## Local build test

```powershell
npm install --legacy-peer-deps
npm run build
npm start
```

Open http://localhost:5175 (production build served by Express).

## App routes (after deploy)

| URL | Page |
|-----|------|
| `/` | Full dashboard — attendance upload, PJP sync, maps, KPIs, travel AI |
| `/dashboard` | Redirects to `/` |
