#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${project_dir}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${project_dir}/.env"
  set +a
fi

: "${WHATSAPP_ACCESS_TOKEN:?Set WHATSAPP_ACCESS_TOKEN in .env}"
: "${WHATSAPP_PHONE_NUMBER_ID:?Set WHATSAPP_PHONE_NUMBER_ID in .env}"
: "${TEST_RECIPIENT_PHONE:?Set TEST_RECIPIENT_PHONE to a Meta-approved test recipient}"

graph_version="${WHATSAPP_GRAPH_VERSION:-v23.0}"
message="${1:-Hello from the WhatsApp Store Bot test}"
api_url="https://graph.facebook.com/${graph_version}/${WHATSAPP_PHONE_NUMBER_ID}/messages"

body="$(jq -n \
  --arg to "${TEST_RECIPIENT_PHONE}" \
  --arg message "${message}" \
  '{messaging_product:"whatsapp",recipient_type:"individual",to:$to,type:"text",text:{preview_url:false,body:$message}}')"

curl \
  --silent \
  --show-error \
  --fail-with-body \
  --request POST \
  --url "${api_url}" \
  --header "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  --header "Content-Type: application/json" \
  --data "${body}"
echo

