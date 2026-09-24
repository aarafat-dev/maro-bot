# Orders, owner notifications, and takeover

## Runtime placement

`Order Sales State Machine` runs after trusted store data is loaded and before the existing deterministic FAQ/product router. It handles only order, delivery-time, photo, negotiation, and human-request messages. Unhandled messages continue through the existing deterministic and Cloudflare paths unchanged.

Legal transitions are:

```text
NONE → COLLECTING
COLLECTING → AWAITING_CONFIRMATION | CANCELLED | HANDOFF | ABANDONED
AWAITING_CONFIRMATION → COLLECTING | CONFIRMED | CANCELLED | HANDOFF | ABANDONED
CONFIRMED → OWNER_NOTIFIED
HANDOFF → COLLECTING | CANCELLED | ABANDONED
OWNER_NOTIFIED, CANCELLED, and ABANDONED are terminal
```

An acknowledgement such as `ok`, `sf`, or `wakha` confirms only when the persisted order is `AWAITING_CONFIRMATION`, `awaiting_confirmation_prompted=true`, and the last relevant bot action is `REQUEST_FINAL_CONFIRMATION`. A FAQ response changes that last action, so a later `ok` is only an acknowledgement until the customer explicitly resumes the draft and sees the summary again. Purchase intent never skips collection or the final summary.

## Durable store

Orders are stored at `ORDER_STORE_PATH`, defaulting to `/home/node/.n8n/whatsapp-orders.json`. This is inside the existing named `n8n_data` volume, so it survives workflow, n8n, and Docker restarts.

Writes use a fixed operator-controlled path, an exclusive lock, mode `0600`, a same-directory temporary file, and atomic rename. Stale locks older than 30 seconds are recoverable. This is deliberately small infrastructure for the current single-container deployment and roughly 150 messages/day.

The store contains orders, durable conversation records, the active order per customer, processed order-message IDs, and owner/handoff notification records. Conversation records include mode, pending action/field/product/order, the last bot action/question, fresh product context, active order, language, and timestamps. Each update is a patch: null or absent extraction never erases a valid order field.

The order state machine reloads the conversation and order while holding the file lock. Clear FAQ intent is evaluated before pending-field capture, while short contextual answers still resolve the pending field. Missing fields are recalculated from the merged persisted order in the same atomic transaction.

FAQ context expires independently according to `CONVERSATION_CONTEXT_TTL_MINUTES`. `COLLECTING`, `AWAITING_CONFIRMATION`, and `HANDOFF` drafts older than `ORDER_DRAFT_TTL_MINUTES` become `ABANDONED`. Their historical records remain, but the active-order map and pending conversation fields are cleared. Confirmed, cancelled, owner-notified, and abandoned records are never resumed as editable drafts.

Do not run multiple n8n replicas against a non-shared local volume. Migrate orders and message idempotency to PostgreSQL before queue mode or horizontal scaling.

## Owner notification

`STORE_OWNER_WHATSAPP` is the separate owner/admin recipient. Messages are sent from the configured WhatsApp Business Cloud API number. `WHATSAPP_BUSINESS_PHONE` is the sender's actual E.164 number and lets the reservation step refuse a self-target.

The current node sends a free-form text alert. Meta can reject that message when the owner recipient is not eligible for free-form delivery (for example, no open customer-service window, an unapproved recipient in development mode, or another account restriction). Verify this with the actual WABA. If the owner must receive business-initiated alerts outside the permitted window, replace the text body with an approved utility template; failures remain durable and visible as described below.

Confirmation and notification are separate durable events:

1. The order becomes `CONFIRMED` and is persisted.
2. The customer receives a confirmation response.
3. The notification is reserved as `SENDING` once.
4. Meta success changes the order to `OWNER_NOTIFIED` and notification to `SENT`.
5. Failure leaves the order `CONFIRMED` with notification `FAILED`.

Automatic HTTP retries are disabled for owner alerts. A protected manual retry is allowed for a still-`PENDING` alert (for example, if customer acknowledgement failed before the owner branch ran) or a `FAILED` alert, with fewer than two total attempts:

```bash
scripts/retry-owner-notification.sh ORD-... https://YOUR_BOT_DOMAIN
```

A crash after Meta accepts a message but before the success record is written can leave `SENDING`. It is intentionally not retried automatically because exact-once delivery cannot be guaranteed across an external API without a provider idempotency key. Reconcile it manually in Meta/n8n.

## Human takeover

Customer requests set `handoff_status=active`, `automation_enabled=false`, and `handoff_until`. The draft order is preserved as `HANDOFF`. While active, the pre-router guard stops automated replies and Cloudflare. Expiry only permits a future customer message to resume automation; it does not send anything by itself.

```bash
scripts/start-handoff.sh 2126XXXXXXXX https://YOUR_BOT_DOMAIN 60
scripts/clear-handoff.sh 2126XXXXXXXX https://YOUR_BOT_DOMAIN
```

The currently configured inbound Cloud API webhook and subscribed events do not expose a reliable signal for every message an owner manually sends from a separate interface. The workflow therefore uses explicit protected takeover controls. If WhatsApp Business App Coexistence or another operator interface is later enabled and verified to deliver suitable authenticated outgoing events for this account, add that as a separate signal.

## Admin visibility

The protected read-only endpoint exposes recent order records:

```bash
scripts/list-orders.sh https://YOUR_BOT_DOMAIN
scripts/list-orders.sh https://YOUR_BOT_DOMAIN CONFIRMED
```

It contains personal data. Restrict it at the network layer, protect `HANDOFF_ADMIN_TOKEN`, and never send its output to Cloudflare AI or public logs.

## Reset one development conversation

The protected reset clears conversation context and the active-draft reference only for the supplied WhatsApp ID. An active draft becomes `ABANDONED`; historical confirmed/cancelled/notified orders are retained.

```bash
scripts/reset-conversation.sh 2126XXXXXXXX https://YOUR_BOT_DOMAIN
```

This endpoint is for operators during testing. Do not expose it to customers, and keep it behind the same network controls as the other admin endpoints.

## Product photos

Products support `"media": { "images": [] }`. Only operator-configured HTTPS links are accepted and are sent through Meta image messages. Current arrays are empty, so the bot fabricates nothing and asks a human to send photos. Incoming customer images still receive text-only clarification; no vision recognition was added.
