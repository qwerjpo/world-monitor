import asyncio
import json
import os
from typing import Any

import httpx
from telethon import TelegramClient
from telethon.sessions import StringSession


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
    channels = [item.strip() for item in os.getenv("TELEGRAM_CHANNELS", "").split(",") if item.strip()]
    limit = int(os.getenv("TELEGRAM_LIMIT_PER_CHANNEL", "50"))

    if not channels:
        print("No TELEGRAM_CHANNELS configured; nothing to collect.")
        return

    async with TelegramClient(StringSession(session), api_id, api_hash) as client:
        messages: list[dict[str, Any]] = []
        for channel in channels:
            entity = await client.get_entity(channel)
            async for message in client.iter_messages(entity, limit=limit):
                messages.append(
                    {
                        "channel_id": getattr(entity, "id", channel),
                        "message_id": message.id,
                        "date": message.date.isoformat() if message.date else None,
                        "edit_date": message.edit_date.isoformat() if message.edit_date else None,
                        "permalink": f"https://t.me/{getattr(entity, 'username', '')}/{message.id}"
                        if getattr(entity, "username", None)
                        else None,
                        "text": message.message or "",
                        "media": summarize_media(message),
                        "forward": summarize_forward(message),
                    }
                )

    if not messages:
        print("No Telegram messages found.")
        return

    async with httpx.AsyncClient(timeout=30) as http:
        response = await http.post(
            ingest_url,
            headers={"authorization": f"Bearer {ingest_token}", "content-type": "application/json"},
            content=json.dumps({"messages": messages}),
        )
        response.raise_for_status()
        print(response.text)


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
