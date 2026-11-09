#!/usr/bin/env python3
"""Regression: the Tunefield Pro key check and the export backstop (1.1.0).

Pins the key format the store mints (license_key.py docstring) with a known-answer vector,
then drives /api/license and the three server-side export routes. Every key here is signed
by a TEST key made from a public seed; the app's real public key is swapped out for the test.

Runs against an isolated TUNEFIELD_ROOT and touches nothing in the repo's data/.

    python3 scripts/test_pro_license.py
"""
import os, sys, json, base64, hashlib, tempfile

ROOT = tempfile.mkdtemp(prefix="tf-pro-")
os.environ["TUNEFIELD_ROOT"] = ROOT
os.makedirs(os.path.join(ROOT, "data"))

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
os.chdir(REPO)

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import license_key as lk

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []

def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

# TEST-ONLY signing key from a public seed. Never trusted by a shipped app.
TEST_SEED = hashlib.sha256(b"tunefield-pro-test-vector-NOT-A-REAL-KEY").digest()
TEST_PRIV = Ed25519PrivateKey.from_private_bytes(TEST_SEED)
def pub_b64(priv):
    return base64.b64encode(priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
TEST_PUB = pub_b64(TEST_PRIV)

def mint(payload, priv=TEST_PRIV, raw=False):
    """What the store does: compact JSON, sign those bytes, base32 (payload || sig), groups of 5."""
    p = payload if raw else json.dumps(payload, separators=(",", ":")).encode()
    body = lk.b32_encode(p + priv.sign(p))
    return "TF1-" + "-".join(body[i:i + 5] for i in range(0, len(body), 5))

GOOD = {"v": 1, "p": "pro", "s": "lite-lifetime", "o": "cs_test_a1b2c3d4e5f6", "t": 1768176000, "h": "1a2b3c4d"}

# Known-answer vector: the store's minting must reproduce this exact string (Ed25519 is deterministic).
KAT_PAYLOAD = b'{"v":1,"p":"pro","s":"lite-lifetime","o":"cs_test_example","t":1768176000,"h":"1a2b3c4d"}'
KAT_PUB = "Docby12zFC+sxSFNsBy/Xb0cu9vtNw+G9iVPmLUk/sM="
KAT_KEY = ("TF1-FCH7C-8HT64-P24W1-278H7-0WKF4-8P24W-S278H-6RTBM-CMPPR-TB6CN-T6JVB-548P2-4VS27-8H66W-"
           "TZEHJ-Q6X2Z-CNW62-VBGDH-JJ4B1-2EGH3-MC9Q6-RW32D-SP60R-30B12-D0H3M-8HHC4-S64CV-36HJ2-4Z8NS-"
           "QJBKK-K01F7-RB1JY-2V4TA-5JHW1-YHDRS-5JXK6-WX69C-RCHP6-43VZE-2292Z-TFFPD-Z6TET-P5V8R-WJ1CJ-"
           "FHJ9P-RKZ2E-PS9VC-NV27V-M4BG0")

def refused_at(key, now, pub=TEST_PUB):
    try:
        lk.check_key(key, pub, now=now); return None
    except lk.LicenceError as e:
        return str(e)

def refused(key, pub=TEST_PUB):
    try:
        lk.check_key(key, pub); return None
    except lk.LicenceError as e:
        return str(e)

try:
    # ── format ──
    check("KAT: test public key", TEST_PUB == KAT_PUB, TEST_PUB)
    check("KAT: minting reproduces the pinned key", mint(KAT_PAYLOAD, raw=True) == KAT_KEY)
    check("KAT: pinned key checks", lk.check_key(KAT_KEY, KAT_PUB).get("o") == "cs_test_example")
    for n in range(0, 70):
        b = bytes((i * 37 + n) & 0xFF for i in range(n))
        if lk.b32_decode(lk.b32_encode(b)) != b:
            check(f"base32 round trip, {n} bytes", False); break
    else:
        check("base32 round trip, 0 to 69 bytes", True)

    good = mint(GOOD)
    check("valid key accepted", lk.check_key(good, TEST_PUB)["s"] == "lite-lifetime")
    check("pasted with line breaks, spaces, lower case, no dashes",
          lk.check_key("  " + good.lower()[:40] + "\n" + good.lower()[40:].replace("-", "") + " \n", TEST_PUB)["p"] == "pro")
    ro = good[:4] + good[4:].replace("0", "O").replace("1", "l")
    check("Crockford read-alikes (O for 0, l for 1) accepted", lk.check_key(ro, TEST_PUB)["v"] == 1)

    flip = good[:30] + ("A" if good[30] != "A" else "B") + good[31:]
    check("one changed character refused", "isn't valid" in (refused(flip) or ""), refused(flip))
    check("truncated key refused", refused(good[:-10]) is not None)
    check("key signed by another keypair refused",
          "isn't valid" in (refused(mint(GOOD, priv=Ed25519PrivateKey.generate())) or ""))
    check("old beta TFL1 key refused with its own message",
          "beta key" in (refused("TFL1.eyJ0IjoicHJvIn0.c2ln") or ""))
    check("full-Tunefield scope refused", "different Tunefield product" in (refused(mint({**GOOD, "s": "full-lifetime"})) or ""))
    check("other product refused", "different Tunefield product" in (refused(mint({**GOOD, "p": "merch"})) or ""))
    check("newer format version asks for an update", "newer Tunefield" in (refused(mint({**GOOD, "v": 2})) or ""))
    check("signed non-JSON payload refused", refused(mint(b"not json", raw=True)) is not None)
    check("U (not in Crockford) refused", refused("TF1-UUUUU") is not None)
    check("empty and non-string refused", refused("") is not None and refused(None) is not None)
    check("overlong input refused", "too long" in (refused("TF1-" + "0" * 5000) or ""))
    check("no prefix refused", "starts with TF1-" in (refused(good[4:]) or ""))

    # ── expiry: test keys only (Mark, 9 Nov 2026: "Short expiry") ──
    NOW = 1768176000
    qa = {**GOOD, "o": "QA-TEST-2026-11-09", "x": NOW + 7 * 86400}
    check("test key before its expiry accepted", lk.check_key(mint(qa), TEST_PUB, now=NOW)["x"] == NOW + 7 * 86400)
    check("test key at its expiry refused", "expired" in (refused_at(mint(qa), NOW + 7 * 86400) or ""))
    check("test key after its expiry refused", "expired" in (refused_at(mint(qa), NOW + 30 * 86400) or ""))
    check("expiry that is not a number refused", "isn't valid" in (refused(mint({**GOOD, "x": "2027-01-01"})) or ""))
    check("expiry true/false refused", "isn't valid" in (refused(mint({**GOOD, "x": True})) or ""))
    check("customer key (no x) has no expiry, even far in the future", lk.check_key(good, TEST_PUB, now=4102444800)["s"] == "lite-lifetime")

    # ── app ──
    import app as tf
    real_pub = tf.LICENSE_PUBKEY_B64
    check("app embeds a real public key, not the test key", real_pub != TEST_PUB and len(base64.b64decode(real_pub)) == 32)
    check("the real key refuses test-signed keys", refused(good, pub=real_pub) is not None)
    tf.LICENSE_PUBKEY_B64 = TEST_PUB
    c = tf.app.test_client()
    J = lambda r: r.get_json()
    check("create Field", J(c.post("/catalogs", json={"name": "Pro"})).get("slug") == "pro")

    def exports():
        return (c.get("/catalog/export.csv?cat=pro").status_code,
                c.post("/export/rekordbox/bridge", json={"name": "t", "tracks": []}).status_code,
                c.post("/export/als", json={"name": "t", "tracks": []}).status_code)

    check("GET: not licensed by default", J(c.get("/api/license")) == {"licensed": False})
    st = exports()
    check("all three server exports 403 without a key", st == (403, 403, 403), st)
    r = c.get("/catalog/export.csv?cat=pro")
    check("403 says Pro is required", J(r).get("pro_required") is True)

    r = c.post("/api/license", json={"key": flip})
    check("POST bad key: 400 with a readable reason", r.status_code == 400 and "isn't valid" in J(r).get("error", ""), J(r))
    check("bad key not stored", "pro_key" not in tf.load_config())
    r = c.post("/api/license", json={"key": 12345})
    check("POST non-string: 400", r.status_code == 400)

    messy = good.lower().replace("-", " ") + "\n"
    r = c.post("/api/license", json={"key": messy})
    j = J(r)
    check("POST good key (messy paste): licensed", r.status_code == 200 and j.get("licensed") is True, j)
    check("view: scope, issued date, short ref", j.get("scope") == "lite-lifetime" and j.get("issued") == "2026-01-12"
          and j.get("ref") == "a1b2c3d4e5f6"[-8:], j)
    check("view never carries the email hash or the key", "h" not in j and "key" not in j and "pro_key" not in j)
    stored = tf.load_config().get("pro_key", "")
    check("stored key is cleaned (no whitespace, upper case)", stored == lk.clean_key(messy) and stored.startswith("TF1"), stored[:12])
    check("GET: licensed", J(c.get("/api/license")).get("licensed") is True)
    st = exports()
    check("server exports pass the gate with a key", 403 not in st, st)

    import time as _t
    live_qa = mint({**GOOD, "o": "QA-TEST-live", "x": int(_t.time()) + 3600})
    j = J(c.post("/api/license", json={"key": live_qa}))
    check("live test key unlocks and the view shows its expiry", j.get("licensed") is True and j.get("expires"), j)
    dead_qa = mint({**GOOD, "o": "QA-TEST-dead", "x": int(_t.time()) - 60})
    r = c.post("/api/license", json={"key": dead_qa})
    check("POST expired test key: 400 'expired'", r.status_code == 400 and "expired" in J(r).get("error", ""), J(r))
    cfg = tf.load_config(); cfg["pro_key"] = dead_qa; tf.save_config(cfg)
    check("an expired key already in config.json stops unlocking", J(c.get("/api/license")) == {"licensed": False} and exports() == (403, 403, 403))
    check("customer key view has no expiry", J(c.post("/api/license", json={"key": good})).get("expires") is None)
    check("DELETE: removes the key", J(c.delete("/api/license")) == {"licensed": False} and "pro_key" not in tf.load_config())
    check("exports 403 again", exports() == (403, 403, 403))

    cfg = tf.load_config(); cfg["pro_key"] = flip; tf.save_config(cfg)
    check("a tampered key in config.json does not unlock", J(c.get("/api/license")) == {"licensed": False} and exports()[0] == 403)
    tf.LICENSE_PUBKEY_B64 = real_pub
    cfg = tf.load_config(); cfg["pro_key"] = good; tf.save_config(cfg)
    check("with the real public key, a test-signed key does not unlock", J(c.get("/api/license")) == {"licensed": False})

    r = c.post("/api/license", json={"key": good}, headers={"Origin": "https://evil.example"})
    check("cross-origin POST refused by the CSRF guard", r.status_code == 403)
finally:
    import shutil; shutil.rmtree(ROOT, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
