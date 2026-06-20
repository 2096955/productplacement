#!/usr/bin/env bash
# ============================================================
# deploy.sh — deploy the HSBC SSR Concept Lab to Cloud Run.
#
# Single service: the backend serves the built frontend, calls
# Vertex AI (Gemini Flash + gemini-embedding-001) via Application
# Default Credentials (the Cloud Run runtime service account).
# No API keys are used or required.
#
# Usage:
#   PROJECT=my-gcp-project ./deploy/deploy.sh
#
# All settings are parameterised via environment variables with
# sensible defaults. PROJECT is the only required value.
#
# Override examples:
#   PROJECT=acme REGION=europe-west2 VERTEX_LOCATION=europe-west2 \
#     GEMINI_MODEL=gemini-2.0-flash ./deploy/deploy.sh
# ============================================================
set -euo pipefail

# ---- Parameters (env with defaults) -------------------------------------
PROJECT="${PROJECT:-${GOOGLE_CLOUD_PROJECT:-}}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-ssr-concept-lab}"
VERTEX_LOCATION="${VERTEX_LOCATION:-us-central1}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
EMBED_MODEL="${EMBED_MODEL:-gemini-embedding-001}"
SSR_TEMPERATURE="${SSR_TEMPERATURE:-0.05}"

if [[ -z "${PROJECT}" ]]; then
  echo "ERROR: PROJECT is not set." >&2
  echo "  Run as:  PROJECT=your-gcp-project ./deploy/deploy.sh" >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not found on PATH. Install the Google Cloud SDK." >&2
  exit 1
fi

# Deploy from the repository root regardless of where the script is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "============================================================"
echo " Deploying ${SERVICE} to Cloud Run"
echo "   project          : ${PROJECT}"
echo "   region           : ${REGION}"
echo "   vertex location  : ${VERTEX_LOCATION}"
echo "   gemini model     : ${GEMINI_MODEL}"
echo "   embed model      : ${EMBED_MODEL}"
echo "   source           : ${ROOT_DIR}"
echo "============================================================"

# --source builds the image with Cloud Build using the repo Dockerfile,
# pushes to Artifact Registry, and deploys — one idempotent command.
gcloud run deploy "${SERVICE}" \
  --source "${ROOT_DIR}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --allow-unauthenticated \
  --port 8080 \
  --memory "${MEMORY:-512Mi}" \
  --cpu "${CPU:-1}" \
  --timeout "${TIMEOUT:-60}" \
  --max-instances "${MAX_INSTANCES:-4}" \
  --concurrency "${CONCURRENCY:-40}" \
  --set-env-vars "VERTEX_PROJECT=${PROJECT},VERTEX_LOCATION=${VERTEX_LOCATION},GEMINI_MODEL=${GEMINI_MODEL},EMBED_MODEL=${EMBED_MODEL},SSR_TEMPERATURE=${SSR_TEMPERATURE},RATE_LIMIT_PER_MIN=${RATE_LIMIT_PER_MIN:-20}"

# Print the resulting service URL.
URL="$(gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --format 'value(status.url)')"

echo ""
echo "============================================================"
echo " Deployed. Service URL:"
echo "   ${URL}"
echo " Health check:"
echo "   curl -s ${URL}/api/health"
echo "============================================================"

# ------------------------------------------------------------------------
# IMPORTANT — grant Vertex AI access to the Cloud Run runtime service account.
#
# By default Cloud Run runs as the Compute Engine default service account:
#   PROJECT_NUMBER-compute@developer.gserviceaccount.com
# It must hold roles/aiplatform.user for LIVE mode (Gemini + embeddings).
# Without it the app still works — it degrades silently to SAMPLE mode.
#
# Grant it (run once per project), substituting your project number:
#
#   PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
#   gcloud projects add-iam-policy-binding "${PROJECT}" \
#     --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
#     --role="roles/aiplatform.user"
#
# Also ensure the Vertex AI API is enabled:
#   gcloud services enable aiplatform.googleapis.com --project "${PROJECT}"
# ------------------------------------------------------------------------
