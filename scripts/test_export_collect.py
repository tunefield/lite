#!/usr/bin/env python3
"""Regression: E5, collect a set to a folder (1.1.0).

- dry_run reports size, free space and what is already there, and writes nothing
- an unapproved target folder → 409 approval_required, nothing created (E0)
- approved → numbered copies in set order + a relative M3U8 in <target>/<set name>/
- a second run skips files that are already there unchanged
- a file there with different contents → 409 files_exist; "skip" keeps it, "replace" replaces it
- not enough space → 409, nothing copied; no temp file is ever left behind

    .venv/bin/python scripts/test_export_collect.py
"""
import os, sys, json, hashlib, tempfile, shutil, base64, collections

TMP = os.path.realpath(tempfile.mkdtemp(prefix="tf-collect-"))
ROOT = os.path.join(TMP, "root"); os.makedirs(os.path.join(ROOT, "data"))
os.environ["TUNEFIELD_ROOT"] = ROOT
os.environ["TUNEFIELD_TEST_HOST_ID"] = "collect-mac"
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
    src = os.path.join(TMP, "lib"); os.makedirs(src)
    names = ["b.mp3", "a.flac", "#odd.wav"]
    for i, n in enumerate(names):
        with open(os.path.join(src, n), "wb") as f: f.write(bytes([i]) * (1000 * (i + 1)))
    tracks = [{"path": os.path.join(src, n), "label": f"Artist - Track {i}", "duration": 200 + i} for i, n in enumerate(names)]
    tracks.append({"path": os.path.join(src, "gone.mp3"), "label": "Gone"})
    target = os.path.join(TMP, "stick"); os.makedirs(target)
    post = lambda **kw: c.post("/export/collect", json={"name": "Club: Friday", "target": target, "tracks": tracks, **kw})
    dest = os.path.join(target, "Club_ Friday")

    check("without Pro: refused", post(dry_run=True).status_code == 403)
    c.post("/api/license", json={"key": mint({"v": 1, "p": "pro", "s": "lite-lifetime", "o": "QA", "t": 1768176000, "h": "00000000"})})
    j = J(post(dry_run=True))
    check("dry run: 3 files, 6000 bytes, one missing, free space reported, nothing written",
          j.get("dest") == dest and j["files"] == 3 and j["bytes_to_copy"] == 6000 and j["missing"] == [tracks[3]["path"]]
          and j["free"] > 0 and not os.path.exists(dest), j)
    r = post(); j = J(r)
    check("unapproved folder: 409 approval_required, nothing created",
          r.status_code == 409 and j.get("approval_required", {}).get("kind") == "collect_folder" and not os.path.exists(dest), j)
    c.post("/export/approvals", json=j["approval_required"])
    j = J(post())
    files = sorted(os.listdir(dest))
    check("approved: numbered copies + playlist", j.get("ok") and files == ["01 b.mp3", "02 a.flac", "03 #odd.wav", "Club_ Friday.m3u8"], (j, files))
    check("copies are byte-identical", all(open(os.path.join(dest, f"{i+1:02d} {n}"), "rb").read() == open(os.path.join(src, n), "rb").read()
                                          for i, n in enumerate(names)))
    m3u = open(os.path.join(dest, "Club_ Friday.m3u8"), encoding="utf-8").read().splitlines()
    check("M3U8 is relative, in order, with labels and lengths",
          m3u == ["#EXTM3U", "#EXTINF:200,Artist - Track 0", "01 b.mp3", "#EXTINF:201,Artist - Track 1", "02 a.flac",
                  "#EXTINF:202,Artist - Track 2", "03 #odd.wav"], m3u)
    j = J(post())
    check("second run: unchanged files are skipped", j.get("written") == [] and len(j.get("skipped_same", [])) == 3, j)

    with open(os.path.join(dest, "02 a.flac"), "wb") as f: f.write(b"edited elsewhere")
    r = post(); j = J(r)
    check("a file there with other contents: 409 files_exist", r.status_code == 409 and j.get("files_exist") == ["02 a.flac"], j)
    J(post(existing="skip"))
    check("'skip' keeps it", open(os.path.join(dest, "02 a.flac"), "rb").read() == b"edited elsewhere")
    J(post(existing="replace"))
    check("'replace' replaces it", open(os.path.join(dest, "02 a.flac"), "rb").read() == open(os.path.join(src, "a.flac"), "rb").read())

    real = shutil.disk_usage
    shutil.disk_usage = lambda p: collections.namedtuple("u", "total used free")(10**9, 10**9, 1000)
    try:
        os.remove(os.path.join(dest, "01 b.mp3"))
        r = post()
        check("not enough space: 409, nothing copied", r.status_code == 409 and not os.path.exists(os.path.join(dest, "01 b.mp3")), r.status_code)
    finally:
        shutil.disk_usage = real
    check("no temp file left behind", not [f for f in os.listdir(dest) if f.startswith((".tftmp-", "._"))])
    check("bad bodies answer 400", [c.post("/export/collect", json=b).status_code for b in (
        {"name": "x", "target": "rel/dir", "tracks": tracks},
        {"name": "x", "target": target, "tracks": []},
        {"name": "x", "target": os.path.join(TMP, "nope"), "tracks": tracks})] == [400, 400, 400])
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
