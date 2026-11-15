#!/usr/bin/env python3
"""Regression: E4 routes, writing BPM/key/energy into the user's files (1.1.0).

- off by default: a write is refused until Settings turns it on; preview always writes nothing
- each music folder needs the user's OK once (E0, kind tag_write)
- MP3 and FLAC get the values; a WAV is left alone with its reason
- the entries' stored file_size follows the write, so /library/stale never flags our own write
- Undo (restore) puts the old values back, absent fields removed; a run undone twice → 404
- leftover .tftmp- temps are removed at startup (in-flight record) and by a library scan

Needs ffmpeg for the test files (skips without it). Keys are signed by the public TEST key.

    .venv/bin/python scripts/test_export_tags.py
"""
import os, sys, json, hashlib, tempfile, shutil, base64, subprocess, time

if not shutil.which("ffmpeg"):
    print("ffmpeg not installed: skipped"); sys.exit(0)
TMP = os.path.realpath(tempfile.mkdtemp(prefix="tf-tags-"))
ROOT = os.path.join(TMP, "root"); os.makedirs(os.path.join(ROOT, "data"))
MUSIC = os.path.join(TMP, "music"); os.makedirs(MUSIC)
os.environ["TUNEFIELD_ROOT"] = ROOT
os.environ["TUNEFIELD_TEST_HOST_ID"] = "tags-mac"
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

def make(name, extra=()):
    out = os.path.join(MUSIC, name)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=8",
                    *extra, out], check=True)
    return out

try:
    mp3 = make("one.mp3", ["-c:a", "libmp3lame", "-q:a", "5"])
    flac = make("two.flac")
    wav = make("three.wav")
    import app as tf, tag_write
    tf.LICENSE_PUBKEY_B64 = PUB
    c = tf.app.test_client(); J = lambda r: r.get_json()
    c.post("/library/roots", json={"path": MUSIC, "cat": "default"})
    J(c.post("/library/analyse", json={"paths": [mp3, flac, wav], "duration": 1.0, "cat": "default"}))
    ents = {e["filename"]: e for e in J(c.get("/catalog?cat=default"))}
    ids = [ents[n]["id"] for n in ("one.mp3", "two.flac", "three.wav")]
    # give the tracks known values (as a user's corrections would)
    cat = tf.load_cat("default")
    for e in cat:
        e["bpm_user"] = 127.6
        e["data"]["harmony"].update({"root": "A", "mode": "minor"})
        e["data"]["energy"]["level"] = 0.72
    tf.save_cat("default", cat)
    body = {"ids": ids, "fields": {"bpm": True, "key": True, "energy": True}, "key_format": "musical"}

    check("without Pro: refused", c.post("/export/tags/preview", json=body).status_code == 403)
    c.post("/api/license", json={"key": mint({"v": 1, "p": "pro", "s": "lite-lifetime", "o": "QA", "t": 1768176000, "h": "00000000"})})
    before = {p: open(p, "rb").read() for p in (mp3, flac, wav)}
    j = J(c.post("/export/tags/preview", json=body))
    check("preview: 2 of 3 writable, the WAV left alone with its reason, nothing written",
          j.get("count") == 3 and j.get("writable") == 2 and j["skipped"][0]["reason"] == tag_write.R_FORMAT
          and all(open(p, "rb").read() == b for p, b in before.items()), j)
    check("tag writing is off by default", J(c.get("/export/tags/settings")) == {"enabled": False})
    r = c.post("/export/tags/write", json=body)
    check("…so a write is refused (409), nothing written", r.status_code == 409 and J(r).get("tag_write_disabled")
          and all(open(p, "rb").read() == b for p, b in before.items()))
    c.post("/export/tags/settings", json={"enabled": True})
    r = c.post("/export/tags/write", json=body); j = J(r)
    check("on, but the music folder needs an OK: 409 approval_required for it",
          r.status_code == 409 and j.get("approval_required") == {"kind": "tag_write", "target": MUSIC}, j)
    c.post("/export/approvals", json=j["approval_required"])
    j = J(c.post("/export/tags/write", json=body))
    check("approved: 2 files written, the WAV skipped", j.get("written") == 2 and len(j.get("skipped")) == 1 and j.get("run"), j)
    v_mp3, v_flac = tag_write.read_values(mp3), tag_write.read_values(flac)
    check("MP3: TBPM 128, TKEY Am, energy 7", (v_mp3["bpm"], v_mp3["key"], v_mp3["energy"]) == ("128", "Am", "7"), v_mp3)
    check("FLAC: BPM 127.60, INITIALKEY Am, ENERGY 7", (v_flac["bpm"], v_flac["key"], v_flac["energy"]) == ("127.60", "Am", "7"), v_flac)
    check("WAV untouched", open(wav, "rb").read() == before[wav])
    sizes = {e["filename"]: e.get("file_size") for e in tf.load_cat("default")}
    check("stored file_size follows the write", sizes["one.mp3"] == os.path.getsize(mp3) and sizes["two.flac"] == os.path.getsize(flac), sizes)
    st = J(c.get("/library/stale?cat=default"))
    check("our own write is not flagged as a changed file", st.get("changed") == 0, st)

    run = j["run"]
    u = J(c.post("/export/tags/restore", json={"run": run}))
    check("Undo restores both files", u.get("restored") == 2 and u.get("skipped") == [], u)
    check("…old values back (absent → removed)", tag_write.read_values(mp3) == {"bpm": None, "key": None, "energy": None}
          and tag_write.read_values(flac) == {"bpm": None, "key": None, "energy": None},
          (tag_write.read_values(mp3), tag_write.read_values(flac)))
    check("…and still not flagged as changed", J(c.get("/library/stale?cat=default")).get("changed") == 0)
    check("a run undone twice → 404", c.post("/export/tags/restore", json={"run": run}).status_code == 404)
    check("bad bodies answer 400", [c.post("/export/tags/preview", json=b).status_code for b in (
        {"ids": [], "fields": {"bpm": True}}, {"ids": ids, "fields": {}}, {"ids": ids, "fields": {"bpm": False}})] == [400, 400, 400])

    # leftovers: in-flight record at startup, and the scan
    t1 = os.path.join(MUSIC, ".tftmp-aaaaaaaaaaaa"); open(t1, "wb").write(b"x")
    tf.atomic_json_dump(tf.TAGS_INFLIGHT, [tf.store_path(MUSIC)])
    tf._cleanup_inflight()
    check("startup removes temps of a run that was cut off", not os.path.exists(t1) and not os.path.exists(tf.TAGS_INFLIGHT))
    # The engine ages a temp by max(mtime, ctime), and ctime can't be backdated in a test,
    # so check that the scan asks for the cleanup of the folder holding a temp.
    t2 = os.path.join(MUSIC, ".tftmp-bbbbbbbbbbbb"); open(t2, "wb").write(b"x")
    real, asked = tag_write.cleanup_temps, []
    tag_write.cleanup_temps = lambda folder, older_than_s=600: (asked.append(folder), real(folder, 0))[1]
    try:
        c.get("/library/scan?cats=default")
    finally:
        tag_write.cleanup_temps = real
    check("a library scan cleans temps in the folders it walks", asked == [MUSIC] and not os.path.exists(t2), asked)
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
