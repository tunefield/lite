#!/usr/bin/env python3
"""Regression: E1, the Rekordbox/Traktor field mapping (1.1.0).

- default = the 1.0.0 behaviour (Comments: Camelot + tags), not yet confirmed
- the bridge writes nothing until the mapping is confirmed (409 fields_required)
- POST validates and confirms; bad mappings answer 400
- Colour and Grouping reach the bridge XML when the page sends them, and are left out
  when empty

    .venv/bin/python scripts/test_export_fields.py
"""
import os, sys, json, hashlib, tempfile, shutil, base64

TMP = tempfile.mkdtemp(prefix="tf-fields-")
os.environ["TUNEFIELD_ROOT"] = TMP
os.environ["TUNEFIELD_RB_HOME"] = os.path.join(TMP, "rbhome")
os.environ["TUNEFIELD_TEST_HOST_ID"] = "fields-mac"
os.makedirs(os.path.join(TMP, "data"))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO); os.chdir(REPO)

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import license_key as lk

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []
def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

PRIV = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"tunefield-pro-test-vector-NOT-A-REAL-KEY").digest())
PUB = base64.b64encode(PRIV.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
def mint(payload):
    p = json.dumps(payload, separators=(",", ":")).encode()
    body = lk.b32_encode(p + PRIV.sign(p))
    return "TF1-" + "-".join(body[i:i + 5] for i in range(0, len(body), 5))

try:
    import app as tf
    tf.LICENSE_PUBKEY_B64 = PUB
    c = tf.app.test_client(); J = lambda r: r.get_json()
    c.post("/api/license", json={"key": mint({"v": 1, "p": "pro", "s": "lite-lifetime", "o": "QA", "t": 1768176000, "h": "00000000"})})
    f = J(c.get("/export/fields"))
    check("default is the 1.0.0 behaviour, not confirmed", f == {"confirmed": False, "rb_comments": ["camelot", "tags"],
          "rb_colour": "off", "rb_grouping": "off", "tk_comment": ["tags"]}, f)
    c.post("/export/approvals", json={"kind": "rekordbox_bridge", "target": tf._rb_bridge_xml()})
    tr = {"location": os.path.join(TMP, "a.mp3"), "name": "T", "comments": "8A / warm", "colour": "0xFF0000", "grouping": "E9"}
    r = c.post("/export/rekordbox/bridge", json={"name": "Set", "tracks": [tr]})
    check("bridge before the mapping is confirmed: 409 fields_required, nothing written",
          r.status_code == 409 and J(r).get("fields_required") and not os.path.exists(tf._rb_bridge_xml()), (r.status_code, J(r)))
    bad = [c.post("/export/fields", json=b).status_code for b in (
        {"rb_comments": ["nope"], "rb_colour": "off", "rb_grouping": "off", "tk_comment": []},
        {"rb_comments": [], "rb_colour": "rainbow", "rb_grouping": "off", "tk_comment": []},
        {"rb_comments": [], "rb_colour": "off", "rb_grouping": "off"})]
    check("bad mappings answer 400", bad == [400, 400, 400], bad)
    j = J(c.post("/export/fields", json={"rb_comments": ["camelot", "energy"], "rb_colour": "energy", "rb_grouping": "vocals", "tk_comment": ["mood"]}))
    check("POST confirms and stores the mapping", j.get("confirmed") is True and j.get("rb_grouping") == "vocals")
    check("…kept in config.json (travels with a stick)", tf.load_config()["export_fields"]["rb_colour"] == "energy")
    r = c.post("/export/rekordbox/bridge", json={"name": "Set", "tracks": [tr, {**tr, "location": os.path.join(TMP, "b.mp3"), "colour": "", "grouping": ""}]})
    xml = open(tf._rb_bridge_xml(), encoding="utf-8").read() if r.status_code == 200 else ""
    check("bridge XML carries Colour and Grouping", 'Colour="0xFF0000"' in xml and 'Grouping="E9"' in xml, r.status_code)
    check("…and leaves them out when empty", xml.count("Colour=") == 1 and xml.count("Grouping=") == 1)
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
