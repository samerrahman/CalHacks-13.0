#!/usr/bin/env python3
"""Dry-run-first ElevenLabs generator for authored LOCK IN dialogue.

No SDK/dependency installation, dotenv loading, retries, cloning or live calls
by default. Live network work runs in a bounded child process. Credentials are
read only from its inherited environment and never printed or written.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
MAX_AUDIO = 2_000_000
FORMAT = "mp3_44100_128"
SETTINGS = {"stability": 0.65, "similarity_boost": 0.7}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")
SAFE_PROVIDER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$")


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def atomic_json(path: Path, value: dict) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def worker() -> int:
    """Internal child: bounded output, fixed host, no raw error bodies."""
    try:
        job = json.load(sys.stdin)
        key = os.environ.get("ELEVENLABS_API_KEY", "")
        if not key:
            print(json.dumps({"error": "ELEVENLABS_API_KEY absent"}))
            return 1
        kind = job["kind"]
        headers = {"xi-api-key": key, "Accept": "application/json"}
        if kind == "voice":
            path = "/v1/voices/" + quote(job["voice"], safe="")
            body = None
        elif kind == "models":
            path, body = "/v1/models", None
        elif kind == "speech":
            path = "/v1/text-to-speech/" + quote(job["voice"], safe="") + "/stream?output_format=" + FORMAT
            body = json.dumps({"text": job["text"], "model_id": job["model"], "voice_settings": SETTINGS}).encode()
            headers.update({"Accept": "audio/mpeg", "Content-Type": "application/json"})
        else:
            raise ValueError("Unsupported operation")
        request = Request("https://api.elevenlabs.io" + path, data=body, headers=headers)
        with build_opener(NoRedirects()).open(request, timeout=12) as response:
            data = response.read(MAX_AUDIO + 1)
            if len(data) > MAX_AUDIO:
                raise ValueError("Response exceeded 2 MB limit")
            if kind == "speech":
                if not data or response.headers.get_content_type() not in ("audio/mpeg", "audio/mp3"):
                    raise ValueError("Empty or unsupported audio response")
                response_id = response.headers.get("request-id") or response.headers.get("x-request-id")
                safe_id = response_id if response_id and SAFE_PROVIDER_ID.fullmatch(response_id) else None
                print(json.dumps({"audio": base64.b64encode(data).decode("ascii"), "providerRequestId": safe_id}))
            elif kind == "voice":
                decoded = json.loads(data)
                if not isinstance(decoded, dict) or decoded.get("voice_id") != job["voice"]:
                    raise ValueError("Configured voice was not confirmed")
                print(json.dumps({"available": True}))
            else:
                decoded = json.loads(data)
                available = isinstance(decoded, list) and any(
                    isinstance(item, dict) and item.get("model_id") == job["model"]
                    and item.get("can_do_text_to_speech", True) for item in decoded
                )
                print(json.dumps({"available": available}))
        return 0
    except HTTPError as error:
        print(json.dumps({"error": f"ElevenLabs HTTP {error.code}"}))
    except (URLError, TimeoutError):
        print(json.dumps({"error": "Provider transport unavailable or timed out"}))
    except Exception:
        # Do not print provider responses, request objects, URLs, headers or keys.
        print(json.dumps({"error": "Provider response failed bounded validation"}))
    return 1


def bounded_request(job: dict, timeout: float) -> dict:
    try:
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--internal-worker"],
            input=json.dumps(job), text=True, capture_output=True, timeout=timeout,
            env=os.environ.copy(), check=False,
        )
    except subprocess.TimeoutExpired:
        raise ValueError("Provider deadline exceeded; request not retried") from None
    try:
        result = json.loads(completed.stdout)
    except (json.JSONDecodeError, TypeError):
        raise ValueError("Provider worker returned no valid result") from None
    if completed.returncode or "error" in result:
        # Worker error vocabulary is fixed and contains no raw provider content.
        raise ValueError(result.get("error", "Provider worker failed"))
    return result


def read_lines(path: Path) -> list[dict]:
    if path.stat().st_size > 1_000_000:
        raise ValueError("Dialogue exceeds 1 MB")
    payload = json.loads(path.read_text(encoding="utf-8"))
    lines = payload.get("lines") if isinstance(payload, dict) else None
    if not isinstance(lines, list):
        raise ValueError("Expected dialogue object with a lines array")
    validated, ids = [], set()
    for line in lines:
        if not isinstance(line, dict) or not isinstance(line.get("id"), str) or not SAFE_ID.fullmatch(line["id"]):
            raise ValueError("Every dialogue entry needs a safe unique id")
        if line["id"] in ids:
            raise ValueError("Duplicate dialogue id")
        ids.add(line["id"])
        if line["id"] == "NONE":
            continue
        if not isinstance(line.get("text"), str) or not line["text"].strip() or len(line["text"]) > 600:
            raise ValueError("Each spoken caption must contain 1–600 characters")
        if line.get("role") not in ("supervisor", "creature", "system"):
            raise ValueError("Dialogue role must be supervisor, creature or system")
        validated.append(line)
    return validated


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dialogue", type=Path, default=ROOT / "design/dialogue.json")
    parser.add_argument("--output", type=Path, default=ROOT / "assets/generated-voice")
    parser.add_argument("--line", action="append", default=[], help="Exact line id; repeat to select several")
    parser.add_argument("--max-lines", type=int, default=8, help="Batch cap, 1–32 (default 8)")
    parser.add_argument("--timeout", type=float, default=15, help="Hard per-HTTP-operation deadline, 1–20 seconds")
    parser.add_argument("--live", action="store_true", help="Actually use the provider and account quota")
    parser.add_argument("--acknowledge-voice-rights", action="store_true", help="Confirm permission for selected voice and intended use")
    args = parser.parse_args()
    if not 1 <= args.max_lines <= 32 or not 1 <= args.timeout <= 20:
        raise ValueError("max-lines must be 1–32 and timeout must be 1–20 seconds")
    lines = read_lines(args.dialogue)
    if args.line:
        wanted = set(args.line)
        if wanted - {line["id"] for line in lines}:
            raise ValueError("An explicitly selected line is missing or not spoken")
        lines = [line for line in lines if line["id"] in wanted]
        if len(lines) > args.max_lines:
            raise ValueError("Selected lines exceed the explicit batch cap")
    remaining = max(0, len(lines) - args.max_lines)
    lines = lines[:args.max_lines]
    print(json.dumps({"mode": "LIVE" if args.live else "DRY_RUN", "selected": [{"id": line["id"], "role": line["role"], "characters": len(line["text"])} for line in lines], "unselectedCount": remaining, "maximumGenerationRequests": len(lines), "preflightRequestsIfNeeded": 2}))
    if not args.live:
        print("Dry run only: no credentials read, network requests, output files or generated-audio claims.")
        return 0
    if not args.acknowledge_voice_rights:
        raise ValueError("Live generation requires --acknowledge-voice-rights")
    names = ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID"]
    if any(not os.environ.get(name) for name in names):
        raise ValueError("Required environment names: " + ", ".join(names))
    voice, model = os.environ["ELEVENLABS_VOICE_ID"], os.environ["ELEVENLABS_MODEL_ID"]
    if not lines:
        raise ValueError("No spoken lines selected")
    args.output.mkdir(parents=True, exist_ok=True)
    lock = args.output / ".generate-voices.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError("Another generation may be running; inspect the lock before trying again") from None
    os.close(descriptor)
    try:
        manifest_path = args.output / "manifest.json"
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"version": 1, "assets": {}}
        if not isinstance(manifest, dict) or not isinstance(manifest.get("assets"), dict):
            raise ValueError("Existing generated-voice manifest is invalid")
        preflight_done = False
        for line in lines:
            cache_key = digest(json.dumps([line["text"], voice, model, FORMAT, SETTINGS], sort_keys=True).encode())
            filename = f"{line['id']}--{cache_key[:16]}.mp3"
            target = args.output / filename
            old = manifest["assets"].get(cache_key)
            if old and old.get("file") == filename and target.is_file() and target.stat().st_size <= MAX_AUDIO and digest(target.read_bytes()) == old.get("audioSha256"):
                print(json.dumps({"id": line["id"], "source": "cached", "file": filename}))
                continue
            if target.exists():
                raise ValueError("Unverified audio file already exists; inspect it before regeneration")
            if not preflight_done:
                if not bounded_request({"kind": "voice", "voice": voice}, args.timeout).get("available"):
                    raise ValueError("Configured voice is unavailable")
                if not bounded_request({"kind": "models", "model": model}, args.timeout).get("available"):
                    raise ValueError("Configured speech model is unavailable")
                preflight_done = True
            response = bounded_request({"kind": "speech", "voice": voice, "model": model, "text": line["text"]}, args.timeout)
            audio = base64.b64decode(response["audio"], validate=True)
            if not 0 < len(audio) <= MAX_AUDIO:
                raise ValueError("Generated audio exceeded the local size limit")
            # Exclusive creation avoids clobbering a separately authored asset.
            with target.open("xb") as handle:
                handle.write(audio)
            manifest["assets"][cache_key] = {
                "id": line["id"], "role": line["role"], "caption": line["text"], "source": "elevenlabs",
                "model": model, "voiceReferenceHash": digest(voice.encode()), "format": FORMAT, "settings": SETTINGS,
                "file": filename, "audioSha256": digest(audio), "bytes": len(audio),
                "generatedAt": datetime.now(timezone.utc).isoformat(), "providerRequestId": response.get("providerRequestId"),
                "voiceRightsAcknowledged": True, "distributionLicenseStatus": "Review selected voice and account plan before redistribution",
            }
            atomic_json(manifest_path, manifest)
            print(json.dumps({"id": line["id"], "source": "elevenlabs", "file": filename, "bytes": len(audio), "providerRequestId": response.get("providerRequestId")}))
        return 0
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--internal-worker"]:
        raise SystemExit(worker())
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError) as error:
        # Input errors are local, and network exceptions are sanitized by worker.
        print("Generation stopped: " + str(error), file=sys.stderr)
        raise SystemExit(1)
