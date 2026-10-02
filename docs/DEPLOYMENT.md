# Deploying CommonHours

**Architecture (option a):**

```
Browser ──► Cloudflare Pages (static React app + /api/* Pages Function proxy)
                 │  API_ORIGIN
                 ▼
            Render Web Service (Express API, Node 22) ──► Render PostgreSQL
```

The web app calls `/api/...` on its own origin. `apps/web/functions/api/[[path]].ts` forwards those calls to the API, so no CORS setup or build-time API URL is needed.

## 1. API + database on Render (about 10 minutes)

1. Push this repo to GitHub (already done for `claude/lucid-meitner-o1jtse`; merge to your main branch first if you prefer).
2. Go to https://dashboard.render.com → **New → Blueprint** and pick the repo. Render reads `render.yaml` and creates:
   - `commonhours-db` (PostgreSQL, free plan)
   - `commonhours-api` (Node web service): `npm ci --include=dev`, then `npm run start:prod`, which runs `prisma migrate deploy`, seeds the demo **only if the database is empty**, and starts the server.
3. Once it's live, open `https://<your-service>.onrender.com/api/health`. It should return `{"ok":true,...}`.
4. Note the service URL. You need it as `API_ORIGIN` below.

Environment variables (set by the blueprint):

| Key | Value |
| --- | --- |
| `DATABASE_URL` | from `commonhours-db` |
| `JWT_SECRET` | generated (the server refuses to start in production without one) |
| `DEMO_MODE` | `true`: public account switcher, simulated clock and **Reset demo** for everyone |
| `DEBUG_ENDPOINTS` | `false` (debug routes are also always off when `NODE_ENV=production`) |
| `WEB_ORIGIN` | your Pages URL (only used for CORS if you ever call the API directly) |

> The free Render plan sleeps after inactivity, so the first request after a pause takes around 30–60 s. Open the site a minute before you present.

## 2. Web app on Cloudflare Pages

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
1. Open the Pages URL. The login page should list the demo members.
2. Click **Mei Chen**, then **Trust Network**. You should see the path Mei → Sam with strength 0.49.
3. If the login page shows no members, the API isn't reachable: check `API_ORIGIN` and `/api/health` on Render.

## Notes and risks
- **Demo mode is public.** Anyone with the link can switch accounts or reset the data. That's intended for judging, but don't use it for real members. Set `DEMO_MODE=false` for a real pilot.
- **Reset after rehearsing:** use the **Reset demo** button (or `curl -X POST https://<pages-url>/api/demo/reset`).
- The local `docker-compose.yml` is for development only; production uses Render's managed Postgres.

## Verified locally (before deploy)
- `NODE_ENV=production npm run start:prod` against an empty database: migrations applied, demo seeded, server listening on `PORT`. A second start skips seeding. Debug routes return 404. Startup fails without `JWT_SECRET`.
- `wrangler pages dev dist --binding API_ORIGIN=http://localhost:4000`: `/api/health`, authenticated errors and JSON POSTs proxy correctly, and SPA deep links like `/exchanges/abc` serve `index.html`.
