import asyncio
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from telethon import TelegramClient
from telethon.sessions import StringSession


VALID_CATEGORIES = {"T1", "T2", "T3", "T4", "T5", "T6"}
VALID_TYPES = {"public_channel", "public_group"}


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


async def main() -> None:
    api_id = int(required_env("TELEGRAM_API_ID"))
    api_hash = required_env("TELEGRAM_API_HASH")
    session = required_env("TELETHON_SESSION")
    ingest_url = required_env("CF_INGEST_URL").rstrip("/") + "/ingest/telegram"
    ingest_token = required_env("CF_INGEST_TOKEN")
    sources = load_sources()
    limit = int(os.getenv("TELEGRAM_LIMIT_PER_SOURCE", os.getenv("TELEGRAM_LIMIT_PER_CHANNEL", "50")))

    if not sources:
        print("No enabled Telegram allowlist sources configured; nothing to collect.")
        return

    async with TelegramClient(StringSession(session), api_id, api_hash) as client:
        messages: list[dict[str, Any]] = []
        for source in sources:
            entity = await client.get_entity(source["handle"])
            async for message in client.iter_messages(entity, limit=limit):
                channel_id = getattr(entity, "id", source["handle"])
                messages.append(
                    {
                        "channel_id": channel_id,
                        "message_id": message.id,
                        "date": message.date.isoformat() if message.date else None,
                        "edit_date": message.edit_date.isoformat() if message.edit_date else None,
                        "permalink": f"https://t.me/{getattr(entity, 'username', '')}/{message.id}"
                        if getattr(entity, "username", None)
                        else None,
                        "text": message.message or "",
                        "media": summarize_media(message),
                        "forward": summarize_forward(message),
                        "source_metadata": source_metadata(source, entity),
                    }
                )

    if not messages:
        print("No Telegram messages found; recording collector health.")

    async with httpx.AsyncClient(timeout=30) as http:
        response = await http.post(
            ingest_url,
            headers={"authorization": f"Bearer {ingest_token}", "content-type": "application/json"},
            content=json.dumps({"messages": messages}),
        )
        response.raise_for_status()
        print(response.text)


def load_sources() -> list[dict[str, Any]]:
    raw_json = os.getenv("TELEGRAM_SOURCES_JSON")
    if raw_json:
        document = json.loads(raw_json)
    else:
        path = Path(os.getenv("TELEGRAM_SOURCES_FILE", "telegram/sources.json"))
        if not path.exists():
            example_allowed = os.getenv("TELEGRAM_USE_EXAMPLE_SOURCES") == "1"
            example_path = Path("telegram/sources.example.json")
            if example_allowed and example_path.exists():
                path = example_path
            else:
                return []
        document = json.loads(path.read_text(encoding="utf-8"))

    configured = document if isinstance(document, list) else document.get("sources", [])
    if not isinstance(configured, list):
        raise RuntimeError("Telegram source allowlist must be a list or contain a sources list")

    sources: list[dict[str, Any]] = []
    for index, source in enumerate(configured):
        if not isinstance(source, dict):
            raise RuntimeError(f"Telegram source at index {index} must be an object")
        if not source.get("enabled", True):
            continue
        source_type = source.get("type")
        category = source.get("category")
        handle = normalize_public_handle(str(source.get("handle", "")).strip())
        if source_type not in VALID_TYPES:
            raise RuntimeError(f"Telegram source {source.get('id', index)} must be a public channel or group")
        if category not in VALID_CATEGORIES:
            raise RuntimeError(f"Telegram source {source.get('id', index)} must use category T1 through T6")
        if not handle:
            raise RuntimeError(f"Telegram source {source.get('id', index)} must use an explicit public handle")
        source["handle"] = handle
        sources.append(source)
    return sources


def normalize_public_handle(raw: str) -> str:
    if not raw:
        return ""
    handle = raw.lstrip("@")
    if handle.startswith("http://") or handle.startswith("https://"):
        parsed = urlparse(handle)
        if parsed.netloc not in {"t.me", "telegram.me"}:
            return ""
        handle = parsed.path.strip("/").split("/")[0]
    if handle.startswith("+") or handle.lower() in {"me", "self", "joinchat"}:
        return ""
    return handle


def source_metadata(source: dict[str, Any], entity: Any) -> dict[str, Any]:
    return {
        "allowlist_id": source.get("id"),
        "handle": source.get("handle"),
        "name": source.get("name") or getattr(entity, "title", None),
        "type": source.get("type"),
        "category": source.get("category"),
        "language": source.get("language"),
        "region": source.get("region"),
        "domain": source.get("domain"),
        "alignment": source.get("alignment"),
        "limitations": source.get("limitations"),
    }


def summarize_media(message: Any) -> dict[str, Any] | None:
    if not message.media:
        return None
    return {
        "class": message.media.__class__.__name__,
        "has_photo": bool(getattr(message, "photo", None)),
        "has_document": bool(getattr(message, "document", None)),
    }


def summarize_forward(message: Any) -> dict[str, Any] | None:
    forward = getattr(message, "fwd_from", None)
    if not forward:
        return None
    from_id = getattr(forward, "from_id", None)
    return {
        "from_channel_id": getattr(from_id, "channel_id", None),
        "message_id": getattr(forward, "channel_post", None),
        "date": forward.date.isoformat() if getattr(forward, "date", None) else None,
    }


if __name__ == "__main__":
    asyncio.run(main())
