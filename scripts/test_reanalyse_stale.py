#!/usr/bin/env python3
"""Regression: updating tracks analysed by an older FEATURES_VERSION (1.1.0).

/library/stale lists a Field's stale tracks; /library/reanalyse replaces only their
analysis through journal "patch" records and keeps everything the user or Repair set on
the entry (genre, BPM correction, filename, blank-filled tags, cover). Also pins the
journal contract: a patch never becomes an entry, a patch for a deleted entry is
dropped, folding applies patches, and the 1.0.0 merge rule (first id wins) ignores them.

Runs against an isolated TUNEFIELD_ROOT and touches nothing in the repo's data/.

    python3 scripts/test_reanalyse_stale.py
"""
import os, sys, math, wave, struct, tempfile, shutil, json

ROOT = tempfile.mkdtemp(prefix="tf-stale-")
os.environ["TUNEFIELD_ROOT"] = ROOT
os.makedirs(os.path.join(ROOT, "data"))
MUSIC = os.path.join(ROOT, "music"); os.makedirs(MUSIC)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
os.chdir(REPO)

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []

def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

def make_wav(path, secs=6, sr=22050, f=220.0, pulse=2.0):
    """Mono 16-bit tone with an amplitude pulse, so tempo estimation has something."""
    n = sr * secs
    frames = b"".join(
        struct.pack("<h", int(12000 * math.sin(2 * math.pi * f * i / sr)
                                  * (0.55 + 0.45 * math.sin(2 * math.pi * pulse * i / sr))))
        for i in range(n))
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(frames)

try:
    import app as tf
    c = tf.app.test_client()
    J = lambda r: r.get_json()
    CUR = tf.FEATURES_VERSION

    wavs = [os.path.join(MUSIC, f"tone{i}.wav") for i in range(3)]
    for i, p in enumerate(wavs): make_wav(p, f=220.0 + 110.0 * i, pulse=2.0 + i * 0.25)
    check("create Field 'Old'", J(c.post("/catalogs", json={"name": "Old"})).get("slug") == "old")
    check("register music folder", J(c.post("/library/roots", json={"path": MUSIC, "cat": "old"})).get("ok") is True)
    j = J(c.post("/library/analyse", json={"paths": wavs, "duration": 2, "cat": "old"}))
    check("analyse 3 tracks", j.get("added_count") == 3, j)
    check("fresh tracks are not stale", J(c.get("/library/stale?cat=old")).get("count") == 0)

    # Age the Field: an older version wrote these, with a wrong tempo we can recognise.
    ents = tf.load_cat("old")
    ents.sort(key=lambda e: e["filename"])
    for e in ents:
        d = e["data"]; d["features_version"] = CUR - 1
        d["rhythm"]["bpm"] = d["rhythm"]["bpm_detected"] = 999.0
    ents[0]["data"]["metadata"]["year"] = "1999"          # Repair backfill; file has no tags
    ents[2]["filename"] = "Renamed by Repair.wav"
    ghost = json.loads(json.dumps(ents[2])); ghost["id"] = "ghost-id"
    ghost["library_file"] = os.path.join(MUSIC, "gone.wav")      # stale but missing on disk
    tf.save_cat("old", ents + [ghost])
    id0, id1, id2 = (e["id"] for e in ents)
    with open(os.path.join(tf.COVERS_DIR, f"{id0}.jpg"), "wb") as f:
        f.write(b"\xff\xd8 user cover")
    check("user genre edit", J(c.patch(f"/catalog/{id0}", json={"genre": "Kept Genre"})).get("ok") is True)
    c.post(f"/catalog/{id1}/bpm?cat=old", json={"bpm": 128})

    s = J(c.get("/library/stale?cat=old"))
    check("stale: 3 offered, missing file counted not offered",
          s.get("count") == 3 and s.get("missing") == 1 and s.get("version") == CUR
          and "ghost-id" not in s.get("ids", []), s)

    j = J(c.post("/library/reanalyse", json={"cat": "old", "ids": [id0, id1], "duration": 2}))
    check("reanalyse 2 of 3", j.get("updated_count") == 2 and j.get("error_count") == 0, j)
    jr = tf._read_journal("old")
    check("one patch record per track, keyed by the track's own id",
          len(jr) == 2 and all(r.get("_patch") and r.get("id") in (id0, id1) for r in jr), jr)

    by = {e["id"]: e for e in tf.load_cat("old")}
    check("no entry added or lost", len(by) == 4, sorted(by))
    e0, e1, e2 = by[id0], by[id1], by[id2]
    check("updated track carries the current version and a new tempo",
          e0["data"].get("features_version") == CUR and e0["data"]["rhythm"]["bpm"] != 999.0,
          e0["data"]["rhythm"])
    check("genre edit kept", e0.get("genre") == "Kept Genre", e0.get("genre"))
    check("blank-filled tag kept", e0["data"]["metadata"].get("year") == "1999", e0["data"]["metadata"])
    check("cover kept", open(os.path.join(tf.COVERS_DIR, f"{id0}.jpg"), "rb").read() == b"\xff\xd8 user cover")
    check("BPM correction still applied over the new analysis",
          e1["data"]["rhythm"]["bpm"] == 128 and e1.get("bpm_user") == 128
          and e1["data"]["rhythm"]["bpm_detected"] != 999.0, e1["data"]["rhythm"])
    check("untouched track still old", e2["data"]["features_version"] == CUR - 1
          and e2["filename"] == "Renamed by Repair.wav")
    check("stale count drops to 1", J(c.get("/library/stale?cat=old")).get("count") == 1)

    j = J(c.post("/library/reanalyse", json={"cat": "old", "ids": [id0, "ghost-id", "nope"], "duration": 2}))
    check("current track is a non-event, missing file an error, unknown id gone",
          j.get("updated_count") == 0 and j.get("current_count") == 1
          and j.get("error_count") == 1 and j.get("gone_count") == 1, j)

    j = J(c.post("/library/reanalyse", json={"cat": "old", "ids": [id2], "duration": 2}))
    check("third track updated, Repair's filename kept",
          j.get("updated_count") == 1 and tf.load_cat("old")[2]["filename"] == "Renamed by Repair.wav", j)

    # A patch for an entry deleted before the merge must vanish, never resurrect it.
    tf.append_journal("old", {"id": "deleted-id", "_patch": True, "data": {"x": 1}})
    check("patch for a deleted entry is dropped", len(tf.load_cat("old")) == 4)

    # 1.0.0's merge rule: journal records whose id is already in the base are skipped.
    base, pend = tf._load_cat_raw("old"), tf._read_journal("old")
    seen = {e.get("id") for e in base}
    old_rule = base + [e for e in pend if e.get("id") not in seen]
    check("1.0.0 reader ignores patches for existing tracks",
          len([e for e in old_rule if e.get("_patch") and e.get("id") in seen]) == 0)

    tf.fold_journal("old")
    raw = {e["id"]: e for e in tf._load_cat_raw("old")}
    check("fold applies patches and leaves no journal",
          len(raw) == 4 and not os.path.exists(tf.journal_file("old"))
          and all(raw[i]["data"]["features_version"] == CUR for i in (id0, id1, id2))
          and not any(e.get("_patch") for e in raw.values()), sorted(raw))
    check("reanalyse is lock-exempt", "library_reanalyse" in tf._LOCK_EXEMPT_ENDPOINTS)
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

if failures:
    print(f"\n{FAIL} {len(failures)} failure(s): " + "; ".join(failures)); sys.exit(1)
print(f"\n{OK} all checks passed"); sys.exit(0)
