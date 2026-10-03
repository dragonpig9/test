# Deploying CommonHours

**Default: one Render service.**

```
Browser ──► Render Web Service (Node 22): React app + Express API on one URL ──► Render PostgreSQL
```

The API process serves the built web app (`apps/web/dist`, enabled by `SERVE_WEB=true`), so the site and `/api` share an origin. You need no CORS setup and no second hosting account.

## 1. Deploy on Render (about 10 minutes)

1. Push this repo to GitHub and merge the branch into your default branch, or pick this branch in Render.
2. Go to https://dashboard.render.com → **New → Blueprint** and pick the repo. Render reads `render.yaml` and creates:
   - `commonhours-db` (PostgreSQL, free plan)
   - `commonhours-api` (Node web service). It builds with `npm ci --include=dev && npm run build -w @commonhours/web`. `npm ci` also runs `prisma generate` through the API's `postinstall`. It starts with `npm run start:prod`, which runs `prisma migrate deploy`, seeds the demo **only if the database is empty**, and starts the server.
3. When the deploy is live, open `https://<your-service>.onrender.com`. The login page should list the demo members. `https://<your-service>.onrender.com/api/health` should return `{"ok":true,...}`.

Environment variables (set by the blueprint):

| Key | Value |
| --- | --- |
| `DATABASE_URL` | from `commonhours-db` |
| `JWT_SECRET` | generated (the server refuses to start in production without one) |
| `DEMO_MODE` | `true`: public account switcher, simulated clock and **Reset demo** for everyone |
| `DEBUG_ENDPOINTS` | `false` (debug routes are also always off when `NODE_ENV=production`) |
| `SERVE_WEB` | `true`: serve the built web app from the same service |

> The free Render plan sleeps after about 15 minutes without traffic, so the first request after a pause takes 30–60 s. Open the site a minute before you present. Render's free PostgreSQL databases expire after 30 days; upgrade the database or recreate the blueprint if you need it longer.

## 2. Optional: web app on Cloudflare Pages instead

Use this only if you want the web app on Cloudflare. Keep the Render service from step 1 for the API. `apps/web/functions/api/[[path]].ts` forwards `/api/*` to it, so set `API_ORIGIN` to the Render URL. You can also remove `SERVE_WEB` and set `WEB_ORIGIN` to your Pages URL.

### Option A: from your machine with Wrangler
```bash
npm install
npx wrangler login                     # or export CLOUDFLARE_API_TOKEN=... and CLOUDFLARE_ACCOUNT_ID=...
# set API_ORIGIN in apps/web/wrangler.toml to your Render URL, then:
npm run deploy -w @commonhours/web     # vite build + wrangler pages deploy dist --project-name commonhours
```
Wrangler prints `https://commonhours.pages.dev` (or a preview URL).

### Option B: Cloudflare dashboard (Git integration)
Workers & Pages → Create → Pages → Connect to Git → this repo, with:
- **Root directory:** `apps/web`
- **Build command:** `cd ../.. && npm ci && npm run build -w @commonhours/web`
- **Build output directory:** `dist`
- **Environment variable:** `API_ORIGIN = https://<your-service>.onrender.com`; also `NODE_VERSION = 22`

Functions in `apps/web/functions` deploy automatically.

## 3. Check it works
1. Open the site URL (Render, or Pages if you used step 2). The login page should list the demo members.
2. Click **Mei Chen**, then **Trust Network**. You should see the path Mei → Sam with strength 0.49.
3. If the login page shows no members, the API isn't reachable. Check `/api/health` on Render, and `API_ORIGIN` if you use Pages.

## Daily job and email (needed for the community pool and student verification)

**Daily job (00:00 Asia/Hong_Kong).** The API starts an in-process scheduler (`DAILY_JOB_SCHEDULER=true`, the default) that checks every minute and runs the job for the current Hong Kong date once. That works on any always-on instance. **Render's free plan sleeps idle services**, so the timer will not fire at midnight there. Pick one:

- an always-on instance (Render *Starter* or above), or
- a **Render Cron Job** (paid) with schedule `0 16 * * *` (16:00 UTC = 00:00 HKT), the same repo, build `npm ci`, command `npx tsx apps/api/scripts/run-daily-job.ts`, the same `DATABASE_URL`; then set `DAILY_JOB_SCHEDULER=false` on the web service (optional, both together are safe: each date runs once).

Any other cron (GitHub Actions, a VM's crontab) can run the same script with `DATABASE_URL` set. A missed midnight is caught up on the next run.

**University email codes need real email.** With `NODE_ENV=production` the development preview is off, so student verification codes can only be sent when `EMAIL_PROVIDER` (Gmail or SMTP) is configured; otherwise the API answers "Email delivery is not configured". Also check that your sender is not blocked by the university mail systems.

## Notes and risks
- **Demo mode is public.** Anyone with the link can switch accounts or reset the data. That's intended for judging, but don't use it for real members. Set `DEMO_MODE=false` for a real pilot.
- **Reset after rehearsing:** use the **Reset demo** button (or `curl -X POST https://<site-url>/api/demo/reset`). Only one reset runs at a time, with a 15-second cooldown, so a public link can't be used to keep the database constantly reseeding.
- The local `docker-compose.yml` is for development only; production uses Render's managed Postgres.

## Verified locally (before deploy)
- `NODE_ENV=production npm run start:prod` against an empty database: migrations applied, demo seeded, server listening on `PORT`. A second start skips seeding. Debug routes return 404. Startup fails without `JWT_SECRET`.
- `NODE_ENV=production SERVE_WEB=true npm run start:prod` after `npm run build -w @commonhours/web`: `/` and deep links like `/exchanges/abc` serve the app, `/api/*` still returns JSON (including JSON 404s), and the browser demo flow and the credit-floor check pass on the single URL.
- `wrangler pages dev dist --binding API_ORIGIN=http://localhost:4000`: `/api/health`, authenticated errors and JSON POSTs proxy correctly, and SPA deep links like `/exchanges/abc` serve `index.html`.
