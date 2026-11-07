"""Decrypt per-user Gemini keys stored by the `byok` Edge Function (AES-256-GCM, AAD = user id).

Stored format: base64url(iv(12) || ciphertext || tag(16)). The master key is a 32-byte base64url secret.
Never log keys, ciphertext or exceptions' text from this module.
"""

import base64

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class ByokCryptoError(ValueError):
    """The key could not be decrypted. The message never contains secret material."""


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _aesgcm(master_key: str) -> AESGCM:
    try:
        raw = _b64decode(master_key)
    except ValueError as exc:
        raise ByokCryptoError("invalid master key") from exc
    if len(raw) != 32:
        raise ByokCryptoError("invalid master key")
    return AESGCM(raw)


def decrypt_api_key(master_key: str, user_id: str, stored: str) -> str:
    try:
        raw = _b64decode(stored)
    except ValueError as exc:
        raise ByokCryptoError("invalid ciphertext") from exc
    if len(raw) < 12 + 16 + 1:
        raise ByokCryptoError("invalid ciphertext")
    try:
        return _aesgcm(master_key).decrypt(raw[:12], raw[12:], user_id.encode()).decode()
    except (InvalidTag, UnicodeDecodeError) as exc:
        raise ByokCryptoError("decryption failed") from exc


def encrypt_api_key(master_key: str, user_id: str, plaintext: str, iv: bytes) -> str:
    """Used by tests to build vectors; production encryption happens in the Edge Function."""
    if len(iv) != 12:
        raise ByokCryptoError("invalid iv")
    return b64encode(iv + _aesgcm(master_key).encrypt(iv, plaintext.encode(), user_id.encode()))
