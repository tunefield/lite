#!/usr/bin/env python3
"""Regression: the library's backup on a stick, outside the install folder (1.1.0, U1 net).

A fake stick is a folder; stick_backup.volume_of and VOLUMES_PREFIX point at it.
- make: the backup holds data/ minus covers, library, logs, trash, playback cache and the
  analysis queue; data/ itself is untouched; an unchanged library writes nothing
- never from an empty library, or one under half the backup's tracks (offered instead)
- offer: none while the library is intact; offered when data/ is gone or much smaller
- restore: the data/ there is renamed and kept; the backup's files come back; backup.json not
- Start fresh: declined, not offered again; removed once the new library has a backup
- interrupted backup and restore: tidied, finished or rolled back; data/ never lost
- the cap and the space check skip without writing
- the stick app's routes: status, Start fresh, and Restore recorded for the next start

    .venv/bin/python scripts/test_stick_backup.py
"""
import os, sys, json, hashlib, tempfile, shutil, time

TMP = os.path.realpath(tempfile.mkdtemp(prefix="tf-bk-"))
VOL = os.path.join(TMP, "Volumes", "STICK")
F = os.path.join(VOL, "Tunefield-USB")
os.makedirs(os.path.join(F, "data"))
open(os.path.join(F, "PORTABLE"), "w").close()
os.environ["TUNEFIELD_ROOT"] = F                      # a source run pointed at a stick install
os.environ["TUNEFIELD_TEST_NO_QUIT"] = "1"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO); os.chdir(REPO)

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []
def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

def library(data, n, sets=1):
    """A library of n tracks, plus everything the backup must leave out."""
    for d in ("catalogs", "playlists", "covers", "logs", "_trash", "_stream_cache", "library"):
        os.makedirs(os.path.join(data, d), exist_ok=True)
    json.dump([{"id": f"t{i}", "bpm_user": 120 + i} for i in range(n)], open(os.path.join(data, "catalogs", "default.json"), "w"))
    json.dump({"default": {}}, open(os.path.join(data, "catalogs", "_meta.json"), "w"))
    for i in range(sets):
        json.dump({"tracks": ["t0"]}, open(os.path.join(data, "playlists", f"set{i}.json"), "w"))
    json.dump({"ratings": {"t0": 5}}, open(os.path.join(data, "annotations.json"), "w"))
    json.dump({"pro_key": "TF1-TEST"}, open(os.path.join(data, "config.json"), "w"))
    open(os.path.join(data, "covers", "t0.jpg"), "wb").write(b"j" * 5000)
    open(os.path.join(data, "logs", "app.log"), "w").write("log")
    open(os.path.join(data, "_stream_cache", "x.pcm"), "wb").write(b"p" * 5000)
    open(os.path.join(data, "analysis_queue.json"), "w").write("[]")

def manifest(d):
    out = {}
    for dp, _, fns in os.walk(d):
        for n in fns:
            p = os.path.join(dp, n)
            out[os.path.relpath(p, d)] = (hashlib.sha256(open(p, "rb").read()).hexdigest(), os.stat(p).st_mtime_ns)
    return out

try:
    library(os.path.join(F, "data"), 10, sets=2)
    import app as tf, stick_backup as sb
    sb.VOLUMES_PREFIX = os.path.join(TMP, "Volumes") + "/"
    sb.volume_of = lambda p: VOL if os.path.realpath(p).startswith(VOL) else "/"
    H = os.path.join(VOL, ".tunefield-backup", "Tunefield-USB")
    data = os.path.join(F, "data")
    check("the app knows it runs from a stick (env root with PORTABLE)", tf.ON_STICK)

    check("not on a stick: nothing written", sb.make(os.path.join(TMP, "elsewhere"))[0] == "nowhere")
    before = manifest(data)
    st, meta = sb.make(F, version="1.1.0")
    cur = os.path.join(H, "current")
    held = set(manifest(cur))
    check("make: a backup outside the folder, with its record", st == "made" and meta["tracks"] == 10
          and meta["fields"] == 1 and meta["sets"] == 2 and os.path.isfile(os.path.join(cur, "backup.json")), (st, meta))
    check("…it holds catalogs, sets, ratings, settings (Pro key included)", {"catalogs/default.json", "catalogs/_meta.json",
          "playlists/set0.json", "annotations.json", "config.json"} <= held, held)
    check("…and leaves out covers, logs, trash, cache, library and the queue",
          not [p for p in held if p.split("/")[0] in ("covers", "logs", "_trash", "_stream_cache", "library")]
          and "analysis_queue.json" not in held, held)
    check("…data/ itself untouched", manifest(data) == before)
    check("an unchanged library writes nothing", sb.make(F)[0] == "unchanged")
    time.sleep(0.05)
    library(data, 12, sets=2)
    st, meta = sb.make(F)
    check("a changed library is backed up again, swapped in whole", st == "made" and meta["tracks"] == 12
          and sorted(os.listdir(H)) == ["current"], (st, os.listdir(H)))

    check("an intact library: nothing offered", sb.offer(F) is None)
    library(data, 4, sets=0)
    check("a library under half the backup's tracks is never backed up over it", sb.make(F)[0] == "shrunk"
          and sb.read_meta(H)["tracks"] == 12)
    o = sb.offer(F)
    check("…it is offered back instead", o and o["tracks"] == 12 and o["now_tracks"] == 4, o)
    shutil.rmtree(data)
    check("no data/ at all: offered too", (sb.offer(F) or {}).get("now_tracks") == 0)

    # the stick app's routes
    c = tf.app.test_client(); J = lambda r: r.get_json()
    TOKEN = {"X-Tunefield-Confirm": tf.TUNEFIELD_CONFIRM_TOKEN}
    j = J(c.get("/backup/status"))
    check("/backup/status: on the stick, the backup and the offer", j["on_stick"] and j["backup"]["tracks"] == 12
          and j["offer"]["tracks"] == 12, j)
    check("/backup/choose needs the token", c.post("/backup/choose", json={"choice": "restore"}).status_code == 403)
    r = c.post("/backup/choose", json={"choice": "restore"}, headers=TOKEN)
    check("Restore is recorded for the next start (the app would quit)", r.status_code == 200 and J(r).get("quitting")
          and os.path.isfile(os.path.join(F, sb.REQUEST)))
    os.makedirs(data, exist_ok=True); library(data, 1, sets=0)   # what a 1.0.0 app would have made meanwhile
    replaced = manifest(data)
    kept = sb.apply_request(F)
    check("next start: the backup is data/ again", sb.stats(data)["tracks"] == 12 and not os.path.exists(os.path.join(F, sb.REQUEST))
          and not os.path.exists(os.path.join(data, "backup.json")) and not os.path.exists(os.path.join(data, sb.MARKER)))
    check("…and the library that was there is kept, unchanged", kept and os.path.basename(kept).startswith("data-before-restore-")
          and manifest(kept) == replaced, kept)
    check("…nothing is offered any more", sb.offer(F) is None)

    # Start fresh
    shutil.rmtree(data); os.makedirs(data, exist_ok=True); library(data, 2, sets=0)
    r = c.post("/backup/choose", json={"choice": "fresh"}, headers=TOKEN)
    check("Start fresh: the backup is put aside, not offered again", r.status_code == 200 and sb.offer(F) is None
          and [n for n in os.listdir(H) if n.startswith("declined-")] and not os.path.exists(os.path.join(H, "current")), os.listdir(H))
    check("…a second choice has nothing to act on (409)", c.post("/backup/choose", json={"choice": "restore"}, headers=TOKEN).status_code == 409)
    st, _ = sb.make(F)
    check("…the new library gets its own backup, and the declined one goes", st == "made" and os.listdir(H) == ["current"], os.listdir(H))

    # interrupted backup: a .new left over, then a lost current
    os.makedirs(os.path.join(H, ".new", "catalogs"))
    os.rename(os.path.join(H, "current"), os.path.join(H, ".old"))
    sb.recover(H)
    check("interrupted backup: current comes back from .old, .new goes", os.listdir(H) == ["current"], os.listdir(H))

    # interrupted restore
    before = manifest(data)
    os.makedirs(os.path.join(F, sb.STAGING, "catalogs"))            # copy cut off: no marker
    sb.recover_restore(F)
    check("restore cut off mid-copy: staging goes, data/ untouched", not os.path.exists(os.path.join(F, sb.STAGING)) and manifest(data) == before)
    shutil.copytree(os.path.join(H, "current"), os.path.join(F, sb.STAGING), ignore=shutil.ignore_patterns("backup.json"))
    open(os.path.join(F, sb.STAGING, sb.MARKER), "w").close()
    os.rename(data, os.path.join(F, "data-before-restore-x"))       # pulled between the two renames
    sb.recover_restore(F)
    check("restore cut off between the renames: finished at the next start", os.path.isdir(data)
          and not os.path.exists(os.path.join(F, sb.STAGING)) and not os.path.exists(os.path.join(data, sb.MARKER)))

    # cap and space
    library(data, 20)
    real = sb.CAP; sb.CAP = 10
    check("over the cap: skipped, nothing written", sb.make(F)[0] == "toobig" and os.listdir(H) == ["current"])
    sb.CAP = real; real = sb.HEADROOM; sb.HEADROOM = 10 ** 15
    check("short of space: skipped, nothing written", sb.make(F)[0] == "space" and os.listdir(H) == ["current"])
    sb.HEADROOM = real
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
