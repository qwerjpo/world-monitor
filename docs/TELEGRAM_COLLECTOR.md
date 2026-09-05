# Telegram Collector

The GitHub Actions collector only reads explicitly allowlisted public Telegram channels or groups. It must not be pointed at private chats, contacts, or an unrestricted account history.

Required GitHub Actions secrets:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELETHON_SESSION`
- `CF_INGEST_URL`
- `CF_INGEST_TOKEN`

Optional GitHub Actions variables:

- `TELEGRAM_SOURCES_JSON`: full allowlist JSON. Prefer this for production.
- `TELEGRAM_LIMIT_PER_SOURCE`: message limit per enabled source. Defaults to `50`.

Local session generation:

```powershell
python -m pip install -r telegram/requirements.txt
python scripts/generate_telethon_session.py
```

The script prompts for credentials interactively, hides the sensitive inputs, writes only to `.secrets/telethon.session.txt`, and never prints the session value.

If Telegram returns `SendCodeUnavailableError`, wait before retrying. It means Telegram is temporarily refusing another login code for that phone number because the available delivery options were recently used.

Allowlist source categories:

- `T1`: Official government, emergency, military, or public agency channel.
- `T2`: Official international organization or recognized institution.
- `T3`: Established news organization or wire service.
- `T4`: Specialist OSINT, monitoring, or research source.
- `T5`: Local eyewitness aggregation or community reporting source.
- `T6`: Platform, infrastructure, or other context source.
