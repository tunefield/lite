#!/usr/bin/env python3
"""Regression: E0, export approvals (1.1.0; Mark, 15 Nov 2026: approved by the user in the
page first, remembered, editable; "Yes, ask per Mac").

- the Rekordbox bridge writes NOTHING (no store, no folder, no file) until its exact
  path is approved, and answers 409 approval_required with that path
- approving needs Pro; after it, the export writes; DELETE revokes
- approvals for a Mac location are per Mac (TUNEFIELD_TEST_HOST_ID stands in for a
  second Mac); a location on the stick that holds the data travels with the stick
- bad bodies answer 400

Every key here is signed by the public TEST key (scripts/test_pro_license.py); the app's
real key is swapped out. Runs against an isolated TUNEFIELD_ROOT and TUNEFIELD_RB_HOME.

    .venv/bin/python scripts/test_export_approvals.py
"""
import os, sys, json, hashlib, tempfile, shutil, base64

ROOT = tempfile.mkdtemp(prefix="tf-approve-")
RBH = os.path.join(ROOT, "host-music", "Tunefield")      # stands in for ~/Music/Tunefield
os.environ["TUNEFIELD_ROOT"] = ROOT
os.environ["TUNEFIELD_RB_HOME"] = RBH
os.environ["TUNEFIELD_TEST_HOST_ID"] = "mac-A"
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

PRIV = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"tunefield-pro-test-vector-NOT-A-REAL-KEY").digest())
PUB = base64.b64encode(PRIV.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
def mint(payload):
    p = json.dumps(payload, separators=(",", ":")).encode()
    body = lk.b32_encode(p + PRIV.sign(p))
    return "TF1-" + "-".join(body[i:i + 5] for i in range(0, len(body), 5))

try:
    import app as tf
    tf.LICENSE_PUBKEY_B64 = PUB
    c = tf.app.test_client()
    J = lambda r: r.get_json()
    track = {"location": os.path.join(ROOT, "a.mp3"), "artist": "A", "title": "T", "bpm": 120}
    export = lambda: c.post("/export/rekordbox/bridge", json={"name": "Set", "tracks": [track]})

    check("no approvals at first; this Mac has a 16-hex key",
          J(c.get("/export/approvals"))["approvals"] == [] and len(J(c.get("/export/approvals"))["host"]) == 16)
    target = tf._rb_bridge_xml()
    check("approving without Pro is refused", c.post("/export/approvals", json={"kind": "rekordbox_bridge", "target": target}).status_code == 403)

    c.post("/api/license", json={"key": mint({"v": 1, "p": "pro", "s": "lite-lifetime", "o": "QA", "t": 1768176000, "h": "00000000"})})
    r = export()
    j = J(r)
    check("bridge export without approval: 409 with the exact path", r.status_code == 409
          and j.get("approval_required") == {"kind": "rekordbox_bridge", "target": os.path.realpath(target)}, (r.status_code, j))
    check("…and nothing written: no folder in ~/Music, no store, no file",
          not os.path.exists(RBH) and not os.path.exists(tf.REKORDBOX_BRIDGE_STORE))
    check("status says not approved", J(c.get("/export/rekordbox/status")).get("bridge_approved") is False)

    j = J(c.post("/export/approvals", json={"kind": "rekordbox_bridge", "target": target}))
    check("approve: recorded for this Mac", j.get("approved") and j.get("host") == tf._host_key(), j)
    r = export()
    check("after approval the export writes the file", r.status_code == 200 and os.path.exists(target), (r.status_code, J(r)))
    check("approval file lives in data/", os.path.exists(os.path.join(ROOT, "data", "export_approvals.json")))

    # another Mac: same stick, different host key
    tf._HOST_KEY.clear(); os.environ["TUNEFIELD_TEST_HOST_ID"] = "mac-B"
    check("on another Mac the same export asks again", export().status_code == 409)
    check("…and that Mac sees none of Mac A's approvals", J(c.get("/export/approvals"))["approvals"] == [])
    tf._HOST_KEY.clear(); os.environ["TUNEFIELD_TEST_HOST_ID"] = "mac-A"
    check("back on Mac A it is still approved", export().status_code == 200)

    # a location on the stick that holds the data travels with it
    real = (tf.TUNEFIELD_ROOT, tf.TUNEFIELD_ROOT_MODE)
    tf.TUNEFIELD_ROOT, tf.TUNEFIELD_ROOT_MODE = "/Volumes/GIGSTICK/Tunefield", "portable"
    try:
        check("a folder on the stick itself: approval travels (host null)",
              tf._approval_host("/Volumes/GIGSTICK/Collected/Set") is None)
        check("a folder on the Mac: approval is per Mac", tf._approval_host("/Users/x/Music/Tunefield/t.xml") == tf._host_key())
        check("another stick: per Mac", tf._approval_host("/Volumes/OTHER/x") == tf._host_key())
    finally:
        tf.TUNEFIELD_ROOT, tf.TUNEFIELD_ROOT_MODE = real

    # the same place spelled differently is the same approval
    check("a differently cased path matches the same approval", tf._is_approved("rekordbox_bridge", target.swapcase()))
    check("a trailing slash matches the same approval", tf._is_approved("rekordbox_bridge", target + "/"))
    # stick approvals are stored relative, so a renamed stick keeps them
    real = (tf.TUNEFIELD_ROOT, tf.TUNEFIELD_ROOT_MODE)
    try:
        tf.TUNEFIELD_ROOT, tf.TUNEFIELD_ROOT_MODE = "/Volumes/GIGSTICK/Tunefield", "portable"
        stored, host = tf._approval_key("/Volumes/GIGSTICK/Collected/Set")
        check("a stick approval is stored relative to the data root", host is None and stored == "../Collected/Set", (stored, host))
        tf.TUNEFIELD_ROOT = "/Volumes/RENAMED/Tunefield"
        check("…so on the renamed stick it is the same key", tf._approval_key("/Volumes/RENAMED/Collected/Set") == (stored, None))
    finally:
        tf.TUNEFIELD_ROOT, tf.TUNEFIELD_ROOT_MODE = real
    j = J(c.delete("/export/approvals", json={"kind": "rekordbox_bridge", "target": target}))
    check("DELETE revokes", j.get("approved") is False and J(c.get("/export/approvals"))["approvals"] == [])
    check("…and the next export asks again", export().status_code == 409)

    bad = [c.post("/export/approvals", json={"kind": "nope", "target": target}).status_code,
           c.post("/export/approvals", json={"kind": "rekordbox_bridge", "target": "relative/path"}).status_code,
           c.post("/export/approvals", json={"kind": "rekordbox_bridge", "target": 5}).status_code]
    check("bad bodies answer 400", bad == [400, 400, 400], bad)
    r = c.post("/export/approvals", json={"kind": "rekordbox_bridge", "target": target}, headers={"Origin": "https://evil.example"})
    check("cross-origin approval refused", r.status_code == 403)
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
