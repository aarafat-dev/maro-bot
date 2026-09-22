# n8n setup and operation

## Docker environment

The Compose service provides:

- pinned n8n image version;
- named persistent `/home/node/.n8n` volume;
- read-only `/store-data` client-data mount;
- restart policy and health check;
- Casablanca timezone defaults;
- execution pruning;
- disabled diagnostics/personalization;
- only `fs` and `crypto` enabled for Code nodes.

Start it with:

```bash
cp .env.example .env
docker compose config
docker compose up -d
docker compose ps
```

The first visit to the editor prompts for the n8n owner account. Use a strong unique password. Do not expose port 5678 directly to the internet in production; place it behind an HTTPS reverse proxy and restrict editor access.

## Store data

The workflow tries client-specific files first and falls back to examples:

```text
/store-data/products.json       → products.example.json
/store-data/faq.json            → faq.example.json
/store-data/store-config.json   → store-config.example.json
```

The client-specific files are Git-ignored. After changing them, validate with:

```bash
jq empty data/products.json data/faq.json data/store-config.json
npm test
```

The store owner must approve every value. A technically valid JSON file is not evidence that a policy or price is correct.

## Workflow import

1. Import `n8n/workflows/error-handler.json`.
2. Import `n8n/workflows/whatsapp-main.json`.
3. In main workflow settings, assign the imported error handler.
4. Save both.
5. Inspect HTTP Request nodes and confirm environment expressions are allowed.
6. Activate only the main workflow; error workflows are selected in settings rather than activated as triggers.

After importing a regenerated workflow, n8n may create a new workflow rather than replacing the existing one. Deactivate the old copy before activating the new one, because webhook paths are global.

## Environment expressions and credentials

The portable export reads `$env` for Meta and AI-provider secrets. Ensure your self-hosted n8n instance permits environment access in nodes. The Compose file explicitly sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` for this workflow.

For stronger separation, create two Header Auth credentials:

- Meta: header `Authorization`, value `Bearer YOUR_TOKEN`.
- AI provider: header `Authorization`, value `Bearer YOUR_AI_KEY`.

Assign them to the three HTTP nodes and remove the manual Authorization headers. See `n8n/credentials-notes.md`.

## Static-data memory

Workflow static data persists after successful production executions of an active workflow. It does not reliably persist during editor/manual testing. The main workflow keeps bounded session history and seven days of processed message IDs, and prunes sessions inactive for 90 days.

Limitations:

- concurrent executions can race;
- queue-mode workers do not provide a robust atomic deduplication guarantee;
- static data is stored with the workflow and is not a customer-service UI;
- one workflow should serve one store/client.

For higher traffic, move sessions to PostgreSQL and use a unique message-ID constraint. Redis can supply short locks, but durable history should remain in PostgreSQL. The exact schema is in `docs/architecture.md`.

## Clearing a handoff

Use the production admin webhook so the update runs inside the same workflow static-data scope:

```bash
scripts/clear-handoff.sh 2126XXXXXXXX https://bot.example.com
```

The endpoint is `POST /webhook/whatsapp/admin/clear-handoff`, requires `X-Handoff-Admin-Token`, normalizes the phone to digits, and changes only `human_handoff`. Rotate the token if it is exposed.

## Error workflow

Assign the error workflow manually after import because n8n workflow IDs are instance-specific. It writes a structured record to n8n logs. View recent logs with:

```bash
docker compose logs --since=30m n8n
```

Expected AI-provider/network response failures are handled in the main workflow and normally do not invoke the error handler. The deterministic response validator handles them.

## Workflow source and exports

`scripts/build-workflows.mjs` is the maintainable source used to produce both importable JSON files. After modifying it:

```bash
npm run build:workflows
npm test
```

If operators edit a workflow in the n8n UI, export it and reconcile the change with the generator. Otherwise, the next build overwrites the exported JSON.

## Updating n8n

1. Back up the `n8n_data` volume and `.env` securely.
2. Read release notes and check node migrations.
3. Change `N8N_VERSION` deliberately.
4. Pull and start in staging.
5. Import/test both workflows and all scenarios.
6. Promote only after webhook, static data, credentials, and Code nodes work.

Never regenerate `N8N_ENCRYPTION_KEY` during an upgrade; n8n needs the original key to decrypt saved credentials.
