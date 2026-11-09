"""Tunefield Pro licence keys: the offline check Lite runs.

A key is "TF1-" followed by Crockford base32 of (payload || 64-byte Ed25519 signature),
usually in groups of five separated by dashes. The payload is compact JSON, signed as the
exact bytes embedded in the key:

    {"v":1, "p":"pro", "s":"lite-lifetime", "o":<order ref>, "t":<issued, unix s>, "h":<email hash prefix>}

Lite only checks the signature against its own public key, then v, p and s. A customer key
is lifetime: it has no expiry. Only test keys carry "x" (expiry, unix seconds; Mark, 9 Nov
2026: QA keys get a short expiry); past it the key is refused. The scope "s" lets a later
full Tunefield tell its keys apart.
Keys are minted by the Tunefield store (the private key never lives in this repo).
"""
import json
import time

PREFIX = "TF1-"
SIG_LEN = 64
FORMAT_VERSION = 1
PRODUCT = "pro"
LITE_SCOPES = ("lite-lifetime",)
MAX_KEY_CHARS = 2000

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"   # Crockford: no I, L, O, U
_DECODE = {c: i for i, c in enumerate(_ALPHABET)}
_DECODE.update({"O": 0, "I": 1, "L": 1})          # read-alikes, per Crockford


class LicenceError(ValueError):
    """The key was refused. The message is shown to the user as is."""


def b32_encode(data: bytes) -> str:
    """Crockford base32, most significant bit first, last group zero-padded, no padding chars."""
    out, acc, bits = [], 0, 0
    for byte in data:
        acc = (acc << 8) | byte
        bits += 8
        while bits >= 5:
            bits -= 5
            out.append(_ALPHABET[(acc >> bits) & 31])
        acc &= (1 << bits) - 1
    if bits:
        out.append(_ALPHABET[(acc << (5 - bits)) & 31])
    return "".join(out)


def b32_decode(text: str) -> bytes:
    out, acc, bits = bytearray(), 0, 0
    for ch in text:
        v = _DECODE.get(ch)
        if v is None:
            raise LicenceError("This key contains characters a Tunefield key never has. Copy it again from the email.")
        acc = (acc << 5) | v
        bits += 5
        if bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
        acc &= (1 << bits) - 1
    return bytes(out)


def clean_key(key) -> str:
    """The key as stored: no whitespace (email line breaks), upper case."""
    if not isinstance(key, str):
        raise LicenceError("Paste your Tunefield Pro key.")
    s = "".join(key.split()).upper()
    if len(s) > MAX_KEY_CHARS:
        raise LicenceError("This is too long to be a Tunefield Pro key.")
    return s


def check_key(key, public_key_b64: str, now=None) -> dict:
    """Return the key's payload if it is a valid Lite Pro key, else raise LicenceError."""
    s = clean_key(key)
    if not s:
        raise LicenceError("Paste your Tunefield Pro key.")
    if s.startswith("TFL1."):
        raise LicenceError("This is a Tunefield beta key. Tunefield Lite Pro needs a new key.")
    if not s.startswith(PREFIX[:3]):   # the dash after TF1 is optional, like every other dash
        raise LicenceError("This doesn't look like a Tunefield Pro key. It starts with TF1-.")
    raw = b32_decode(s[3:].replace("-", ""))
    if len(raw) <= SIG_LEN:
        raise LicenceError("This key is incomplete. Copy all of it from the email.")
    payload, sig = raw[:-SIG_LEN], raw[-SIG_LEN:]
    try:
        import base64
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        raise LicenceError("This copy of Tunefield can't check keys (a component is missing). Please reinstall it.")
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64)).verify(sig, payload)
    except InvalidSignature:
        raise LicenceError("This key isn't valid. Check you copied all of it from the email.")
    try:
        data = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        data = None
    if not isinstance(data, dict):
        raise LicenceError("This key isn't valid. Check you copied all of it from the email.")
    if data.get("v") != FORMAT_VERSION:
        raise LicenceError("This key needs a newer Tunefield. Please update the app.")
    if data.get("p") != PRODUCT or data.get("s") not in LITE_SCOPES:
        raise LicenceError("This key is for a different Tunefield product.")
    if "x" in data:
        x = data["x"]
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            raise LicenceError("This key isn't valid. Check you copied all of it from the email.")
        if (time.time() if now is None else now) >= x:
            raise LicenceError("This key has expired.")
    return data
