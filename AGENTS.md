# AGENTS.md

## Mission
Build and maintain the WORLD INTELLIGENCE WATCH SYSTEM as a low-cost, mobile-first, continuously running OSINT / early-warning platform.

## Non-negotiable analytical rules

- Treat every source, including governments, militaries, NGOs, media and OSINT accounts, as a potentially interested actor.
- `STATEMENT_FACT` means only that a statement/publication occurred. It must never be silently promoted to `CONFIRMED_FACT`.
- Evaluate important claims at claim level using:
  - P1..P4 = proximity
  - I0..I3 = interest/conflict
  - V1..V3 = verifiability
- Trace source lineage. Reposts, wire copies, shared press briefings, and derivative coverage are not independent corroboration.
- Preserve uncertainty. `UNKNOWN`, `UNRESOLVED`, `UNCONFIRMED`, and `NO MATERIAL CHANGE` are valid outputs.
- Separate event probability from confidence in the assessment.
- For strategic-intent hypotheses, test mundane explanations first.
- Never infer personal culpability or criminal conduct without direct evidence.
- High-impact / low-confidence reports must be trackable and may alert, but must be labeled unconfirmed.

## Engineering rules

- Cloudflare D1 is the System of Record. Notion is not authoritative storage.
- Avoid storing large raw media in D1.
- All collectors must record health, last-success time, error state, and data gaps.
- No collector failure may be interpreted as "no activity".
- Use idempotency keys and content hashes for ingestion.
- Queue expensive work; do not perform multi-source analysis in request handlers.
- Respect free-tier budgets. Critical-alert capacity must be reserved before normal processing.
- Never commit secrets. Use Wrangler secrets / GitHub Actions Secrets.
- Write migrations; do not hand-edit production D1 schema.
- Every probability update >10 percentage points requires DEEP review; >20 points also requires red-team review.

## Phase 1 acceptance criteria

A deployment is Phase-1 complete only when all are true:

1. Cloudflare Worker `/health` returns database and configuration status.
2. D1 schema is applied successfully.
3. Scheduler runs every 15 minutes and dispatches due collector jobs.
4. At least GDACS and USGS collectors ingest normalized evidence automatically.
5. Duplicate ingestion is prevented using unique source/external IDs or hashes.
6. Evidence can produce candidate claims and analysis-queue entries.
7. Important records sync to the configured Notion data sources.
8. WARNING/CRITICAL alerts can be sent through Telegram Bot.
9. Collector health and budget state are visible through API and Notion System Health.
10. No required process depends on a user's PC remaining powered on.

## Notion targets

WORLD INTELLIGENCE CENTER page:
`3cd60a31-f105-813d-b61f-d749149cc960`

Data source IDs:

- Alerts: `50c2ebd7-9c0a-4967-85ac-63b4d98c09be`
- Events: `857d1c29-dadc-4f05-a82c-515b41a63422`
- Trends: `9ed4cbc1-92b5-4f67-a00d-90fdcab06854`
- Scenarios: `78ca568e-6ac2-4ce3-a431-add659365536`
- Indicators: `790126bc-40f3-4e5c-9af2-f12ad1cfeb15`
- Assessments: `c4e0e252-d6ef-4c62-a24e-2e674419b0dc`
- Forecast Ledger: `dc0d6362-4364-4b4c-8850-f59a369a08a6`
- High-Value Claims: `c5954dea-fb73-424e-9680-a38a679cf261`
- Sources: `6cfe72ee-5fcb-41de-ade8-4efc436e41f0`
- System Health: `34caf045-0c93-46b3-9d5a-14f4f635588c`

## First implementation task

Follow `docs/CODEX_SETUP.md` exactly. If Cloudflare authentication requires user interaction, stop only at that authentication boundary, clearly state the single action required from the user, then continue all automatable steps afterwards.
