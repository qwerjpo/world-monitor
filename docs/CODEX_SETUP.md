# CODEX_SETUP.md

This guide is written so Codex can perform nearly all setup. User interaction should only be required for account authentication or creation of third-party credentials.

## 1. Local prerequisites

Install or verify:

```bash
node --version
npm --version
npx wrangler --version
python --version
```

If Wrangler is unavailable, use `npx wrangler` rather than requiring a global install.

## 2. Cloudflare login

Run:

```bash
npx wrangler login
```

If browser authorization is required, ask the user to approve Cloudflare access once, then continue.

## 3. Initialize project

If package.json is absent:

```bash
npm init -y
npm install -D wrangler typescript @cloudflare/workers-types
```

Create a TypeScript Worker project without replacing repository documentation.

## 4. Provision D1

Create one database named:

```text
world-intel-core
```

Command:

```bash
npx wrangler d1 create world-intel-core
```

Record the returned database ID in `wrangler.jsonc` under binding `DB`.

Apply migrations:

```bash
npx wrangler d1 migrations apply world-intel-core --remote
```

## 5. Queues

Attempt to create these queues if available on the account/free plan:

```text
world-intel-collect
world-intel-analyze
world-intel-notion
world-intel-alert
```

Use Wrangler-supported queue commands for the installed version. Do not guess syntax: consult `npx wrangler queues --help` if necessary.

If Queues is unavailable, implement a Phase-1 D1-backed job queue as fallback. Do not block the project solely because Queues is unavailable.

## 6. Workers AI

Add an AI binding named `AI` if available.

Use an economical multilingual model available to the account. The application must not hard-code a model that may later disappear; model name belongs in configuration.

Phase 1 must work with AI disabled. Rule-based ingestion and health monitoring are mandatory fallbacks.

## 7. Cron

Configure one cron trigger:

```text
*/15 * * * *
```

The scheduled handler reads `collector_jobs` and dispatches only jobs whose `next_run_at <= now`.

## 8. Notion secrets

Required Cloudflare secrets:

```text
NOTION_TOKEN
INTERNAL_INGEST_TOKEN
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Set with:

```bash
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put INTERNAL_INGEST_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Never place values in tracked files.

Notion data source IDs are listed in `AGENTS.md` and should be stored as non-secret vars in `wrangler.jsonc`.

## 9. Initial collectors

Implement first:

### USGS earthquakes

Use the official USGS GeoJSON feed. Store individual events by stable external ID. Collector classification: `disaster`, independent physical/agency observation.

### GDACS

Use an official GDACS feed/API format that is currently available. Normalize disasters into evidence records. Do not treat GDACS severity text as proof of local impact; preserve source semantics.

### RSS/Atom official collector

Generic parser for explicitly configured official feeds. Official status means `STATEMENT_FACT` by default, not `CONFIRMED_FACT`.

Do not start GDELT or Telethon until these base collectors and deduplication are proven.

## 10. Telegram collector

Implement in `telegram/` using Python + Telethon and GitHub Actions.

The collector must:

- monitor only explicitly configured channels;
- store message ID, channel ID, posting time, edit time, forward metadata, permalink, text, and media metadata;
- call the Cloudflare `/ingest/telegram` endpoint using `INTERNAL_INGEST_TOKEN`;
- never store Telegram credentials in the repository;
- avoid collecting private chats or unrelated personal content.

GitHub Actions Secrets later required:

```text
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELETHON_SESSION
CF_INGEST_URL
CF_INGEST_TOKEN
```

## 11. Health endpoints

Implement:

```text
GET /health
GET /api/alerts
GET /api/events
GET /api/scenarios
GET /api/system-health
POST /ingest/manual
POST /ingest/telegram
```

Ingestion endpoints require authentication.

`/health` must distinguish:

- service reachable;
- D1 reachable;
- last scheduler run;
- each collector's data gap;
- AI enabled/disabled;
- Notion sync configured/not configured;
- notification configured/not configured.

## 12. Notion sync

Notion is a projection layer, not authoritative storage.

Sync only:

- WARNING/CRITICAL alerts;
- active or high-impact events;
- tracked scenarios;
- non-normal indicators that matter to a scenario;
- completed assessments;
- pending/evaluated forecasts;
- high-value claims;
- system-health problems and budget warnings.

Keep a D1 mapping table of `object_type + object_id -> notion_page_id` to update existing pages instead of creating duplicates.

## 13. Alerts

Telegram bot notifications occur only for:

- `WARNING`;
- `CRITICAL`;
- explicitly configured High-Impact/Low-Confidence events;
- RED collector-health failure for critical sources.

Every alert must state event confidence separately from assessment confidence.

## 14. Free-tier guardian

Implement configurable soft thresholds. At budget pressure:

1. stop low-priority AI enrichment;
2. reduce normal collector cadence;
3. preserve critical source collection;
4. preserve warning/critical alert capability;
5. record the degraded mode in System Health.

Never automatically opt into paid tiers.

## 15. Phase-1 verification

After deployment:

1. `GET /health` succeeds.
2. Trigger scheduler manually if possible.
3. Confirm USGS and GDACS produce `evidence` rows.
4. Run same collector twice and confirm no duplicate evidence.
5. Create one test event and confirm Notion projection.
6. Send a test WARNING notification through Telegram bot.
7. Confirm collector failure simulation becomes System Health YELLOW/ORANGE/RED rather than `no activity`.

## 16. Deploy

Use:

```bash
npx wrangler deploy
```

After deployment, write the deployed URL and outstanding manual configuration to a GitHub issue titled `Phase 1 deployment status`.
