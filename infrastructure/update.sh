#!/usr/bin/env bash
# ============================================================
# ClaudeAWGraphs — Update script (run on the GCP VM)
# Usage: cd ~/ClaudeAWGraphs && ./infrastructure/update.sh
# ============================================================
set -euo pipefail

echo "==> Pulling latest code"
git pull origin master

echo "==> Rebuilding and restarting container"
docker compose build --no-cache
docker compose up -d

echo "==> Waiting for health check..."
sleep 15

STATUS=$(curl -sf http://127.0.0.1:3000/api/admin/status && echo "OK" || echo "FAIL")
echo "==> Health check: ${STATUS}"

echo "==> Recent logs:"
docker compose logs --tail=30
