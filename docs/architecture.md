# Architecture

## Runtime flow

```mermaid
flowchart TD
    WA[Meta WhatsApp Cloud API] --> W[POST webhook]
    W --> ACK[Immediate 200 acknowledgment]
    ACK --> V[Shape + phone ID + optional HMAC]
    V --> N[Normalize and cap input]
    N --> D[Load durable context + message ID deduplication]
    D -->|duplicate or handoff active| STOP[Stop automation]
    D --> DATA[Read-only store JSON]
    DATA --> O[Pending field + durable order state machine]
    O -->|not order-related| R[Deterministic security and sales router]
    O -->|order response| SAVE
    R -->|known fact / greeting / image / rejected| SAVE[Save structured state]
    R -->|relevant unresolved only| B[Build minimal Workers AI request]
    B --> CF[Cloudflare Workers AI REST API]
    CF --> G[Grounding and output validator]
    G -->|valid| SAVE
    G -->|429 / 5xx / invalid| H[Safe reply + handoff]
    H --> SAVE
    SAVE --> SEND[Meta messages endpoint]
    SAVE -->|confirmed order / human request| OWNER[Idempotent owner notification]
```

The GET verification webhook and protected clear-handoff webhook remain separate branches in the main workflow. Unexpected failures use the separate error-trigger workflow.

Orders are written atomically inside the existing persistent n8n volume. Store facts remain read-only and authoritative; order records and customer PII never enter Cloudflare context. See `docs/orders.md` for transitions, persistence, owner notification, takeover, and scaling boundaries.

## Trust boundaries

1. **Untrusted customer data:** message text, image captions, button/list labels, headers, and profile/event metadata. Text is cleaned and capped before use. It cannot select a file, command, endpoint, credential, or model.
2. **Trusted business data:** `products.json`, `faq.json`, and `store-config.json`, mounted at fixed read-only paths under `/store-data`.
3. **Secrets:** Meta and Cloudflare tokens, Meta App Secret, webhook verify token, handoff token, and n8n encryption key. They come from environment variables or n8n credentials and never enter model context or ordinary logs.

The deterministic router is the policy boundary. Clearly irrelevant or adversarial input is answered there, before a Workers AI request can be built.

Its internal classification is three-way: `RELEVANT_UNDERSTOOD` for deterministic answers, `RELEVANT_UNCERTAIN` for store-related questions that need clarification or bounded interpretation, and `OUT_OF_SCOPE` for static rejection. A failed product match alone is never sufficient to mark a shopping/customer-service message out of scope.

## Deterministic routing

The router performs, in order:

1. language detection;
2. data-driven product alias matching;
3. explicit security and out-of-scope rejection;
4. deterministic intent signals;
5. structured product/store/FAQ lookup;
6. direct response where the source-of-truth data is sufficient;
7. an `ai_needed` decision only for a relevant unresolved or interpretive question.

Product aliases live only in product data. Normalization lowercases text, removes basic punctuation and Latin diacritics, and collapses whitespace. Multiple explicit products produce a comparison only when the message contains comparison language; otherwise the bot asks for clarification.

## Workers AI adapter

Provider-specific behavior is isolated to the build, HTTP, and validation nodes. The current adapter calls:

```text
POST /client/v4/accounts/{account_id}/ai/run/{model}
```

Its input contract is:

```json
{
  "normalized_message": "customer user data",
  "language": "darija",
  "ai_context": {
    "products": [],
    "store": {}
  }
}
```

Only matched products and question-relevant store fields are included. The system message is fixed; customer text is a separate user-role JSON payload. The provider adapter returns:

```json
{
  "reply": "...",
  "should_handoff": false,
  "response_source": "cloudflare_ai",
  "ai_status": "success"
}
```

Failures return a localized deterministic reply, `response_source=deterministic`, and a handoff status. Replacing Cloudflare requires only a new adapter that preserves these contracts.

## Grounding controls

- The JSON catalogue/configuration is authoritative; the model is not a database.
- Only relevant matched records enter `ai_context`.
- Prices and other numeric claims must already appear in trusted context or the customer question.
- Unsupported size, color, material, warranty, promotion, authenticity, and waterproof claims are rejected.
- Credential/prompt/environment terminology in output is rejected.
- Invalid JSON, excessive output, a model-requested handoff, missing configuration, 429, and 5xx all fail closed to a safe handoff response.
- Output is capped at 700 characters and model generation at 64–512 tokens.

## Image boundary

Incoming images are treated as a supported message type so the customer receives a useful reply. No media is downloaded and no Media ID is stored or mapped to a product. Meta Media IDs can change across uploads and are not stable catalogue keys. V1 performs no vision inference and never sends an image to Workers AI.

If `last_product_id` is current, the bot may ask whether the image question concerns that product; it never claims the image itself established the identity.

## Persistence model

The durable JSON store at `ORDER_STORE_PATH` contains:

```text
orders[order_id]
active_orders_by_customer[wa_id]
conversations[wa_id]
processed_order_messages[message_id]
notifications[notification_key]
```

Order and conversation mutations use a fixed operator-controlled path, an exclusive lock, a mode-`0600` temporary file, and same-directory atomic rename. Drafts expire according to `ORDER_DRAFT_TTL_MINUTES` and remain as historical `ABANDONED` records. Terminal orders are never kept as active editable drafts.

Conversation records include:

```text
preferred_language
conversation_mode
pending_action / pending_field / pending_fields
pending_product_id / pending_order_id
last_bot_action / last_bot_question
last_intent
last_product_id / last_product_at / last_requested_color
active_order_id / order_status
handoff_status / handoff_until / automation_enabled
last_activity_at / updated_at
```

Product/FAQ context expires according to `CONVERSATION_CONTEXT_TTL_MINUTES`. Processed webhook IDs expire after seven days, and the static compatibility mirror prunes inactive sessions after 90 days. The workflow does not keep or send an unbounded conversation transcript.

Workflow static data remains a compatibility mirror for the early duplicate/handoff guard. Legacy fields (`language`, `last_seen`, and `human_handoff`) remain stored while durable state drives pending questions and orders. Catalog presence and inventory are separate: `catalogued=true` means the product belongs to the store, while `stock_status=unknown` requires staff confirmation and must never be presented as live stock.

The local locked store is appropriate for one low-volume n8n container. Do not use it with queue mode or multiple replicas. Before scaling, use a database uniqueness constraint on `(store_id, message_id)` and a bounded session record keyed by `(store_id, phone_number)`.

## Handoff and error behavior

Explicit human requests, returns/refunds, unknown live stock, and AI/provider failures set the handoff lock. Later events are recorded for deduplication but do not proceed to store routing or AI. Staff clears the lock through the timing-safe-token-protected admin webhook.

Unexpected n8n failures enter the error workflow. Logs contain workflow name, node, execution ID, timestamp, a redacted bounded error message, and only the final four phone digits. Stack traces, Authorization values, tokens, and complete customer phone numbers are not deliberately logged.
