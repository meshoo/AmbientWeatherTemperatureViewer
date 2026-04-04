#!/usr/bin/env bash
# ============================================================
# ClaudeAWGraphs — One-time GCP project and VM setup
# Run from your local machine with gcloud authenticated.
# ============================================================
set -euo pipefail

PROJECT_ID="claudeawgraphs-prod"
REGION="us-central1"
ZONE="us-central1-a"
VM_NAME="claudeawgraphs-vm"
BILLING_ACCOUNT=""   # Fill in: gcloud billing accounts list

echo "==> Creating GCP project ${PROJECT_ID}"
gcloud projects create "${PROJECT_ID}" --name="ClaudeAWGraphs"

echo "==> Linking billing account"
# gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}"

echo "==> Enabling required APIs"
gcloud services enable compute.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> Creating e2-micro VM (always-free tier in ${ZONE})"
gcloud compute instances create "${VM_NAME}" \
  --project="${PROJECT_ID}" \
  --zone="${ZONE}" \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --tags=tailscale-node \
  --metadata=startup-script='#!/bin/bash
    apt-get update -y
    apt-get install -y git curl ca-certificates
    # Install Docker
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker micha
    # Install Docker Compose plugin
    apt-get install -y docker-compose-plugin
  '

echo ""
echo "==> VM created. Next steps:"
echo "  1. SSH in:"
echo "     gcloud compute ssh ${VM_NAME} --zone=${ZONE} --project=${PROJECT_ID} --tunnel-through-iap"
echo ""
echo "  2. Install Tailscale (on the VM):"
echo "     curl -fsSL https://tailscale.com/install.sh | sh"
echo "     sudo tailscale up --authkey=tskey-auth-YOURKEY --hostname=claudeawgraphs"
echo "     sudo tailscale serve --bg 3000"
echo ""
echo "  3. Clone and deploy (on the VM):"
echo "     git clone https://github.com/YOUR_USERNAME/ClaudeAWGraphs.git"
echo "     cd ClaudeAWGraphs"
echo "     cp .env.example .env && nano .env   # fill in AW_API_KEY, AW_APP_KEY, AW_DEVICE_MAC"
echo "     docker compose up -d"
echo ""
echo "  4. Verify:"
echo "     curl http://127.0.0.1:3000/api/admin/status"
