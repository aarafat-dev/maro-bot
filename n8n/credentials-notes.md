# Credential notes

The committed workflow JSON contains no credential objects or secret values. Runtime configuration comes from:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `HANDOFF_ADMIN_TOKEN`
- `STORE_OWNER_WHATSAPP` (the separate owner/admin recipient, never the business sender number)
- `WHATSAPP_BUSINESS_PHONE` (used to reject accidental self-notification)
- `HUMAN_TAKEOVER_MINUTES`
- `CONVERSATION_CONTEXT_TTL_MINUTES`
- `ORDER_DRAFT_TTL_MINUTES`
- `ORDER_PHONE_SOURCE`
- `ORDER_STORE_PATH`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_AI_MODEL`
- `CLOUDFLARE_AI_MAX_TOKENS`

Environment expressions keep a fresh deployment importable without credential IDs from another n8n instance.

## Preferred production hardening

Create separate Header Auth credentials so provider tokens are encrypted by n8n rather than exposed to general Code-node environment access:

1. Create a Cloudflare Header Auth credential with header `Authorization` and value `Bearer CLOUDFLARE_API_TOKEN_VALUE`.
2. Assign it only to `Call Cloudflare Workers AI` and remove that node's manual Authorization header.
3. Create a separate Meta Header Auth credential with header `Authorization` and value `Bearer META_TOKEN_VALUE`.
4. Assign it to `Send WhatsApp Reply`, `Send Owner WhatsApp Notification`, `Send Configured Product Photo`, and `Send WhatsApp Error Fallback`; remove their manual Authorization headers.
5. After controlled tests succeed, remove `CLOUDFLARE_API_TOKEN` and `WHATSAPP_ACCESS_TOKEN` from the container environment if no remaining expression requires them.

The account ID, model, phone-number ID, verify token, App Secret, and handoff token remain runtime settings for Code/webhook nodes. Keep secrets in a protected deployment environment or secret manager.

## Cloudflare token scope

Use Cloudflare Dashboard → Workers AI → **Use REST API** → **Create a Workers AI API Token**. Scope the token only to the bot's account and Workers AI. Do not grant DNS, tunnel, zone, or account-administration access. Cloudflare's current REST setup guide should be treated as authoritative if its required Workers AI permission names change.

## Rules

- Never export real credentials with workflow JSON.
- Never reuse `N8N_ENCRYPTION_KEY`, the Meta verify token, or the App Secret as another credential.
- Never put tokens in product data, prompts, screenshots, chat messages, or source control.
- Never log Authorization headers or full provider error request objects.
- Use one client-owned Meta/Cloudflare credential set per deployment.
- Rotate temporary Meta tokens before launch.
- Revoke and replace any exposed credential; deleting it from Git history is not sufficient.
- Back up `N8N_ENCRYPTION_KEY` separately with the matching n8n volume.
