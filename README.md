# Sales Audit 2.0

**Live app:** https://sales-audit-2-0.onrender.com

> After you push the latest code (see [DEPLOY.md](./DEPLOY.md)), Render rebuilds in ~3–5 minutes.

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
