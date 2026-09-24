#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${project_dir}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${project_dir}/.env"
  set +a
fi

: "${HANDOFF_ADMIN_TOKEN:?Set HANDOFF_ADMIN_TOKEN in .env}"
phone_number="${1:?Usage: scripts/reset-conversation.sh PHONE [BASE_URL]}"
base_url="${2:-${WEBHOOK_TEST_BASE_URL:-http://localhost:5678}}"

body="$(jq -n --arg phone_number "${phone_number}" '{phone_number:$phone_number}')"
curl --silent --show-error --fail-with-body \
  --request POST \
  --url "${base_url%/}/webhook/whatsapp/admin/reset-conversation" \
  --header "Content-Type: application/json" \
  --header "X-Handoff-Admin-Token: ${HANDOFF_ADMIN_TOKEN}" \
  --data "${body}"
echo
