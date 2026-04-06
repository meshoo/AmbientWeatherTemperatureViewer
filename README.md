# AmbientWeatherTemperatureViewer

A self-hosted personal weather dashboard for [Ambient Weather](https://ambientweather.net) sensor arrays. Visualizes temperature data across multiple indoor/outdoor channels with day-over-day comparison to evaluate HVAC effectiveness over time.

![Node.js](https://img.shields.io/badge/Node.js-20-green) ![License](https://img.shields.io/badge/license-MIT-blue) ![Docker](https://img.shields.io/badge/Docker-Compose-blue)

## Features

- **Current** — Live readings from all enabled sensors (temp, humidity, feels-like, dew point, battery)
- **History** — Time-series line chart with 24h / 7d / 30d / 90d range selector
- **Compare** — Overlay any two days on the same 24-hour axis to assess day-over-day differences
- **Patterns** — Temperature snapshot at a specific time-of-day (breakfast, lunch, dinner, bedtime) plotted across months — useful for seasonal HVAC analysis
- **Admin** — Rename/enable/disable channels, trigger manual backfills, view collection status

## Hardware Requirements

**Required:**
- [Ambient Weather WS-2902](https://ambientweather.com/ws-2902) or compatible station with wireless indoor sensors
- An Ambient Weather account with API access enabled at [ambientweather.net/account](https://ambientweather.net/account)

**Optional:**
- Daikin One+ thermostat — a local push agent (see [Daikin integration](#daikin-integration)) can feed indoor setpoint and equipment status data alongside your AW sensors

## Quick Start

### Prerequisites

- Node.js 20+ (for local dev) or Docker + Docker Compose (for deployment)
- Ambient Weather API key and application key from your account settings

### Local Development (mock data, no hardware needed)

```bash
git clone https://github.com/YOUR_USERNAME/AmbientWeatherTemperatureViewer.git
cd AmbientWeatherTemperatureViewer
npm install
cp .env.example .env
USE_MOCK_DATA=true node server.js
# Open http://localhost:3000
```

### Production Deployment (Docker + Tailscale)

The recommended setup runs on a **GCP e2-micro VM** (always-free tier) with Tailscale for private access — no public ports exposed.

**1. Provision a VM** (GCP e2-micro in `us-central1-a` qualifies for the always-free tier):

```bash
# See infrastructure/setup-gcp.sh for the full setup script
gcloud compute instances create ambientweather-vm \
  --machine-type=e2-micro --zone=us-central1-a \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard
```

**2. On the VM, install Docker and Tailscale:**

```bash
curl -fsSL https://get.docker.com | sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=tskey-auth-YOURKEY --hostname=ambientweather
sudo tailscale serve --bg 3000   # Exposes port 3000 as HTTPS on your tailnet
```

**3. Clone and configure:**

```bash
git clone https://github.com/YOUR_USERNAME/AmbientWeatherTemperatureViewer.git
cd AmbientWeatherTemperatureViewer
cp .env.example .env
nano .env   # Fill in AW_API_KEY, AW_APP_KEY, AW_DEVICE_MAC
```

**4. Launch:**

```bash
docker compose up -d
# App is now live at https://ambientweather.YOUR-TAILNET.ts.net
```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
# Ambient Weather API — from ambientweather.net/account
AW_API_KEY=your_api_key
AW_APP_KEY=your_application_key
AW_DEVICE_MAC=                    # Find in the AW app: Devices → Device Info

# Daikin (optional — leave blank to disable)
INGEST_TOKEN=

# App settings
PORT=3000
DATA_RETENTION_DAYS=365
```

### Channel Configuration

On first run, the app seeds 8 channels (`temp1f`–`temp8f`) corresponding to your AW sensor array. By default only channels 1, 5, and 6 are enabled. Rename and enable/disable channels from the **Admin** page, or edit the `channels` table directly in SQLite.

## Architecture

```
┌──────────────────────────────────────────────┐
│              Single Docker container          │
│                                              │
│  Express web server        Collector         │
│  (routes → SQLite)    (every 5 min → AW API) │
│         └──────────────────┘                 │
│                    │                         │
│              SQLite (better-sqlite3)          │
└──────────────────────────────────────────────┘
         ▲ Tailscale Serve (HTTPS, tailnet only)
```

- **No build step** — EJS + Chart.js via CDN, plain CSS
- **SQLite** for all storage — no external DB required, trivial to back up
- **Background collector** polls Ambient Weather every 5 minutes and backfills gaps on startup
- **Rate limiting** — 1500ms minimum between AW API calls, 288-record/24h chunking

## Daikin Integration

Daikin One+ thermostats have a local REST API (`http://[thermostat-ip]:8080/v1/info`). A small push agent on your local machine reads the thermostat and POSTs to `/api/ingest/daikin`. The endpoint is stubbed — set `INGEST_TOKEN` in `.env` to activate it.

See `agent/README.md` (coming soon) for the Windows push agent setup.

## Updating

On the server:

```bash
cd ~/AmbientWeatherTemperatureViewer
./infrastructure/update.sh
```

## AI-Assisted Development

This project was built with [Claude Code](https://claude.ai/code). If you use Claude Code to work on it, copy `CLAUDE.md.example` to `CLAUDE.md` and fill in your own infrastructure details — `CLAUDE.md` is gitignored so your personal config stays private.

## License

MIT — see [LICENSE](LICENSE)
