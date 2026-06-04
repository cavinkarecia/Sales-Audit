# Sales Audit

This repository has **two apps** on different branches:

| Branch | App | Live URL | Render service |
|--------|-----|----------|----------------|
| **`main2`** | **Sentinel** (current) — Data Overview, Expense management, bulk PDF, AI bills | https://sales-audit-2-0-2.onrender.com | `sales-audit-2.0-2` |
| **`master`** | Legacy React attendance dashboard | https://sales-audit-2-0.onrender.com | `sales-audit-2-0` |

**Latest work (password removed, file uploads, bulk PDF, API key persistence) is on branch `main2`.**

To deploy Sentinel: connect Render to this repo, branch **`main2`**, root directory **`backend`**. See `DEPLOY-RENDER.md` on that branch.

---

# Sales Audit 2.0 (branch `master`)

**Live app:** https://sales-audit-2-0.onrender.com

> After you push the latest code (see [DEPLOY.md](./DEPLOY.md)), Render builds in ~3–5 minutes.

## Features

| Route | Description |
|-------|-------------|
| `/` | Attendance Excel upload (latest row per auditor/day) · PJP Google Sheet (all auditor tabs) · KPIs, maps, travel analytics, AI insights |
| `/expense-check-2` | Expense Claim Voucher audit — all auditor tabs, date-wise bus/train, petrol ₹4/₹8 km |
| `/dashboard` | Redirects to `/` |

### Attendance rules

- **Choose Your Name** → auditor  
- **Location** → lat/long on map  
- **Are You on field Today?** = Yes → present  
- Duplicate same date → **latest submission wins**

## Quick start (local)

```powershell
cd "C:\Users\901842-Ezhil Rajan\Projects\Sales-Audit"
npm install --legacy-peer-deps
npm run build
```

Terminal 1: `npm start` → http://localhost:5175  
Terminal 2 (dev UI): `npm run dev` → http://localhost:5173

## Deploy to live

```powershell
powershell -ExecutionPolicy Bypass -File scripts\push-to-github.ps1
```

Then in [Render](https://dashboard.render.com/) → **sales-audit-2-0** → Environment, set:

```
DEEPSEEK_API_KEY=your_key_here
```

Never commit API keys. Rotate any key that was shared in chat.
