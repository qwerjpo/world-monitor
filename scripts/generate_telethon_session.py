import argparse
import asyncio
import getpass
import os
from pathlib import Path

try:
    from telethon import TelegramClient
    from telethon.errors import RPCError, SendCodeUnavailableError, SessionPasswordNeededError
    from telethon.sessions import StringSession
except ModuleNotFoundError as error:
    if error.name != "telethon":
        raise
    raise SystemExit(
        "Telethon is not installed. Run this first:\n"
        "  python -m pip install -r telegram/requirements.txt"
    ) from error


DEFAULT_OUTPUT = Path(".secrets/telethon.session.txt")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a Telethon StringSession locally without printing the "
            "session, API hash, phone number, or login code."
        )
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Local output path for the session string. The default is ignored by git.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite the output file if it already exists.",
    )
    return parser.parse_args()


def prompt_api_id() -> int:
    while True:
        raw = input("TELEGRAM_API_ID: ").strip()
        try:
            return int(raw)
        except ValueError:
            print("Please enter the numeric API ID.")


async def generate_session(output_path: Path, overwrite: bool) -> None:
    if output_path.exists() and not overwrite:
        raise RuntimeError(f"{output_path} already exists. Use --overwrite to replace it.")

    api_id = prompt_api_id()
    api_hash = getpass.getpass("TELEGRAM_API_HASH (hidden): ").strip()
    phone = getpass.getpass("Telegram phone number (hidden): ").strip()

    if not api_hash:
        raise RuntimeError("TELEGRAM_API_HASH is required")
    if not phone:
        raise RuntimeError("Telegram phone number is required")

    try:
        async with TelegramClient(StringSession(), api_id, api_hash) as client:
            sent_code = await client.send_code_request(phone)
            code = getpass.getpass("Telegram login code (hidden): ").strip()
            try:
                await client.sign_in(phone=phone, code=code, phone_code_hash=sent_code.phone_code_hash)
            except SessionPasswordNeededError:
                password = getpass.getpass("Telegram 2FA password (hidden): ")
                await client.sign_in(password=password)
            session = client.session.save()
    except SendCodeUnavailableError as error:
        raise RuntimeError(
            "Telegram is not allowing another login code for this phone number right now. "
            "Wait before retrying, then run the script again with --overwrite only if the output file already exists."
        ) from error
    except RPCError as error:
        raise RuntimeError(f"Telegram rejected the login attempt: {error.__class__.__name__}") from error

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(session, encoding="utf-8")
    try:
        os.chmod(output_path, 0o600)
    except OSError:
        pass

    print(f"Telethon session saved to: {output_path}")
    print("Add that file's contents to the GitHub Actions secret named TELETHON_SESSION.")
    print("Do not commit, paste into issues, or upload the session file.")


def main() -> None:
    args = parse_args()
    asyncio.run(generate_session(Path(args.output), args.overwrite))


if __name__ == "__main__":
    main()
