#!/usr/bin/env python3
"""Regression: the 1.1.0 nice-to-have batch (debug sweep 2 Nov / review 30 Oct).

- #35 wrong JSON types answer 400, never 500
- #38 the five uncalled routes are gone
- #39 deleting the active set leaves no set active
- #54 _meta/_state are never a set or a Field; a user's "_x" still is
- #37 the playback cache evicts by last play (mtime), and its cap reads from the env
- #56 a Field write is seen by streaming at once, whatever the file stamps say
- #57 dedup only drops ids that are still duplicates
- #58 /repair/config no longer carries Discogs/AcoustID keys
- #65 Undo skips an entry whose file was analysed again meanwhile
- #45 (review) GET /catalog answers 304 to the ETag it served
- #32 a DC-only file has no key
- #49/#50 (review) ID3v2.4 per-frame flags; fast unsync with the same output

Runs against an isolated TUNEFIELD_ROOT and touches nothing in the repo's data/.

    .venv/bin/python scripts/test_polish.py
"""
import os, sys, json, math, wave, struct, tempfile, shutil, time, random

ROOT = tempfile.mkdtemp(prefix="tf-polish-")
os.environ["TUNEFIELD_ROOT"] = ROOT
os.environ["TUNEFIELD_STREAM_CACHE_CAP"] = "12345678"
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

def wav(path, secs=6, sr=22050, f=220.0, dc=None):
    n = int(sr * secs)
    if dc is not None:
        frames = struct.pack("<h", int(dc * 32767)) * n
    else:
        frames = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * f * i / sr)
                                                   * (0.55 + 0.45 * math.sin(2 * math.pi * 2 * i / sr)))) for i in range(n))
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(frames)

try:
    import app as tf
    c = tf.app.test_client()
    J = lambda r: r.get_json()
    paths = [os.path.join(MUSIC, f"t{i}.wav") for i in range(3)]
    for i, p in enumerate(paths): wav(p, f=220 + 60 * i)
    c.post("/library/roots", json={"path": MUSIC, "cat": "default"})
    J(c.post("/library/analyse", json={"paths": paths, "duration": 1.0, "cat": "default"}))
    ents = sorted(J(c.get("/catalog?cat=default")), key=lambda e: e["filename"])
    ids = [e["id"] for e in ents]

    # ── #35 ──
    st = [c.post("/catalogs", json={"name": 123}).status_code,
          c.post("/library/roots", json={"path": 123, "cat": "default"}).status_code,
          c.post("/library/analyse", json={"paths": [1, None], "cat": "default"}).status_code,
          c.patch(f"/catalog/{ids[0]}?cat=default", json={"genre": ["x"]}).status_code,
          c.post("/repair/ignore", json={"category": "missing_cover", "ids": [{"a": 1}]}).status_code]
    sl = J(c.post("/playlists", json={"name": "Set"}))["slug"]
    st.append(c.patch(f"/playlists/{sl}", json={"name": 123}).status_code)
    check("six wrong-type bodies answer 400", st == [400] * 6, st)

    # ── #38 ──
    gone = [c.post(f"/repair/relink/{ids[0]}", json={"path": paths[0]}).status_code,
            c.get("/repair/ignored").status_code,
            c.post(f"/repair/apply/{ids[0]}", json={}).status_code,
            c.get("/playlists/snapshots").status_code,
            c.post(f"/playlists/{sl}/snapshot").status_code]
    check("the five uncalled routes are gone", all(s in (404, 405) for s in gone), gone)

    # ── #39 ──
    c.put("/playlists/active", json={"slug": sl})
    other = J(c.post("/playlists", json={"name": "Other"}))["slug"]
    c.put("/playlists/active", json={"slug": sl})
    j = J(c.delete(f"/playlists/{sl}"))
    check("deleting the active set leaves none active", j.get("active_slug") is None, j)

    # ── #54 ──
    st = [c.patch("/playlists/_state", json={"name": "x"}).status_code,
          c.patch("/playlists/_meta", json={"name": "x"}).status_code]
    check("_state/_meta are not sets (400/404, never 500 or a rewrite)", all(s in (400, 404) for s in st), st)
    state_file = os.path.join(tf.PLAYLISTS_DIR, "_state.json")
    check("the state file was not rewritten as a set", "locked" not in json.load(open(state_file)))
    check("a user's '_x' set still works", J(c.post("/playlists", json={"name": "!x"}))["slug"] == "_x")
    check("a Field cannot be called _meta", J(c.post("/catalogs", json={"name": "_meta"}))["slug"] != "_meta")

    # ── #37 ──
    check("stream cache cap reads TUNEFIELD_STREAM_CACHE_CAP", tf.STREAM_CACHE_CAP == 12345678)
    os.makedirs(tf.STREAM_CACHE_DIR, exist_ok=True)
    now = time.time()
    for i, age in enumerate((300, 200, 100)):
        p = os.path.join(tf.STREAM_CACHE_DIR, f"c{i}-1-1.wav")
        with open(p, "wb") as f: f.write(b"\0" * 5_000_000)
        os.utime(p, (now, now - age))                  # same atime (FAT32: date only), mtime differs
    tf._stream_cache_trim()
    left = sorted(f for f in os.listdir(tf.STREAM_CACHE_DIR) if f.endswith(".wav"))
    check("the least recently played (oldest mtime) is evicted first", left == ["c1-1-1.wav", "c2-1-1.wav"], left)

    # ── #56 ──
    tf.entry_index_lookup(ids[0])                      # build the index
    real = tf._file_stamp
    tf._file_stamp = lambda p: (1, 1)                  # FAT32 worst case: stamps never change
    try:
        ents_raw = tf.load_cat("default")
        moved = os.path.join(MUSIC, "moved.wav"); shutil.copy(paths[0], moved)
        for e in ents_raw:
            if e["id"] == ids[0]: e["library_file"] = tf.store_path(moved)
        tf.save_cat("default", ents_raw)
        _slug, lf = tf.entry_index_lookup(ids[0])
        check("a Field write is seen at once, even with frozen file stamps", tf.absolute_form(lf) == moved, lf)
    finally:
        tf._file_stamp = real

    # ── #58 ──
    cfg = J(c.get("/repair/config"))
    check("repair config has no Discogs/AcoustID keys", "discogs_token" not in cfg and "acoustid_key" not in cfg, cfg)

    # ── #65 ──
    r = J(c.delete(f"/catalog/{ids[1]}?cat=default"))
    J(c.post("/library/analyse", json={"paths": [paths[1]], "duration": 1.0, "cat": "default"}))
    j = J(c.post("/repair/undo-entries", json={"snapshot": r["snapshot"]}))
    same_file = [e for e in J(c.get("/catalog?cat=default")) if e["filename"] == "t1.wav"]
    check("Undo skips an entry whose file was analysed again", j.get("restored") == 0 and j.get("already_in_field") == 1
          and len(same_file) == 1, (j, len(same_file)))

    # ── #57 ──
    tok = J(c.get("/system/token"))["token"]
    j = J(c.post("/repair/dedup", json={"category": "duplicate_files", "dry_run": False, "drop_ids": [ids[2]]},
                 headers={"X-Tunefield-Confirm": tok}))
    check("dedup skips an id that is not a duplicate", j.get("deleted") == 0 and j.get("skipped") == 1, j)
    check("…and the track is still there", ids[2] in {e["id"] for e in J(c.get("/catalog?cat=default"))})

    # ── review #45: ETag ──
    r1 = c.get("/catalog?cat=default")
    et = r1.headers.get("ETag")
    r2 = c.get("/catalog?cat=default", headers={"If-None-Match": et})
    check("GET /catalog answers 304 to its own ETag", et and r2.status_code == 304, (et, r2.status_code))
    c.patch(f"/catalog/{ids[0]}?cat=default", json={"genre": "Changed"})
    r3 = c.get("/catalog?cat=default", headers={"If-None-Match": et})
    check("…and 200 with a new body once the Field changed", r3.status_code == 200 and r3.headers.get("ETag") != et)

    # ── #32 ──
    from analyze import analyze
    dcf = os.path.join(ROOT, "dc.wav"); wav(dcf, secs=10, dc=0.3)
    d = analyze(dcf, duration_limit=1.0, verbose=False)
    check("a DC-only file has no key", d["harmony"]["key"] == "unknown" and d["harmony"]["key_confidence"] == 0, d["harmony"])
    d = analyze(paths[0], duration_limit=1.0, verbose=False)
    check("a real tone still gets a key", d["harmony"]["key"] != "unknown", d["harmony"])

    # ── review #49/#50: ID3 ──
    import tags
    def old_unsync(b):
        out = bytearray(); i = 0
        while i < len(b):
            out.append(b[i])
            i += 2 if (b[i] == 0xFF and i + 1 < len(b) and b[i + 1] == 0) else 1
        return bytes(out)
    random.seed(7)
    check("fast unsync gives the old output", all(tags._deunsync(b) == old_unsync(b) for b in
          (bytes(random.choice((0, 0xFF, 0x41)) for _ in range(random.randint(0, 50))) for _ in range(3000))))
    def ss(n): return bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F])
    raw = b"\x03Caf\xc3\xa9 \xff Night"
    data = ss(len(raw)) + raw.replace(b"\xff", b"\xff\x00")
    frame = b"TIT2" + ss(len(data)) + b"\x00" + bytes([0x03]) + data
    tag = b"ID3\x04\x00\x00" + ss(len(frame)) + frame
    check("v2.4 frame with data-length indicator + unsync reads clean", dict(tags._iter_id3_frames(tag)).get(b"TIT2") == raw)
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
