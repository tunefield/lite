#!/usr/bin/env python3
"""Regression: E3, Serato crate export route (1.1.0).

- dry_run says where each crate would go and writes nothing
- no _Serato_ folder (Serato never opened) → 409, nothing created
- an unapproved Subcrates folder → 409 approval_required, nothing created (E0)
- approved → the crate is written with the set's tracks in order, paths relative to the drive
- the same name again → 409 crate_exists; overwrite → replaced
- a track on a drive without _Serato_ is skipped with the reason, the rest is written

HOME points at a temp folder, so ~/Music is never the real one. Keys are signed by the
public TEST key; the app's real key is swapped out.

    .venv/bin/python scripts/test_export_serato.py
"""
import os, sys, json, hashlib, tempfile, shutil, base64

TMP = tempfile.mkdtemp(prefix="tf-serato-")
ROOT = os.path.join(TMP, "root"); HOME = os.path.realpath(os.path.join(TMP, "home"))
os.makedirs(os.path.join(ROOT, "data")); os.makedirs(os.path.join(HOME, "Music"))
os.environ["TUNEFIELD_ROOT"] = ROOT
os.environ["HOME"] = HOME
os.environ["TUNEFIELD_TEST_HOST_ID"] = "serato-mac"

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
os.chdir(REPO)

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import license_key as lk
import serato_crate

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
    music = os.path.join(HOME, "Music", "Set")
    os.makedirs(music)
    paths = [os.path.join(music, n) for n in ("b one.mp3", "a twö.flac", "c three.wav")]
    for p in paths: open(p, "wb").close()
    post = lambda **kw: c.post("/export/serato", json={"name": "Friday Warmup", "paths": paths, **kw})

    check("without Pro: refused", post(dry_run=True).status_code == 403)
    c.post("/api/license", json={"key": mint({"v": 1, "p": "pro", "s": "lite-lifetime", "o": "QA", "t": 1768176000, "h": "00000000"})})
    sub = os.path.join(HOME, "Music", "_Serato_", "Subcrates")
    j = J(post(dry_run=True))
    t = (j.get("targets") or [{}])[0]
    check("dry run: one crate in ~/Music/_Serato_/Subcrates, not set up yet",
          j.get("crate") == "Friday Warmup.crate" and t.get("dir") == sub and t.get("tracks") == 3 and t.get("serato_ready") is False, j)
    r = post()
    check("Serato never opened: 409, and no _Serato_ folder created",
          r.status_code == 409 and not os.path.exists(os.path.join(HOME, "Music", "_Serato_")), (r.status_code, J(r)))

    os.makedirs(os.path.join(HOME, "Music", "_Serato_"))          # what Serato does on first launch
    r = post(); j = J(r)
    check("unapproved Subcrates: 409 approval_required for that folder",
          r.status_code == 409 and j.get("approval_required", {}).get("kind") == "serato_crate"
          and j["approval_required"]["target"] == os.path.realpath(sub), (r.status_code, j))
    check("…and nothing written, not even Subcrates", not os.path.exists(sub))

    c.post("/export/approvals", json=j["approval_required"])
    r = post(); j = J(r)
    crate = os.path.join(sub, "Friday Warmup.crate")
    check("approved: the crate is written", r.status_code == 200 and j.get("written") == [crate], (r.status_code, j))
    rel = serato_crate.read_crate(open(crate, "rb").read())
    check("tracks in the set's order, paths relative to the drive", rel == [p.lstrip("/") for p in paths], rel)

    r = post(); j = J(r)
    check("same name again: 409 crate_exists, nothing replaced", r.status_code == 409 and j.get("crate_exists") == [crate], j)
    r = c.post("/export/serato", json={"name": "Friday Warmup", "paths": paths[:1], "overwrite": True})
    check("overwrite: replaced with the new list", r.status_code == 200 and serato_crate.read_crate(open(crate, "rb").read()) == [paths[0].lstrip("/")])

    r = c.post("/export/serato", json={"name": "Mixed", "paths": paths[:2] + ["/Volumes/NO-SUCH-DRIVE/x.mp3"]}); j = J(r)
    check("a drive without _Serato_ is skipped with the reason, the rest written",
          r.status_code == 200 and len(j.get("written", [])) == 1 and j["skipped"][0]["dir"].startswith("/Volumes/NO-SUCH-DRIVE")
          and "not set up" in j["skipped"][0]["reason"], j)
    # E6 through the route: view=arrangement gives a gzipped Live Set
    import gzip
    r = c.post("/export/als", json={"name": "Mix", "view": "arrangement", "overlap_bars": 4,
                                    "tracks": [{"location": p, "bpm": 120 + i, "duration_sec": 200} for i, p in enumerate(paths)]})
    xml = gzip.decompress(r.data) if r.status_code == 200 else b""
    check("E6 route: Arrangement set with clips in ArrangerAutomation", r.status_code == 200 and xml.count(b"<AudioClip ") >= 3
          and b'SelectedDocumentViewInMainWindow Value="0"' in xml, r.status_code)
    check("bad bodies answer 400", [c.post("/export/serato", json=b).status_code for b in
          ({"name": "", "paths": paths}, {"name": "x", "paths": []}, {"name": "x", "paths": ["rel/a.mp3"]})] == [400, 400, 400])
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
