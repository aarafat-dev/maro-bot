# WhatsApp Store Sales Assistant

A production-oriented, low-cost WhatsApp sales assistant built with n8n, Meta WhatsApp Cloud API, structured store data, and Cloudflare Workers AI as a narrowly gated fallback.

It also supports progressive multi-message order collection, explicit final confirmation, durable local order persistence, idempotent owner notification, and protected human takeover. See [Orders and takeover](docs/orders.md).

The catalogue and store JSON files are authoritative. Greetings, prices, sizes, delivery, known payment facts, obvious product questions, images, irrelevant requests, and security probes are handled without AI. Workers AI is called only when a store-related question genuinely needs language interpretation.

## Message flow

```text
Meta WhatsApp
  → n8n webhook + immediate acknowledgment
  → payload / phone-number / optional HMAC validation
  → input normalization and length cap
  → duplicate + handoff guard
  → read-only store data
  → deterministic order state machine and durable draft/confirmation storage
  → deterministic security, relevance, intent, and alias matching
      ├─ answer known fact directly (response_source=deterministic)
      ├─ reject irrelevant/adversarial input directly
      ├─ clarify ambiguous product or image directly
      └─ relevant unresolved question only
           → Cloudflare Workers AI REST API
           → grounding/output validation
           → response_source=cloudflare_ai, or safe deterministic handoff fallback
  → bounded structured session state
  → Meta messages endpoint
```

The GET verification webhook and protected handoff-clear webhook remain separate branches. Unexpected failures go to the separate error workflow, which redacts credential-shaped text and logs only the last four customer-number digits.

## Requirements

- Docker Engine and Docker Compose v2.
- A public HTTPS hostname for Meta webhooks.
- A Meta app with WhatsApp Cloud API.
- A Cloudflare account with Workers AI access.
- Node.js 20+ for offline tests.
- `jq`, `curl`, and `openssl` for shell smoke tests.

## Local setup

```bash
cp .env.example .env
cp data/products.example.json data/products.json
cp data/faq.example.json data/faq.json
cp data/store-config.example.json data/store-config.json
openssl rand -hex 32
openssl rand -hex 32
```

Use different generated values for `N8N_ENCRYPTION_KEY` and `HANDOFF_ADMIN_TOKEN`. Never commit `.env`.

Validate and start:

```bash
docker compose config
docker compose up -d
docker compose ps
docker compose logs --tail=100 n8n
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `N8N_ENCRYPTION_KEY` | Encrypts persisted n8n credentials; keep stable and backed up. |
| `WHATSAPP_ACCESS_TOKEN` | Meta System User token or temporary test token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta sender resource ID. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID. |
| `WHATSAPP_BUSINESS_PHONE` | Actual sender number; prevents owner alerts targeting the sender itself. |
| `WHATSAPP_VERIFY_TOKEN` | Private webhook verification value. |
| `WHATSAPP_APP_SECRET` | Verifies `X-Hub-Signature-256`. |
| `HANDOFF_ADMIN_TOKEN` | Protects takeover, order-inspection, retry, and test-reset endpoints. |
| `STORE_OWNER_WHATSAPP` | Separate owner/admin recipient for confirmed-order alerts. |
| `HUMAN_TAKEOVER_MINUTES` | Protected manual-takeover duration. |
| `CONVERSATION_CONTEXT_TTL_MINUTES` | Fresh FAQ, product, and pending-question context lifetime. |
| `ORDER_DRAFT_TTL_MINUTES` | Maximum idle age for active drafts before they become `ABANDONED`. |
| `ORDER_PHONE_SOURCE` | Customer-phone preference policy. |
| `ORDER_STORE_PATH` | Durable order JSON path inside `n8n_data`. |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns Workers AI usage. |
| `CLOUDFLARE_API_TOKEN` | Dedicated Workers AI API token. |
| `CLOUDFLARE_AI_MODEL` | Configurable Cloudflare model identifier. |
| `CLOUDFLARE_AI_MAX_TOKENS` | Output cap, clamped by the workflow to 64–512. |

The default model is `@cf/meta/llama-3.1-8b-instruct-fp8`, a currently supported Cloudflare-hosted multilingual text-generation model. The model is configured once through the environment and is not scattered through routing nodes.

## Cloudflare Workers AI setup

No separately deployed Worker is required. n8n calls Cloudflare's supported REST endpoint directly:

```text
POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{MODEL}
```

1. Open Cloudflare Dashboard → Workers AI → **Use REST API**.
2. Copy the Account ID into `CLOUDFLARE_ACCOUNT_ID`.
3. Choose **Create a Workers AI API Token** and scope it only to the account used by this bot. Do not grant DNS, tunnel, zone, or unrelated permissions. If creating a custom token, follow Cloudflare's current REST guide for the required Workers AI permissions.
4. Copy the token once into `CLOUDFLARE_API_TOKEN` in `.env` or, preferably, an n8n Header Auth credential.
5. Keep the default model or set another compatible text-generation model in `CLOUDFLARE_AI_MODEL`.
6. Restart n8n after changing environment values.

Official references:

- [Workers AI REST API setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)
- [Workers AI model catalogue](https://developers.cloudflare.com/workers-ai/models/)
- [Cloudflare API token creation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

## Where AI is called

Workers AI is not called for:

- greetings and “I have a question” openers;
- known product price or size questions;
- known delivery or payment facts;
- known catalogue characteristics;
- unsupported size/material/color facts that can be answered safely as unknown;
- ambiguous product identification, which receives a deterministic clarification;
- out-of-scope requests and prompt/secret/command injection attempts;
- incoming images;
- duplicate messages or sessions locked for human handoff.

Workers AI is called once when all of these are true:

1. the message passed the security and relevance gate;
2. it is clearly related to this store or the current product context;
3. deterministic logic cannot confidently answer it; and
4. natural-language interpretation is useful, such as a nuanced comparison using multiple known facts.

Only the normalized customer message, matched product records, relevant store fields, and language are sent. Secrets, Docker settings, `.env`, unrelated products, logs, and full conversation history are never added to the request.

Each prepared response contains:

```text
response_source=deterministic
```

or:

```text
response_source=cloudflare_ai
```

Inspect `response_source` in the n8n execution data after the router/validator nodes. It is also recorded against the processed message ID in workflow static data; it is not sent to the customer.

## Cloudflare failure behavior

The HTTP node has a 20-second timeout and at most two total attempts. HTTP 429, 5xx, missing credentials, malformed model output, and failed grounding checks produce a localized deterministic technical response and activate the existing human-handoff lock. There is no retry loop.

## Products and aliases

Edit `data/products.json`; keep `data/products.example.json` aligned for tests and new deployments. Aliases are data-driven:

```json
{
  "id": "nike-double-face-jacket",
  "name": "Jaket Nike Double Face",
  "aliases": ["nike", "jaket nike", "veste nike", "جاكيط نايك"]
}
```

Matching lowercases text, removes basic punctuation/diacritics, collapses whitespace, and compares product names and aliases. Do not add speculative colors, materials, stock, promotions, or sizing advice. When more than one product is plausibly named and the message is not a comparison, the bot asks which product the customer means.

The store scope is four products. All four confirmed identities and their existing local catalog image paths are recorded. Complete commerce facts currently exist only for `nike-double-face-jacket` and `cotton-montoni-tracksuit`; products 3 and 4 keep unknown price, size, material, delivery, and payment fields as `null`/empty values instead of fabricated facts. The runtime loader excludes incomplete products from customer-facing sales routing until those required facts are confirmed.

Catalog images remain under `data/products-images/` and are referenced through each product's `image_path`. These paths are catalog metadata only: they are not Meta Media IDs, are not uploaded automatically, and do not enable customer-image recognition. Outgoing product media still requires separately configured approved HTTPS entries under `media.images`.

The router emits one of three internal outcomes:

- `RELEVANT_UNDERSTOOD`: answer or clarify deterministically;
- `RELEVANT_UNCERTAIN`: store-related interpretation may pass the AI gate;
- `OUT_OF_SCOPE`: return the static store-only response with no AI call.

Color aliases are normalized deterministically to `Black` or `White`. Unsupported colors retain the matched/current product and return its catalogued colors without invoking AI.

## Conversation context

The workflow stores lightweight structured state per phone number in the same atomically written persistent file as draft orders:

```text
preferred_language
conversation_mode
pending_action
pending_field / pending_fields
pending_product_id / pending_order_id
last_bot_action / last_bot_question
last_intent
last_product_id
last_product_at
last_requested_color
active_order_id / order_status
handoff_status
last_activity_at
```

Compatibility fields `language`, `last_seen`, and `human_handoff` remain mirrored in workflow static data. FAQ/product/pending context expires according to `CONVERSATION_CONTEXT_TTL_MINUTES` (default 1,440 minutes). Active drafts are durable but expire independently after `ORDER_DRAFT_TTL_MINUTES` (default 1,440 minutes); they remain in history as `ABANDONED` and are removed from conversational routing. Atomic patch/merge writes prevent absent fields in a new message from erasing previously collected values. Customer message history is not retained as an unbounded transcript or forwarded to AI.

## Incoming images (V1)

Customer-uploaded images are never downloaded, recognized, or sent to Workers AI. The workflow does not persist or map incoming Meta Media IDs because re-uploads can receive different IDs and they are not durable product identifiers. Existing files under `data/products-images/` are trusted catalog assets referenced by `image_path`; they are not used for vision inference or uploaded to Meta automatically. With recent context, the bot may ask whether an incoming image question concerns that known product without claiming it identified the image.

The normalization/router boundary leaves room for a future explicitly authorized vision service without changing webhook, deduplication, state, or send nodes.

## Security and relevance filtering

Input is control-character cleaned, whitespace-normalized, and capped at 1,000 characters before routing. Explicit prompt extraction, secret access, environment/file access, command execution, malware/code, homework, politics, and unrelated public-figure questions receive a static store-scope reply and never reach AI.

The filter intentionally allows normal openers such as `salam`, `bonjour`, `hello`, `bghit nswlk`, and `wach momkin nswlk?`.

Customer text is always placed in the user message of the Workers AI request as JSON data. It is never inserted into the system instructions. Code nodes never construct shell commands or file paths from customer input; store files are fixed paths mounted read-only.

## Testing without WhatsApp

All routing and provider-failure tests are offline and require no credentials:

```bash
npm test
```

The suite regenerates both workflow exports, validates every embedded Code node, checks for committed secret patterns, and exercises 22 FAQ/routing scenarios, 25 order scenarios, and the state-first multi-turn context regressions. It includes pending questions, multiline/rapid slot merging, FAQ↔order transitions, language persistence, the AI gate, 429/5xx handling, order idempotency, and human takeover.

Run only routing scenarios:

```bash
npm run test:scenarios
```

Run only real-conversation order scenarios:

```bash
npm run test:orders
```

Run only context/state regressions:

```bash
npm run test:context
```

After importing and activating the workflow, simulate a signed Meta webhook:

```bash
TEST_CUSTOMER_PHONE=2126XXXXXXXX scripts/test-webhook.sh https://YOUR_BOT_DOMAIN
```

This can trigger a real outbound reply if production credentials and the test recipient are configured. The Node.js test suite itself never sends WhatsApp messages or calls Workers AI.

## n8n workflow import/update

1. Back up the n8n volume and export the currently active workflows.
2. Import `n8n/workflows/error-handler.json` and `n8n/workflows/whatsapp-main.json`.
3. If n8n creates new copies, deactivate the old main workflow before activating the new one; webhook paths must be unique.
4. Assign the imported error handler in the main workflow settings.
5. Confirm environment access is allowed and the three JSON files are visible under `/store-data`.
6. Activate the main workflow exactly once.
7. Run deterministic tests before adding Cloudflare credentials, then verify one controlled AI-routed comparison.

Importing as a new workflow creates a new static-data scope, so existing deduplication/session/handoff state is not automatically migrated. Update the existing workflow in place if retaining that state is operationally required.

## Human handoff

Missing live stock, explicit human requests, returns/refunds, and AI/provider failures set `human_handoff=true`. Later messages are deduplicated but receive no automation until staff clears the lock:

```bash
scripts/clear-handoff.sh 2126XXXXXXXX https://YOUR_BOT_DOMAIN
```

Protect the admin path at the network layer and keep `HANDOFF_ADMIN_TOKEN` independent from every other secret.

To clear FAQ context and detach/abandon only the active draft for one development test number, while preserving historical orders:

```bash
scripts/reset-conversation.sh 2126XXXXXXXX https://YOUR_BOT_DOMAIN
```

## Replacing Cloudflare later

Provider-specific logic is isolated to three nodes generated by `scripts/build-workflows.mjs`:

- `Build Cloudflare AI Request`
- `Call Cloudflare Workers AI`
- `Validate Cloudflare AI Reply`

A later Groq, OpenAI, or other provider adapter should preserve the router input (`normalized_message`, `language`, `ai_context`) and validator output (`reply`, `should_handoff`, `response_source`, `ai_status`). No webhook, catalogue, security, deduplication, handoff, or Meta send redesign is needed.

## Production notes

- Use a stable named HTTPS tunnel or reverse proxy; accountless Quick Tunnels have no uptime guarantee.
- Restrict the n8n editor separately from public webhook routes.
- Set `VERIFY_META_SIGNATURE=true` and use the correct Meta App Secret.
- Use a long-lived least-privilege Meta System User token; temporary test tokens expire.
- Keep `N8N_ENCRYPTION_KEY` stable and back up the matching n8n volume.
- Review every catalogue and store-policy fact with the store owner.
- Static workflow data is suitable for one low-volume instance, not concurrent queue workers; migrate deduplication/session state to PostgreSQL before scaling.

More detail:

- [Architecture and trust boundaries](docs/architecture.md)
- [Deployment checklist](docs/deployment.md)
- [Meta WhatsApp setup](docs/meta-whatsapp-setup.md)
- [n8n operation](docs/n8n-setup.md)
- [Credential handling](n8n/credentials-notes.md)
- [Orders, owner notifications, and takeover](docs/orders.md)
