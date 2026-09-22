# WhatsApp Store Bot

A reusable customer-support MVP for ecommerce stores, built with n8n, the official Meta WhatsApp Cloud API, and an OpenAI-compatible AI provider. It handles Darija, French, and English, searches client-owned data before answering, validates model output, and escalates whenever a fact is missing or uncertain.

The repository contains importable n8n workflows—not an unofficial WhatsApp Web client and not a custom backend service.

## What it does

- Receives and acknowledges Meta webhook events.
- Handles Meta's `GET` webhook verification challenge.
- Optionally verifies `X-Hub-Signature-256` against the Meta App Secret.
- Normalizes phone number, message ID, text, type, timestamp, and customer name.
- Ignores statuses, unsupported message types, and empty events.
- Detects Darija, French, English, and unknown language.
- Classifies all MVP intents with strict JSON output.
- Searches FAQ, delivery, COD, and product data before composing a factual reply.
- Uses the configured AI provider only for classification and natural wording; deterministic fallbacks keep the bot useful during AI errors.
- Rejects ungrounded output, unexpected source IDs, leaked internal terms, and unsupported numeric claims.
- Stores recent conversation context per WhatsApp phone number.
- Deduplicates webhook retries by WhatsApp message ID.
- Locks automation after a human handoff and exposes a protected endpoint for clearing that lock.
- Logs unexpected workflow failures without exposing internals to customers.

## Architecture

```text
Customer → WhatsApp → Meta Cloud API → n8n webhook
                                          ↓
                              validate and normalize
                                          ↓
                          session and duplicate guard
                                          ↓
                          language + intent classifier
                                          ↓
                     FAQ / product / order / human route
                                          ↓
                           deterministic trusted context
                                          ↓
                         AI wording → output validation
                                          ↓
                       save conversation → Cloud API send
```

The product search node is the replaceable data boundary. Swap it for Shopify, Google Sheets, PostgreSQL, Airtable, or another API without changing the safety and response nodes. See [architecture.md](docs/architecture.md).

## Requirements

- Docker Engine and the Docker Compose v2 plugin (`docker compose version`).
- A public HTTPS hostname for production webhooks.
- A Meta Developer account and Meta app with the WhatsApp product.
- A WhatsApp test or production phone number.
- A Groq API key for the free default, or another Responses API-compatible provider key.
- Node.js 20 or newer only if running the offline repository tests.
- `jq`, `curl`, and `openssl` for the shell smoke tests.

## Local installation

```bash
cp .env.example .env
cp data/products.example.json data/products.json
cp data/faq.example.json data/faq.json
cp data/store-config.example.json data/store-config.json
```

Generate two different random secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Put the first value in `N8N_ENCRYPTION_KEY` and the second in `HANDOFF_ADMIN_TOKEN`. Edit the three non-example JSON files for the client. They are ignored by Git.

Validate and start n8n:

```bash
docker compose config
docker compose up -d
docker compose ps
docker compose logs --tail=100 n8n
```

Open <http://localhost:5678> and create the n8n owner account. Local HTTP is for development only.

## Environment configuration

All supported variables are documented inline in [.env.example](.env.example). The required client values are:

| Variable | Purpose |
| --- | --- |
| `N8N_ENCRYPTION_KEY` | Encrypts n8n credentials at rest; never rotate casually. |
| `WHATSAPP_ACCESS_TOKEN` | Meta System User or temporary test token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Sender phone-number resource ID, not the visible phone number. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID, reserved for later account operations. |
| `WHATSAPP_VERIFY_TOKEN` | Private value used during Meta webhook verification. |
| `WHATSAPP_APP_SECRET` | Used for webhook HMAC verification. |
| `HANDOFF_ADMIN_TOKEN` | Protects the clear-handoff endpoint. |
| `AI_API_KEY` | Authorizes AI Responses API calls; use the Groq key by default. |
| `AI_BASE_URL` | Provider API base URL; defaults to Groq. |
| `AI_MODEL` | Provider model ID; defaults to `openai/gpt-oss-20b`. |

`DATABASE_URL` is deliberately unused in this MVP. It reserves a clear migration path to PostgreSQL.

## Importing the workflows

1. Start n8n and sign in.
2. Import [whatsapp-main.json](n8n/workflows/whatsapp-main.json).
3. Import [error-handler.json](n8n/workflows/error-handler.json).
4. Open the main workflow settings and select `WhatsApp Store Bot - Error Handler` as its error workflow.
5. Save both workflows.
6. Confirm the three JSON files are visible inside the container at `/store-data`.
7. Activate the main workflow. Static conversation data is persisted only by production executions, not editor test runs.

The workflows use environment expressions for portability. For stricter production isolation, move the Meta and AI-provider tokens to n8n Header Auth credentials as described in [credentials-notes.md](n8n/credentials-notes.md).

## Meta WhatsApp setup

The production callback URL is:

```text
https://YOUR_BOT_DOMAIN/webhook/whatsapp/webhook
```

Enter the exact value from `WHATSAPP_VERIFY_TOKEN`, verify the callback, then subscribe the WhatsApp Business Account to `messages`. Set `VERIFY_META_SIGNATURE=true` before accepting production traffic.

The full ten-step Meta setup, test-number instructions, permanent-token guidance, and troubleshooting are in [meta-whatsapp-setup.md](docs/meta-whatsapp-setup.md).

## AI setup and grounding

The default free configuration uses Groq's OpenAI-compatible Responses API and `openai/gpt-oss-20b`. Set `AI_API_KEY` to your Groq key; `AI_BASE_URL` and `AI_MODEL` are already populated in `.env.example`. Both calls use strict JSON Schema output and `store: false`:

1. Language and intent classification.
2. Brief natural wording from trusted context.

Customer text is explicitly delimited as untrusted input. The model never queries arbitrary store facts. FAQ and product nodes construct the only trusted context, and a separate validation node rejects ungrounded source IDs, unsupported numbers, secret-like output, or factual wording without a source. A deterministic reply or human handoff is used on failure.

Older deployments using `OPENAI_API_KEY` and `OPENAI_MODEL` remain supported when all three `AI_*` variables are blank.

## Testing

Run the fully offline checks; no API keys are needed:

```bash
npm test
```

This validates JSON, workflow topology, embedded Code-node syntax, secret patterns, data contracts, and these scenarios:

- `Salam` → Darija greeting.
- `Vous livrez à Casablanca ?` → French answer using configured delivery data.
- `ch7al Jagwar?` → 90 MAD for one pair, 150 MAD for two, and 29 MAD delivery.
- `wach Jagwar kayna?` → human confirmation because stock was not supplied.
- `3ndkom ndader Nokia titanium?` → no invented product; human handoff.
- `wach n9der nchofhom 9bel mankhless?` → inspect first, then pay on delivery.
- `ila ma3jbnich n9der nbdel?` → confirms the configured exchange policy.
- `bghit nhder m3a chi wahed` → handoff lock.
- prompt injection → no hidden data or credential disclosure.
- duplicate message ID → no second automated reply.

After activating the workflow, simulate an inbound webhook:

```bash
TEST_CUSTOMER_PHONE=2126XXXXXXXX scripts/test-webhook.sh https://YOUR_BOT_DOMAIN
```

Send an outbound Meta test message:

```bash
TEST_RECIPIENT_PHONE=2126XXXXXXXX scripts/test-message.sh "Hello from the store bot"
```

Only send free-form outbound messages when Meta permits them; outside the customer-service window, use an approved template.

## Human handoff

The workflow sets `human_handoff=true` for explicit human requests, complaints/refunds/payment issues, unknown or low-confidence requests, missing data, failed product searches, and unsafe model output. Later messages are recorded but receive no automated reply while the lock is active.

After a staff member finishes the conversation, clear the lock:

```bash
scripts/clear-handoff.sh 2126XXXXXXXX https://YOUR_BOT_DOMAIN
```

Keep this admin endpoint behind network controls when possible and always protect it with a long, independent token.

## Deployment

Production requires:

- HTTPS termination with a valid public certificate.
- Correct public `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` values.
- n8n owner authentication and restricted editor access.
- A persistent `n8n_data` volume with tested backups.
- `N8N_SECURE_COOKIE=true`.
- `VERIFY_META_SIGNATURE=true` and a correct Meta App Secret.
- A long-lived least-privilege Meta System User token.
- Client-specific JSON data reviewed by the store owner.
- Execution pruning, monitoring, and an assigned error workflow.

See [deployment.md](docs/deployment.md) for the rollout, backup, rollback, and client onboarding checklists.

## Client onboarding

For each new store:

1. Copy this repository into a separate private deployment.
2. Create client-specific `.env` and non-example data files.
3. Confirm every price, stock value, policy, delivery promise, and FAQ with the client.
4. Create or connect the client's Meta app, WABA, and phone number.
5. Import and configure both workflows.
6. Run all offline and live test cases in all supported languages.
7. Train staff on handoff notifications and lock clearing.
8. Activate production and monitor the first conversations closely.

Do not share one static-data workflow across unrelated clients. Use a separate deployment per client until multi-tenant storage and isolation are implemented.

## Security considerations

- No credentials are committed; `.env` and live client data are ignored.
- The official Cloud API is used—never WhatsApp Web session automation.
- Webhook payload shape, phone-number ID, and optionally Meta HMAC are validated.
- Inputs are length-limited and control characters are removed.
- Tokens are never written to workflow logs.
- AI requests use `store: false`; review your own privacy and retention requirements.
- The read-only `/store-data` mount limits accidental catalogue writes.
- `fs` and `crypto` are the only built-ins enabled in Code nodes.
- Restrict n8n editor access separately from the public webhook paths.
- Rotate compromised tokens and update the relevant Meta/n8n credentials immediately.

## Data and workflow development

Business configuration lives in `data/`; automation logic lives in `scripts/build-workflows.mjs`. Regenerate the importable exports after changing workflow source:

```bash
npm run build:workflows
npm test
```

Changes made directly in the n8n editor are not automatically copied back to the generator. Export, review, and deliberately reconcile them.

## Future improvements

The architecture leaves clear boundaries for Shopify live catalogue and order creation, order status, Google Sheets CRM, PostgreSQL, Redis, voice-note transcription, image/product recognition, abandoned-cart follow-ups, segmentation, analytics, automatic lead capture, a human-agent dashboard, and multi-store tenancy. These are documented but intentionally not implemented in this MVP.

## Documentation index

- [Architecture and safety boundaries](docs/architecture.md)
- [Meta WhatsApp Cloud API setup](docs/meta-whatsapp-setup.md)
- [n8n import, operation, and persistence](docs/n8n-setup.md)
- [Deployment and onboarding](docs/deployment.md)
- [Credential handling](n8n/credentials-notes.md)
