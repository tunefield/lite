"""The library's backup on a stick, outside the install folder (1.1.0, U1 safety net).

A Finder Replace of an install folder with an old 1.0.0 download deletes data/, and 1.0.0
knows nothing of any net. So a copy of the library lives where a Replace of the folder can't
reach it: <stick top>/.tunefield-backup/<install folder name>/current/. Mark, 15 Nov 22:32:
"Net in 1.1.0". The rules:

  * It holds data/ minus what can be rebuilt (covers, library/, logs, trash, the playback
    cache, the analysis queue): about 50 MB at 30,000 tracks. Capped; skipped (and said so)
    when it would not fit.
  * It is written by the stick app (portable mode, shortly after launch and then at most
    every half hour, only when the library changed) and by the Mac's stick tool just before
    an update or repair. Never from a library under half the size of the backup: that is
    the moment to OFFER the backup, not to overwrite it.
  * One generation, swapped in like the app: written to .new, then renamed. A pulled stick
    leaves the previous backup; the next run tidies up.
  * Restore is always the user's choice, never automatic. It never overwrites: the current
    data/ is renamed to data-before-restore-<stamp>/ and kept. "Start fresh" renames the
    backup to declined-<stamp>, so it is not offered again; it goes once the new library
    has a backup of its own.
"""
import os, re, sys, json, shutil, time
from datetime import datetime

BACKUP_DIR = ".tunefield-backup"
SKIP_DIRS = {"covers", "library", "logs", "_trash", "_stream_cache"}
SKIP_FILES = {"analysis_queue.json"}
CAP = 300 * 1024 * 1024
HEADROOM = 100 * 1024 * 1024
STAGING, MARKER = "data.restoring", ".restore-complete"
REQUEST = ".tunefield-restore"          # in the install folder: "restore at the next start"
META = "backup.json"
VOLUMES_PREFIX = "/Volumes/"            # tests point this and volume_of at fake sticks


def _gone(func, path, exc):
    """FAT32/exFAT delete ._X along with X, after the walk listed it; that one is already gone."""
    e = exc if isinstance(exc, BaseException) else exc[1]
    if not isinstance(e, FileNotFoundError):
        raise e


def _rmtree(path):
    if os.path.isdir(path) and not os.path.islink(path):
        if sys.version_info >= (3, 12):
            shutil.rmtree(path, onexc=_gone)
        else:
            shutil.rmtree(path, onerror=_gone)
    elif os.path.lexists(path):
        os.remove(path)


def _pause(phase):
    """The stick tool's test hook, for the net's phases (backup-swap, restore-swap)."""
    import usb_install
    usb_install._pause(phase)


def _copy_files(pairs, phase):
    """Copy (src, dst) pairs; the test hook can stop it halfway (backup-copy, restore-copy)."""
    for i, (src, dst) in enumerate(pairs):
        if i == len(pairs) // 2:
            _pause(phase)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            shutil.copyfile(src, dst)
        except FileNotFoundError:
            pass                                  # renamed away mid-walk by an atomic save


def volume_of(path):
    p = os.path.realpath(path)
    while not os.path.ismount(p):
        p = os.path.dirname(p)
    return p


def home(folder):
    """Where `folder`'s backup lives, or None when the folder is not on a mounted stick
    (a portable copy on the Mac's own disk has no 'outside the folder' worth having)."""
    vol = volume_of(folder)
    if not vol.startswith(VOLUMES_PREFIX):
        return None
    name = "_top" if os.path.realpath(folder) == vol else os.path.basename(os.path.realpath(folder))
    return os.path.join(vol, BACKUP_DIR, name)


def _sources(data):
    """(relative path, absolute path) of every file the backup holds."""
    for dp, dns, fns in os.walk(data):
        rel = os.path.relpath(dp, data)
        if rel == ".":
            dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith(".")]
        for n in fns:
            if n.startswith(".") or (rel == "." and n in SKIP_FILES) or ".tmp" in n:
                continue
            yield os.path.normpath(os.path.join(rel, n)), os.path.join(dp, n)


def stats(data):
    """Tracks, Fields, sets and catalog bytes of a library; zeros when there is none. Tracks are
    distinct audio files (library_file), so a track in two Fields counts once (Release & QA)."""
    cats = os.path.join(data, "catalogs")
    seen, fields, sets, cbytes = set(), 0, 0, 0
    def add(e):
        if isinstance(e, dict) and not e.get("_patch"):
            seen.add(e.get("library_file") or e.get("id"))
    try:
        names = os.listdir(cats)
    except OSError:
        names = []
    for n in names:
        p = os.path.join(cats, n)
        if n.startswith(("_", ".")) or not os.path.isfile(p):
            continue
        cbytes += os.path.getsize(p)
        try:
            with open(p) as f:
                if n.endswith(".journal.jsonl"):
                    for line in f:
                        try:
                            add(json.loads(line))
                        except ValueError:
                            pass                     # blank or torn line
                elif n.endswith(".json"):
                    fields += 1
                    d = json.load(f)
                    for e in d if isinstance(d, list) else ():
                        add(e)
        except (OSError, ValueError):
            pass
    seen.discard(None)
    try:
        sets = sum(1 for n in os.listdir(os.path.join(data, "playlists"))
                   if n.endswith(".json") and not n.startswith(("_", ".")))
    except OSError:
        pass
    return {"tracks": len(seen), "fields": fields, "sets": sets, "catalog_bytes": cbytes}


def read_meta(h):
    try:
        with open(os.path.join(h, "current", META)) as f:
            return json.load(f)
    except (OSError, ValueError, TypeError):
        return None


def recover(h):
    """Tidy an interrupted backup: a lost current comes back from .old; .new and .old go."""
    cur, new, old = (os.path.join(h, n) for n in ("current", ".new", ".old"))
    if not os.path.isdir(cur) and os.path.isfile(os.path.join(old, META)):
        os.rename(old, cur)
    for p in (new, old):
        if os.path.lexists(p):
            _rmtree(p)


def changed_since(data, meta):
    """True when a file the backup holds is newer than the backup (or there is none)."""
    if not meta:
        return True
    t = meta.get("made_ts", 0)
    for _, p in _sources(data):
        try:
            if os.path.getmtime(p) > t:
                return True
        except OSError:
            pass
    return False


def make(folder, version="", force=False):
    """Back up folder/data. Returns (status, detail): made, unchanged, empty, shrunk, nodata,
    nowhere, toobig, space. Only 'made' writes anything, and only under the backup home."""
    data, h = os.path.join(folder, "data"), home(folder)
    if not h:
        return "nowhere", None
    if not os.path.isdir(os.path.join(data, "catalogs")):
        return "nodata", None
    os.makedirs(h, exist_ok=True)
    recover(h)
    meta, st = read_meta(h), stats(data)
    if st["tracks"] == 0:
        return "empty", None
    if meta and st["tracks"] < meta.get("tracks", 0) / 2:
        return "shrunk", meta                    # offer the backup; never overwrite it
    if not force and not changed_since(data, meta):
        return "unchanged", meta
    files = list(_sources(data))
    total = sum(os.path.getsize(p) for _, p in files if os.path.exists(p))
    if total > CAP:
        return "toobig", total
    if shutil.disk_usage(h).free < total + HEADROOM:
        return "space", total
    new = os.path.join(h, ".new")
    os.makedirs(new)
    _copy_files([(p, os.path.join(new, rel)) for rel, p in files], "backup-copy")
    now = time.time()
    meta = {**st, "made_at": datetime.fromtimestamp(now).isoformat(timespec="seconds"), "made_ts": now,
            "version": version, "folder": os.path.basename(os.path.realpath(folder)), "bytes": total}
    with open(os.path.join(new, META), "w") as f:            # written last: marks it complete
        json.dump(meta, f)
    _pause("backup-swap")
    cur = os.path.join(h, "current")
    if os.path.isdir(cur):
        os.rename(cur, os.path.join(h, ".old"))
    os.rename(new, cur)
    _rmtree(os.path.join(h, ".old"))
    for n in os.listdir(h):                       # a declined backup goes once a new one exists
        if n.startswith("declined-"):
            _rmtree(os.path.join(h, n))
    return "made", meta


def offer(folder):
    """The backup to offer for this install, or None: there is one, not declined, and the
    library now holds under half its tracks (or none at all)."""
    h = home(folder)
    meta = read_meta(h) if h else None
    if not meta or not meta.get("tracks"):
        return None
    data = os.path.join(folder, "data")
    cb = stats_bytes(data)
    if cb >= meta.get("catalog_bytes", 0) / 2:   # quick: catalogs at least half the size
        return None
    now = stats(data)["tracks"]
    if now >= meta["tracks"] / 2:
        return None
    return {"made_at": meta.get("made_at"), "tracks": meta["tracks"], "fields": meta.get("fields", 0),
            "sets": meta.get("sets", 0), "now_tracks": now}


def stats_bytes(data):
    cats = os.path.join(data, "catalogs")
    try:
        return sum(os.path.getsize(os.path.join(cats, n)) for n in os.listdir(cats)
                   if not n.startswith(("_", ".")) and os.path.isfile(os.path.join(cats, n)))
    except OSError:
        return 0


def decline(folder):
    """Start fresh: the backup is kept aside as declined-<stamp> and never offered again."""
    h = home(folder)
    cur = os.path.join(h, "current") if h else None
    if cur and os.path.isdir(cur):
        os.rename(cur, os.path.join(h, "declined-" + datetime.now().strftime("%Y%m%d-%H%M%S")))


def recover_restore(folder):
    """Finish or roll back an interrupted restore. A complete staging copy with no data/
    beside it is the window between the two renames: it goes into place. Anything else
    in staging is incomplete and goes; data/ itself was never touched before that."""
    data, stg = os.path.join(folder, "data"), os.path.join(folder, STAGING)
    if os.path.isdir(stg):
        if not os.path.exists(data) and os.path.isfile(os.path.join(stg, MARKER)):
            os.rename(stg, data)
            os.remove(os.path.join(data, MARKER))
        else:
            _rmtree(stg)


def restore(folder):
    """Put the backup back as folder/data. The data/ there now is renamed, never deleted.
    Must run while nothing has the library open: the stick tool refuses while the stick app
    runs, and the stick app does it at its next start, before anything loads."""
    h = home(folder)
    cur = os.path.join(h, "current") if h else None
    if not cur or not os.path.isfile(os.path.join(cur, META)):
        raise RuntimeError("There is no backup of this library on the stick.")
    recover_restore(folder)
    stg = os.path.join(folder, STAGING)
    os.makedirs(stg)
    _copy_files([(os.path.join(dp, n), os.path.join(stg, os.path.relpath(os.path.join(dp, n), cur)))
                 for dp, _, fns in os.walk(cur) for n in fns if n != META and not n.startswith("._")],
                "restore-copy")
    open(os.path.join(stg, MARKER), "w").close()
    _pause("restore-swap")
    data = os.path.join(folder, "data")
    kept = None
    if os.path.lexists(data):
        kept = os.path.join(folder, "data-before-restore-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
        os.rename(data, kept)
    os.rename(stg, data)
    os.remove(os.path.join(data, MARKER))
    return kept


def request_restore(folder):
    """The stick app can't swap data/ under its own running server: it records the request
    and quits, and apply_request() does the swap at the next start."""
    with open(os.path.join(folder, REQUEST), "w") as f:
        f.write(datetime.now().isoformat(timespec="seconds") + "\n")


def apply_request(folder):
    """At start, before anything loads: tidy an interrupted restore, then do a requested one."""
    recover_restore(folder)
    req = os.path.join(folder, REQUEST)
    if os.path.isfile(req):
        try:
            return restore(folder)
        finally:
            os.remove(req)
