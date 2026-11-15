#!/usr/bin/env python3
"""Regression: the 1.1.0 data-safety fixes (debug sweep 2 Nov 2026 #14, #15, #18, #11; review #46).

- #14 a torn _meta.json on a FAT32 stick must not adopt '._default.json' as a Field
- #15 a journal fold that cannot be written (full stick) must not fail catalog reads,
      and the stream cache must leave the volume a margin of free space
- #18 a non-installed data root gets its own Rekordbox bridge file
- #11 a sub-5-second file gets no BPM (0 = no pulse), whatever its tag says
- #46 find_free_port skips a port that is taken on [::1]

Runs against an isolated TUNEFIELD_ROOT and touches nothing in the repo's data/.

    .venv/bin/python scripts/test_stick_safety.py
"""
import os, re, sys, json, math, wave, struct, socket, tempfile, shutil, errno

ROOT = tempfile.mkdtemp(prefix="tf-stick-")
os.environ["TUNEFIELD_ROOT"] = ROOT
os.makedirs(os.path.join(ROOT, "data"))

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
os.chdir(REPO)

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []

def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

def tone(path, secs, sr=22050, f=220.0):
    n = int(sr * secs)
    frames = b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * f * i / sr))) for i in range(n))
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(frames)

try:
    import app as tf
    c = tf.app.test_client()
    J = lambda r: r.get_json()

    # ── #14: '._' sidecars in catalogs/ ──
    check("create Field 'Keep'", J(c.post("/catalogs", json={"name": "Keep"})).get("slug") == "keep")
    check("create Field '!party' (slug starts with _)", J(c.post("/catalogs", json={"name": "!party"})).get("slug") == "_party")
    cdir = tf.CATALOGS_DIR
    for side in ("._default.json", "._keep.json", ".__meta.json"):
        with open(os.path.join(cdir, side), "wb") as f:
            f.write(b"\x00\x05\x16\x07AppleDouble sidecar")
    with open(tf.META_FILE, "w") as f:
        f.write('[{"name": "Def')                     # torn write
    r = c.get("/catalogs")
    slugs = sorted(m["slug"] for m in (J(r) or [])) if r.status_code == 200 else None
    check("torn meta + sidecars: GET /catalogs still 200", r.status_code == 200, (r.status_code, r.get_data()[:200]))
    check("recovered Fields are the real ones, no '._' slug", slugs == ["_party", "default", "keep"], slugs)
    check("GET /catalog works after recovery", c.get("/catalog?cat=keep").status_code == 200)

    # ── #15: a fold that cannot be written ──
    for i in range(tf.JOURNAL_FOLD_AT + 5):
        tf.append_journal("keep", {"id": f"j{i}", "filename": f"j{i}.wav", "data": {}})
    real_dump = tf.atomic_json_dump
    def full_disk(path, data, compact=False):
        if path == tf.cat_file("keep"):
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_dump(path, data, compact)
    tf.atomic_json_dump = full_disk
    try:
        r = c.get("/catalog?cat=keep")
        n = len(J(r) or []) if r.status_code == 200 else None
        check("full stick: GET /catalog answers 200 with every pending entry", r.status_code == 200 and n == tf.JOURNAL_FOLD_AT + 5, (r.status_code, n))
        check("full stick: GET /catalogs answers 200", c.get("/catalogs").status_code == 200)
        check("journal kept for a later fold", len(tf._read_journal("keep")) == tf.JOURNAL_FOLD_AT + 5)
    finally:
        tf.atomic_json_dump = real_dump
    check("space back: the next read folds the journal", len(J(c.get("/catalog?cat=keep"))) == tf.JOURNAL_FOLD_AT + 5
          and tf._read_journal("keep") == [])
    try:
        tf.atomic_json_dump(os.path.join(ROOT, "x.json"), {"a": {1, 2}})   # a set: json.dump fails mid-write
    except TypeError:
        pass
    check("a failed write leaves no .tmp behind", not os.path.exists(os.path.join(ROOT, "x.json.tmp")))

    os.makedirs(tf.STREAM_CACHE_DIR, exist_ok=True)
    for i in range(4):
        with open(os.path.join(tf.STREAM_CACHE_DIR, f"t{i}-1-1.wav"), "wb") as f:
            f.write(b"\0" * (1 << 20))
    real_free = tf._stream_free
    tf._stream_free = lambda: tf.STREAM_FREE_MARGIN + (1 << 20)    # 1 MiB above the margin
    try:
        tf._stream_cache_trim(reserve=2 << 20)                     # about to write 2 MiB
        left = len([f for f in os.listdir(tf.STREAM_CACHE_DIR) if f.endswith(".wav")])
        check("nearly full volume: the trim drops old decodes to keep the margin", left == 3, left)
    finally:
        tf._stream_free = real_free

    # ── #18: bridge file per install ──
    real_root, name_file = tf.TUNEFIELD_ROOT, tf.RB_BRIDGE_NAME_FILE
    def fresh(root):
        tf.TUNEFIELD_ROOT = root
        try: os.remove(name_file)
        except FileNotFoundError: pass
        return tf._rb_bridge_name()
    try:
        name = os.path.basename(tf._rb_bridge_xml())
        check("a non-installed root gets its own bridge file", name.startswith("tunefield-") and name != "tunefield.xml", name)
        check("status reports that file", J(c.get("/export/rekordbox/status")).get("bridge_path") == tf._rb_bridge_xml())
        tf.TUNEFIELD_ROOT = tf._os_data_dir()
        check("the installed app keeps tunefield.xml", tf._rb_bridge_name() == "tunefield.xml")
        n1 = fresh("/Volumes/NO NAME/Tunefield-USB")
        check("a stick root is named after the stick", re.fullmatch(r"tunefield-NO-NAME-[0-9a-f]{4}\.xml", n1) is not None, n1)
        check("the name is kept: same answer on the next call", tf._rb_bridge_name() == n1)
        tf.TUNEFIELD_ROOT = "/Volumes/GIG STICK/Tunefield-USB"
        check("a renamed stick keeps its file", tf._rb_bridge_name() == n1)
        names = {fresh("/Volumes/NO NAME/Tunefield-USB") for _ in range(6)}
        check("sticks with the same name and folder get different files", len(names) >= 5, names)
        tf.RB_BRIDGE_NAME_FILE = os.path.join(ROOT, "no-such-dir", "name.txt")
        tf.TUNEFIELD_ROOT = "/Volumes/NO NAME/Tunefield-USB"
        ro = tf._rb_bridge_name()
        check("read-only data folder: a stable name from the root path", ro == tf._rb_bridge_name() and ro.startswith("tunefield-NO-NAME-"), ro)
    finally:
        tf.TUNEFIELD_ROOT, tf.RB_BRIDGE_NAME_FILE = real_root, name_file

    # ── #43 test switch: TUNEFIELD_TEST_NO_STORAGE ──
    js = c.get("/static/js/storage-guard.js").get_data(as_text=True)
    check("storage guard served as-is without the switch", "TUNEFIELD_TEST_NO_STORAGE" not in js)
    tf._TEST_NO_STORAGE = True
    try:
        js = c.get("/static/js/storage-guard.js").get_data(as_text=True)
        check("with the switch, storage is blocked before the guard runs",
              js.startswith("Object.defineProperty(window, 'localStorage'") and "in-memory stand-in" in js)
    finally:
        tf._TEST_NO_STORAGE = False

    # ── #11: sub-second files ──
    from analyze import analyze
    short = os.path.join(ROOT, "hit.wav"); tone(short, 0.5)
    d = analyze(short, duration_limit=0.5, verbose=False)
    check("0.5 s file: bpm 0 (no pulse)", d.get("rhythm", {}).get("bpm") == 0, d.get("rhythm"))
    longer = os.path.join(ROOT, "loop.wav"); tone(longer, 12)
    d = analyze(longer, duration_limit=1.0, verbose=False)
    check("12 s file still analyses with a rhythm block", "bpm" in d.get("rhythm", {}), d.get("rhythm"))

    # ── #46: port taken on [::1] ──
    try:
        s6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s6.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s6.bind(("::1", 0)); s6.listen(1)
        busy = s6.getsockname()[1]
        p = tf.find_free_port(busy, 5)
        check("a port held on [::1] is skipped", p != busy, (busy, p))
        s6.close()
    except OSError as e:
        print(f"  (IPv6 not available here, port check skipped: {e})")
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
