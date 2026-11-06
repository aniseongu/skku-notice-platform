# 출처: https://github.com/pyca/cryptography/blob/main/docs/fernet.rst
"""Keep only authenticated ciphertext in the shared Actions cache."""

import argparse
import base64
import hashlib
import json
import os
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

DOMAIN = b"skku-notice-alert/canvas-cache/v1\x00"
PLAIN_PATH = Path("state/canvas.json")
ENCRYPTED_PATH = Path("state/canvas.enc")


def _cipher(token: str) -> Fernet:
    if not token.strip():
        raise ValueError("Canvas cache key is unavailable")
    # Canvas API tokens are high-entropy credentials, not human passwords.
    key = hashlib.sha256(DOMAIN + token.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _write_private(path: Path, content: bytes, mtime_ns: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        if mtime_ns is not None:
            os.utime(temporary, ns=(mtime_ns, mtime_ns))
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def seal_cache(token: str, plain: Path = PLAIN_PATH, encrypted: Path = ENCRYPTED_PATH) -> bool:
    encrypted.unlink(missing_ok=True)
    if not plain.is_file():
        return False
    envelope = {
        "version": 1,
        "mtime_ns": plain.stat().st_mtime_ns,
        "content": base64.b64encode(plain.read_bytes()).decode("ascii"),
    }
    ciphertext = _cipher(token).encrypt(json.dumps(envelope).encode("utf-8"))
    _write_private(encrypted, ciphertext)
    return True


def open_cache(token: str, plain: Path = PLAIN_PATH, encrypted: Path = ENCRYPTED_PATH) -> bool:
    # A missing, rotated or corrupt cache must never leave an old baseline behind.
    plain.unlink(missing_ok=True)
    if not encrypted.is_file() or not token.strip():
        return False
    try:
        envelope = json.loads(_cipher(token).decrypt(encrypted.read_bytes()))
        if not isinstance(envelope, dict) or type(envelope.get("version")) is not int:
            return False
        if envelope["version"] != 1 or type(envelope.get("mtime_ns")) is not int:
            return False
        mtime_ns = envelope["mtime_ns"]
        if not 0 <= mtime_ns <= 2**63 - 1 or not isinstance(envelope.get("content"), str):
            return False
        plaintext = base64.b64decode(envelope["content"], validate=True)
    except (InvalidToken, ValueError, TypeError, KeyError):
        return False
    # Collection throttling uses the last successful state's mtime, not restore time.
    _write_private(plain, plaintext, mtime_ns)
    return True


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("open", "seal"))
    parser.add_argument("--plain", type=Path, default=PLAIN_PATH)
    parser.add_argument("--encrypted", type=Path, default=ENCRYPTED_PATH)
    args = parser.parse_args(argv)
    try:
        action = open_cache if args.action == "open" else seal_cache
        action(os.environ.get("CANVAS_TOKEN", ""), args.plain, args.encrypted)
    except (OSError, ValueError):
        # Do not expose source data, paths, credentials or exception messages.
        print("Canvas cache operation failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
