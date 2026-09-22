# Meta WhatsApp Cloud API setup

Use only the official Meta WhatsApp Cloud API. Meta dashboard labels can change, but the resource values and webhook contract below remain the same. Start from the [official Cloud API documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).

## 1. Create or access a Meta Developer account

Sign in at [Meta for Developers](https://developers.facebook.com/) with the account that should administer the client's integration. Complete any requested business verification or two-factor authentication.

## 2. Create a Meta app

Create an app for the client, choose the business use case presented by Meta, and associate the correct Business Portfolio. Use one client-owned app per client when possible.

## 3. Add the WhatsApp product

In the app dashboard, add **WhatsApp**, open **API Setup**, and connect or create the client's WhatsApp Business Account (WABA).

## 4. Use the test phone number first

Meta provides a test sender and lets you register test recipients. Add your own recipient phone and complete its verification. Free-form outbound tests are limited to registered recipients at this stage.

## 5. Copy resource IDs

From WhatsApp **API Setup**, copy:

- **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
- **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`.

The phone number ID is a numeric API resource ID, not the visible telephone number.

## 6. Generate an access token

The dashboard's temporary token is suitable for the first test only. For production, create a Business Manager System User, assign the app and WABA assets, and issue a long-lived token with only the WhatsApp permissions the integration needs. Store it in `WHATSAPP_ACCESS_TOKEN` or an n8n credential.

Never paste the token into workflow JSON, screenshots, chat messages, or source control.

## 7. Expose the n8n webhook over HTTPS

Set production values similar to:

```env
N8N_HOST=bot.example.com
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://bot.example.com
WEBHOOK_URL=https://bot.example.com/
N8N_SECURE_COOKIE=true
```

Activate the main n8n workflow. Its callback URL is:

```text
https://bot.example.com/webhook/whatsapp/webhook
```

Do not give Meta the editor's temporary `/webhook-test/` URL.

## 8. Configure verification

Generate a private value and set it as `WHATSAPP_VERIFY_TOKEN`. In the Meta app's WhatsApp webhook configuration:

- Callback URL: the production callback above.
- Verify token: the exact same value.

Meta sends `hub.mode`, `hub.verify_token`, and `hub.challenge`. The GET branch compares the token and returns only the challenge on success.

Troubleshoot verification with:

```bash
curl --get 'https://bot.example.com/webhook/whatsapp/webhook' \
  --data-urlencode 'hub.mode=subscribe' \
  --data-urlencode 'hub.verify_token=YOUR_VERIFY_TOKEN' \
  --data-urlencode 'hub.challenge=12345'
```

A correct configuration returns `12345` with HTTP 200. A wrong token returns HTTP 403.

## 9. Subscribe to messages

In WhatsApp webhooks, subscribe the WABA to the `messages` field. Message delivery/status events share this subscription; the workflow ignores events without a supported inbound message.

Copy the app's **App Secret** to `WHATSAPP_APP_SECRET`, then set:

```env
VERIFY_META_SIGNATURE=true
```

The webhook's raw request body is HMAC-SHA256 verified against `X-Hub-Signature-256`. Restart n8n after environment changes.

## 10. Send and receive the first test

Send from the Meta test sender:

```bash
TEST_RECIPIENT_PHONE=2126XXXXXXXX scripts/test-message.sh "Hello from the store bot"
```

Then send `Salam` from the registered recipient to the Meta test number. Confirm:

1. Meta receives HTTP 200 quickly.
2. An n8n production execution appears.
3. The payload normalizes to the correct phone and message ID.
4. The bot returns a Darija greeting.
5. A second delivery of the same message ID produces no second reply.

Use `scripts/test-webhook.sh` to simulate Meta, including a correct signature when signature verification is enabled.

## Production phone number

Before launch, add and verify the client's real number, set its display name, complete any business requirements, and replace the test Phone Number ID/token values. Confirm the number is not simultaneously registered in an incompatible WhatsApp app.

## Messaging window and templates

Replies to a customer's inbound message normally occur inside Meta's customer-service window. Business-initiated messages outside that window require an approved template. This MVP only automates inbound replies; abandoned carts and follow-ups belong in a later template-aware workflow.

## Common failures

| Symptom | Check |
| --- | --- |
| Verification fails | Workflow active, public HTTPS works, correct callback path and verify token. |
| POST returns 200 but no reply | Event is a message, phone-number ID matches, no active handoff, execution logs. |
| `invalid_signature` | Correct App Secret, raw body enabled, proxy did not rewrite the body. |
| Cloud API returns 401/403 | Token expiry, asset assignment, scopes, correct app/WABA. |
| Cloud API returns unsupported recipient | Register the recipient for the test sender or use the production setup. |
| Duplicate replies | Confirm the same workflow is not active twice and message IDs reach the dedup node. |

