#!/usr/bin/env python3
"""Regression: the 1.1.0 should-fix batch (debug sweep 2 Nov 2026).

- #12 a deleted track keeps its cover while Undo can bring it back; pruning drops it
- #17/#50 Undo restores the deletion it is asked for; same-second names keep time order
- #16 /tracks/resolve never drops ids past the old 500 cap
- #20 two windows rating different tracks both survive; null deletes; big bodies save
- #21 a deleted Field's folder can be added again; another Field's folder is named
- #63 deleting a recreated set keeps the earlier trashed copy
- #13 a file replaced on disk is offered for update and re-analysed in place
- #48 a pure tone has no pulse; a kick keeps its pulse
- #10 a VBR MP3 without a Xing frame gets its real length (needs ffmpeg; skipped without)
- #49 big folder art is shrunk (needs macOS sips; skipped without)

Runs against an isolated TUNEFIELD_ROOT and touches nothing in the repo's data/.

    .venv/bin/python scripts/test_library_fixes.py
"""
import os, sys, json, math, wave, struct, tempfile, shutil, subprocess, time

ROOT = tempfile.mkdtemp(prefix="tf-libfix-")
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

def wav(path, secs, sr=22050, f=220.0, kick_bpm=None):
    n = int(sr * secs)
    out = []
    for i in range(n):
        if kick_bpm:
            ph = (i / sr) % (60.0 / kick_bpm)
            v = math.sin(2 * math.pi * 55 * ph) * math.exp(-ph * 30)
        else:
            v = math.sin(2 * math.pi * f * i / sr)
        out.append(struct.pack("<h", int(12000 * v)))
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(b"".join(out))

try:
    import app as tf
    c = tf.app.test_client()
    J = lambda r: r.get_json()

    paths = [os.path.join(MUSIC, f"t{i}.wav") for i in range(4)]
    for i, p in enumerate(paths): wav(p, 8, kick_bpm=120 + 4 * i)
    check("register folder", J(c.post("/library/roots", json={"path": MUSIC, "cat": "default"})).get("ok") is True)
    j = J(c.post("/library/analyse", json={"paths": paths, "duration": 1.0, "cat": "default"}))
    check("analyse 4 tracks", j.get("added_count") == 4, j)
    ents = sorted(J(c.get("/catalog?cat=default")), key=lambda e: e["filename"])
    ids = [e["id"] for e in ents]

    # ── #13 file size stored, replaced file offered, re-analysed in place ──
    raw = {e["id"]: e for e in tf.load_cat("default")}
    check("new entries record their file size", raw[ids[0]].get("file_size") == os.path.getsize(paths[0]), raw[ids[0]].get("file_size"))
    st = J(c.get("/library/stale?cat=default"))
    check("nothing to update yet", st["count"] == 0 and st["changed"] == 0, st)
    wav(paths[0], 11, kick_bpm=100)                       # a different master, same name
    st = J(c.get("/library/stale?cat=default"))
    check("replaced file is offered as changed", st["ids"] == [ids[0]] and st["changed"] == 1, st)
    j = J(c.post("/library/reanalyse", json={"cat": "default", "ids": [ids[0]], "duration": 1.0}))
    e0 = next(e for e in tf.load_cat("default") if e["id"] == ids[0])
    check("re-analysed in place: same id, new size, new length",
          e0.get("file_size") == os.path.getsize(paths[0]) and round(e0["data"]["metadata"]["duration_sec"]) == 11, (j, e0.get("file_size")))
    check("offer is empty again", J(c.get("/library/stale?cat=default"))["count"] == 0)
    legacy = dict(raw[ids[1]]); legacy.pop("file_size", None)
    check("entries from before 1.1.0 (no size) are never flagged", tf._is_changed(legacy) is False)

    # ── #12 covers survive a deletion while Undo can restore it ──
    for i in ids[:3]:
        with open(os.path.join(tf.COVERS_DIR, f"{i}.jpg"), "wb") as f: f.write(b"\xff\xd8\xff cover")
    r1 = J(c.delete(f"/catalog/{ids[1]}?cat=default")); time.sleep(0.01)
    r2 = J(c.delete(f"/catalog/{ids[2]}?cat=default"))
    check("deleted tracks keep their covers", all(os.path.exists(os.path.join(tf.COVERS_DIR, f"{i}.jpg")) for i in ids[1:3]))
    # ── #17 Undo restores the named deletion, not the newest ──
    j = J(c.post("/repair/undo-entries", json={"snapshot": r1["snapshot"]}))
    have = {e["id"] for e in J(c.get("/catalog?cat=default"))}
    check("Undo with a name restores that deletion", j.get("restored") == 1 and ids[1] in have and ids[2] not in have, j)
    check("restored track has its cover", J(c.get("/catalog?cat=default")) and
          next(e for e in J(c.get("/catalog?cat=default")) if e["id"] == ids[1]).get("has_cover") is True)
    check("an unknown snapshot name is refused", c.post("/repair/undo-entries", json={"snapshot": "nope.json"}).status_code == 404)
    j = J(c.post("/repair/undo-entries", json={}))
    check("Undo without a name restores the newest", j.get("restored") == 1)
    # ── #50 same-second names keep time order; pruning drops covers of tracks gone ──
    names = ["20261102-155832-delete-entry.json", "20261102-155832-delete-entry-2.json",
             "20261102-155832-000001-remove-folder.json", "20261102-155833-dedup-x.json"]
    os.makedirs(tf.ENTRIES_TRASH_DIR, exist_ok=True)
    for n in names:
        with open(os.path.join(tf.ENTRIES_TRASH_DIR, n), "w") as f: json.dump({"catalogs": {}}, f)
    order = [n for n in tf._entries_snaps() if n in names]
    check("snapshots order by time, '-2' after its twin", order.index("20261102-155832-delete-entry.json")
          < order.index("20261102-155832-delete-entry-2.json") and order[-1] == "20261102-155833-dedup-x.json", order)
    for n in names: os.remove(os.path.join(tf.ENTRIES_TRASH_DIR, n))
    gone_id = "gone-track"
    with open(os.path.join(tf.COVERS_DIR, f"{gone_id}.jpg"), "wb") as f: f.write(b"\xff\xd8\xff")
    tf._snapshot_entries_trash("delete-entry", {"default": [{"id": gone_id}]})
    for k in range(tf.ENTRIES_TRASH_KEEP):
        tf._snapshot_entries_trash("delete-entry", {"default": [{"id": f"x{k}"}]})
    check("pruned snapshot takes its track's cover with it", not os.path.exists(os.path.join(tf.COVERS_DIR, f"{gone_id}.jpg")))
    check("a cover of a track still in a Field is never pruned", os.path.exists(os.path.join(tf.COVERS_DIR, f"{ids[0]}.jpg")))

    # ── #16 resolve past 500 ids ──
    fake = [f"fake-{i}" for i in range(600)]
    j = J(c.post("/tracks/resolve", json={"ids": fake + [ids[0]]}))
    check("resolve: 601 ids → 1 found, 600 missing, none dropped", len(j["found"]) == 1 and len(j["missing"]) == 600, (len(j["found"]), len(j["missing"])))

    # ── #20 per-item merge ──
    c.post("/annotations", json={"patch": {"ratings": {"t1": 5}}})
    c.post("/annotations", json={"patch": {"ratings": {"t2": 3}}})
    a = J(c.get("/annotations"))
    check("two windows rating different tracks: both kept", a["ratings"] == {"t1": 5, "t2": 3}, a["ratings"])
    c.post("/annotations", json={"patch": {"ratings": {"t1": None}, "track_tags": {"t2": ["tag-a"]}}})
    a = J(c.get("/annotations"))
    check("null removes one rating, the other stays; track tags merge", a["ratings"] == {"t2": 3} and a["track_tags"] == {"t2": ["tag-a"]}, a)
    c.post("/annotations", json={"patch": {"ratings": {"t3": 9, "t4": True, "t5": "5"}}})
    check("invalid ratings are ignored", J(c.get("/annotations"))["ratings"] == {"t2": 3})
    big = {f"{i:08d}-0000-0000-0000-000000000000": 4 for i in range(2000)}
    body = json.dumps({"patch": {"ratings": big}})
    r = c.post("/annotations", data=body, content_type="application/json")
    check("a patch over 64 KiB saves", len(body) > 65536 and r.status_code == 200 and len(J(c.get("/annotations"))["ratings"]) == 2001, (len(body), r.status_code))
    c.post("/annotations", json={"views": [{"name": "v1"}]})
    check("views still save whole", J(c.get("/annotations"))["views"] == [{"name": "v1"}])

    # ── #21 folders of deleted and of other Fields ──
    gig = os.path.join(ROOT, "gig"); os.makedirs(gig)
    J(c.post("/catalogs", json={"name": "Gig"}))
    c.post("/library/roots", json={"path": gig, "cat": "gig"})
    d = c.delete("/catalogs/gig")
    j = J(c.post("/library/roots", json={"path": gig, "cat": "default"}))
    check("a deleted Field's folder can be added to another Field", d.status_code == 200 and j.get("reassigned") is True and not j.get("already"), j)
    J(c.post("/catalogs", json={"name": "Club"}))
    j = J(c.post("/library/roots", json={"path": gig, "cat": "club"}))
    check("a folder of another live Field is named, not silently 'already'", j.get("owner") == "default" and j.get("owner_name"), j)
    os.makedirs("/tmp/tf-libfix-orphan-probe", exist_ok=True)
    cfg = tf.load_config(); cfg["library_roots"].append({"path": "/tmp/tf-libfix-orphan-probe", "cat": "deleted_field"}); tf.save_config(cfg)
    j = J(c.post("/library/roots", json={"path": "/tmp/tf-libfix-orphan-probe", "cat": "club"}))
    check("a folder left by a deleted Field is taken over", j.get("reassigned") is True, j)
    shutil.rmtree("/tmp/tf-libfix-orphan-probe", ignore_errors=True)

    # ── #63 recreated set deleted twice ──
    s1 = J(c.post("/playlists", json={"name": "Saturday"}))["slug"]
    c.delete(f"/playlists/{s1}")
    s2 = J(c.post("/playlists", json={"name": "Saturday"}))["slug"]
    c.delete(f"/playlists/{s2}")
    trash = os.listdir(os.path.join(tf.PLAYLISTS_DIR, "_trash"))
    check("both trashed 'Saturday' copies are kept", s1 == s2 and len([t for t in trash if t.startswith(s1)]) == 2, trash)
    check("restore brings back the newest", c.post(f"/playlists/{s1}/restore").status_code == 200)

    # ── #48 pulse ──
    from analyze import analyze
    tone = os.path.join(ROOT, "tone.wav"); wav(tone, 20)
    d = analyze(tone, duration_limit=1.0, verbose=False)
    check("pure tone: pulse 0", d["rhythm"]["pulse_clarity"] == 0, d["rhythm"])
    kick = os.path.join(ROOT, "kick.wav"); wav(kick, 20, kick_bpm=120)
    d = analyze(kick, duration_limit=1.0, verbose=False)
    check("120 BPM kick keeps a strong pulse", (d["rhythm"]["pulse_clarity"] or 0) > 0.5, d["rhythm"])

    # ── #10 VBR MP3 without Xing ──
    if shutil.which("ffmpeg"):
        import numpy as np, soundfile as sf
        src = os.path.join(ROOT, "vbr.wav"); sr = 44100; t = np.arange(sr * 120) / sr
        y = np.zeros_like(t); y[:sr * 30] = 0.05 * np.sin(2 * np.pi * 220 * t[:sr * 30])
        y[sr * 30:] = 0.4 * np.random.default_rng(1).standard_normal(len(t) - sr * 30)
        sf.write(src, y.astype(np.float32), sr)
        mp3 = os.path.join(ROOT, "noxing.mp3")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-c:a", "libmp3lame", "-q:a", "9",
                        "-write_xing", "0", mp3], check=True)
        d = analyze(mp3, duration_limit=0.5, verbose=False)
        check("Xing-less VBR MP3: real length", round(d["metadata"]["duration_sec"]) == 120, d["metadata"].get("duration_sec"))
        check("and it is decoded beyond libsndfile's guess", not d.get("warnings") and "_decode_via" not in d["metadata"], d.get("warnings"))
    else:
        print("  (ffmpeg not installed: #10 skipped)")

    # ── #49 folder art ──
    if os.path.exists("/usr/bin/sips"):
        import numpy as np
        ppm = os.path.join(ROOT, "big.ppm"); jpg = os.path.join(ROOT, "big.jpg")
        arr = np.random.default_rng(0).integers(0, 255, (1600, 1600, 3)).astype(np.uint8)
        with open(ppm, "wb") as f: f.write(b"P6 1600 1600 255\n" + arr.tobytes())
        subprocess.run(["/usr/bin/sips", "-s", "format", "jpeg", ppm, "--out", jpg], capture_output=True)
        blob = open(jpg, "rb").read()
        small = tf._small_cover(jpg, blob)
        check("big folder art is shrunk", len(blob) > 1_000_000 and small and len(small) < 200_000 and small[:3] == b"\xff\xd8\xff", (len(blob), len(small or b"")))
    else:
        print("  (sips not available: #49 skipped)")
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
