# Credential notes

The committed workflow JSON contains no credential objects or secret values. It reads these environment variables at runtime:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `HANDOFF_ADMIN_TOKEN`
- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`

`OPENAI_API_KEY` and `OPENAI_MODEL` are optional legacy fallbacks when the three `AI_*` variables are blank.

Environment expressions make a fresh client deployment importable without binding it to credential IDs from another n8n instance.

## Preferred production hardening

After import, consider moving HTTP Authorization values to n8n credentials:

1. Create a Header Auth credential for the AI provider with header `Authorization` and value `Bearer AI_API_KEY_VALUE`.
2. Assign it to `Classify Language and Intent` and `Generate Grounded AI Reply`.
3. Remove the manual Authorization header from those nodes.
4. Create a separate Header Auth credential for Meta with the same header name and `Bearer META_TOKEN_VALUE`.
5. Assign it to `Send WhatsApp Reply` and `Send WhatsApp Error Fallback`.
6. Remove the corresponding tokens from the container environment after confirming the nodes work.

The phone-number ID, verify token, App Secret, and handoff token are still needed by Code/webhook nodes. Keep them in a secret manager or protected deployment environment.

## Rules

- Never export real credentials with workflow JSON.
- Never reuse the n8n encryption key as any application token.
- Never log access tokens or send them to the AI model.
- Use one set of client-owned Meta credentials per deployment.
- Grant only required WhatsApp assets and permissions to the System User.
- Rotate temporary Meta tokens before launch.
- Back up `N8N_ENCRYPTION_KEY` separately; losing it makes saved n8n credentials unreadable.
- If a token is exposed, revoke it at the provider and replace it—deleting it from Git history is not sufficient.
