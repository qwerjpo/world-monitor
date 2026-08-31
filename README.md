# WORLD INTELLIGENCE WATCH SYSTEM

PCを常時起動せず、無料クラウドを中心に世界情勢を収集・史料批判・早期警戒・予測・採点するシステムです。

## Core architecture

- **Cloudflare D1**: System of Record
- **Cloudflare Workers**: API / scheduler / collectors / analysis routing
- **Cloudflare Queues**: asynchronous collection and analysis
- **Workers AI**: LIGHT / STANDARD classification and analysis
- **GitHub Actions + Telethon**: Telegram collector
- **Google Drive**: Evidence Vault (optional in Phase 1)
- **Notion**: human-facing intelligence center
- **Telegram Bot**: WARNING / CRITICAL notifications
- **PWA**: smartphone dashboard

## Epistemic rules

1. Primary/official sources are not automatically true.
2. Separate `STATEMENT_FACT` from `CONFIRMED_FACT`.
3. Evaluate claims, not media brands, using Proximity / Interest / Verifiability (P-I-V).
4. Multiple reports sourced from the same origin count as one information stream.
5. Separate impact/urgency from event confidence.
6. Prefer mundane explanations before strategic-intent hypotheses.
7. `UNKNOWN`, `UNRESOLVED`, and `NO MATERIAL CHANGE` are valid outputs.
8. Predictions are preregistered and later scored.

## Repository layout

```text
migrations/          D1 SQL migrations
src/                 Cloudflare Worker source
src/collectors/      source collectors
src/analysis/        LIGHT / STANDARD analysis logic
src/notion/          Notion sync
src/alerts/          warning/critical alert engine
telegram/            Telethon collector
.github/workflows/   Telegram and maintenance jobs
docs/                architecture and Codex setup
public/              smartphone PWA
```

## Implementation order

1. Provision Cloudflare resources using `docs/CODEX_SETUP.md`.
2. Apply `migrations/0001_initial.sql` to D1.
3. Set secrets listed in `.dev.vars.example`.
4. Deploy Worker.
5. Verify `/health`.
6. Enable the initial collectors.
7. Configure Notion IDs and Telegram notification bot.
8. Add Telegram Telethon credentials to GitHub Actions Secrets.

See `AGENTS.md` before making implementation changes.
