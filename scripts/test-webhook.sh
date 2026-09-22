#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${project_dir}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${project_dir}/.env"
  set +a
fi

base_url="${1:-${WEBHOOK_TEST_BASE_URL:-http://localhost:5678}}"
source_payload="${2:-${project_dir}/samples/webhook-payload.json}"
webhook_url="${base_url%/}/webhook/whatsapp/webhook"
temp_payload="$(mktemp)"
trap 'rm -f "${temp_payload}"' EXIT

phone_number_id="${WHATSAPP_PHONE_NUMBER_ID:-123456789012345}"
customer_phone="${TEST_CUSTOMER_PHONE:-212612345678}"
message_id="wamid.LOCAL_TEST_$(date +%s)"

jq \
  --arg phone_number_id "${phone_number_id}" \
  --arg customer_phone "${customer_phone}" \
  --arg message_id "${message_id}" \
  '.entry[0].changes[0].value.metadata.phone_number_id = $phone_number_id
   | .entry[0].changes[0].value.contacts[0].wa_id = $customer_phone
   | .entry[0].changes[0].value.messages[0].from = $customer_phone
   | .entry[0].changes[0].value.messages[0].id = $message_id' \
  "${source_payload}" > "${temp_payload}"

curl_args=(
  --silent
  --show-error
  --fail-with-body
  --request POST
  --header "Content-Type: application/json"
  --data-binary "@${temp_payload}"
)

if [[ "${VERIFY_META_SIGNATURE:-false}" == "true" ]]; then
  if [[ -z "${WHATSAPP_APP_SECRET:-}" ]]; then
    echo "WHATSAPP_APP_SECRET is required when VERIFY_META_SIGNATURE=true" >&2
    exit 1
  fi
  signature="$(openssl dgst -sha256 -hmac "${WHATSAPP_APP_SECRET}" "${temp_payload}" | awk '{print $NF}')"
  curl_args+=(--header "X-Hub-Signature-256: sha256=${signature}")
fi

echo "POST ${webhook_url}"
curl "${curl_args[@]}" "${webhook_url}"
echo

