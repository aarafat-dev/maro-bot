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
base_url="${1:-${WEBHOOK_TEST_BASE_URL:-http://localhost:5678}}"
status="${2:-}"
url="${base_url%/}/webhook/whatsapp/admin/orders?limit=50"
if [[ -n "${status}" ]]; then url="${url}&status=${status}"; fi

curl --silent --show-error --fail-with-body \
  --url "${url}" \
  --header "X-Handoff-Admin-Token: ${HANDOFF_ADMIN_TOKEN}" | jq .
