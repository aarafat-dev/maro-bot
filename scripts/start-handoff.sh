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
phone_number="${1:?Usage: scripts/start-handoff.sh PHONE [BASE_URL] [MINUTES]}"
base_url="${2:-${WEBHOOK_TEST_BASE_URL:-http://localhost:5678}}"
minutes="${3:-${HUMAN_TAKEOVER_MINUTES:-60}}"

body="$(jq -n --arg phone_number "${phone_number}" --argjson minutes "${minutes}" '{phone_number:$phone_number,minutes:$minutes}')"
curl --silent --show-error --fail-with-body \
  --request POST \
  --url "${base_url%/}/webhook/whatsapp/admin/start-handoff" \
  --header "Content-Type: application/json" \
  --header "X-Handoff-Admin-Token: ${HANDOFF_ADMIN_TOKEN}" \
  --data "${body}"
echo
