# Deployment provenance

## Production Worker

- Name: `world-monitor`
- URL: `https://world-monitor.qwerjpo.workers.dev`
- Schedule: `*/15 * * * *`

## Cloudflare D1

- Binding: `DB`
- Database name: `world-intel-core`
- Database ID: `aed42027-fbdf-4d83-ae76-1dce3bcace44`
- Applied migrations:
  - `0001_initial.sql`
  - `0002_phase1_runtime.sql`
  - `0003_phase15_hardening.sql`

## Queues

- `world-intel-collect`
- `world-intel-analyze`
- `world-intel-notion`
- `world-intel-alert`

## Commit provenance

The deployed Git commit SHA is recorded in the GitHub issue completion comment and in D1 `deployment_provenance` after each production deployment. It is not hard-coded here because a file cannot contain the SHA of the commit that contains itself.
