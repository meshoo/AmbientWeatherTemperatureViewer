# ClaudeAWGraphs — AI Session Context

Start Claude Code from this directory (`ClaudeAWGraphs/`) so this file loads automatically.

## What This Project Is

Personal weather monitoring web app. Pulls temperature from Ambient Weather cloud API, stores in
SQLite, visualizes with Chart.js. Single user (Michael), runs on GCP e2-micro (free tier),
accessed via Tailscale only.

- **Current page**: live sensor readings, auto-refreshes via `/api/current`
- **History page**: time-series chart (24h / 7d / 30d / 90d), data from `/api/readings`
- **Compare page**: day-over-day overlay chart — primary use case for HVAC analysis
- **Patterns page**: snapshot at a specific time-of-day, plotted over months
- **Admin page**: channel config, collection status, manual backfill

## Stack

- **Node.js 20 + Express 4** (no TypeScript)
- **EJS templates** — server-side rendering, no React/Vue
- **Chart.js 4** via CDN — no build step
- **better-sqlite3** — synchronous SQLite (intentional, not an oversight)
- **node-cron** — in-process background scheduler
- **Docker Compose** with `127.0.0.1:3000` port binding; Tailscale on host exposes as HTTPS

## Critical Architecture Decisions (Do Not Revisit)

1. **Single container**: web server + collector in the same Node.js process. VM has 1GB RAM — two
   containers would waste ~150MB. Do not split into microservices.
2. **Synchronous DB calls**: `better-sqlite3` is synchronous. Do not add async DB wrappers or
   convert to `node-sqlite3`. This is correct for single-process, read-heavy, no-concurrent-writers.
3. **Routes never call AW API**: all Ambient Weather API calls happen in
   `src/services/ambientWeather.js` on a schedule. Routes only query SQLite.
4. **Daikin is push-based (stub)**: `POST /api/ingest/daikin` exists but returns 404 unless
   `INGEST_TOKEN` is set. The local Windows push agent (not yet built) POSTs here.

## File Map

```
server.js                    Entry point: DB init → Express → collector.start()
src/app.js                   Express factory
src/collector.js             Cron jobs: 5-min poll, weekly prune, startup backfill
src/db/schema.js             CREATE TABLE statements + default channel seed
src/db/index.js              better-sqlite3 singleton
src/db/queries.js            All SQL query functions (no SQL anywhere else)
src/services/ambientWeather.js  AW API client, rate limiting, backfill logic
src/services/mockData.js     Mock AW API (USE_MOCK_DATA=true)
src/routes/api.js            JSON API endpoints + Daikin ingest stub
src/routes/views.js          EJS page routes
views/                       EJS templates
public/style.css             All CSS (single file, no inline styles in views)
scripts/migrate-json-cache.js  One-time migration from CursorAWGraphs JSON cache
infrastructure/setup-gcp.sh  GCP project + VM setup instructions
infrastructure/update.sh     VM-side update script
```

## Ambient Weather API Constraints

- **Rate limit**: 1500ms minimum between calls (`MIN_CALL_INTERVAL_MS` in ambientWeather.js)
- **288 records max per call** = exactly 24 hours at 5-min intervals
- **Must chunk**: date ranges are split into 24-hour windows in `_fillGap()`
- **MAC format**: `'00:0E:C6:30:22:8B'` (colons, uppercase) — from `AW_DEVICE_MAC` env var
- **npm package**: `ambient-weather-api@0.0.6`

## Database

- **File**: `/app/data/claudeawgraphs.db` (Docker volume `app-data`)
- **Schema** auto-applied on startup via `src/db/schema.js`
- **Tables**: `readings`, `channels`, `collection_log`
- **Timestamps**: Unix milliseconds throughout (matches AW API format)
- **Channel keys**: `temp1f`..`temp8f` for Ambient; `daikin_indoor` etc. for Daikin

### Michael's sensor config (seeded by default)
| Key     | Name          | Enabled |
|---------|---------------|---------|
| temp1f  | Outside       | yes     |
| temp2f  | Channel 2     | no      |
| temp3f  | Channel 3     | no      |
| temp4f  | Channel 4     | no      |
| temp5f  | Guest Bedroom | yes     |
| temp6f  | Master Bedroom| yes     |
| temp7f  | Channel 7     | no      |
| temp8f  | Channel 8     | no      |

## Environment Variables

All documented in `.env.example`. Required: `AW_API_KEY`, `AW_APP_KEY`, `AW_DEVICE_MAC`.
Optional: `INGEST_TOKEN` (Daikin), `DATA_RETENTION_DAYS` (default 365), `USE_MOCK_DATA`.

## Local Development (no hardware)

```bash
npm install
cp .env.example .env   # no keys needed for mock mode
USE_MOCK_DATA=true node server.js
# open http://localhost:3000
```

## Deployment (GCP VM)

```bash
gcloud compute ssh claudeawgraphs-vm --zone=us-central1-a --project=claudeawgraphs-prod --tunnel-through-iap
# on VM:
cd ~/ClaudeAWGraphs
./infrastructure/update.sh
```

## Common Tasks

- **Add a new view**: create `views/foo.ejs`, add route in `src/routes/views.js`, add API endpoint in
  `src/routes/api.js` if needed, add nav link in `views/partials/nav.ejs`
- **Add a Daikin channel**: insert a row into `channels` table with `source='daikin'`, then update
  `src/routes/api.js` ingest endpoint to handle the new field
- **Change poll interval**: edit the cron expression in `src/collector.js`
- **Manual backfill**: `POST /api/admin/backfill` with `{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}`
  or use the Admin page
- **Backup DB**: `docker compose exec app sh -c 'cat /app/data/claudeawgraphs.db' > backup.db`
- **Check logs**: `docker compose logs -f`

## What Intentionally Does NOT Exist

- No authentication beyond Tailscale network access
- No user accounts or sessions
- No build step (no webpack, tsc, etc.)
- No test suite
- No Redis or external cache — SQLite is the cache
- No Cloud SQL or Firestore — SQLite only, for cost reasons
- No TypeScript — keep it simple for open-source portability
