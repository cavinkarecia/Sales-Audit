# Deploy Sentinel on Render (no coding required)

This guide walks you through putting the app online on [Render](https://render.com). After setup, you open one URL in your browser — the dashboard and backend run together.

---

## What you need before starting

1. A **GitHub** account with this project pushed to a repository.
2. A **Render** account (sign up free at [render.com](https://render.com)).
3. An **Anthropic API key** for AI bill verification ([get one here](https://console.anthropic.com/settings/keys)) — you will paste this **in the browser**, not on Render.
4. A **password** you will use to log into the dashboard (pick something strong).

---

## Step 1 — Push code to GitHub

If the project is not on GitHub yet:

1. Create a new repository on GitHub.
2. Upload this entire folder (`my-project`) to that repository.

---

## Step 2 — Create the app on Render

1. Log in to [dashboard.render.com](https://dashboard.render.com).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account and select the repository that contains this project.
4. Render will read `render.yaml` and propose:
   - **sentinel** (web service)
   - **sentinel-db** (PostgreSQL database)
5. Click **Apply**.

---

## Step 3 — Set secret environment variables

After the blueprint is created, open the **sentinel** web service → **Environment**:

| Variable | What to put |
|----------|-------------|
| `APP_PASSWORD` | The password you want for logging into Sentinel |

`DATABASE_URL` and `SESSION_SECRET` are filled in automatically by the blueprint.

**Do not** set `ANTHROPIC_API_KEY` on Render. Each user pastes their own key in the app using the **AI Key** chip in the header after logging in.

Click **Save Changes**. Render will redeploy the service.

---

## Step 4 — Open your app

1. On the **sentinel** service page, copy the URL (e.g. `https://sentinel-xxxx.onrender.com`).
2. Open that URL in your browser.
3. Log in with the **APP_PASSWORD** you set.
4. Click **AI Key** in the header and paste your Anthropic key (`sk-ant-...`).
5. Upload your **Attendance** and **PJP** Excel files as before.

Data and claims are saved in the database and survive browser refresh.

---

## Free tier notes

- The app may **sleep** after ~15 minutes of no use; the first visit after sleep can take 30–60 seconds to wake up.
- PostgreSQL free databases expire after 90 days on Render’s free plan — upgrade or export data before then if you rely on it long term.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Login required” loop | Set `APP_PASSWORD` in Environment and redeploy |
| AI verification fails | Click **AI Key** in the header and paste a valid `sk-ant-...` key; hard-refresh (Ctrl+Shift+R) if you still see an old build |
| Deploy fails on database | Wait for **sentinel-db** to finish creating, then redeploy **sentinel** |
| Blank page | Check **Logs** tab on the web service for errors |

---

## Updating the app later

Push changes to GitHub. Render redeploys automatically if auto-deploy is on (default).
