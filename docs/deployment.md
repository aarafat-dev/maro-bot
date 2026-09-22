# Deployment and client onboarding

## Recommended MVP deployment

Run one n8n instance and one named data volume per client, behind a managed HTTPS reverse proxy. Keep the editor private through an allowlist, VPN, identity-aware proxy, or separate protected hostname while allowing Meta to reach only the webhook path.

This repository intentionally avoids PostgreSQL, Redis, and queue workers for the first low-volume client. Add them when concurrency, availability, or reporting requirements justify the operational cost.

## Production environment

```env
N8N_HOST=bot.client-domain.example
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://automation.client-domain.example
WEBHOOK_URL=https://bot.client-domain.example/
N8N_SECURE_COOKIE=true
VERIFY_META_SIGNATURE=true
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_SECRET_TOKEN
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8
```

Use separate random values for `N8N_ENCRYPTION_KEY`, `WHATSAPP_VERIFY_TOKEN`, and `HANDOFF_ADMIN_TOKEN`. The Meta App Secret is not the verify token.
Store the Cloudflare token in the deployment secret store or an encrypted n8n credential; the placeholder above is illustrative only.

## Reverse-proxy requirements

- TLS 1.2 or newer and a valid public certificate.
- Preserve the exact POST body so Meta HMAC validation works.
- Forward `Host`, client protocol, and forwarding headers correctly.
- Permit Meta webhook POST/GET requests.
- Apply stricter controls to editor and handoff-admin paths.
- Do not log Authorization headers, query secrets, or full message bodies.
- Keep request-body limits reasonable; the MVP accepts short text/button/list messages only.

The workflow immediately returns `EVENT_RECEIVED`, then continues processing, reducing webhook retries caused by AI/API latency.

## First deployment checklist

- [ ] `.env` contains no placeholders.
- [ ] `N8N_ENCRYPTION_KEY` is backed up in a secure secret manager.
- [ ] Live product, FAQ, and config files are client-approved.
- [ ] Container data directory is mounted read-only.
- [ ] n8n owner account and editor network controls are enabled.
- [ ] Public callback resolves over HTTPS.
- [ ] Meta callback verification succeeds.
- [ ] `messages` is subscribed.
- [ ] HMAC verification is enabled and tested.
- [ ] Long-lived Meta token works with the production Phone Number ID.
- [ ] Cloudflare account/model work and the token is scoped only to Workers AI on the intended account.
- [ ] A deterministic message shows `response_source=deterministic` and makes no Workers AI request.
- [ ] A controlled relevant comparison shows `response_source=cloudflare_ai`.
- [ ] Simulated 429/5xx paths produce the safe fallback and handoff.
- [ ] Error workflow is assigned to the main workflow.
- [ ] Main workflow is active exactly once.
- [ ] `npm test` passes from the deployed revision.
- [ ] Live Darija, French, product, missing-product, human, and injection tests pass.
- [ ] Staff know how to see escalations and clear locks.
- [ ] Volume backup and restore have been tested.

## Client onboarding checklist

### Business discovery

Collect and confirm:

- legal/store display name and country;
- supported languages and desired tone;
- exact product catalogue fields and update owner;
- authoritative price and stock source;
- delivery areas, price, and estimated range;
- COD status and restrictions;
- opening hours;
- return, exchange, refund, discount, and warranty rules;
- staff escalation phone/process and service hours;
- prohibited promises and regulated-product constraints.

If a policy is not approved, omit it and let the bot escalate.

### Technical onboarding

1. Create a private deployment and secrets for the client.
2. Have the client own or grant access to the Meta app/WABA.
3. Register the phone number and permanent System User token.
4. Populate client-specific data files.
5. Import workflows and assign the error handler.
6. Configure the HTTPS callback and message subscription.
7. Run tests with the client present.
8. Define who monitors human handoffs and how quickly.
9. Record a rollback owner and change-approval process.

## Backups

The named `n8n_data` volume contains workflows, credentials, encryption metadata, execution data, and static session memory. Back it up consistently with the corresponding `N8N_ENCRYPTION_KEY`. Also back up the client-specific JSON files and deployment configuration in a private secret-aware system.

Perform restore drills in staging. A backup that has never been restored is unverified.

## Rollback

1. Deactivate the current main workflow or stop the container.
2. Restore the last tested n8n volume and matching encryption key.
3. Restore the last approved data files and image version.
4. Start n8n and verify the health endpoint.
5. Confirm only one workflow owns each webhook path.
6. Run callback verification and one controlled inbound message.

Do not roll back store data blindly if newer customer orders or handoffs depend on it; coordinate with store staff.

## Monitoring

At minimum monitor:

- container health and restart count;
- n8n error executions;
- Cloud API 4xx/5xx responses;
- Workers AI calls, 429/5xx errors, and fallback rate;
- deterministic-to-AI routing ratio and unexpected AI use;
- handoff count and unresolved handoff age;
- duplicate rate;
- unknown/missing-product queries;
- catalogue freshness.

Do not put tokens or full customer conversations into general-purpose alerts.

## Scaling and future roadmap

Migrate persistence before adding queue workers or multiple n8n replicas. Then add integrations behind the existing boundaries:

- Shopify live catalogue and order creation;
- order status with verified customer/order identity;
- Google Sheets CRM or lead capture;
- PostgreSQL durable sessions and analytics;
- Redis locking/cache;
- voice transcription and image recognition;
- approved-template abandoned-cart follow-ups;
- segmentation and analytics dashboard;
- staffed human-agent inbox;
- store-aware tenant isolation and per-tenant credentials.

Each feature needs its own authorization, data-retention, failure, and human-review design. None is silently enabled by this MVP.
