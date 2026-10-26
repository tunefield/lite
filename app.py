#!/usr/bin/env python3
import os, sys, re, json, uuid, shutil, csv, io, secrets, threading, hashlib, base64, time, copy
from datetime import datetime, date, timedelta
from urllib.parse import urlparse
from werkzeug.exceptions import HTTPException
from flask import Flask, request, jsonify, send_from_directory, Response, g

sys.path.insert(0, os.path.dirname(__file__))
from analyze import analyze
from analyze import loudness_to_energy as _loudness_to_energy, rms_to_energy as _rms_to_energy
from als_export import AlsTrack, build_live_set
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024

# ── Version ────────────────────────────────────────────────────────
# Read VERSION file if present (source-of-truth for distributions); fall back to
# an in-code default so bare-source clones still report something sensible.
def _read_version_file():
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION")) as f:
            return f.read().strip() or "unknown"
    except Exception:
        return "unknown"
TUNEFIELD_VERSION = _read_version_file()

ALLOWED       = {".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a", ".aiff", ".aif",
                 ".aifc", ".opus", ".m4b"}

# ── Concurrency guard ──────────────────────────────────────────────
# Single RLock around every JSON read-modify-write sequence (catalogs, playlists,
# meta, state, config, repair-ignored). RLock is reentrant so helpers can call
# each other under the same lock without self-deadlocking. The dev server is
# threaded, so a parallel analyse + rescan would otherwise race-lose writes.
_FS_LOCK = threading.RLock()

# Process-global registry of library paths committed by /library/analyse this process
# lifetime: {slug: set(lowercase absolute paths)}. Guarded by _FS_LOCK. Two concurrent
# analyse requests each snapshot the catalog at entry, so without this a track committed
# by one request is invisible to the other's snapshot and gets appended twice (the
# double-resume mass-duplication bug). It is a dedup guard, not a cache — it may grow
# for the life of the process, which is fine.
# {slug: set(lowercased paths)} appended by in-place analyse since the slug's last
# authoritative write. Lets two concurrent analyse requests dedup against each other
# without re-reading the catalog per commit. INVALIDATED by save_cat / delete_catalog /
# create_catalog — it is a cache of appends, not a record of what exists.
_COMMITTED_PATHS = {}

# ── Server confirmation token ──────────────────────────────────────
# A random token generated at startup. Destructive endpoints (anything that
# removes audio files from disk) require this token via header or query param.
# Defends against malicious cross-origin requests to localhost — a webpage in
# the same browser may attempt fetches to http://localhost:5050 but cannot read
# this token (it's exposed only via same-origin GET /system/token). Token is
# stable for the life of the server process; rotated on every restart.
TUNEFIELD_CONFIRM_TOKEN = secrets.token_urlsafe(24)

# TUNEFIELD_ROOT: the portability anchor. Everything under data/ roams with the
# root; tracks under it store relative paths so the same data/ folder works on any
# machine that mounts the drive.
#
# Resolution order matters (2026-08-04, packaging prep). A signed .app bundle is
# READ-ONLY and writing inside it BREAKS THE CODE SIGNATURE — so an installed build
# must never keep data next to the executable, while the USB-portable build must
# always do exactly that. One rule can't serve both, hence the ladder:
#
#   1. TUNEFIELD_ROOT env var          — explicit wins, always (tests, launchers, USB)
#   2. frozen bundle (PyInstaller/py2app) → per-user OS data dir
#   3. a PORTABLE marker file next to the app → app dir  (the USB zip ships one)
#   4. an existing data/ next to the app     → app dir  (never strand an existing install)
#   5. app dir is writable                   → app dir  (plain source checkout, dev)
#   6. otherwise                             → per-user OS data dir
def _os_data_dir():
    """Per-user writable app-data directory, by platform."""
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "Tunefield")
    if os.name == "nt":
        return os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "Tunefield")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share"), "tunefield")

def _translocated_original(exe_path, mount_text=None):
    """App Translocation: a quarantined bundle launched by double-click runs from a
    read-only nullfs copy under /private/var/folders/.../AppTranslocation/<uuid>/d/.
    sys.executable then points INTO that copy, so the PORTABLE marker on the stick —
    beside the ORIGINAL bundle — is never found, _resolve_root falls to "installed",
    and the app quietly writes to the host Mac's App Support instead of the stick.
    That is exactly what a tester gets after unzipping on a Mac and dragging to a
    FAT32 stick with Finder (USB session, 2026-09-25; reproduced 4x). Map the path
    back through the mount table: "<original> on <mountpoint> (nullfs, ...)".
    Returns the original executable path, or None when not translocated / unknown.
    mount_text is injectable for tests."""
    if "/AppTranslocation/" not in exe_path:
        return None
    try:
        if mount_text is None:
            import subprocess
            mount_text = subprocess.run(["/sbin/mount"], capture_output=True, text=True,
                                        timeout=5).stdout
    except Exception:
        return None
    import re
    # Real line, captured live (USB session, 2026-09-25):
    #   /Volumes/TFTEST/Tunefield-USB/Tunefield.app on /private/var/folders/.../T/AppTranslocation/<uuid> (nullfs, ...)
    # with sys.executable = <that mountpoint>/d/Tunefield.app/Contents/MacOS/Tunefield.
    # So: the mount TARGET is the <uuid> dir, the SOURCE is the .app bundle itself, and the
    # executable sits one level deeper under "d/". Derive the mountpoint from our own path
    # and anchor the split on " on <mountpoint> (" — never on the first " on ", because a
    # stick path can contain spaces, and never on "the only AppTranslocation line", because
    # stale mounts from earlier launches linger with their own uuids.
    m = re.match(r"^(.*?/AppTranslocation/[^/]+)", exe_path)
    if not m:
        return None
    mnt = m.group(1)
    orig = None
    for line in mount_text.splitlines():
        i = line.find(" on " + mnt + " (")
        if i > 0:
            orig = line[:i]
            break
    if not orig:
        return None
    # Translocated bundle root is <mnt>/d/<bundle name>; it maps to <orig> (the .app).
    tbundle = os.path.join(mnt, "d", os.path.basename(orig))
    cands = []
    if exe_path.startswith(tbundle + os.sep):
        cands.append(os.path.join(orig, os.path.relpath(exe_path, tbundle)))
    if exe_path.startswith(mnt + os.sep):                   # older layout: mount IS the bundle
        cands.append(os.path.join(orig, os.path.relpath(exe_path, mnt)))
    for cand in cands:
        cand = os.path.normpath(cand)
        if os.path.exists(cand):
            return cand
    return None

def _resolve_root():
    env = os.environ.get("TUNEFIELD_ROOT")
    if env:
        return os.path.abspath(env), "env"
    app_dir = os.path.dirname(os.path.abspath(__file__))
    if getattr(sys, "frozen", False):                     # packaged, signed, read-only
        # __file__ points INSIDE the bundle here, so the PORTABLE marker must be looked
        # for next to the executable — and, when that lives in Foo.app/Contents/MacOS,
        # next to the .app itself, which is where a USB stick actually carries it.
        # Until 2026-08-07 the frozen branch returned before any PORTABLE check ran,
        # which made the documented USB layout (rung 3 of the ladder) unreachable.
        exe = os.path.abspath(sys.executable)
        translocated = "/AppTranslocation/" in exe
        orig = _translocated_original(exe) if translocated else None
        if orig:
            exe = orig                                     # look beside the REAL bundle
        exe_dir = os.path.dirname(exe)
        cands = [exe_dir]
        if exe_dir.endswith(os.path.join("Contents", "MacOS")):
            cands.append(os.path.dirname(os.path.dirname(os.path.dirname(exe_dir))))
        for c in cands:
            if os.path.exists(os.path.join(c, "PORTABLE")) and os.access(c, os.W_OK):
                return c, "portable"
        if translocated:
            # Never fall to "installed" SILENTLY from a translocated launch — that is the
            # failure mode where a stick user's data lands on someone else's Mac.
            print("Tunefield: launched from a translocated (quarantined) copy and no PORTABLE "
                  "folder was found beside the original bundle"
                  + (f" ({os.path.dirname(orig)})" if orig else " (original path unknown)")
                  + " — using the installed data folder on this Mac. To run from the stick, "
                  "remove the quarantine flag once:  xattr -dr com.apple.quarantine <path to Tunefield.app>",
                  file=sys.stderr)
        return _os_data_dir(), "installed"
    if os.path.exists(os.path.join(app_dir, "PORTABLE")):
        return app_dir, "portable"
    if os.path.isdir(os.path.join(app_dir, "data")):
        return app_dir, "portable"
    if os.access(app_dir, os.W_OK):
        return app_dir, "source"
    return _os_data_dir(), "installed"

TUNEFIELD_ROOT, TUNEFIELD_ROOT_MODE = _resolve_root()
DATA_DIR      = os.path.join(TUNEFIELD_ROOT, "data")
CATALOGS_DIR  = os.path.join(DATA_DIR, "catalogs")
META_FILE     = os.path.join(CATALOGS_DIR, "_meta.json")
LIBRARY_DIR   = os.path.join(DATA_DIR, "library")
COVERS_DIR    = os.path.join(DATA_DIR, "covers")
CONFIG_FILE   = os.path.join(DATA_DIR, "config.json")
ANALYSIS_QUEUE_FILE = os.path.join(DATA_DIR, "analysis_queue.json")  # resumable analyse queue mirror
LEGACY_FILE   = os.path.join(TUNEFIELD_ROOT, "catalog.json")  # pre-catalogs[] legacy import
PLAYLISTS_DIR = os.path.join(DATA_DIR, "playlists")
PL_META_FILE  = os.path.join(PLAYLISTS_DIR, "_meta.json")
PL_STATE_FILE = os.path.join(PLAYLISTS_DIR, "_state.json")
TRASH_DIR     = os.path.join(DATA_DIR, "_trash")   # safety: deleted audio moves here, not unlinked
ANNOTATIONS_FILE = os.path.join(DATA_DIR, "annotations.json")
LOGS_DIR      = os.path.join(DATA_DIR, "logs")
LOG_FILE      = os.path.join(LOGS_DIR, "app.log")
USAGE_FILE    = os.path.join(LOGS_DIR, "usage.jsonl")

# A double-clicked .app has no terminal: stdout — and with it every traceback and access
# line — vanished. On a test machine that made "it didn't work" undiagnosable after the
# fact, which is precisely when diagnosis is wanted. Everything the console would have
# shown also lands in data/logs/app.log (rotating, ~2 MB cap). Never remote.
def _setup_file_logging():
    import logging
    from logging.handlers import RotatingFileHandler
    try:
        os.makedirs(LOGS_DIR, exist_ok=True)
        h = RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=1, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        h.setLevel(logging.INFO)
        for lg in (app.logger, logging.getLogger("werkzeug")):
            lg.addHandler(h)
            lg.setLevel(logging.INFO)
    except OSError:
        pass          # unwritable root — the app still runs, just unlogged as before

# library_analyse emits from its ThreadPoolExecutor workers, and interleaved appends
# from two threads can tear a JSON line — one lock keeps every line whole.
_USAGE_LOCK = threading.Lock()

def usage_event(event, **fields):
    """One JSON line per event → data/logs/usage.jsonl. Strictly local — Tunefield never
    phones home; 'tracking' here means the machine can answer questions about itself.
    Grep-friendly: {"t": iso-time, "e": event, ...}."""
    try:
        os.makedirs(LOGS_DIR, exist_ok=True)
        rec = {"t": datetime.now().isoformat(timespec="seconds"), "e": event, **fields}
        with _USAGE_LOCK:
            with open(USAGE_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass

_setup_file_logging()

def atomic_json_dump(path, data, compact=False):
    """Write JSON to a temp file, fsync, then os.replace — atomic on the same filesystem.
    A USB pull / power-cut / crash during the write leaves either the previous file
    intact (replace never ran) or the new file complete (replace ran). Never a half file.
    Wrapped by _FS_LOCK so concurrent read-modify-write sequences serialise cleanly."""
    with _FS_LOCK:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            # Catalogs pass compact=True: indent=2 costs ~31% file size and ~15% of the
            # save time on a 30 MB catalog, for whitespace nobody reads. Small config
            # files stay indented — they ARE read by hand. (scripts/re_analyse.py has
            # always written catalogs compact, so the app was re-inflating them after
            # every re-analysis.)
            if compact:
                json.dump(data, f, separators=(",", ":"))
            else:
                json.dump(data, f, indent=2)
            f.flush()
            try: os.fsync(f.fileno())
            except OSError: pass  # FAT32 may not support fsync; flush still helps
        os.replace(tmp, path)


def _safe_remove_audio(path, reason="deleted"):
    """Move an audio file to data/_trash/YYYYMMDD/ instead of os.unlink-ing it.
    Recoverable mistakes are 99 % of mistakes — empty the trash manually when sure.
    If the move fails (eg. cross-device on a weird mount) this returns False and
    the file STAYS PUT — there is deliberately no unlink fallback, and there must
    never be one: a "fallback" that permanently destroys the file is the exact
    behaviour this function exists to prevent. (An older docstring claimed
    otherwise — bytecode review caught the lie, Aug 15.) Covers / cache files
    can still use raw os.unlink — cheap to regenerate."""
    if not path or not os.path.exists(path):
        return False
    try:
        day = datetime.now().strftime("%Y%m%d")
        bucket = os.path.join(TRASH_DIR, day)
        os.makedirs(bucket, exist_ok=True)
        base = os.path.basename(path)
        stem, ext = os.path.splitext(base)
        # Include a short timestamp to disambiguate same-name files across deletes.
        # The stamp alone is NOT unique — batch deletes trash many files per second and
        # music libraries are full of repeated basenames ("01 Intro.mp3"); shutil.move
        # silently REPLACES an existing destination, which would destroy the earlier
        # file inside the very trash that exists to prevent loss. Uniquify with a counter.
        stamp = datetime.now().strftime("%H%M%S")
        dest = os.path.join(bucket, f"{stem}.{stamp}{ext}")
        n = 1
        while os.path.exists(dest):
            dest = os.path.join(bucket, f"{stem}.{stamp}-{n}{ext}")
            n += 1
        shutil.move(path, dest)
        return True
    except Exception:
        # Move to trash failed (e.g. a cross-device copy that errored partway). Do NOT
        # os.unlink as a fallback — that would permanently destroy the audio this function
        # exists to preserve. Leave the file in place and report failure to the caller.
        return False


def _require_confirm():
    """Reject destructive requests that don't present the startup token.
    Header (X-Tunefield-Confirm) or JSON body only — NOT the query string: URLs
    persist in browser history, logs and copied links, so a secret in a query
    parameter outlives the process that minted it (Aug 15 code review). Returns
    None if allowed; otherwise a Flask Response tuple to return immediately.
    Frontend fetches the token from GET /system/token at boot."""
    supplied = (request.headers.get("X-Tunefield-Confirm")
                or (request.get_json(silent=True) or {}).get("confirm")
                or "")
    if supplied != TUNEFIELD_CONFIRM_TOKEN:
        return jsonify({"error": "destructive endpoint requires confirm token (GET /system/token)"}), 403
    return None


def _same_origin_ok():
    """CSRF guard for state-changing endpoints that AREN'T confirm-token gated (analyse,
    scan, extract-*). A browser always sets Origin/Referer on a cross-origin POST and a
    malicious page cannot forge them, so a mismatch means a cross-origin attacker; block it.
    Non-browser clients (curl, the smoke test) send no Origin — allow those, since they are
    not the CSRF threat model and the truly destructive ops are separately token-gated."""
    # Layer 1 — the Host itself must be loopback. "Origin agrees with Host" as the
    # FIRST trust decision leaves a DNS-rebinding gap: a hostile hostname resolving to
    # 127.0.0.1 satisfies origin==host while being an attacker page (Aug 15 code
    # review). We only ever bind loopback, so any other Host is by definition wrong.
    host = (request.host or "").rsplit(":", 1)[0].strip("[]").lower()
    if host not in ("localhost", "127.0.0.1", "::1"):
        return False
    origin = request.headers.get("Origin") or request.headers.get("Referer") or ""
    if not origin:
        return True
    try:
        return urlparse(origin).netloc == request.host
    except Exception:
        return False


# ── Request lifecycle ──────────────────────────────────────────────
# Serialize every mutating (non-GET) request under _FS_LOCK. Atomic writes prevent torn
# files but NOT lost updates: a route that does load_cat → mutate → save_cat has an
# unguarded window on the threaded dev server where a concurrent writer clobbers it.
# Holding the reentrant lock for the whole request closes that window (atomic_json_dump
# re-acquires it harmlessly). GETs stay unlocked so browsing works during a long scan.
#
# Endpoints exempted from the request-wide lock — they either mutate no shared JSON at
# all, or they block for a long time (native dialogs, external HTTP, per-track librosa /
# ffprobe) and instead take _FS_LOCK themselves around their short load→mutate→save
# sections. Holding the global lock across those would freeze every other write in the
# app for minutes (or, for /library/browse, for as long as a human leaves a folder
# picker open — up to 300 s).
_LOCK_EXEMPT_ENDPOINTS = {
    "library_browse",          # native folder picker, no state mutation
    "repair_discogs_lookup",   # external HTTP lookup, no state mutation
    "repair_fetch_covers",     # external HTTP per track; writes cover FILES only
    "generated_cover",         # writes one cover file, never a catalog JSON
    "repair_acoustid_lookup",  # fpcalc + external HTTP, no state mutation
    "batch_extract_covers",    # writes per-id cover files only, never a catalog JSON
    "library_analyse",         # librosa per track; takes _FS_LOCK around each commit
    "batch_extract_genres",    # ffprobe per track; takes _FS_LOCK around its commit
    "batch_extract_metadata",  # ffprobe per track; takes _FS_LOCK around its commits
}

@app.before_request
def _serialize_mutations():
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    # Blanket CSRF guard: a cross-origin browser request carries a mismatched Origin /
    # Referer, which a malicious page cannot forge. Enforcing here covers every mutating
    # endpoint at once (folder-picker popping, playlist edits, explore logs, tag-filename
    # rewrites, …) instead of relying on per-route _same_origin_ok() calls. Non-browser
    # clients (curl, smoke test) send no Origin and stay allowed.
    if not _same_origin_ok():
        from flask import abort
        abort(403, description="cross-origin request refused")
    if request.endpoint in _LOCK_EXEMPT_ENDPOINTS:
        return
    _FS_LOCK.acquire()
    g._fs_locked = True

@app.teardown_request
def _release_mutation_lock(exc):
    if getattr(g, "_fs_locked", False):
        g._fs_locked = False
        try: _FS_LOCK.release()
        except RuntimeError: pass

# Uniform JSON errors. Without this, an unhandled ValueError (bad slug, non-numeric
# duration) or any exception returns Flask's HTML 500 page, breaking the frontend's
# uniform {"error": ...} handling. ValueError → 400 (client fault); HTTPExceptions keep
# their code; everything else → 500 with a generic message (details logged, not leaked).
@app.errorhandler(Exception)
def _json_error_handler(e):
    if isinstance(e, HTTPException):
        # A ROUTING miss is not the user's fault, and Werkzeug's stock text for it —
        # "If you entered the URL manually please check your spelling and try again" —
        # blames them for a typo they never made. Because this handler makes every error
        # valid JSON, that sentence reaches the UI verbatim anywhere the client shows
        # d.error, which is the established pattern across index.html. It surfaced on the
        # licensing panel, but licensing is not where it was confined.
        #
        # request.url_rule is None ONLY when no rule matched at all, so an abort(404,
        # "Target Field not found") raised inside a view keeps its own honest message.
        # stale_client is the machine-readable signal: the page is asking for an endpoint
        # this process does not have, which in practice means it was reloaded without the
        # server being restarted.
        if e.code == 404 and getattr(request, "url_rule", None) is None:
            return jsonify({
                "error": "This page is newer than the Tunefield that's running \u2014 "
                         "quit the app and start it again.",
                "code": e.code, "stale_client": True}), e.code
        # A 405 means the rule EXISTS \u2014 only the method missed. The UI latches
        # stale_client into a sticky "Restart needed", so it must never ride on a 405:
        # restarting the app cannot fix a request sent with the wrong verb.
        if e.code == 405:
            return jsonify({
                "error": f"this address exists, but not for {request.method} \u2014 "
                         "the request used the wrong method, the app is not stale",
                "code": 405}), 405
        if e.code == 413:
            # Werkzeug's stock text ("The data value transmitted exceeds the capacity
            # limit") reads like a modem error. Name the actual limit and the way out —
            # multi-hour set recordings hit this, and those belong in a library folder
            # scan, which reads from disk and has no upload cap at all.
            mb = int(app.config["MAX_CONTENT_LENGTH"] / 1048576)
            usage_event("analyze_reject", src="upload",
                        reason=f"larger than the {mb} MB upload limit")
            return jsonify({
                "error": f"file larger than the {mb} MB upload limit — "
                         "add its folder as a library root instead, folder scans have no size limit",
                "code": 413}), 413
        return jsonify({"error": e.description, "code": e.code}), e.code
    if isinstance(e, ValueError):
        return jsonify({"error": str(e) or "invalid input"}), 400
    app.logger.exception("unhandled error")
    usage_event("error", where=request.path, type=type(e).__name__)
    return jsonify({"error": "internal server error"}), 500


def prepend_bundled_tools():
    """If tools/<platform>/ exists with bundled ffmpeg / fpcalc binaries, prepend to PATH so
    they take precedence over system installs. Lets a USB stick ship its own toolchain."""
    import platform as _plat
    sysname = _plat.system()
    mach    = _plat.machine().lower()
    sub = None
    if sysname == "Darwin":
        sub = "macos-arm64" if "arm" in mach or mach == "arm64" else "macos-x64"
    elif sysname == "Windows":
        sub = "windows-x64"
    elif sysname == "Linux":
        sub = "linux-x64"
    if not sub: return
    tool_dir = os.path.join(TUNEFIELD_ROOT, "tools", sub)
    if os.path.isdir(tool_dir):
        os.environ["PATH"] = tool_dir + os.pathsep + os.environ.get("PATH", "")

prepend_bundled_tools()


def migrate_to_data_layout():
    """One-time: move pre-portable folders (catalogs/, library/, covers/, playlists/,
    config.json) from TUNEFIELD_ROOT into TUNEFIELD_ROOT/data/. Safe to re-run."""
    moved = []
    for name in ("catalogs", "library", "covers", "playlists"):
        old = os.path.join(TUNEFIELD_ROOT, name)
        new = os.path.join(DATA_DIR, name)
        if os.path.isdir(old) and not os.path.isdir(new):
            os.makedirs(DATA_DIR, exist_ok=True)
            shutil.move(old, new); moved.append(name + "/")
    old_cfg, new_cfg = os.path.join(TUNEFIELD_ROOT, "config.json"), CONFIG_FILE
    if os.path.exists(old_cfg) and not os.path.exists(new_cfg):
        os.makedirs(DATA_DIR, exist_ok=True)
        shutil.move(old_cfg, new_cfg); moved.append("config.json")
    if moved:
        print(f"  Migrated to data/ layout: {', '.join(moved)}")

# Wrap so a partial migration failure (disk full, cross-device, permissions) doesn't
# crash the whole process at import — the per-folder idempotency lets a retry resume.
try:
    migrate_to_data_layout()
except Exception as _e:
    print(f"  WARNING: data/ layout migration incomplete ({_e}); continuing.")
os.makedirs(CATALOGS_DIR, exist_ok=True)
os.makedirs(LIBRARY_DIR, exist_ok=True)
os.makedirs(COVERS_DIR, exist_ok=True)
os.makedirs(PLAYLISTS_DIR, exist_ok=True)

def migrate_catalog_paths():
    """Rewrite stored library_file values to point at the new data/ locations.
    - Absolute paths that resolve and live under TUNEFIELD_ROOT → relativized
    - Absolute paths that no longer resolve → try swapping pre-portable folders
      (TUNEFIELD_ROOT/library/X → DATA_DIR/library/X) and adopt if the file exists
    - Everything else (absolute external paths) → left alone
    Called once at boot; idempotent."""
    if not os.path.isdir(CATALOGS_DIR): return
    meta_path = META_FILE
    if not os.path.exists(meta_path): return
    with open(meta_path) as f: meta = json.load(f)
    moved = 0
    for m in meta:
        cf = os.path.join(CATALOGS_DIR, f"{m['slug']}.json")
        if not os.path.exists(cf): continue
        with open(cf) as f: entries = json.load(f)
        changed = False
        for e in entries:
            lf = e.get("library_file")
            if not lf or not os.path.isabs(lf): continue
            if os.path.exists(lf):
                new = store_path(lf)
                if new != lf:
                    e["library_file"] = new; changed = True; moved += 1
                continue
            # Broken absolute — try pre-portable → data/ rewrite
            for sub in ("library", "covers"):
                pre = os.path.join(TUNEFIELD_ROOT, sub) + os.sep
                if lf.startswith(pre):
                    cand = os.path.join(DATA_DIR, sub, lf[len(pre):])
                    if os.path.exists(cand):
                        e["library_file"] = store_path(cand); changed = True; moved += 1
                    break
        if changed:
            atomic_json_dump(cf, entries, compact=True)
    if moved:
        print(f"  Migrated {moved} library_file path(s) to data/ layout")
# NOTE: migrate_catalog_paths() is invoked once at module load AFTER store_path/resolve_path
# are defined (see the call just below the portable-path helpers), so it also runs under a
# WSGI runner that imports `app` without executing __main__.


# ── Portable path helpers ──────────────────────────────────────────
def resolve_path(stored):
    """Resolve a stored library_file value to an absolute on-disk path, or None if missing.
    Tries absolute as-is first, then joined with TUNEFIELD_ROOT."""
    if not stored: return None
    if os.path.isabs(stored):
        return stored if os.path.exists(stored) else None
    p = os.path.join(TUNEFIELD_ROOT, stored)
    return p if os.path.exists(p) else None

def absolute_form(stored):
    """Resolve to absolute regardless of file existence — for dedup keys / comparisons."""
    if not stored: return ""
    return stored if os.path.isabs(stored) else os.path.abspath(os.path.join(TUNEFIELD_ROOT, stored))

def store_path(absolute):
    """Convert an absolute path to its stored form: relative if it sits under TUNEFIELD_ROOT,
    absolute otherwise. This is what lets the data/ folder roam with the drive."""
    if not absolute: return absolute
    absolute = os.path.abspath(absolute)
    root_with_sep = TUNEFIELD_ROOT.rstrip(os.sep) + os.sep
    if absolute == TUNEFIELD_ROOT or absolute.startswith(root_with_sep):
        return os.path.relpath(absolute, TUNEFIELD_ROOT)
    return absolute

# Now that store_path/resolve_path exist, run the path-repair migration once at import.
try:
    migrate_catalog_paths()
except Exception as _e:
    print(f"  WARNING: catalog path migration incomplete ({_e}); continuing.")


# ── Config (API keys) ───────────────────────────────────────────────
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f: return json.load(f)
        except Exception: pass
    return {}

def save_config(cfg):
    atomic_json_dump(CONFIG_FILE, cfg)



# ── Annotations: ratings, custom tags, saved views — SERVER-side ─────────────
# These lived only in browser localStorage until 2026-08-15, and localStorage is scoped
# to an ORIGIN — which includes the port. The app deliberately drifts to :5051 when
# :5050 is taken, so a user could rate a thousand tracks and "lose" every one of them
# to a port change, a browser switch, or a cleared cache (Aug 15 code review, top P1).
# The catalog survived those events because it lives here; now the user's own judgments
# do too. localStorage remains as a warm cache only.
def _load_annotations():
    try:
        with open(ANNOTATIONS_FILE) as f:
            d = json.load(f)
        if isinstance(d, dict):
            return d
    except (OSError, json.JSONDecodeError):
        pass
    return {"version": 1, "ratings": {}, "tags": {}, "track_tags": {}, "views": []}

@app.route("/annotations", methods=["GET"])
def annotations_get():
    return jsonify(_load_annotations())

@app.route("/annotations", methods=["POST"])
def annotations_post():
    """Section-wise merge: the client sends only the top-level sections it changed
    ({"ratings": {...}}), each replacing that section wholesale. Single-user app —
    last write wins per section; the request-wide _FS_LOCK serialises writers."""
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    body = request.get_json(silent=True) or {}
    doc = _load_annotations()
    changed = []
    for k in ("ratings", "tags", "track_tags"):
        if isinstance(body.get(k), dict):
            doc[k] = body[k]
            changed.append(k)
    if isinstance(body.get("views"), list):
        doc["views"] = body["views"][:50]
        changed.append("views")
    if not changed:
        return jsonify({"error": "nothing recognisable to save"}), 400
    doc["version"] = 1
    atomic_json_dump(ANNOTATIONS_FILE, doc)
    return jsonify({"ok": True, "saved": changed})


@app.route("/usage/events", methods=["POST"])
def usage_events_ingest():
    """Batched Field-behaviour events from the client — the strategic review's launch
    metrics live here (does anyone change axes? weights? save a view?). Whitelisted
    names only, size-capped, and STRICTLY LOCAL like every other usage_event line:
    nothing leaves the machine unless the user exports the file themselves."""
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    allowed = {"axis_change", "weight_change", "config_saved", "config_loaded",
               "field_session", "onboarding_done", "onboarding_skipped",
               # Light launch telemetry (2026-08-26): FEATURE names only, never music.
               "feature_first_use", "upsell", "session_shape"}
    events = (request.get_json(silent=True) or {}).get("events") or []
    if not isinstance(events, list):
        return jsonify({"error": "events must be a list"}), 400
    kept = 0
    for ev in events[:50]:
        if not isinstance(ev, dict) or ev.get("e") not in allowed:
            continue
        fields = {k: v for k, v in ev.items()
                  if k != "e" and isinstance(k, str) and len(str(v)) < 200}
        usage_event(ev["e"], src="field", **fields)
        kept += 1
    return jsonify({"ok": True, "recorded": kept})


@app.route("/usage/export", methods=["GET"])
def usage_export():
    """Download the usage log — the OPT-IN half of the research loop. A beta tester
    clicks the Settings button, gets the file, and chooses whether to send it. The
    server never phones home; this is the whole telemetry exit path."""
    if not os.path.exists(USAGE_FILE):
        return jsonify({"error": "no usage log yet"}), 404
    return send_from_directory(os.path.dirname(USAGE_FILE), os.path.basename(USAGE_FILE),
                               as_attachment=True,
                               download_name=f"tunefield-usage-{date.today().isoformat()}.jsonl")


@app.route("/catalog/<entry_id>/bpm", methods=["POST", "DELETE"])
def api_bpm_override(entry_id):
    """Set or clear a user tempo correction.

    Tempo detection lands on the wrong multiple often enough to matter: measured across
    this library against the BPM tags files ship with, BEFORE the 2026-08-19 octave
    rescue (which further shrank the octave share): 78% exact, ~10% a triplet
    multiple (2/3, 4/3), ~4.5% the octave. The triplet case is the common one, which is
    why the UI offers x2/3 and x3/2 as well as the obvious x2 and /2."""
    # A track id is unique across Fields, and the client does not necessarily know which
    # Field the row came from (the List view can show several at once), so find it.
    slug = entries = hit = None
    order = ([request.args.get("cat")] if request.args.get("cat") else []) \
            + [m["slug"] for m in load_meta()]
    for cand in order:
        if not cand:
            continue
        try:
            # Merge any journal-pending entries into the base FIRST: _load_cat_raw alone
            # cannot see them, and save_cat below deletes the journal unconditionally —
            # without this fold, editing a track mid-batch destroyed every pending entry
            # and 404'd on tracks the UI was happily showing (review, 2026-08-12).
            fold_journal(cand)
            rows = _load_cat_raw(cand)
        except Exception:
            continue
        found = next((e for e in rows if e.get("id") == entry_id), None)
        if found is not None:
            slug, entries, hit = cand, rows, found
            break
    if hit is None:
        return jsonify({"error": "No such track."}), 404

    if request.method == "DELETE":
        hit.pop("bpm_user", None)
        save_cat(slug, entries)
        return jsonify({"bpm": ((hit.get("data") or {}).get("rhythm") or {}).get("bpm")})

    try:
        bpm = float((request.get_json(silent=True) or {}).get("bpm"))
    except (TypeError, ValueError):
        return jsonify({"error": "bpm must be a number"}), 400
    if not 20 <= bpm <= 400:
        return jsonify({"error": "bpm must be between 20 and 400"}), 400
    hit["bpm_user"] = round(bpm, 1)
    save_cat(slug, entries)
    return jsonify({"bpm": hit["bpm_user"]})


_KEY_ROOTS = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}

@app.route("/catalog/<entry_id>/key", methods=["POST", "DELETE"])
def api_key_override(entry_id):
    """Set or clear a user key correction — the same contract as the tempo override:
    stored on the ENTRY so re-analysis cannot wipe it, folded back into data.harmony by
    _apply_overrides so no reader knows corrections exist. Key detection has no tag
    ground truth to lean on (TKEY is rarer and less reliable than TBPM), and its classic
    failures are the fifth, the relative major/minor, and near-tie mode flips."""
    slug = entries = hit = None
    order = ([request.args.get("cat")] if request.args.get("cat") else []) \
            + [m["slug"] for m in load_meta()]
    for cand in order:
        if not cand:
            continue
        try:
            # Merge any journal-pending entries into the base FIRST: _load_cat_raw alone
            # cannot see them, and save_cat below deletes the journal unconditionally —
            # without this fold, editing a track mid-batch destroyed every pending entry
            # and 404'd on tracks the UI was happily showing (review, 2026-08-12).
            fold_journal(cand)
            rows = _load_cat_raw(cand)
        except Exception:
            continue
        found = next((e for e in rows if e.get("id") == entry_id), None)
        if found is not None:
            slug, entries, hit = cand, rows, found
            break
    if hit is None:
        return jsonify({"error": "No such track."}), 404

    if request.method == "DELETE":
        hit.pop("key_user", None)
        save_cat(slug, entries)
        h = ((hit.get("data") or {}).get("harmony") or {})
        return jsonify({"root": h.get("root"), "mode": h.get("mode"), "key": h.get("key")})

    body = request.get_json(silent=True) or {}
    root = str(body.get("root", "")).strip()
    mode = str(body.get("mode", "")).strip().lower()
    if root not in _KEY_ROOTS:
        return jsonify({"error": "root must be one of the 12 notes (C, C#, ... B)"}), 400
    if mode not in ("major", "minor"):
        return jsonify({"error": "mode must be major or minor"}), 400
    hit["key_user"] = {"root": root, "mode": mode}
    save_cat(slug, entries)
    return jsonify({"root": root, "mode": mode, "key": f"{root} {mode}"})


# ── Library roots (in-place file management) ────────────────────────
# Kept in lockstep with ALLOWED — the scan advertising formats analyse then rejects
# produced walls of errors (.aif was rejected). .opus/.m4b/.aifc verified decoding
# here (soundfile takes opus and aifc; audioread/CoreAudio takes m4b). .wma stays OUT:
# CoreAudio happens to decode it on macOS but the Linux/Windows backends don't
# reliably, and the walk's skipped counter now reports it instead of silence.
AUDIO_EXTS = set(ALLOWED)

def _root_entry(r):
    """Normalise one stored library_roots value. Legacy entries are plain path
    strings; since 2026-08-02 each root is a dict carrying its Tunefield
    assignment: {"path": stored_path, "cat": slug_or_None}. cat None = unassigned
    (legacy) — such roots show everywhere and scan with every selection."""
    if isinstance(r, dict):
        return {"path": r.get("path") or "", "cat": r.get("cat") or None}
    return {"path": r, "cat": None}

def get_library_roots(cat=None):
    """Return library roots resolved to absolute paths. Stored values may be
    relative-to-root (portable) or absolute (legacy / external locations).
    cat: optional Tunefield slug — confines the result to roots assigned to that
    Tunefield plus unassigned (legacy) roots."""
    out = []
    for raw in (load_config().get("library_roots") or []):
        e = _root_entry(raw)
        if not e["path"]:
            continue
        if cat is not None and e["cat"] is not None and e["cat"] != cat:
            continue
        p = e["path"]
        out.append(p if os.path.isabs(p) else os.path.join(TUNEFIELD_ROOT, p))
    return out

def get_library_roots_raw():
    """Stored library_roots entries, normalised ({"path","cat"}) but unresolved.
    Used for listing in the UI."""
    return [_root_entry(r) for r in (load_config().get("library_roots") or [])
            if _root_entry(r)["path"]]

def all_cataloged_paths():
    """Return set of lowercased absolute paths already referenced by any entry."""
    seen = set()
    for m in ensure_default():
        for e in load_cat(m["slug"]):
            lf = e.get("library_file")
            if lf:
                try: seen.add(absolute_form(lf).lower())
                except Exception: seen.add(lf.lower())
    return seen

def walk_audio_files(root, skipped=None):
    """Walk a directory tree, yielding absolute paths of audio files.
    Uses realpath so a symlink and its target resolve to the same identity — otherwise
    dedup (which compares paths textually) would treat them as two distinct tracks.
    skipped: optional caller-owned {ext: count} dict — every non-dot file dropped for
    its extension is tallied there. A folder of .wma used to vanish without a trace."""
    if not os.path.isdir(root): return
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        # Skip dotfolders and common non-music dirs
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in ("__pycache__", "node_modules")]
        for fn in filenames:
            if fn.startswith("."): continue
            ext = os.path.splitext(fn)[1].lower()
            if ext in AUDIO_EXTS:
                yield os.path.realpath(os.path.join(dirpath, fn))
            elif skipped is not None and ext:
                skipped[ext] = skipped.get(ext, 0) + 1


def _path_within_library(abs_path):
    """True if abs_path sits under any configured library root or under data/library.
    Used to confine /repair/relink so an entry can't be pointed at an arbitrary file
    (which /stream would then serve — an arbitrary-file-read primitive otherwise)."""
    try:
        rp = os.path.realpath(abs_path)
    except Exception:
        return False
    roots = [os.path.realpath(r) for r in get_library_roots()]
    roots.append(os.path.realpath(LIBRARY_DIR))
    for root in roots:
        root_sep = root.rstrip(os.sep) + os.sep
        if rp == root or rp.startswith(root_sep):
            return True
    return False


@app.route("/manual")
def manual():
    """The shipped user guide — static/manual.html, GENERATED from MANUAL.md by
    scripts/build_manual.py. Rebuild + commit whenever the .md changes."""
    usage_event("manual_open")
    return send_from_directory(app.static_folder, "manual.html")


@app.route("/library/roots", methods=["GET"])
def library_roots_list():
    out = []
    for e in get_library_roots_raw():
        r = e["path"]
        absolute = r if os.path.isabs(r) else os.path.join(TUNEFIELD_ROOT, r)
        out.append({
            "path":     r,            # stored form (may be relative)
            "absolute": absolute,
            "exists":   os.path.isdir(absolute),
            "cat":      e["cat"],     # assigned Tunefield slug, or null (unassigned)
        })
    return jsonify(out)


@app.route("/library/roots", methods=["POST"])
def library_roots_add():
    body = request.json or {}
    path = (body.get("path") or "").strip()
    if not path:
        return jsonify({"error": "Path required"}), 400
    # Expand ~ and resolve to absolute for the existence check
    abs_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(abs_path):
        return jsonify({"error": f"Folder not found: {abs_path}"}), 400
    # Store in portable form (relative when under TUNEFIELD_ROOT)
    stored = store_path(abs_path)
    cat = (body.get("cat") or "").strip() or None
    if cat and not any(m["slug"] == cat for m in ensure_default()):
        return jsonify({"error": f"Unknown Field: {cat}"}), 400
    cfg = load_config()
    roots = [_root_entry(r) for r in (cfg.get("library_roots") or [])]
    if any(e["path"] in (stored, abs_path) for e in roots):
        return jsonify({"ok": True, "path": stored, "already": True})
    # NESTED folders are allowed (2026-08-02): a sub-folder of a big master folder can
    # be assigned to its own Tunefield — the scan attributes every file to its DEEPEST
    # containing folder, so nothing is walked twice and the sub-folder carves its
    # subtree out of the parent's scope. Only an exact re-add is short-circuited
    # (handled above as {"already": true}).
    roots.append({"path": stored, "cat": cat})
    cfg["library_roots"] = roots
    save_config(cfg)
    return jsonify({"ok": True, "path": stored, "absolute": abs_path, "cat": cat})


@app.route("/library/roots", methods=["PATCH"])
def library_roots_assign():
    """Reassign a root to a Field. Body: {path, cat} — cat empty/null = unassigned."""
    body = request.json or {}
    path = (body.get("path") or "").strip()
    if not path:
        return jsonify({"error": "Path required"}), 400
    cat = (body.get("cat") or "").strip() or None
    if cat and not any(m["slug"] == cat for m in ensure_default()):
        return jsonify({"error": f"Unknown Field: {cat}"}), 400
    cfg = load_config()
    roots = [_root_entry(r) for r in (cfg.get("library_roots") or [])]
    abs_target = path if os.path.isabs(path) else os.path.join(TUNEFIELD_ROOT, path)
    hit = False
    for e in roots:
        r_abs = e["path"] if os.path.isabs(e["path"]) else os.path.join(TUNEFIELD_ROOT, e["path"])
        if e["path"] == path or r_abs == abs_target:
            e["cat"] = cat
            hit = True
    if not hit:
        return jsonify({"error": "Folder not found in library roots"}), 404
    cfg["library_roots"] = roots
    save_config(cfg)
    return jsonify({"ok": True, "path": path, "cat": cat})


def _entries_under_root(slug, root_path):
    """Entries of one Field whose audio sits under a folder (realpath prefix, case-folded
    like every other path comparison here). Returns (all_entries, under)."""
    absr = root_path if os.path.isabs(root_path) else os.path.join(TUNEFIELD_ROOT, root_path)
    pref = os.path.realpath(absr).lower().rstrip(os.sep) + os.sep
    entries = load_cat(slug)
    under = []
    for e in entries:
        lf = e.get("library_file")
        if not lf:
            continue
        try: real = os.path.realpath(absolute_form(lf)).lower()
        except Exception: continue
        if real.startswith(pref):
            under.append(e)
    return entries, under


@app.route("/library/roots/entries", methods=["GET"])
def library_roots_entries():
    """How many of a Field's tracks live under a folder — asked before removing it."""
    path = (request.args.get("path") or "").strip()
    slug = (request.args.get("cat") or "").strip()
    if not path or not slug:
        return jsonify({"error": "path and cat required"}), 400
    if not any(m["slug"] == slug for m in ensure_default()):
        return jsonify({"error": "Field not found"}), 404
    _all, under = _entries_under_root(slug, path)
    return jsonify({"count": len(under)})


@app.route("/library/roots/move-entries", methods=["POST"])
def library_roots_move_entries():
    """Move a folder's tracks from one Field to another. Body: {path, from, to}.
    Copies every `from` entry under the folder into `to` (same clone as
    /library/analyse — fresh id, provenance, cover), then removes them from `from`
    (snapshotted, undoable). Tracks already in `to` are skipped, not duplicated.
    This is the "I assigned the folder to the wrong Field" repair in one step
    (Mark, 2026-08-22)."""
    body = request.json or {}
    path = (body.get("path") or "").strip()
    src  = (body.get("from") or "").strip()
    dst  = (body.get("to") or "").strip()
    if not path or not src or not dst:
        return jsonify({"error": "path, from and to required"}), 400
    if src == dst:
        return jsonify({"error": "from and to are the same Field"}), 400
    slugs = {m["slug"] for m in ensure_default()}
    if src not in slugs or dst not in slugs:
        return jsonify({"error": "Field not found"}), 404
    with _FS_LOCK:
        src_all, under = _entries_under_root(src, path)
        dst_all = load_cat(dst)
        have = {absolute_form(e.get("library_file", "")).lower()
                for e in dst_all if e.get("library_file")}
        moved, skipped = [], 0
        for e in under:
            key = absolute_form(e.get("library_file", "")).lower()
            if key in have:
                skipped += 1; continue
            c = copy.deepcopy(e)
            new_id = str(uuid.uuid4())
            c["id"] = new_id
            c["copied_from"] = {"cat": src, "id": e["id"],
                                "at": datetime.now().isoformat(timespec="seconds")}
            cp = cover_path(e["id"])
            if cp:
                try: shutil.copyfile(cp, os.path.join(COVERS_DIR, f"{new_id}.jpg"))
                except OSError: pass
            moved.append(c); have.add(key)
        snap = None
        if under:
            if moved:
                save_cat(dst, dst_all + moved)
            gone = {e["id"] for e in under}
            snap = _snapshot_entries_trash("move-folder", {src: under})
            save_cat(src, [e for e in src_all if e["id"] not in gone])
            for e in under:
                cp = cover_path(e["id"])
                if cp:
                    try: os.unlink(cp)
                    except OSError: pass
    return jsonify({"ok": True, "moved": len(moved), "already_there": skipped,
                    "removed_from_source": len(under), "undoable": bool(snap), "snapshot": snap})


@app.route("/library/roots", methods=["DELETE"])
def library_roots_remove():
    """Remove a folder. ?cat=<slug>&purge=1 ALSO removes that Field's tracks under it —
    catalog records only, audio untouched, snapshotted for undo. Without it the
    tracks stayed in the Field invisibly: the folder was gone from the list, the
    scan still said "in Super Massive", and a new Field could not take them
    (Mark, 2026-08-22)."""
    path = (request.args.get("path") or "").strip()
    if not path:
        return jsonify({"error": "Path required"}), 400
    purge_slug = (request.args.get("cat") or "").strip() if \
        (request.args.get("purge") or "").lower() in ("1", "true") else ""
    if purge_slug and not any(m["slug"] == purge_slug for m in ensure_default()):
        return jsonify({"error": "Field not found"}), 404
    cfg = load_config()
    roots = [_root_entry(r) for r in (cfg.get("library_roots") or [])]
    # Match either the stored form or the absolute equivalent
    abs_target = path if os.path.isabs(path) else os.path.join(TUNEFIELD_ROOT, path)
    def _keep(e):
        r = e["path"]
        r_abs = r if os.path.isabs(r) else os.path.join(TUNEFIELD_ROOT, r)
        return r != path and r != abs_target and r_abs != abs_target
    cfg["library_roots"] = [e for e in roots if _keep(e)]
    save_config(cfg)
    purged, snap = 0, None
    if purge_slug:
        with _FS_LOCK:
            entries, under = _entries_under_root(purge_slug, path)
            if under:
                gone = {e["id"] for e in under}
                snap = _snapshot_entries_trash("remove-folder", {purge_slug: under})
                save_cat(purge_slug, [e for e in entries if e["id"] not in gone])
                for e in under:
                    cp = cover_path(e["id"])
                    if cp:
                        try: os.unlink(cp)
                        except OSError: pass
                purged = len(under)
    return jsonify({"ok": True, "purged": purged, "undoable": bool(snap), "snapshot": snap})


@app.route("/library/browse", methods=["POST"])
def library_browse():
    """Open a native folder picker. Returns the chosen path or {cancelled: true}."""
    import platform, subprocess as _sp
    sysname = platform.system()
    try:
        if sysname == "Darwin":
            r = _sp.run(["osascript", "-e", 'POSIX path of (choose folder with prompt "Pick a music folder")'],
                        capture_output=True, text=True, timeout=300)
            if r.returncode != 0 or not r.stdout.strip():
                return jsonify({"cancelled": True})
            return jsonify({"path": r.stdout.strip().rstrip("/")})
        elif sysname == "Windows":
            ps = ('Add-Type -AssemblyName System.Windows.Forms;'
                  '$f=New-Object System.Windows.Forms.FolderBrowserDialog;'
                  '$f.Description="Pick a music folder";'
                  'if($f.ShowDialog() -eq "OK"){Write-Output $f.SelectedPath}')
            r = _sp.run(["powershell", "-NoProfile", "-Command", ps],
                        capture_output=True, text=True, timeout=300)
            if r.returncode != 0 or not r.stdout.strip():
                return jsonify({"cancelled": True})
            return jsonify({"path": r.stdout.strip()})
        else:
            # Try zenity on Linux
            r = _sp.run(["zenity", "--file-selection", "--directory", "--title=Pick a music folder"],
                        capture_output=True, text=True, timeout=300)
            if r.returncode != 0 or not r.stdout.strip():
                return jsonify({"cancelled": True})
            return jsonify({"path": r.stdout.strip()})
    except FileNotFoundError:
        return jsonify({"error": f"Native picker not available on this system ({sysname}). Type or paste the path instead."}), 500
    except Exception:
        # Raw exception text can echo absolute filesystem paths back to the page.
        app.logger.exception("folder picker failed")
        return jsonify({"error": "Folder picker failed — type or paste the path instead."}), 500


@app.route("/library/scan", methods=["GET"])
def library_scan():
    """Walk configured folders and return discovered audio files with cataloged status.

    ?cats=a,b (or legacy ?cat=a) confines the walk to folders assigned to those
    Tunefields, plus shared (unassigned) folders. Folders may NEST: every file
    belongs to its DEEPEST containing folder, so a sub-folder assigned to one
    Tunefield carves its subtree out of any parent folder's scope, and nothing is
    ever walked or listed twice. Each cataloged file reports EVERY Tunefield that
    contains it (a track can be analysed into several)."""
    raw = request.args.get("cats")
    if raw is None:
        raw = request.args.get("cat")
    cats = {s.strip() for s in raw.split(",") if s.strip()} if raw else None

    # All folders with assignments, deepest-first for attribution.
    roots_all = []
    for e in get_library_roots_raw():
        p = e["path"]
        absr = p if os.path.isabs(p) else os.path.join(TUNEFIELD_ROOT, p)
        roots_all.append({"abs": os.path.realpath(absr), "cat": e["cat"]})
    roots_all.sort(key=lambda r: len(r["abs"]), reverse=True)

    def relevant(r):
        return cats is None or r["cat"] is None or r["cat"] in cats

    def deepest_for(path_real):
        for r in roots_all:            # deepest-first → first prefix hit wins
            pr = r["abs"].rstrip(os.sep) + os.sep
            if path_real.startswith(pr) or path_real == r["abs"]:
                return r
        return None

    # Reverse map path → EVERY (entry_id, catalog_name) referencing it, built once.
    path_to_entries = {}
    for m in ensure_default():
        cat_name = m["name"]
        for e in load_cat(m["slug"]):
            lf = e.get("library_file") or ""
            if not lf: continue
            try: key = absolute_form(lf).lower()
            except Exception: key = lf.lower()
            if key:
                path_to_entries.setdefault(key, []).append((e["id"], cat_name, m["slug"]))

    found, seen = [], set()
    skipped = {}   # {ext: count} of files the walk dropped — the UI can show these
    walk_roots = [r for r in roots_all if relevant(r)]
    for r in walk_roots:
        root = r["abs"]
        if not os.path.isdir(root):
            continue
        for path in walk_audio_files(root, skipped=skipped):
            real = os.path.realpath(path)
            if real in seen:
                continue               # nested folders — already listed via a deeper one
            seen.add(real)
            att = deepest_for(real) or r
            if not relevant(att):
                continue               # subtree belongs to a Tunefield outside the selection
            ents = path_to_entries.get(path.lower()) or path_to_entries.get(real.lower()) or []
            try:
                size = os.path.getsize(path)
            except OSError:
                size = 0
            found.append({
                "path":        path,
                "filename":    os.path.basename(path),
                "rel":         os.path.relpath(path, att["abs"]),
                "root":        att["abs"],
                "folder_cat":  att["cat"],                       # the owning folder's Tunefield (null = shared)
                "size_bytes":  size,
                "cataloged":   bool(ents),                       # in ANY Field (back-compat)
                "entry_id":    ents[0][0] if ents else None,
                "catalog":     ents[0][1] if ents else None,      # back-compat single name
                "catalogs":    sorted({c for _, c, _s in ents}),  # EVERY Tunefield containing it (names)
                # Slugs let the client decide per TARGET Field: a track already in some
                # OTHER Field is addable here (copied, not re-analysed), not blocked.
                # "Already in the system somewhere" was the trap (Mark, 2026-08-22).
                "catalog_slugs": sorted({sl for _, _c, sl in ents}),
            })
    if skipped:
        app.logger.info("library scan skipped by extension: %s",
                        json.dumps(skipped, sort_keys=True))
    return jsonify({"roots": [r["abs"] for r in walk_roots], "files": found, "total": len(found),
                    "new": sum(1 for f in found if not f["cataloged"]),
                    "skipped": skipped})


@app.route("/library/analyse", methods=["POST"])
def library_analyse():
    """Analyse a batch of paths in-place (no copy). Body: {paths:[...], duration:int, cat:slug}

    Lock discipline: this endpoint is on _LOCK_EXEMPT_ENDPOINTS — librosa runs for
    seconds per track and holding the global lock for the whole batch would freeze every
    other write in the app. Instead each per-track commit re-loads the catalog under
    _FS_LOCK, re-checks for duplicates against the fresh state, appends, and saves —
    so an interrupt still loses at most one track, and concurrent writers are safe."""
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    body     = request.json or {}
    paths    = body.get("paths") or []
    duration = _scan_duration(body.get("duration"), 60)
    if not _scan_duration_ok(duration):
        return jsonify({"error": _SCAN_DURATION_ERR}), 400
    slug     = (body.get("cat") or "").strip() or req_slug()
    if not isinstance(paths, list):
        return jsonify({"error": "paths must be a list"}), 400
    if not paths:
        return jsonify({"error": "paths required"}), 400
    # A slug that passes _safe_slug but isn't registered in _meta.json would make
    # save_cat CREATE an unlisted catalog file — the entries would be invisible to every
    # meta-driven route (list, stream, export) and the analysis work silently stranded.
    if not any(m["slug"] == slug for m in ensure_default()):
        return jsonify({"error": f"Target catalog not found: {slug}"}), 404
    with _FS_LOCK:
        cataloged = {absolute_form(e.get("library_file", "")).lower()
                     for e in load_cat(slug) if e.get("library_file")}
        # Same track, a DIFFERENT Field → copy its analysis instead of decoding again.
        # A track can live in any number of Fields (Mark, 2026-08-22); librosa only ever
        # needs to hear it once. Built per request: a full parse of every catalog is
        # ~0.5 s against ~15 s of decoding per 5-track chunk — and it is the same read
        # /library/scan does on every scan.
        elsewhere = {}
        for m in ensure_default():
            if m["slug"] == slug:
                continue
            for e in load_cat(m["slug"]):
                lf = e.get("library_file")
                if not lf:
                    continue
                try: key = absolute_form(lf).lower()
                except Exception: key = lf.lower()
                elsewhere.setdefault(key, (m["slug"], e))
    added = []
    errors = []
    already = 0    # already in this Field
    skipped = {}   # {ext: count} refused at the gate — same shape /library/scan reports

    # ── Pre-flight (serial, cheap): everything that can be judged without decoding ──
    todo, clones = [], []
    for path in paths:
        path = os.path.abspath(path)
        if not os.path.exists(path):
            errors.append({"path": path, "error": "not found"}); continue
        if path.lower() in cataloged:
            already += 1; continue   # a non-event: counted, never an error (beta8 #2)
        ext = os.path.splitext(path)[1].lower()
        if ext not in ALLOWED:
            skipped[ext or "(none)"] = skipped.get(ext or "(none)", 0) + 1
            usage_event("analyze_reject", fmt=ext, reason="unsupported extension", src="scan")
            errors.append({"path": path, "error": f"unsupported {ext}"}); continue
        # Confine in-place analysis to configured roots (plus data/library). The stock UI
        # only sends paths discovered by /library/scan, which walks the roots — anything
        # else is a scripted caller reaching for arbitrary files on disk.
        if not _path_within_library(path):
            errors.append({"path": path, "error": "outside configured music folders"}); continue
        src = elsewhere.get(path.lower())
        if src is not None:
            clones.append((path, src)); continue
        todo.append(path)

    def _clone(path, src):
        # Same entry, new identity: fresh id, this Field's path form, provenance noted.
        # Entry-level corrections (bpm_user etc.) travel with it — they describe the
        # track, not the Field. The cover is a per-id file, so it is copied too.
        src_slug, src_e = src
        ext = os.path.splitext(path)[1].lower()
        entry = copy.deepcopy(src_e)
        new_id = str(uuid.uuid4())
        entry["id"] = new_id
        entry["library_file"] = store_path(path)
        entry["copied_from"] = {"cat": src_slug, "id": src_e["id"],
                                "at": datetime.now().isoformat(timespec="seconds")}
        has_cover = False
        cp = cover_path(src_e["id"])
        if cp:
            try:
                shutil.copyfile(cp, os.path.join(COVERS_DIR, f"{new_id}.jpg")); has_cover = True
            except OSError:
                pass
        return path, entry, None, {"fmt": ext, "ms": 0, "cover": has_cover, "copied": True}

    # ── Analyse in parallel (see _analysis_workers) ──
    def _work(path):
        # usage_event is safe from these pool threads — its appends serialise on
        # _USAGE_LOCK. src distinguishes this path from /analyze uploads in usage.jsonl.
        ext = os.path.splitext(path)[1].lower()
        try:
            entry_id = str(uuid.uuid4())
            t0       = time.time()
            result   = analyze(path, duration_limit=duration, verbose=False)
            # analyze() returns a clean error dict on undecodable/corrupt audio instead of
            # raising (post-remediation contract, same as /analyze and /rescan). Route it
            # to errors — cataloging it would strand an entry with no rhythm/harmony/
            # scores keys, which breaks the library table render client-side.
            if result.get("error"):
                usage_event("analyze_reject", fmt=ext, reason=str(result["error"])[:80],
                            src="scan")
                return path, None, result["error"], None
            result["original_filename"] = os.path.basename(path)
            has_cover = bool(extract_cover(entry_id, path, os.path.basename(path)))
            # Telemetry rides ALONGSIDE the entry (never inside it — extra keys would
            # be persisted into the journal); the commit loop emits the event only
            # after the durable append, so a track the commit phase rejects
            # (catalog deleted mid-batch, duplicate) never logs as analysed.
            telem = {"fmt": ext, "ms": int((time.time() - t0) * 1000), "cover": has_cover}
            return path, {
                "id":            entry_id,
                "filename":      os.path.basename(path),
                "analyzed_at":   datetime.now().isoformat(timespec="seconds"),
                "scan_duration": duration,
                "library_file":  store_path(path),   # in-place reference (relative when under root)
                "genre":         (result.get("metadata", {}) or {}).get("genre", ""),
                "data":          result,
            }, None, telem
        except Exception as e:
            usage_event("analyze_reject", fmt=ext,
                        reason=(str(e) or type(e).__name__)[:80], src="scan")
            return path, None, str(e), None

    workers = _analysis_workers()
    # Foreground courtesy (Mark, 2026-08-28): while the user is on the Field or List tab
    # the client sends a lower `workers` hint with each chunk, so a long analysis run
    # stays a background hum instead of starving the UI's own requests (this server is
    # one threaded process — four librosa threads flatten everything else). The hint can
    # only LOWER the count, never raise it past _analysis_workers().
    try:
        rw = int(body.get("workers") or 0)
        if rw > 0:
            workers = max(1, min(rw, workers))
    except (TypeError, ValueError):
        pass
    if workers > 1 and len(todo) > 1:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            done = list(ex.map(_work, todo))
    else:
        done = [_work(p) for p in todo]
    done = [_clone(p, src) for p, src in clones] + done

    # ── Commit serially, in submission order (cheap now: one journal append each) ──
    for path, entry, err, telem in done:
        if err:
            errors.append({"path": path, "error": err}); continue
        with _FS_LOCK:
            # The target catalog can be deleted/cleared MID-BATCH (Repair tab, another
            # browser window). Blindly saving would resurrect it as a ghost file that
            # is invisible in the UI — verify it still exists, else stop the batch.
            if not any(m["slug"] == slug for m in load_meta()):
                errors.append({"path": path, "error": "target Field was deleted during analysis — batch stopped"})
                break
            # Re-check against state that may have moved while we were decoding.
            # `cataloged` is request-local, so it cannot see tracks committed by a
            # CONCURRENT analyse request (two windows resuming the same queue would
            # both append every track). _COMMITTED_PATHS is process-global — seed the
            # slug's set lazily from this request's snapshot, then dedup against both.
            committed = _COMMITTED_PATHS.setdefault(slug, set(cataloged))
            if path.lower() in committed or path.lower() in cataloged:
                already += 1; continue
            # Durable per track exactly as before — an interrupt (USB pull, crash, quit)
            # still loses at most one track. The difference is that appending one line
            # costs the same whether the catalog holds 100 tracks or 30,000.
            append_journal(slug, entry)
            committed.add(path.lower())
            cataloged.add(path.lower())
        if telem:
            copied = telem.pop("copied", False)
            usage_event("analyze", src="copy" if copied else "scan", **telem)
        added.append({"id": entry["id"], "path": path, "copied": bool(entry.get("copied_from"))})

    # Collapse the journal into the main catalog at the end of every batch. Bounded work
    # (at most one batch of entries), and it keeps the on-disk file close to current for
    # anything reading it outside this process.
    try: fold_journal(slug)
    except Exception as e: print(f"[library_analyse] fold_journal: {e}")
    return jsonify({"ok": True, "added": added, "errors": errors,
                    "copied_count": sum(1 for a in added if a.get("copied")),
                    "added_count": len(added), "error_count": len(errors),
                    "already_count": already,
                    "skipped": skipped})


# ── Resumable analyse queue ─────────────────────────────────────────
# The analyse loop lives in the browser page; a crash / ⌘R / power cut used to lose the
# whole run (Mark lost 14.7k tracks to an accidental reload). The client mirrors its live
# queue here on every chunk, and the boot path offers to resume whatever is still pending.

@app.route("/library/queue", methods=["GET"])
def library_queue_get():
    try:
        with open(ANALYSIS_QUEUE_FILE) as f:
            doc = json.load(f)
        pending = doc.get("pending") if isinstance(doc, dict) else None
        if not isinstance(pending, list):
            return jsonify({"pending": []})
        return jsonify({"pending": pending, "updated_at": doc.get("updated_at")})
    except Exception:
        # Absent or corrupt file both mean "nothing to resume" — never 500 the boot path.
        return jsonify({"pending": []})


@app.route("/library/queue", methods=["POST"])
def library_queue_set():
    """Replace the persisted queue. Body: {pending:[{path,cat,duration},...]}.
    An empty list deletes the file (run finished or cancelled — nothing to resume)."""
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    # Reject absurd payloads before Flask buffers/parses the whole body.
    if request.content_length and request.content_length > 32 * 1024 * 1024:
        return jsonify({"error": "request too large"}), 413
    body = request.get_json(silent=True) or {}
    pending = body.get("pending")
    if not isinstance(pending, list):
        return jsonify({"error": "pending must be a list"}), 400
    # Never 500 (or hard-reject) the resume file — this endpoint is the crash-safety
    # net. Oversized lists are truncated (flagged in the response), oversized paths
    # skipped, and mistyped cat/duration coerced to None rather than refused.
    truncated = len(pending) > 100000
    if truncated:
        pending = pending[:100000]
    clean = []
    for it in pending:
        if not isinstance(it, dict) or not isinstance(it.get("path"), str) or not it["path"]:
            return jsonify({"error": "each pending item needs a string path"}), 400
        if len(it["path"]) > 4096:
            continue   # no real filesystem path is this long — drop it, keep the rest
        cat = it.get("cat")
        cat = cat if isinstance(cat, str) else None
        dur = it.get("duration")
        dur = dur if isinstance(dur, (int, float)) and not isinstance(dur, bool) else None
        clean.append({"path": it["path"], "cat": cat, "duration": dur})
    if not clean:
        try: os.remove(ANALYSIS_QUEUE_FILE)
        except FileNotFoundError: pass
        return jsonify({"ok": True, "pending": 0, "truncated": truncated})
    atomic_json_dump(ANALYSIS_QUEUE_FILE, {
        "pending": clean,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    })
    return jsonify({"ok": True, "pending": len(clean), "truncated": truncated})


# ── Catalog meta helpers ────────────────────────────────────────────
def load_meta():
    """Read the catalog meta list. Resilient to a corrupted file: logs the issue, moves
    the bad file aside as .corrupt and returns [] so `ensure_default()` regenerates rather
    than 500-ing every endpoint that touches the catalog."""
    if not os.path.exists(META_FILE):
        return []
    try:
        with open(META_FILE) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        try:
            os.replace(META_FILE, META_FILE + ".corrupt")
            print(f"[load_meta] corrupted {META_FILE} → moved to .corrupt ({e})")
        except Exception:
            pass
        return []

def save_meta(meta):
    atomic_json_dump(META_FILE, meta)

def _reconstruct_meta_from_disk():
    """When _meta.json is missing/corrupt but catalog *.json files exist on disk,
    rebuild meta entries from those files instead of assuming a clean slate. Prevents
    a corrupt-meta recovery from silently orphaning real catalogs. Titles the slug in a
    human-ish way (underscores → spaces, capitalised)."""
    out = []
    try:
        for fn in sorted(os.listdir(CATALOGS_DIR)):
            if not fn.endswith(".json") or fn.startswith("_"):
                continue
            slug = fn[:-5]
            name = slug.replace("_", " ").strip().title() or slug
            out.append({"name": name, "slug": slug})
    except FileNotFoundError:
        pass
    return out

def ensure_default():
    meta = load_meta()
    if not meta:
        # Recovery/first-run writes below run from GET paths too (e.g. GET /catalogs),
        # which skip the request-level lock — take _FS_LOCK explicitly so the
        # reconstruct-and-save can't interleave with a locked mutator's save_meta.
        with _FS_LOCK:
            # Re-check under the lock — another thread may have just regenerated it.
            meta = load_meta()
            if meta:
                return meta
            # _meta.json is missing or was quarantined as corrupt. If catalog files already
            # exist on disk, rebuild meta from them — DO NOT overwrite an intact default.json
            # with [] (that would wipe real entries and orphan every other catalog).
            reconstructed = _reconstruct_meta_from_disk()
            if reconstructed:
                save_meta(reconstructed)
                return reconstructed
            # Genuine first run — no catalog files at all.
            slug = "default"
            dest = os.path.join(CATALOGS_DIR, f"{slug}.json")
            if os.path.exists(LEGACY_FILE):
                shutil.copy(LEGACY_FILE, dest)
            elif not os.path.exists(dest):     # never clobber an existing file
                atomic_json_dump(dest, [])
            meta = [{"name": "Default", "slug": slug}]
            save_meta(meta)
    return meta

def make_slug(name, existing):
    base = re.sub(r"[^a-z0-9_-]", "_", name.lower().strip())[:40] or "catalog"
    slug = base
    i = 2
    while slug in existing:
        slug = f"{base}_{i}"; i += 1
    return slug

def _safe_slug(slug):
    """Defence-in-depth: reject any slug from a URL param that contains path-traversal
    characters or anything outside [a-z0-9_-]. Routes that accept user-supplied slugs
    funnel through cat_file / pl_file — guarding here covers every
    read/write path in one place. Returns the slug if safe, raises ValueError otherwise."""
    import re as _re
    if not isinstance(slug, str) or not slug or len(slug) > 128:
        raise ValueError(f"invalid slug: {slug!r}")
    if not _re.match(r"^[A-Za-z0-9_-]+$", slug):
        raise ValueError(f"invalid slug: {slug!r}")
    return slug

def cat_file(slug):
    return os.path.join(CATALOGS_DIR, f"{_safe_slug(slug)}.json")

def _load_cat_raw(slug):
    """Resilient like load_meta(): a torn/corrupt catalog file (USB pull mid-flush on
    FAT32) is quarantined as .corrupt and treated as empty, instead of raising
    JSONDecodeError — which subclasses ValueError and would surface as a misleading 400
    from EVERY route that touches the catalog list, bricking the whole UI over one file."""
    path = cat_file(slug)
    if not os.path.exists(path):
        return []
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        try:
            os.replace(path, path + ".corrupt")
            print(f"[load_cat] corrupted {path} → moved to .corrupt ({e})")
        except Exception:
            pass
        return []

# A scan length is EITHER a fraction of each track in (0, 1] — the form the UI has used
# since 2026-08-26 — OR a legacy number of seconds. The old guard was `1 <= duration`,
# which rejected every fractional value: with the UI defaulting to 50%, adding music
# returned HTTP 400 and nothing could be scanned at all (review, 2026-08-27).
_SCAN_MIN_SECONDS, _SCAN_MAX_SECONDS = 1.0, 99999.0
_SCAN_DURATION_ERR = ("duration must be a fraction of the track in (0, 1] "
                      "— e.g. 0.25, 0.5, 1 — or a legacy length in seconds (1-99999)")


def _scan_duration_ok(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return False
    if v != v:                      # NaN
        return False
    return (0 < v <= 1.0) or (_SCAN_MIN_SECONDS <= v <= _SCAN_MAX_SECONDS)


def _scan_duration(raw, default=60):
    """Parse a scan-length setting.

    Accepts legacy SECONDS (30, 60, ... 99999 = full) and the fractional form added
    2026-08-26, where a value in (0, 1] means a proportion of each track's own length.
    Kept as float on purpose — int() would collapse 0.25 and 0.5 to 0 and silently turn
    every partial scan into a 1-second read.
    """
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return float(default)
    if v <= 0:
        return float(default)
    return v


def _apply_overrides(entries):
    """Fold user corrections into `data` on the way out.

    Corrections live on the ENTRY (entry["bpm_user"]), never inside `data`, because
    analysis rewrites `data` wholesale — anything stored in there is destroyed by the
    next scan, which is exactly what a correction must survive. Re-applying here means
    every reader downstream (cards, list, filters, axes, the vector space, exports) sees
    the corrected tempo without a single one of them knowing corrections exist."""
    # Reversible on purpose: any load_cat->save_cat route persists the FOLDED view, so
    # without a snapshot the detected value is gone the first time an unrelated save
    # touches the catalog — and clearing the override then has nothing to restore
    # (review, 2026-08-12). *_detected fields are the escrow.
    for e in entries:
        d = e.get("data")
        bpm = e.get("bpm_user")
        if isinstance(d, dict) and isinstance(d.get("rhythm"), dict):
            r = d["rhythm"]
            if bpm:
                # Escrow the PRE-OVERRIDE value under its own key. This used to reuse
                # bpm_detected, which analyze.py always writes (analyze.py:713) — so the
                # setdefault was inert, and clearing an override on a TAG-sourced track
                # restored the AUDIO value while popping the field the Check column reads
                # (index.html:4793), permanently disabling Check for that track
                # (review, 2026-08-26). bpm_pre_user is ours alone; analysis never writes it.
                # Only escrow when the stored value is NOT already a folded override.
                # A correction made before bpm_pre_user existed has bpm_user=True and
                # r["bpm"] already EQUAL to the override — escrowing that would record
                # the override as the "original" and destroy the real detected/tag value
                # for good (review, 2026-08-27). Such tracks fall through to the
                # bpm_detected fallback below instead, which is the honest answer.
                if not r.get("bpm_user"):
                    r.setdefault("bpm_pre_user", r.get("bpm"))
                r["bpm"] = bpm
                r["bpm_user"] = True
            elif r.get("bpm_user"):
                if r.get("bpm_pre_user") is not None:
                    r["bpm"] = r.pop("bpm_pre_user")
                elif r.get("bpm_detected") is not None:
                    # Override predating bpm_pre_user: bpm_detected is the only candidate,
                    # but it is analysis-owned — read it, never pop it, so Check survives.
                    r["bpm"] = r["bpm_detected"]
                r.pop("bpm_user", None)
        key = e.get("key_user")
        if isinstance(d, dict) and isinstance(d.get("harmony"), dict):
            h = d["harmony"]
            if isinstance(key, dict) and key.get("root"):
                h.setdefault("root_detected", h.get("root"))
                h.setdefault("mode_detected", h.get("mode"))
                h["root"] = key["root"]
                h["mode"] = key.get("mode", "major")
                h["key"]  = f'{h["root"]} {h["mode"]}'
                h["key_user"] = True
            elif h.get("key_user"):
                if h.get("root_detected") is not None:
                    h["root"] = h.pop("root_detected")
                    h["mode"] = h.pop("mode_detected", h.get("mode"))
                    h["key"]  = f'{h["root"]} {h["mode"]}'
                h.pop("key_user", None)
    return entries


def load_cat(slug):
    """What every route calls. Returns the catalog INCLUDING anything still sitting in
    the journal, so no caller needs to know the journal exists. Folds opportunistically
    once the journal is worth collapsing — keeping reads cheap without paying the fold
    cost on every single append."""
    pending = _read_journal(slug)
    if not pending:
        return _apply_overrides(_load_cat_raw(slug))
    if len(pending) >= JOURNAL_FOLD_AT:
        fold_journal(slug)
        return _apply_overrides(_load_cat_raw(slug))
    base = _load_cat_raw(slug)
    seen = {e.get("id") for e in base if isinstance(e, dict)}
    return _apply_overrides(base + [e for e in pending
                                    if isinstance(e, dict) and e.get("id") not in seen])


def save_cat(slug, entries):
    """Authoritative full write. Clears any pending journal — `entries` IS the truth now."""
    atomic_json_dump(cat_file(slug), entries, compact=True)
    # `entries` is also the truth for the in-process dedup memory. Every removal path
    # (clear, delete-entry, dedup, orphans, move, folder purge) lands here, and each one
    # used to leave _COMMITTED_PATHS[slug] still holding the removed paths — so the next
    # in-place analyse decoded the track for seconds and then refused it as "already
    # cataloged" against a Field that was empty on disk (Mark, 2026-09-02).
    _COMMITTED_PATHS.pop(slug, None)
    jp = journal_file(slug)
    if os.path.exists(jp):
        with _FS_LOCK:
            try: os.remove(jp)
            except OSError: pass


# ── Append-only journal ───────────────────────────────────────────────────────
# Analysis used to do load_cat + append + save_cat FOR EVERY TRACK, so the cost of
# adding track N scaled with N and building a library was O(N²). Measured on a real
# run: 70 ms/track at 8.5 MB (4,810 entries), ~213 ms projected at 14,718, and the
# observed rate degraded 1.46 → 2.05 s/track over one afternoon.
#
# The per-track durability was deliberate ("lose at most one track on an interrupt")
# and is preserved exactly: each new entry is appended as one line to a sidecar
# .journal.jsonl and flushed. Appending is O(1) regardless of catalog size. The
# journal is folded into the main file periodically and whenever the catalog is read,
# so every existing reader keeps seeing one coherent list and no other code changes.
# ── Parallel analysis ─────────────────────────────────────────────────────────
# Analysis was fully serial: the client awaited each chunk and the server looped it one
# track at a time, so one core did everything on a 16-core machine.
#
# THREADS, not processes, deliberately. librosa/numpy release the GIL for the heavy
# numeric work, and measuring on 8 real tracks showed serial 1.45 s/track → 0.42 s/track
# at 4 threads (3.46x), plateauing by 6. Processes would add pickling, and `spawn` on
# macOS re-imports the main module in every worker — app.py runs migrations at import —
# and multiprocessing inside a PyInstaller bundle is a known source of pain, which
# matters because installers are the next job. Threads buy most of the win for none of
# that. (Measured 2026-08-05.)
def _analysis_workers():
    try:
        n = int(os.environ.get("TUNEFIELD_WORKERS", "0"))
        if n > 0:
            return min(n, 16)
    except ValueError:
        pass
    return max(1, min(4, (os.cpu_count() or 2) - 1))


JOURNAL_FOLD_AT = 200          # fold once this many entries are pending
def journal_file(slug):
    return os.path.join(CATALOGS_DIR, f"{_safe_slug(slug)}.journal.jsonl")


def append_journal(slug, entry):
    """O(1) durable append. Cost does NOT grow with catalog size."""
    with _FS_LOCK:
        with open(journal_file(slug), "a") as f:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")
            f.flush()
            try: os.fsync(f.fileno())
            except OSError: pass


def _read_journal(slug):
    """Entries pending in the journal. A torn final line (power cut mid-append) is
    dropped rather than raising — that is the one record the old design would also
    have lost, and losing it silently beats bricking the catalog."""
    jp = journal_file(slug)
    if not os.path.exists(jp):
        return []
    out = []
    try:
        with open(jp) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try: out.append(json.loads(line))
                except json.JSONDecodeError: pass   # torn tail — skip
    except OSError:
        return []
    return out


# ── Energy-scale migration (2026-08-05) ──────────────────────────────────────
# The old energy formula clipped: `clip(mean_rms / 0.25, 0, 1)`. Measured across a real
# 14,694-track library, 28.1% of tracks sat at EXACTLY 1.000, flattening 9.0 dB of
# genuine loudness into one number — so for nearly a third of the collection, energy
# carried no information and every similarity, route and cluster leaning on it was
# reading a blank. analyze.py now derives energy from integrated LUFS, which is
# asymptotic and cannot pin.
#
# LUFS was already stored for every analysed track (14,693/14,694 here), so this is a
# RECOMPUTE, not a re-analysis: 24,259 tracks are corrected in seconds instead of the
# ~5.5 hours re-scanning the audio would cost.
#
# Deliberately NOT recomputed: mood and valence. Measured, recomputing them would flip
# 13.3% of labels — and every formerly-clipped track lands above the new mood gate
# anyway (their new energies span 0.481-0.898 against a 0.42 threshold), so the group
# that actually had wrong energy keeps the same mood either way. The thresholds in
# analyze.py were restated to hold the old population splits (drift -1.6/+0.4/-0.3
# points), so freshly-analysed tracks stay comparable with existing ones. Churning
# labels people may have built playlists around, to no accuracy gain, is the worse
# trade.
ENERGY_SCALE_TAG = "lufs-v2"

def _migrate_entry_energy(data):
    """Recompute one entry's energy in place. True if it changed."""
    en = data.get("energy")
    if not isinstance(en, dict) or en.get("scale") == ENERGY_SCALE_TAG:
        return False
    old = en.get("level")
    lufs = en.get("loudness_lufs")
    new = _loudness_to_energy(lufs)
    if new is None:
        # No LUFS. The old value is invertible while it wasn't clipped, so the RMS
        # fallback can still put it on the new scale; a clipped one is unrecoverable
        # and is left exactly as it was rather than guessed at.
        if isinstance(old, (int, float)) and old < 0.9995:
            new = _rms_to_energy(old * 0.25)
        else:
            return False
    en["level"] = round(new, 3)
    en["scale"] = ENERGY_SCALE_TAG
    sc = data.get("scores")
    if isinstance(sc, dict) and "energy" in sc:      # the duplicate copy
        sc["energy"] = round(new, 3)
    # Every stored summary quotes the energy as a percentage ("... · energy 76% · vocal")
    # and that string is printed on the card. Patch the number in place rather than
    # rebuilding the sentence — the format belongs to analyze.py, and duplicating it here
    # would be two copies to keep in step.
    summ = data.get("summary")
    if isinstance(summ, str) and "energy" in summ:
        data["summary"] = re.sub(r"energy \d+%", "energy %d%%" % round(new * 100), summ)
    return True

def migrate_energy_scale():
    """Recompute energy for every catalog. Idempotent: each entry carries its scale tag.

    Runs through load_cat/save_cat so a pending journal is folded in first and the
    write is atomic — a crash mid-migration leaves the previous file intact, and the
    per-entry tag means the next boot resumes rather than redoing."""
    if not os.path.isdir(CATALOGS_DIR):
        return
    total = 0
    for fn in os.listdir(CATALOGS_DIR):
        if not fn.endswith(".json") or fn == "_meta.json":
            continue
        slug = fn[:-5]
        try:
            entries = load_cat(slug)
        except Exception:
            continue                      # unreadable catalog is the repair tab's problem
        n = 0
        for e in entries:
            d = e.get("data")
            if isinstance(d, dict) and _migrate_entry_energy(d):
                n += 1
        if n:
            save_cat(slug, entries)
            total += n
            print(f"  energy rescaled: {n} tracks in {slug}")
    if total:
        print(f"  energy scale migration complete — {total} tracks")


def fold_journal(slug):
    """Merge pending journal entries into the main catalog and clear the journal.
    Deduped by id, journal winning, so folding twice is harmless."""
    pending = _read_journal(slug)
    if not pending:
        return 0
    with _FS_LOCK:
        pending = _read_journal(slug)          # re-read under the lock
        if not pending:
            return 0
        base = _load_cat_raw(slug)
        seen = {e.get("id") for e in base if isinstance(e, dict)}
        merged = list(base)
        for e in pending:
            if isinstance(e, dict) and e.get("id") not in seen:
                seen.add(e.get("id")); merged.append(e)
        atomic_json_dump(cat_file(slug), merged, compact=True)
        try: os.remove(journal_file(slug))
        except OSError: pass
        return len(pending)

# Run the energy rescale once, here rather than beside migrate_catalog_paths(), because
# it needs load_cat/save_cat/fold_journal — all defined above this line. At import, so it
# also runs under WSGI. Threads share the module, so it cannot race itself (this is one
# of the reasons the analysis pool uses threads and not processes).
try:
    migrate_energy_scale()
except Exception as _e:
    print(f"  energy scale migration skipped: {_e}")


def library_path(entry):
    """Resolve an entry's library_file to an absolute path on disk, or None if missing."""
    return resolve_path(entry.get("library_file"))

def cover_path(entry_id):
    p = os.path.join(COVERS_DIR, f"{entry_id}.jpg")
    return p if os.path.exists(p) else None

def _paths_referenced_outside(exclude_slug=None, exclude_ids=None):
    """Set of lowercased absolute audio paths referenced by catalog entries OUTSIDE the
    given deletion scope. The same on-disk file can legitimately be cataloged in two
    catalogs (in-place analyse guards duplicates per-catalog only), so delete-with-files
    paths must not trash audio that another entry still points at — repair_dedup already
    honours this invariant; the delete endpoints share it via this helper.
    exclude_slug: ignore all entries in this catalog (they are being deleted).
    exclude_ids:  ignore these entry ids wherever they live."""
    exclude_ids = exclude_ids or set()
    refs = set()
    for m in ensure_default():
        for e in load_cat(m["slug"]):
            if m["slug"] == exclude_slug and not exclude_ids:
                continue
            if e.get("id") in exclude_ids:
                continue
            lf = e.get("library_file") or ""
            if not lf:
                continue
            try:
                refs.add(absolute_form(lf).lower())
            except Exception:
                pass
    return refs

def _id3_apic_bytes(path):
    """Pure-python art extractor for WAV/AIFF files carrying an ID3v2 block in a RIFF
    'id3 ' / AIFF 'ID3 ' chunk (the Beatport/Rekordbox wav convention). ffmpeg's wav
    demuxer IGNORES that chunk, so without this the art is invisible to the pipeline.
    Walks the container to the ID3 block, then the ID3 frames to APIC, and returns the
    raw image bytes — or None. No dependencies; any parse trouble returns None."""
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            id3 = None
            if head[:4] == b"RIFF":                     # WAV — little-endian chunk sizes
                while True:
                    hdr = f.read(8)
                    if len(hdr) < 8:
                        break
                    cid, size = hdr[:4], int.from_bytes(hdr[4:8], "little")
                    if cid.lower() == b"id3 ":
                        id3 = f.read(min(size, 32 * 1024 * 1024))
                        break
                    f.seek(size + (size & 1), 1)
                # Some taggers append a bare ID3 block AFTER the RIFF payload instead
                if id3 is None:
                    f.seek(0, 2)
                    riff_end = 8 + int.from_bytes(head[4:8], "little")
                    if f.tell() > riff_end + 10:
                        f.seek(riff_end)
                        maybe = f.read()
                        if maybe[:3] == b"ID3":
                            id3 = maybe
            elif head[:4] == b"FORM":                   # AIFF — big-endian chunk sizes
                while True:
                    hdr = f.read(8)
                    if len(hdr) < 8:
                        break
                    cid, size = hdr[:4], int.from_bytes(hdr[4:8], "big")
                    if cid in (b"ID3 ", b"id3 "):
                        id3 = f.read(min(size, 32 * 1024 * 1024))
                        break
                    f.seek(size + (size & 1), 1)
        if not id3 or id3[:3] != b"ID3":
            return None
        ver = id3[3]
        syncsafe = lambda b: (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]
        total = min(syncsafe(id3[6:10]) + 10, len(id3))
        pos = 10
        if id3[5] & 0x40:                               # skip extended header
            ext = syncsafe(id3[pos:pos + 4]) if ver >= 4 else int.from_bytes(id3[pos:pos + 4], "big")
            pos += max(ext, 4)
        while pos + 10 <= total:
            fid = id3[pos:pos + 4]
            if fid == b"\x00\x00\x00\x00":
                break
            fsz = syncsafe(id3[pos + 4:pos + 8]) if ver >= 4 else int.from_bytes(id3[pos + 4:pos + 8], "big")
            if fsz <= 0 or pos + 10 + fsz > len(id3):
                break
            if fid == b"APIC":
                body = id3[pos + 10:pos + 10 + fsz]
                enc = body[0]
                i = body.index(b"\x00", 1) + 1          # end of MIME string
                i += 1                                  # picture-type byte
                if enc in (1, 2):                       # UTF-16 description → 2-byte NUL, aligned
                    j = i
                    while j + 1 < len(body) and body[j:j + 2] != b"\x00\x00":
                        j += 2
                    j += 2
                else:                                   # latin-1 / utf-8 → single NUL
                    j = body.index(b"\x00", i) + 1
                data = bytes(body[j:])
                return data if len(data) > 64 else None
            pos += 10 + fsz
    except Exception:
        return None
    return None

def extract_cover(entry_id, audio_path, original_filename=None):
    """Embedded art → covers/<id>.jpg, or None. NEVER raises: artwork is decoration, and
    no failure to find a picture may cost the caller its analysis. That is not a
    hypothetical — a TypeError in here discarded every analysis of every track that had
    cover art until 2026-08-06."""
    try:
        return _extract_cover(entry_id, audio_path, original_filename)
    except Exception:
        app.logger.exception("cover extraction failed for %s", entry_id)
        return None


def _extract_cover(entry_id, audio_path, original_filename=None):
    """Embedded art → covers/<id>.jpg. Pure python first, ffmpeg only if that fails.

    tags.read_cover handles ID3 APIC (including the malformed frames real taggers emit),
    FLAC PICTURE, MP4 covr and Vorbis METADATA_BLOCK_PICTURE. Measured against ffmpeg on
    150 real files: 37 of 37 found, 35 byte-identical, none missed — at 0.11 ms/file
    instead of a subprocess each. ffmpeg remains a fallback for anything exotic, and its
    absence costs nothing."""
    try:
        import tags as _tags
        got = _tags.read_cover(audio_path)
    except Exception:
        got = None
    if got:
        data, _mime = got
        # NOT cover_path() — that is a lookup which returns None until the file exists,
        # and passing None to os.path.dirname raised TypeError for every track that HAD
        # embedded art. Analysis of tagged libraries failed wholesale on 2026-08-06.
        dest = os.path.join(COVERS_DIR, f"{entry_id}.jpg")
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
            return dest
        except OSError:
            pass
    return _extract_cover_ffmpeg(entry_id, audio_path, original_filename)


def _extract_cover_ffmpeg(entry_id, audio_path, original_filename=None):
    """Extract embedded cover via ffmpeg, then WAV/AIFF ID3-chunk art, then sidecar /
    folder images. Returns dest path or None."""
    import subprocess as _sp
    dest = os.path.join(COVERS_DIR, f"{entry_id}.jpg")
    if os.path.exists(dest):
        return dest
    if not audio_path or not os.path.exists(audio_path):
        return None
    # 1. Try embedded art via ffmpeg
    try:
        r = _sp.run(
            ["ffmpeg", "-y", "-v", "quiet", "-i", audio_path,
             "-an", "-vcodec", "mjpeg", "-vframes", "1", "-vf", "scale=400:-1", dest],
            timeout=15
        )
        if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0:
            return dest
        if os.path.exists(dest):
            os.unlink(dest)
    except Exception:
        pass
    # 1b. WAV/AIFF ID3-chunk art (Beatport-style) that ffmpeg's demuxer can't see.
    art = _id3_apic_bytes(audio_path)
    if art:
        tmp = dest + ".artsrc"
        try:
            with open(tmp, "wb") as f:
                f.write(art)
            r = _sp.run(["ffmpeg", "-y", "-v", "quiet", "-i", tmp, "-vf", "scale=400:-1", dest], timeout=10)
            if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0:
                return dest
        except Exception:
            pass
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    # 2. Fallback images on disk: a SIDE-CAR image sharing the track's basename
    #    ("Track.wav" + "Track.jpg"), then the usual folder-level cover names.
    candidates = []
    _folder_names = ("cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg",
                     "folder.png", "front.jpg", "front.png", "album.jpg", "album.png",
                     "artwork.jpg", "artwork.png")
    for base in ([original_filename] if original_filename else []) + [audio_path]:
        stem = os.path.splitext(base)[0]
        for ext in (".jpg", ".jpeg", ".png"):
            p = stem + ext
            if os.path.exists(p):
                candidates.append(p)
    if original_filename:
        parent = os.path.dirname(original_filename)
        if parent:
            for name in _folder_names:
                p = os.path.join(parent, name)
                if os.path.exists(p):
                    candidates.append(p)
    audio_parent = os.path.dirname(audio_path)
    for name in _folder_names:
        p = os.path.join(audio_parent, name)
        if os.path.exists(p):
            candidates.append(p)
    for src in candidates:
        try:
            r = _sp.run(["ffmpeg", "-y", "-v", "quiet", "-i", src, "-vf", "scale=400:-1", dest], timeout=10)
            if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0:
                return dest
        except Exception:
            continue
    return None

def req_slug():
    """Active catalog slug from request, defaulting to first."""
    slug = request.values.get("cat", "").strip()
    return slug if slug else ensure_default()[0]["slug"]

def find_entry_anywhere(entry_id):
    """Search all catalogs for an entry, return (entry, slug) or (None, None)."""
    for m in ensure_default():
        for e in load_cat(m["slug"]):
            if e["id"] == entry_id:
                return e, m["slug"]
    return None, None


# ── Routes ─────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/favicon.ico")
def favicon():
    # Browsers request /favicon.ico directly (outside the page's <link>). Serve the logo
    # so the tab icon resolves instead of 404-ing to a generic placeholder.
    return send_from_directory(os.path.join("static", "assets"), "tunefield-logo.png",
                               mimetype="image/png")


@app.route("/catalogs", methods=["GET"])
def list_catalogs():
    meta = ensure_default()
    return jsonify([{**m, "count": len(load_cat(m["slug"]))} for m in meta])


@app.route("/catalogs", methods=["POST"])
def create_catalog():
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    meta = ensure_default()
    slug = make_slug(name, {m["slug"] for m in meta})
    meta.append({"name": name, "slug": slug})
    save_meta(meta)
    atomic_json_dump(cat_file(slug), [])
    _COMMITTED_PATHS.pop(slug, None)   # new Field = clean slate, whatever the slug's past
    return jsonify({"name": name, "slug": slug, "count": 0})


@app.route("/catalogs/<slug>", methods=["DELETE"])
def delete_catalog(slug):
    meta = ensure_default()
    m    = next((x for x in meta if x["slug"] == slug), None)
    if not m:
        return jsonify({"error": "Not found"}), 404
    if len(meta) == 1:
        return jsonify({"error": "Cannot delete the only catalog"}), 400
    # Default-safe: keep audio files unless caller explicitly opts in via delete_files=true.
    # delete_files=true is destructive → requires confirm token. Legacy ?keep_files=false is
    # ALSO honoured but now requires the token for parity.
    delete_files = (request.args.get("delete_files", "false").lower() == "true"
                    or request.args.get("keep_files", "true").lower() == "false")
    entries = load_cat(slug)
    skipped_shared = 0
    if delete_files:
        rej = _require_confirm()
        if rej is not None: return rej
        # Never trash audio still referenced by an entry in ANOTHER catalog — the same
        # file can be legitimately cataloged twice (in-place analyse guards per-catalog).
        refs_elsewhere = _paths_referenced_outside(exclude_slug=slug)
        for entry in entries:
            fpath = library_path(entry)
            if fpath and fpath.lower() in refs_elsewhere:
                skipped_shared += 1
                continue
            _safe_remove_audio(fpath, reason="delete_catalog")
    # Covers are per-entry derived data — clean them up like clear_catalog does, so
    # deleting a catalog doesn't leave orphaned thumbnails accumulating forever.
    for entry in entries:
        cp = cover_path(entry.get("id"))
        if cp:
            try: os.unlink(cp)
            except OSError: pass
    # Whole-catalog metadata is never hard-deleted: the JSON moves into a dated trash
    # bucket so months of ratings/tags/analysis survive a slip. Manual recovery only
    # (copy it back + re-register in _meta.json) — no restore UI before the beta.
    path = cat_file(slug)
    if os.path.exists(path):
        bucket = os.path.join(TRASH_DIR, "catalogs", datetime.now().strftime("%Y%m%d"))
        os.makedirs(bucket, exist_ok=True)
        shutil.move(path, os.path.join(bucket, f"{_safe_slug(slug)}.{datetime.now().strftime('%H%M%S')}.json"))
    save_meta([x for x in meta if x["slug"] != slug])
    # A Field deleted and re-created keeps its slug (make_slug only avoids LIVE slugs), so
    # the dedup memory keyed on it must go too — or the new Field refuses every track the
    # old one held, after decoding each in full. Three passes over 46 tracks, ~12 minutes
    # of librosa for nothing, before this line existed (2026-09-02).
    _COMMITTED_PATHS.pop(slug, None)
    return jsonify({"ok": True, "files_trashed": delete_files,
                    "skipped_shared_files": skipped_shared})


@app.route("/catalogs/<slug>", methods=["PATCH"])
def rename_catalog(slug):
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    meta = load_meta()
    m = next((x for x in meta if x["slug"] == slug), None)
    if not m:
        return jsonify({"error": "Not found"}), 404
    m["name"] = name
    save_meta(meta)
    return jsonify({"ok": True, "name": name, "slug": slug})


@app.route("/catalog/<entry_id>/move", methods=["POST"])
def move_entry(entry_id):
    from_slug = request.form.get("from") or req_slug()
    to_slug   = request.form.get("to", "").strip()
    if not to_slug:
        return jsonify({"error": "Target catalog required"}), 400
    # Same-catalog move is a no-op. Without this guard the two save_cat calls below race
    # on the SAME file — the second overwrites the first and the entry is deleted entirely.
    if to_slug == from_slug:
        return jsonify({"ok": True, "noop": True})
    # Target must be a real catalog, or the entry gets stranded in an unlisted file.
    if not any(m["slug"] == to_slug for m in ensure_default()):
        return jsonify({"error": f"Target catalog not found: {to_slug}"}), 404
    from_entries = load_cat(from_slug)
    entry = next((e for e in from_entries if e["id"] == entry_id), None)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404
    to_entries = load_cat(to_slug)
    to_entries.append(entry)
    save_cat(to_slug, to_entries)
    save_cat(from_slug, [e for e in from_entries if e["id"] != entry_id])
    return jsonify({"ok": True})


@app.route("/analyze", methods=["POST"])
def analyze_route():
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f   = request.files["file"]
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED:
        usage_event("analyze_reject", fmt=ext, reason="unsupported extension", src="upload")
        return jsonify({"error": f"Unsupported format: {ext}"}), 400

    slug     = req_slug()
    duration = _scan_duration(request.form.get("duration"), 60)
    if not _scan_duration_ok(duration):
        return jsonify({"error": _SCAN_DURATION_ERR}), 400
    # Reject slugs not registered in _meta.json — save_cat would create an unlisted
    # catalog file whose entries are invisible to every meta-driven route.
    if not any(m["slug"] == slug for m in ensure_default()):
        return jsonify({"error": f"Target catalog not found: {slug}"}), 404
    entry_id = str(uuid.uuid4())
    lib_path = os.path.join(LIBRARY_DIR, entry_id + ext)
    try:
        f.save(lib_path)
    except OSError as e:
        # Disk full / permissions — clean up any partial file and say so plainly
        # instead of a generic 500 with an orphan left behind.
        try: os.unlink(lib_path)
        except OSError: pass
        app.logger.exception("upload save failed")
        return jsonify({"error": "could not save the upload — is the disk full?"}), 507

    try:
        t0 = time.time()
        result = analyze(lib_path, duration_limit=duration, verbose=False)
        # analyze() returns a clean error dict on undecodable/corrupt audio — don't
        # catalog a broken entry; clean up the saved copy and report 422 (bad input,
        # not a server fault).
        if result.get("error"):
            try: os.unlink(lib_path)
            except OSError: pass
            usage_event("analyze_reject", fmt=ext, reason=str(result["error"])[:80],
                        src="upload")
            return jsonify({"error": result["error"]}), 422
        result["original_filename"] = f.filename
        extract_cover(entry_id, lib_path, f.filename)
        entry = {
            "id":            entry_id,
            "filename":      f.filename,
            "analyzed_at":   datetime.now().isoformat(timespec="seconds"),
            "scan_duration": duration,
            "library_file":  store_path(lib_path),
            "genre":         (result.get("metadata", {}) or {}).get("genre", ""),
            "data":          result,
        }
        entries = load_cat(slug)
        entries.append(entry)
        save_cat(slug, entries)
        result["catalog_id"]    = entry_id
        result["has_file"]      = True
        result["has_cover"]     = cover_path(entry_id) is not None
        result["scan_duration"] = duration
        usage_event("analyze", fmt=ext, ms=int((time.time() - t0) * 1000),
                    cover=result["has_cover"], src="upload")
        return jsonify(result)
    except Exception as e:
        try: os.unlink(lib_path)
        except OSError: pass
        # Undecodable audio is already handled above: analyze() returns an error dict for
        # that and we answer 422. Landing HERE means the server broke, not the file — so
        # say so, and name the exception. Reporting our own bugs as "could not be decoded"
        # sent a real investigation after the wrong cause for most of a day.
        app.logger.exception("analyze failed")
        usage_event("error", where="analyze", type=type(e).__name__)
        return jsonify({
            "error": f"internal error during analysis ({type(e).__name__}) — this is a bug, not your file",
            "internal": True,
        }), 500


@app.route("/catalog", methods=["GET"])
def get_catalog():
    slug    = req_slug()
    entries = load_cat(slug)
    for e in entries:
        p = library_path(e)
        e["has_file"]  = bool(p)
        e["has_cover"] = bool(cover_path(e["id"]))
        if "genre" not in e:
            e["genre"] = (e.get("data", {}).get("metadata", {}) or {}).get("genre", "")
        # File creation date — fallback for the 'Released' metric when the audio carries
        # no year tag. st_birthtime is the true creation time on macOS/BSD; mtime elsewhere.
        if p:
            try:
                st = os.stat(p)
                ts = getattr(st, "st_birthtime", None) or st.st_mtime
                e["file_created"] = datetime.fromtimestamp(ts).isoformat(timespec="seconds")
            except OSError:
                pass
    return jsonify(entries)


@app.route("/catalog/<entry_id>/rescan", methods=["POST"])
def rescan_entry(entry_id):
    slug     = req_slug()
    duration = _scan_duration(request.form.get("duration"), 120)
    if not _scan_duration_ok(duration):
        return jsonify({"error": _SCAN_DURATION_ERR}), 400
    entries  = load_cat(slug)
    entry    = next((e for e in entries if e["id"] == entry_id), None)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404
    fpath = library_path(entry)
    if not fpath:
        return jsonify({"error": "Original file not in library — re-upload to rescan"}), 404
    fmt = os.path.splitext(fpath)[1].lower()
    try:
        t0 = time.time()
        result = analyze(fpath, duration_limit=duration, verbose=False)
        if result.get("error"):
            # Keep the existing (good) entry data; report the rescan failure as 422.
            usage_event("analyze_reject", fmt=fmt, reason=str(result["error"])[:80],
                        src="rescan")
            return jsonify({"error": result["error"]}), 422
        result["original_filename"] = entry["filename"]
        extract_cover(entry_id, fpath, entry.get("filename"))
        entry["data"]          = result
        entry["analyzed_at"]   = datetime.now().isoformat(timespec="seconds")
        entry["scan_duration"] = duration
        save_cat(slug, entries)
        result["catalog_id"]    = entry_id
        result["has_file"]      = True
        result["has_cover"]     = cover_path(entry_id) is not None
        result["scan_duration"] = duration
        usage_event("analyze", fmt=fmt, ms=int((time.time() - t0) * 1000),
                    cover=result["has_cover"], src="rescan")
        return jsonify(result)
    except Exception as e:
        usage_event("analyze_reject", fmt=fmt,
                    reason=(str(e) or type(e).__name__)[:80], src="rescan")
        return jsonify({"error": str(e) or "rescan failed"}), 422


@app.route("/catalog", methods=["DELETE"])
def clear_catalog():
    slug       = req_slug()
    # Default-safe: keep audio. delete_files=true (or legacy keep_files=false) requires
    # the confirm token. Covers always get cleaned because they're cheap to re-extract.
    delete_files = (request.args.get("delete_files", "false").lower() == "true"
                    or request.args.get("keep_files", "true").lower() == "false")
    entries    = load_cat(slug)
    skipped_shared = 0
    if delete_files:
        rej = _require_confirm()
        if rej is not None: return rej
        # Skip audio still referenced from another catalog (see _paths_referenced_outside)
        refs_elsewhere = _paths_referenced_outside(exclude_slug=slug)
        for entry in entries:
            fpath = library_path(entry)
            if fpath and fpath.lower() in refs_elsewhere:
                skipped_shared += 1
                continue
            _safe_remove_audio(fpath, reason="clear_catalog")
    for entry in entries:
        cp = cover_path(entry["id"])
        if cp:
            try: os.unlink(cp)
            except OSError: pass
    snap = _snapshot_entries_trash("clear-catalog", {slug: entries})
    save_cat(slug, [])
    return jsonify({"ok": True, "deleted": len(entries), "files_trashed": delete_files,
                    "skipped_shared_files": skipped_shared,
                    "undoable": bool(snap), "snapshot": snap})


@app.route("/catalog/<entry_id>", methods=["DELETE"])
def delete_catalog_entry(entry_id):
    # If ?cat= is given use it; otherwise locate the entry across all catalogs so dedup
    # can delete entries without knowing which catalog they live in.
    raw_cat = (request.values.get("cat") or "").strip()
    slug = raw_cat if raw_cat else None
    if not slug:
        _e, found_slug = find_entry_anywhere(entry_id)
        slug = found_slug or ensure_default()[0]["slug"]
    entries = load_cat(slug)
    entry   = next((e for e in entries if e["id"] == entry_id), None)
    if not entry:
        # Nothing matched — say so (404) instead of a misleading {"ok": true}. A no-op
        # rewrite of the catalog is also avoided.
        return jsonify({"error": "Entry not found", "slug": slug}), 404
    # Default-safe: keep audio. delete_file=true (or legacy keep_file=false) requires
    # confirm token. Cover always removed (cheap to re-extract).
    delete_file = (request.args.get("delete_file", "false").lower() == "true"
                   or request.args.get("keep_file", "true").lower() == "false")
    file_trashed = False
    if delete_file:
        rej = _require_confirm()
        if rej is not None: return rej
        fpath = library_path(entry)
        # Skip if any OTHER entry (any catalog) still references this audio file.
        if fpath and fpath.lower() in _paths_referenced_outside(exclude_ids={entry_id}):
            delete_file = False   # report accurately below
        else:
            file_trashed = _safe_remove_audio(fpath, reason="delete_entry")
    cp = cover_path(entry_id)
    if cp:
        try: os.unlink(cp)
        except OSError: pass
    snap = _snapshot_entries_trash("delete-entry", {slug: [entry]})
    save_cat(slug, [e for e in entries if e["id"] != entry_id])
    return jsonify({"ok": True, "slug": slug, "file_trashed": file_trashed,
                    "undoable": bool(snap), "snapshot": snap})


# ── Formats WebKit cannot play over HTTP ─────────────────────────────────────────
# AVFoundation (WebKit's media engine on macOS, i.e. the packaged app's window) decodes
# FLAC and Ogg from a local file but its HTTP loader only accepts them inside MP4: a
# native .flac URL fails with AVFoundationErrorDomain -11828 "Cannot Open" while curl,
# afinfo and Chrome all say the file is fine (Mark, 2026-09-02: eleven of twenty-three
# tracks in a new Field "won't play", toast "the file didn't load"). For WebKit clients
# these are decoded once with libsndfile (bundled for analysis anyway) into a PCM WAV kept
# under data/_stream_cache, and THAT streams — same bit depth, same sample rate. Other
# browsers get the original file. The cache is LRU by access time, capped at
# STREAM_CACHE_CAP; it lives under data/ so "start over" removes it with everything else.
STREAM_PCM_EXTS  = {".flac", ".ogg", ".oga", ".opus"}
STREAM_CACHE_DIR = os.path.join(DATA_DIR, "_stream_cache")
STREAM_CACHE_CAP = 4 * 1024 ** 3
_STREAM_LOCKS, _STREAM_LOCKS_GUARD = {}, threading.Lock()

def _ua_streams_pcm(ua):
    """True for WebKit media loaders. The media element's own requests arrive as
    AppleCoreMedia/…, not as the page's user agent; the page UA is checked too for
    HEAD probes and downloads. Chromium-based browsers also say AppleWebKit, hence the
    exclusion list."""
    ua = ua or ""
    if "AppleCoreMedia" in ua:
        return True
    return "AppleWebKit" in ua and not any(b in ua for b in ("Chrome", "Chromium", "Firefox", "Edg", "OPR"))

def _stream_cache_trim():
    try:
        files = [(os.path.join(STREAM_CACHE_DIR, f), os.stat(os.path.join(STREAM_CACHE_DIR, f)))
                 for f in os.listdir(STREAM_CACHE_DIR) if f.endswith((".wav", ".tmp"))]
    except OSError:
        return
    # Sweep stale temp files first — a hard exit (window closed mid-decode: _window_mode uses
    # os._exit) skips the except-handler above, so nothing else would ever remove them.
    now = time.time()
    keep = []
    for path, st in files:
        if path.endswith(".tmp") and now - st.st_mtime > 300:
            try: os.remove(path); continue
            except OSError: pass
        keep.append((path, st))
    files = [(p, st) for p, st in keep if p.endswith(".wav")]
    total = sum(st.st_size for _, st in files)
    for path, st in sorted(files, key=lambda x: x[1].st_atime):
        if total <= STREAM_CACHE_CAP:
            break
        try:
            os.remove(path); total -= st.st_size
        except OSError:
            pass

def _stream_pcm_path(entry_id, fpath):
    """Path of the PCM WAV for this file, decoding it on first use. Keyed on the source
    mtime + size, so a replaced file gets a fresh decode. One decode per file at a time."""
    st = os.stat(fpath)
    name = f"{_safe_slug(entry_id)}-{int(st.st_mtime)}-{st.st_size}.wav"
    out = os.path.join(STREAM_CACHE_DIR, name)
    if os.path.exists(out):
        try: os.utime(out, (time.time(), os.stat(out).st_mtime))   # bump atime for the LRU, keep mtime
        except OSError: pass
        return out
    with _STREAM_LOCKS_GUARD:
        lock = _STREAM_LOCKS.setdefault(name, threading.Lock())
    with lock:
        if os.path.exists(out):
            return out
        import soundfile as sf
        os.makedirs(STREAM_CACHE_DIR, exist_ok=True)
        info = sf.info(fpath)
        subtype = info.subtype if info.subtype in ("PCM_16", "PCM_24", "PCM_32") else "PCM_16"
        # Lossy sources (VORBIS / OPUS / MPEG) decode to floats that routinely exceed ±1.0 on
        # hot masters. Reading them as int16 makes libsndfile WRAP each over to the opposite
        # rail — audible crackle on exactly the loudest tracks. Read float and let the write
        # side clip instead, which saturates cleanly (review, 2026-09-17).
        lossless = info.subtype in ("PCM_16", "PCM_24", "PCM_32", "PCM_S8", "PCM_U8")
        dtype = ("int16" if subtype == "PCM_16" else "int32") if lossless else "float32"
        tmp = out + ".tmp"
        try:
            with sf.SoundFile(fpath) as src, \
                 sf.SoundFile(tmp, "w", samplerate=src.samplerate, channels=src.channels,
                              subtype=subtype, format="WAV") as dst:
                for block in src.blocks(blocksize=1 << 16, dtype=dtype):
                    dst.write(block)
            os.replace(tmp, out)
        except BaseException:
            # A decode error, a full disk, a drive pulled mid-read — the partial .tmp must not
            # be left behind: the LRU trim only ever counted and deleted *.wav, so the debris
            # sat in the cache forever and outside the 4 GB cap.
            try: os.remove(tmp)
            except OSError: pass
            raise
    _stream_cache_trim()
    return out

@app.route("/catalog/<entry_id>/stream")
def stream_entry(entry_id):
    # Search specified catalog first, then all catalogs
    entry, _ = find_entry_anywhere(entry_id)
    if not entry:
        return jsonify({"error": "Not found"}), 404
    fpath = library_path(entry)
    if not fpath:
        return jsonify({"error": "File not in library"}), 404
    ext = os.path.splitext(fpath)[1].lower()
    if ext in STREAM_PCM_EXTS and (request.args.get("pcm") == "1"
                                   or _ua_streams_pcm(request.headers.get("User-Agent"))):
        try:
            pcm = _stream_pcm_path(entry_id, fpath)
            return send_from_directory(os.path.dirname(pcm), os.path.basename(pcm),
                                       conditional=True, mimetype="audio/wav")
        except Exception as e:
            app.logger.warning("stream: PCM fallback failed for %s (%s) — serving the original", entry_id, e)
    return send_from_directory(os.path.dirname(fpath), os.path.basename(fpath), conditional=True)


@app.route("/tracks/resolve", methods=["POST"])
def tracks_resolve():
    """Bulk id → light metadata across ALL catalogs (read-only). Post-consolidation,
    playlists are cross-catalog by design: the UI calls this to name playlist tracks
    that live outside the active catalog instead of showing "(missing track)"."""
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        return jsonify({"error": "ids must be a list of strings"}), 400
    want = set(ids[:500])
    found = {}
    for m in ensure_default():
        if not want:
            break
        for e in load_cat(m["slug"]):
            if e["id"] in want:
                d = e.get("data") or {}
                md = d.get("metadata") or {}
                found[e["id"]] = {
                    "filename": e.get("filename"),
                    "original_filename": d.get("original_filename"),
                    # Tags, not filename parses — cross-catalog playlist export rows
                    # are built from this projection, and without these every such
                    # row falls back to the filename and loses the real artist/title.
                    "artist": md.get("artist"),
                    "title": md.get("title"),
                    "bpm": (d.get("rhythm") or {}).get("bpm"),
                    "root": (d.get("harmony") or {}).get("root"),
                    "mode": (d.get("harmony") or {}).get("mode"),
                    "key": (d.get("harmony") or {}).get("key"),
                    "duration_sec": md.get("duration_sec"),
                    # Export support: playlist exports resolve cross-catalog tracks
                    # through here, so include the file path + encode metadata.
                    "library_file": e.get("library_file"),
                    "genre": e.get("genre"),
                    "codec": md.get("codec"),
                    "bitrate_kbps": md.get("bitrate_kbps"),
                    "sample_rate_hz": md.get("sample_rate_hz"),
                    "catalog": m["slug"],
                    "catalog_name": m.get("name", m["slug"]),
                }
                want.discard(e["id"])
    return jsonify({"found": found, "missing": sorted(want)})


@app.route("/catalog/<entry_id>/cover")
def cover_entry(entry_id):
    cp = cover_path(entry_id)
    if not cp:
        return ("", 404)
    return send_from_directory(COVERS_DIR, os.path.basename(cp), conditional=True, mimetype="image/jpeg")


@app.route("/catalog/extract-covers", methods=["POST"])
def batch_extract_covers():
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    slug = req_slug()
    body = request.get_json(silent=True) or {}
    ids  = set(body.get("ids")) if isinstance(body.get("ids"), list) else None
    entries = load_cat(slug)
    if ids is not None:
        entries = [e for e in entries if e["id"] in ids]   # UI sends chunks for live progress
    extracted = 0
    skipped   = 0
    failed    = 0
    for e in entries:
        if cover_path(e["id"]):
            skipped += 1
            continue
        fpath = library_path(e)
        if not fpath:
            failed += 1
            continue
        if extract_cover(e["id"], fpath, e.get("filename")):
            extracted += 1
        else:
            failed += 1
    usage_event("repair", op="extract-covers", changed=extracted)
    return jsonify({"ok": True, "extracted": extracted, "skipped": skipped, "failed": failed, "total": len(entries)})


@app.route("/catalog/<entry_id>", methods=["PATCH"])
def patch_entry(entry_id):
    """Patch user-editable fields on an entry. Currently: genre."""
    body  = request.json or {}
    entry, slug = find_entry_anywhere(entry_id)
    if not entry:
        return jsonify({"error": "Not found"}), 404
    entries = load_cat(slug)
    target  = next((e for e in entries if e["id"] == entry_id), None)
    if not target:
        return jsonify({"error": "Not found"}), 404
    if "genre" in body:
        target["genre"] = (body.get("genre") or "").strip()
    save_cat(slug, entries)
    return jsonify({"ok": True, "entry": target})


@app.route("/catalog/extract-genres", methods=["POST"])
def batch_extract_genres():
    """Re-read embedded genre tags via ffprobe and write to entry.genre if currently empty."""
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    slug = req_slug()
    body = request.get_json(silent=True) or {}
    ids  = set(body.get("ids")) if isinstance(body.get("ids"), list) else None
    # Lock discipline: exempt from the request-wide lock (ffprobe runs per track, minutes
    # on a big library, and would freeze every other write). Snapshot the work list under
    # the lock, probe unlocked, then commit once against FRESH state under the lock.
    # ids: optional chunk from the UI so the progress bar can move per batch.
    with _FS_LOCK:
        entries = load_cat(slug)
        total = len(entries)
        todo  = [(e["id"], library_path(e)) for e in entries
                 if not e.get("genre") and (ids is None or e["id"] in ids)]
    skipped = total - len(todo)
    failed  = 0
    found   = {}
    from analyze import get_metadata
    for eid, fpath in todo:
        if not fpath:
            failed += 1
            continue
        try:
            md = get_metadata(fpath)
            g  = (md or {}).get("genre", "").strip()
            if g:
                found[eid] = g
            else:
                skipped += 1
        except Exception:
            failed += 1
    updated = 0
    with _FS_LOCK:
        entries = load_cat(slug)
        for e in entries:
            g = found.get(e["id"])
            if g and not e.get("genre"):
                e["genre"] = g
                updated += 1
        if updated:
            save_cat(slug, entries)
    usage_event("repair", op="extract-genres", changed=updated)
    return jsonify({"ok": True, "updated": updated, "skipped": skipped, "failed": failed, "total": total})


@app.route("/catalog/extract-metadata", methods=["POST"])
def batch_extract_metadata():
    """Re-read embedded ID3-style tags (artist/title/album/year) via ffprobe and fill in
    any blank fields on every catalog entry. Fast — no librosa, just metadata."""
    if not _same_origin_ok():
        return jsonify({"error": "cross-origin request refused"}), 403
    from analyze import get_metadata
    body = request.get_json(silent=True) or {}
    cats = body.get("cats")  # optional list of slugs; defaults to all
    ids  = set(body.get("ids")) if isinstance(body.get("ids"), list) else None
    target_meta = [m for m in ensure_default() if not cats or m["slug"] in cats]
    # Lock discipline: exempt from the request-wide lock (ffprobe per entry). Snapshot the
    # work under the lock, probe unlocked, commit per catalog against fresh state.
    # ONLY entries that actually need a backfill are probed: an explicit ids list (the
    # Repair UI sends its issue rows in chunks for live progress), else any entry with a
    # blank artist/title/album/year. The old behaviour — one ffprobe subprocess for EVERY
    # entry in EVERY catalog — took tens of minutes on a big library with no feedback.
    def _needs(e):
        cur = (e.get("data", {}) or {}).get("metadata", {}) or {}
        return not all(cur.get(k) for k in ("artist", "title", "album", "year"))
    with _FS_LOCK:
        work = {}
        for m in target_meta:
            items = [(e["id"], library_path(e)) for e in load_cat(m["slug"])
                     if (e["id"] in ids if ids is not None else _needs(e))]
            if items:
                work[m["slug"]] = items
    updated = 0
    skipped = 0
    failed  = 0
    probed  = {}   # slug -> {entry_id: md}
    for slug, items in work.items():
        probed[slug] = {}
        for eid, fpath in items:
            if not fpath:
                failed += 1
                continue
            try:
                probed[slug][eid] = get_metadata(fpath)
            except Exception:
                failed += 1
    with _FS_LOCK:
        for slug, by_id in probed.items():
            entries = load_cat(slug)
            changed = False
            for e in entries:
                md = by_id.get(e["id"])
                if md is None:
                    continue
                cur = (e.get("data", {}) or {}).get("metadata", {}) or {}
                wrote = False
                for k in ("artist", "title", "album", "year"):
                    if not cur.get(k) and md.get(k):
                        cur[k] = md[k]; wrote = True
                if wrote:
                    e.setdefault("data", {}).setdefault("metadata", {}).update(cur)
                    updated += 1; changed = True
                else:
                    skipped += 1
            if changed:
                save_cat(slug, entries)
    usage_event("repair", op="extract-metadata", changed=updated)
    return jsonify({"ok": True, "updated": updated, "skipped": skipped, "failed": failed})


# ── Repair / Library Health ────────────────────────────────────────
REPAIR_IGNORED_FILE = os.path.join(DATA_DIR, "repair_ignored.json")

def repair_ignored_load():
    """Returns {category_key: set(entry_ids)} of issues the user has chosen to suppress."""
    if not os.path.exists(REPAIR_IGNORED_FILE): return {}
    try:
        with open(REPAIR_IGNORED_FILE) as f:
            raw = json.load(f)
        return {k: set(v or []) for k, v in (raw or {}).items()}
    except Exception:
        return {}

def repair_ignored_save(state):
    serial = {k: sorted(list(v)) for k, v in state.items() if v}
    atomic_json_dump(REPAIR_IGNORED_FILE, serial)



def _normalize_for_compare(s):
    """Canonicalise an artist/title string for filename↔tag comparison.

    Two strings are 'equivalent' for our purposes when they only differ in
    cosmetic punctuation that the filename sanitiser already strips:
      • multi-artist separators '/', ',', '&' all treated as the same break
      • quote-mark variants (straight, curly, single, double) ignored
      • trailing '?' ignored (some tag editors append it)
      • whitespace collapsed; case folded
    """
    if not isinstance(s, str): return ""
    out = s.lower().strip()
    out = re.sub(r'\s*[/,&]\s*', ' ', out)                     # collapse "A / B / C" → "A B C"
    out = re.sub(r'["“”‘’\']', '', out)    # strip all quote variants
    out = re.sub(r'\s*\?\s*$', '', out)                        # trailing question mark
    # Strip all whitespace — handles cases where the filename sanitiser dropped a '/' and
    # ran two artist names together ("A/B" → "AB" vs tag "A B"). Catches the joined-words
    # cases at the cost of being maximally lenient.
    out = re.sub(r'\s+', '', out)
    return out

def _parse_artist_title(filename):
    base = os.path.splitext(filename or "")[0]
    if " - " in base:
        a, t = base.split(" - ", 1)
        return a.strip(), t.strip()
    return "", base.strip()


def scan_health(slugs=None):
    """Walk catalogs and surface issues. Returns dict keyed by issue type.
    slugs: optional iterable of catalog slugs — confines the scan to that selection
    (the Repair tab passes its chip selection so unselected libraries are never
    walked or stat'd)."""
    meta = ensure_default()
    if slugs is not None:
        want = {s for s in slugs if s}
        meta = [m for m in meta if m["slug"] in want]
    issues = {
        "broken_paths":          [],   # entries whose library_file is missing on disk
        "missing_artist_title":  [],   # entry's metadata has no artist/title (ID3 not yet extracted, or absent)
        "missing_cover":         [],
        "missing_genre":         [],
        "missing_loudness":      [],
        "filename_tag_mismatch": [],
        "failed_analysis":   [],   # bpm=0 / duration=0
        "duplicate_files":   [],   # same library_file in 2+ entries
        "duplicate_titles":  [],   # same artist+title in 2+ entries
        "unknown_key":       [],
    }
    seen_paths = {}
    seen_titles = {}
    total_entries = 0  # accumulate during main pass so the summary doesn't re-read every catalog
    # Foreground courtesy (Mark, 2026-08-28): with ?fg=1 (the client sends it while the
    # user is on the Field or List tab) the walk yields briefly every 200 entries, so a
    # 24k-entry health scan hums along behind a live canvas instead of monopolising the
    # disk and a server thread while the user is looking at something else.
    _fg = request.args.get("fg") == "1"
    for m in meta:
        slug = m["slug"]
        for e in load_cat(slug):
            total_entries += 1
            if _fg and total_entries % 200 == 0:
                time.sleep(0.002)
            # Per-entry guard: one malformed entry (e.g. hand-edited, missing "id") must
            # not take down the entire /repair/health response for every catalog.
            try:
                eid = e.get("id")
                if not eid:
                    continue
                row = {
                    "id":       eid,
                    "slug":     slug,
                    "catalog":  m["name"],
                    "filename": e.get("filename", ""),
                }
                fpath = library_path(e)
                if not fpath:
                    issues["broken_paths"].append({**row, "library_file": e.get("library_file", "")})
                    continue
                if not cover_path(eid):
                    issues["missing_cover"].append(row)
                if not (e.get("genre") or "").strip():
                    issues["missing_genre"].append(row)
                d = e.get("data", {}) or {}
                en = d.get("energy", {}) or {}
                if en.get("loudness_lufs") in (None, 0):
                    issues["missing_loudness"].append(row)
                r = d.get("rhythm", {}) or {}
                md = d.get("metadata", {}) or {}
                if not (md.get("artist") or "").strip() and not (md.get("title") or "").strip():
                    issues["missing_artist_title"].append(row)
                if not r.get("bpm") or not md.get("duration_sec"):
                    issues["failed_analysis"].append(row)
                h = d.get("harmony", {}) or {}
                root = h.get("root", "")
                if root and root not in ("C","C#","D","D#","E","F","F#","G","G#","A","A#","B","unknown"):
                    issues["unknown_key"].append({**row, "root": root})
                # Filename vs tag mismatch (use parseTrack-like split)
                tag_artist = (md.get("artist") or "").strip()
                tag_title  = (md.get("title")  or "").strip()
                fn_artist, fn_title = _parse_artist_title(e.get("filename", ""))
                # Compare against what the rename repair would actually WRITE — the
                # sanitised, 120-char-capped canonical — not the raw tag. Raw tags can
                # carry characters and lengths no filename ever will, so a raw
                # comparison flags the sanitiser's own output as mismatched forever,
                # with the repair unable to clear it.
                fn_ext = os.path.splitext(e.get("filename", ""))[1]
                cmp_artist, cmp_title = _parse_artist_title(
                    _build_canonical_filename(tag_artist, tag_title, fn_ext))
                if (cmp_artist and fn_artist and _normalize_for_compare(cmp_artist) != _normalize_for_compare(fn_artist)) \
                  or (cmp_title  and fn_title  and _normalize_for_compare(cmp_title)  != _normalize_for_compare(fn_title)):
                    issues["filename_tag_mismatch"].append({
                        **row,
                        "filename_artist": fn_artist, "filename_title": fn_title,
                        "tag_artist": tag_artist,    "tag_title": tag_title,
                    })
                # Dupes
                key_path = absolute_form(e.get("library_file","")).lower()
                if key_path:
                    seen_paths.setdefault(key_path, []).append(row)
                # Prefer real ID3 tags for the title-dup key; fall back to filename parse
                # only when tags are absent (a stronger signal for a delete-triggering heuristic).
                dup_artist = (tag_artist or fn_artist).lower()
                dup_title  = (tag_title  or fn_title).lower()
                tkey = (dup_artist, dup_title)
                if tkey != ("",""):
                    seen_titles.setdefault(tkey, []).append(row)
            except Exception:
                # Skip the malformed entry; the rest of the scan proceeds.
                continue
    issues["duplicate_files"]  = [g for g in seen_paths.values()  if len(g) > 1]
    issues["duplicate_titles"] = [g for g in seen_titles.values() if len(g) > 1]

    # Apply per-category ignore list. Flat categories drop by id. Grouped categories
    # (duplicate_*) drop ids from each group and then re-drop groups that fall under 2.
    ignored = repair_ignored_load()
    for k, ids in ignored.items():
        if k not in issues: continue
        if k in ("duplicate_files", "duplicate_titles"):
            issues[k] = [[r for r in g if r["id"] not in ids] for g in issues[k]]
            issues[k] = [g for g in issues[k] if len(g) > 1]
        else:
            issues[k] = [r for r in issues[k] if r["id"] not in ids]

    summary = {k: (len(v) if k not in ("duplicate_files","duplicate_titles") else sum(len(g) for g in v)) for k, v in issues.items()}
    summary["duplicate_groups_files"]  = len(issues["duplicate_files"])
    summary["duplicate_groups_titles"] = len(issues["duplicate_titles"])
    summary["total_entries"] = total_entries
    summary["ignored_total"] = sum(len(v) for v in ignored.values())
    return {"summary": summary, "issues": issues, "ignored": {k: sorted(list(v)) for k, v in ignored.items() if v}}


@app.route("/repair/health", methods=["GET"])
def repair_health():
    # ?slugs=a,b,c confines the scan to those catalogs (Repair chip selection).
    raw = request.args.get("slugs")
    slugs = [s.strip() for s in raw.split(",") if s.strip()] if raw is not None else None
    out = scan_health(slugs)
    out["scanned_slugs"] = sorted(slugs) if slugs is not None else None
    return jsonify(out)

@app.route("/repair/ignore", methods=["POST"])
def repair_ignore():
    """Mark issues as ignored. Body: {category, ids: [...]}. ids may include current
    visible entries or 'all' to grab every flagged id in that category right now."""
    body = request.get_json(silent=True) or {}
    category = body.get("category")
    ids_in   = body.get("ids") or []
    if not category: return jsonify({"error": "category required"}), 400
    state = repair_ignored_load()
    cur   = state.get(category, set())
    if ids_in == "all":
        snap = scan_health()["issues"].get(category, [])
        if category in ("duplicate_files", "duplicate_titles"):
            for g in snap:
                for r in g: cur.add(r["id"])
        else:
            for r in snap: cur.add(r["id"])
    else:
        for i in ids_in:
            cur.add(i)
    state[category] = cur
    repair_ignored_save(state)
    return jsonify({"ok": True, "ignored_count": len(cur)})

@app.route("/repair/unignore", methods=["POST"])
def repair_unignore():
    """Body: {category, ids: [...]}.  ids may be the literal 'all' to clear the whole
    category, or '*' to clear every category."""
    body = request.get_json(silent=True) or {}
    category = body.get("category")
    ids_in   = body.get("ids") or []
    state = repair_ignored_load()
    if category == "*":
        state = {}
    elif category and ids_in == "all":
        state.pop(category, None)
    elif category:
        cur = state.get(category, set())
        for i in ids_in: cur.discard(i)
        if cur: state[category] = cur
        else:   state.pop(category, None)
    repair_ignored_save(state)
    return jsonify({"ok": True})

@app.route("/repair/ignored", methods=["GET"])
def repair_ignored_list():
    state = repair_ignored_load()
    return jsonify({k: sorted(list(v)) for k, v in state.items() if v})


@app.route("/repair/delete-orphans", methods=["POST"])
def repair_delete_orphans():
    """Delete entries whose library_file is missing on disk. Returns count per catalog.
    Requires confirm token — even though the audio is already gone, the catalog entries
    (with their analysis data, tags, ratings) are still useful and should not be removed
    by a malicious cross-origin request."""
    rej = _require_confirm()
    if rej is not None: return rej
    # Refuse if a configured library root is currently unreachable (unmounted USB / NAS).
    # resolve_path can't tell "file deleted" from "drive not mounted", so without this a
    # run with the drive absent would permanently delete every entry on that volume — and
    # catalog-metadata deletion has no trash/undo. `force=true` overrides (still token-gated).
    force = request.args.get("force", "false").lower() == "true"
    purge_unreachable = request.args.get("purge_unreachable", "false").lower() == "true"
    roots = get_library_roots()
    missing_roots = [r for r in roots if not os.path.isdir(r)]
    if missing_roots and not force:
        return jsonify({
            "error": "Some library folders are unreachable (unmounted drive?). "
                     "Reconnect them, or pass force=true to delete anyway.",
            "missing_roots": missing_roots,
        }), 409
    def _looks_unreachable(stored):
        """Heuristic: distinguish 'file was deleted' from 'whole volume is absent'.
        Walk up from the stored absolute path to the first EXISTING ancestor; if that
        ancestor is the filesystem root or a mount container (/Volumes, /media, /mnt,
        /run/media), the file's entire volume is gone — almost certainly an unplugged
        drive whose root was since removed from config (so the configured-roots check
        above didn't catch it). Treat as unreachable, not deleted."""
        try:
            p = absolute_form(stored)
        except Exception:
            return False
        anc = os.path.dirname(p)
        while anc and not os.path.isdir(anc):
            parent = os.path.dirname(anc)
            if parent == anc:
                break
            anc = parent
        return anc in ("/", os.path.sep, "/Volumes", "/media", "/mnt", "/run/media") \
            or re.match(r"^[A-Za-z]:\\?$", anc or "") is not None

    # Optional scoping: {slugs:[...]} limits the sweep to those catalogs. The Repair tab
    # is scoped to selected libraries and its confirm dialog shows the SCOPED count —
    # without this parameter the endpoint would silently delete orphans in every catalog.
    body_slugs = (request.get_json(silent=True) or {}).get("slugs")
    meta = ensure_default()
    if isinstance(body_slugs, list) and body_slugs:
        wanted = {s for s in body_slugs if isinstance(s, str)}
        meta = [m for m in meta if m["slug"] in wanted]
    total = 0
    skipped_unreachable = 0
    per_cat = {}
    removed_by_slug = {}
    for m in meta:
        slug = m["slug"]
        entries = load_cat(slug)
        keep = []
        dropped = []
        for e in entries:
            if library_path(e):
                keep.append(e)
            elif not purge_unreachable and _looks_unreachable(e.get("library_file") or ""):
                # Entry lives on an absent volume — keep it. `force=true` only bypasses
                # the whole-run 409 gate above (so genuinely-deleted files still get
                # cleaned while a drive is unplugged); purging absent-volume entries too
                # requires the explicit purge_unreachable=true.
                keep.append(e)
                skipped_unreachable += 1
            else:
                # NOTE: the cover file is deliberately KEPT — the removal is undoable via
                # the entries trash, and a restored entry wants its artwork back.
                dropped.append(e)
        if dropped:
            removed_by_slug[slug] = dropped
            save_cat(slug, keep)
            per_cat[m["name"]] = len(dropped)
            total += len(dropped)
    snap = _snapshot_entries_trash("delete-orphans", removed_by_slug)
    usage_event("repair", op="delete-orphans", changed=total)
    return jsonify({"ok": True, "deleted": total, "per_catalog": per_cat,
                    "skipped_unreachable": skipped_unreachable,
                    "undoable": bool(snap), "snapshot": snap})


# ── Entries trash: undo for destructive Repair operations ──────────────────────
# delete-orphans and dedup-apply used to destroy catalog entries (analysis, ratings,
# tags, genre edits) with NO undo — flagged as the beta's #1 data-safety risk. Every
# such operation now snapshots the removed entries here first; one endpoint restores
# the most recent snapshot. Mirrors the playlists' _trash convention.
ENTRIES_TRASH_DIR = os.path.join(DATA_DIR, "_trash", "entries")
ENTRIES_TRASH_KEEP = 20

def _snapshot_entries_trash(reason, removed_by_slug):
    """removed_by_slug: {slug: [full entry dicts]}. Returns snapshot filename or None."""
    if not any(removed_by_slug.values()):
        return None
    os.makedirs(ENTRIES_TRASH_DIR, exist_ok=True)
    # Uniquify on same-second collisions (rapid bulk deletes) — a "-2" suffix keeps the
    # lexicographic ordering the pruner and undo (newest = last) rely on.
    base = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{reason}"
    name, n = f"{base}.json", 1
    while os.path.exists(os.path.join(ENTRIES_TRASH_DIR, name)):
        n += 1
        name = f"{base}-{n}.json"
    atomic_json_dump(os.path.join(ENTRIES_TRASH_DIR, name), {
        "at": datetime.now().isoformat(timespec="seconds"),
        "reason": reason,
        "catalogs": removed_by_slug,
    })
    # prune to the newest ENTRIES_TRASH_KEEP
    try:
        snaps = sorted(f for f in os.listdir(ENTRIES_TRASH_DIR) if f.endswith(".json"))
        for old in snaps[:-ENTRIES_TRASH_KEEP]:
            os.unlink(os.path.join(ENTRIES_TRASH_DIR, old))
    except OSError:
        pass
    return name

@app.route("/repair/undo-entries", methods=["POST"])
def repair_undo_entries():
    """Restore the MOST RECENT entries-trash snapshot: re-append every entry whose id
    is no longer present in its catalog, then delete the snapshot. Safe to call when
    nothing exists (404)."""
    try:
        snaps = sorted(f for f in os.listdir(ENTRIES_TRASH_DIR) if f.endswith(".json"))
    except FileNotFoundError:
        snaps = []
    if not snaps:
        return jsonify({"error": "nothing to undo"}), 404
    path = os.path.join(ENTRIES_TRASH_DIR, snaps[-1])
    try:
        with open(path) as f:
            snap = json.load(f)
    except (OSError, json.JSONDecodeError):
        return jsonify({"error": "snapshot unreadable"}), 500
    restored = 0
    known_slugs = {m["slug"] for m in ensure_default()}
    for slug, entries in (snap.get("catalogs") or {}).items():
        if slug not in known_slugs:
            continue                       # catalog itself was deleted since — skip
        cur = load_cat(slug)
        have = {e["id"] for e in cur}
        add = [e for e in entries if e.get("id") and e["id"] not in have]
        if add:
            save_cat(slug, cur + add)
            restored += len(add)
    try: os.unlink(path)
    except OSError: pass
    return jsonify({"ok": True, "restored": restored, "reason": snap.get("reason", "")})


@app.route("/repair/relink/<entry_id>", methods=["POST"])
def repair_relink(entry_id):
    """Update entry.library_file to a new path. Body: {path: '...'}"""
    body = request.json or {}
    new_path = (body.get("path") or "").strip()
    if not new_path or not os.path.exists(new_path):
        return jsonify({"error": "Path does not exist"}), 400
    abs_new = os.path.abspath(new_path)
    # Confine the target: it must be an audio file under a configured library root or under
    # data/library. Otherwise relink + /stream would be an arbitrary-file-read primitive
    # (point an entry at /etc/passwd, then stream it).
    if os.path.splitext(abs_new)[1].lower() not in ALLOWED:
        return jsonify({"error": "Target must be an audio file"}), 400
    if not _path_within_library(abs_new):
        return jsonify({"error": "Target must be inside a configured library folder"}), 400
    entry, slug = find_entry_anywhere(entry_id)
    if not entry:
        return jsonify({"error": "Not found"}), 404
    entries = load_cat(slug)
    target = next((e for e in entries if e["id"] == entry_id), None)
    if not target:
        return jsonify({"error": "Not found"}), 404
    target["library_file"] = store_path(new_path)
    save_cat(slug, entries)
    return jsonify({"ok": True, "entry": target})


def _discogs_search(token, artist, title):
    """Search Discogs for releases matching artist+title. Returns list of suggestion dicts."""
    import urllib.request, urllib.parse
    if not token: return None
    q = (artist + " " + title).strip()
    if not q: return []
    url = "https://api.discogs.com/database/search?" + urllib.parse.urlencode({
        "q": q, "type": "release", "per_page": 5,
    })
    req = urllib.request.Request(url, headers={
        "Authorization": f"Discogs token={token}",
        "User-Agent": "Tunefield/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}
    out = []
    for r in (data.get("results") or [])[:5]:
        title_full = r.get("title", "")  # "Artist - Title"
        a, t = (title_full.split(" - ", 1) + [""])[:2] if " - " in title_full else ("", title_full)
        genres = r.get("genre") or []
        styles = r.get("style") or []
        out.append({
            "artist":      a.strip(),
            "title":       t.strip(),
            "year":        r.get("year", ""),
            "label":       (r.get("label") or [""])[0] if r.get("label") else "",
            "country":     r.get("country", ""),
            "genre":       genres[0] if genres else (styles[0] if styles else ""),
            "all_genres":  genres + styles,
            "format":      ", ".join(r.get("format") or []),
            "thumb":       r.get("thumb", ""),
            "cover_image": r.get("cover_image", ""),
            "uri":         r.get("uri", ""),
            "discogs_id":  r.get("id"),
        })
    return out


@app.route("/repair/discogs-lookup/<entry_id>", methods=["POST"])
def repair_discogs_lookup(entry_id):
    cfg = load_config()
    token = cfg.get("discogs_token", "")
    if not token:
        return jsonify({"error": "Discogs token not configured. Open the API Keys panel and add one from discogs.com/settings/developers."}), 400
    entry, slug = find_entry_anywhere(entry_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404
    # Query prefers embedded tags, falls back to the filename — the same precedence
    # the batch cover pass and the exports use.
    md = ((entry.get("data") or {}).get("metadata") or {})
    a, t = (md.get("artist") or "").strip(), (md.get("title") or "").strip()
    if not t:
        base = os.path.splitext(entry.get("filename", ""))[0]
        if " - " in base:
            a, t = base.split(" - ", 1)
        else:
            a, t = "", base
    body = request.json or {}
    artist = (body.get("artist") or a).strip()
    title  = (body.get("title")  or t).strip()
    results = _discogs_search(token, artist, title)
    if isinstance(results, dict) and results.get("error"):
        return jsonify(results), 502
    return jsonify({"query": {"artist": artist, "title": title}, "results": results or []})


@app.route("/catalog/<entry_id>/generated-cover", methods=["POST"])
def generated_cover(entry_id):
    """Save a client-generated cover (key-colour + artist/title, drawn on a canvas in
    the browser) for a track whose file carries no art AND that Discogs doesn't know —
    the last rung of the cover ladder: embedded -> folder art -> Discogs -> generated.
    Fill-only, like the rungs above it: an existing cover is never overwritten, so a
    real cover found later... wins by arriving first. Body: raw JPEG bytes."""
    entry, _slug = find_entry_anywhere(entry_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404
    dest = os.path.join(COVERS_DIR, f"{entry['id']}.jpg")
    if os.path.exists(dest):
        return jsonify({"ok": True, "skipped": "cover already exists"})
    blob = request.get_data(cache=False)
    if not blob or len(blob) > 2_000_000:
        return jsonify({"error": "expected a JPEG body under 2 MB"}), 400
    if not blob.startswith(b"\xff\xd8\xff"):
        return jsonify({"error": "not a JPEG"}), 400
    os.makedirs(COVERS_DIR, exist_ok=True)
    # O_EXCL IS the fill-only check, atomically — the exists() above is only a fast
    # path. Without it, a generated placeholder racing a real extractor could land
    # second and overwrite genuine art (lowest rung must never beat a higher one).
    try:
        fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return jsonify({"ok": True, "skipped": "cover already exists"})
    with os.fdopen(fd, "wb") as f:
        f.write(blob)
    usage_event("repair", op="gen_cover", changed=1)
    return jsonify({"ok": True})


@app.route("/repair/fetch-covers", methods=["POST"])
def repair_fetch_covers():
    """Fill MISSING covers from Discogs — for files that genuinely carry no embedded
    art (measured on the Beatport catalog: 36 of 127, mostly untagged WAV purchases,
    zero of which have art in the file — local extraction has nothing to find there).
    Only ever writes covers/<id>.jpg where none exists; never touches catalog JSON,
    never overwrites art. Body: {ids: [...]}. Throttled to Discogs' authenticated
    rate limit. Query prefers embedded tags, falls back to the filename — the same
    precedence the exports use."""
    cfg = load_config()
    token = cfg.get("discogs_token", "")
    if not token:
        return jsonify({"error": "Discogs token not configured. Open the API Keys panel and add one from discogs.com/settings/developers."}), 400
    ids = (request.get_json(silent=True) or {}).get("ids") or []
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "ids required"}), 400
    import urllib.request
    fetched = already = no_match = failed = 0
    for entry_id in ids[:50]:            # bounded per request; the client chunks
        entry, _slug = find_entry_anywhere(str(entry_id))
        if not entry:
            failed += 1
            continue
        dest = os.path.join(COVERS_DIR, f"{entry['id']}.jpg")
        if os.path.exists(dest):
            already += 1
            continue
        md = ((entry.get("data") or {}).get("metadata") or {})
        artist, title = (md.get("artist") or "").strip(), (md.get("title") or "").strip()
        if not title:
            base = os.path.splitext(entry.get("filename", ""))[0]
            artist, title = (base.split(" - ", 1) + [""])[:2] if " - " in base else ("", base)
        results = _discogs_search(token, artist, title)
        time.sleep(1.1)                  # authenticated limit is 60/min; stay under it
        if isinstance(results, dict) and results.get("error"):
            failed += 1
            continue
        img = next((r.get("cover_image") or r.get("thumb") for r in (results or [])
                    if r.get("cover_image") or r.get("thumb")), None)
        if not img:
            no_match += 1
            continue
        from urllib.parse import urlparse as _urlparse
        u = _urlparse(img)
        host = (u.hostname or "")
        if u.scheme not in ("http", "https") or not (host == "discogs.com" or host.endswith(".discogs.com")):
            no_match += 1
            continue
        try:
            req = urllib.request.Request(img, headers={"User-Agent": "Tunefield/1.0"})
            MAX_COVER = 20 * 1024 * 1024
            with urllib.request.urlopen(req, timeout=15) as resp:
                cl = resp.headers.get("Content-Length")
                if cl and cl.isdigit() and int(cl) > MAX_COVER:
                    no_match += 1
                    continue
                # read one byte past the cap so an over-limit body is detectable
                # without ever buffering an unbounded response
                blob = resp.read(MAX_COVER + 1)
                if len(blob) > MAX_COVER:
                    no_match += 1
                    continue
            # Magic bytes, not just size: whatever the URL claimed, only a real image
            # may occupy a cover slot.
            if len(blob) < 1000 or not (blob.startswith((b"\xff\xd8\xff", b"\x89PNG", b"GIF8"))
                                        or (blob[:4] == b"RIFF" and blob[8:12] == b"WEBP")):
                no_match += 1
                continue
            os.makedirs(COVERS_DIR, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(blob)
            fetched += 1
        except Exception:
            failed += 1
    usage_event("repair", op="fetch_covers", changed=fetched)
    return jsonify({"fetched": fetched, "already": already,
                    "no_match": no_match, "failed": failed})


def _sanitize_filename_chars(s):
    """Map filesystem-illegal chars to a space and collapse whitespace. Doesn't touch
    the actual file on disk — only used for the display 'filename' field on catalog
    entries. A space, not a plain strip: stripping joins whatever sits either side of
    the char ("AC/DC" → "ACDC", "Live@9:30" → "Live@930"), and the joined form no
    longer matches the tag under whitespace-tolerant comparison."""
    if not isinstance(s, str): return ""
    out = re.sub(r'[\/\\:*?"<>|]', ' ', s)  # forbidden on FAT32 / NTFS / macOS
    out = re.sub(r'[\x00-\x1f]', '', out)
    out = re.sub(r'\s+', ' ', out).strip()
    return out

def _build_canonical_filename(artist, title, ext):
    """Compose 'Artist - Title.ext' (or 'Title.ext' if no artist), sanitised + truncated."""
    a = _sanitize_filename_chars(artist or "")
    t = _sanitize_filename_chars(title or "")
    base = f"{a} - {t}" if a and t else (t or a)
    if not base: return ""
    if len(base) > 120: base = base[:120].rstrip(" -")  # keep room for extension
    return base + (ext or "")

_VARIOUS_ARTIST_HINTS = ("various artists", "various", "va", "compilation", "v.a.")

@app.route("/repair/dedup", methods=["POST"])
def repair_dedup():
    """Auto-delete duplicates, keeping ONE entry per group.
    Body: {category: 'duplicate_files' | 'duplicate_titles', dry_run: bool,
           preferred_root: optional stored-form root path — a copy under it wins}

    Keep policy (best-first):
      0. entry under preferred_root, when one was given and validates (see below)
      1. entry that has a cover (visual richness wins)
      2. earliest analyzed_at (original import)
      3. lower entry id (deterministic tiebreaker)

    Returns the kept/deleted IDs per group so the UI can confirm before applying."""
    body = request.get_json(silent=True) or {}
    category = body.get("category")
    dry_run  = bool(body.get("dry_run", True))
    slugs    = body.get("slugs") if isinstance(body.get("slugs"), list) else None
    if category not in ("duplicate_files", "duplicate_titles"):
        return jsonify({"error": "category must be duplicate_files or duplicate_titles"}), 400
    # Optional preferred root: a copy living under this root wins its group outright,
    # ahead of the cover/age policy. Anything that doesn't resolve under a CONFIGURED
    # root (deleted root, typo, scripted caller) silently degrades to no preference —
    # the existing keep policy — rather than erroring a repair mid-flow.
    preferred_root = body.get("preferred_root")
    pref_real = None
    if isinstance(preferred_root, str) and preferred_root.strip():
        # Compare case-insensitively — macOS APFS/HFS+ are case-insensitive by default,
        # and all_cataloged_paths() already lowercases unconditionally. Same convention.
        cand = os.path.realpath(absolute_form(preferred_root.strip())).lower()
        for root in get_library_roots():
            rr = os.path.realpath(root).lower()
            if cand == rr or cand.startswith(rr.rstrip(os.sep) + os.sep):
                pref_real = cand
                break
    # Scoped to the Repair tab's selection (same contract as /repair/health) — and
    # dramatically cheaper than the old full scan: one preloaded id→entry map instead
    # of a find_entry_anywhere() catalog walk per duplicate row, and one covers-dir
    # listing instead of a stat per row.
    issues = scan_health(slugs)["issues"]
    groups = issues.get(category, [])
    by_id = {}
    for m in ensure_default():
        if slugs is not None and m["slug"] not in slugs:
            continue
        for e in load_cat(m["slug"]):
            by_id[e["id"]] = e
    try:
        cover_ids = {fn[:-4] for fn in os.listdir(COVERS_DIR) if fn.endswith(".jpg")}
    except OSError:
        cover_ids = set()
    plan = []  # [{ keep: row, drop: [rows] }]
    for grp in groups:
        enriched = []
        for row in grp:
            e = by_id.get(row["id"])
            if not e: continue
            p = os.path.realpath(absolute_form(e.get("library_file", ""))).lower()
            enriched.append({
                **row,
                "has_cover":   row["id"] in cover_ids,
                "analyzed_at": e.get("analyzed_at", ""),
                "under_pref":  bool(pref_real) and (p == pref_real or p.startswith(pref_real + os.sep)),
            })
        if len(enriched) < 2: continue
        enriched.sort(key=lambda r: (not r["under_pref"], not r["has_cover"], r["analyzed_at"] or "9999", r["id"]))
        keep = enriched[0]
        drop = enriched[1:]
        plan.append({"keep": keep, "drop": drop})
    if dry_run:
        return jsonify({
            "category": category, "groups": len(plan),
            "would_delete": sum(len(p["drop"]) for p in plan),
            "preferred_root": preferred_root if pref_real else None,
            "plan": plan,
        })
    # Apply — destructive, requires confirm token.
    rej = _require_confirm()
    if rej is not None: return rej
    deleted = 0
    removed_by_slug = {}
    # ONE load + save per catalog (the old per-entry rewrite made big libraries crawl:
    # a full JSON load + atomic dump for every deleted duplicate).
    drops_by_slug = {}
    for p in plan:
        for d in p["drop"]:
            drops_by_slug.setdefault(d["slug"], set()).add(d["id"])
    for slug, ids in drops_by_slug.items():
        entries = load_cat(slug)
        gone = [e for e in entries if e["id"] in ids]
        if not gone:
            continue   # already deleted between plan and apply
        # Cover files deliberately KEPT — removal is undoable via the entries trash,
        # and a restored duplicate wants its artwork back.
        removed_by_slug.setdefault(slug, []).extend(gone)
        save_cat(slug, [e for e in entries if e["id"] not in ids])
        deleted += len(gone)
    snap = _snapshot_entries_trash("dedup-" + category, removed_by_slug)
    usage_event("repair", op="dedup", changed=deleted)
    return jsonify({"ok": True, "category": category, "deleted": deleted, "groups": len(plan),
                    "undoable": bool(snap), "snapshot": snap})


@app.route("/repair/preview-tag-filenames", methods=["POST"])
def preview_tag_filenames():
    """Dry-run: walk every catalog and propose 'filename = Artist - Title.ext' for entries
    whose stored filename diverges from their ID3 tags. Returns the proposed changes
    without writing anything. Body: {} (no params yet)."""
    proposals = []
    skipped   = {"empty_tags": 0, "various_artists": 0, "already_canonical": 0, "no_extension": 0}
    for m in ensure_default():
        slug = m["slug"]
        for e in load_cat(slug):
            md = (e.get("data", {}) or {}).get("metadata", {}) or {}
            a = (md.get("artist") or "").strip()
            t = (md.get("title")  or "").strip()
            if not a and not t:
                skipped["empty_tags"] += 1; continue
            if a.lower() in _VARIOUS_ARTIST_HINTS:
                skipped["various_artists"] += 1; continue
            cur = e.get("filename", "")
            ext = os.path.splitext(cur)[1] or os.path.splitext(library_path(e) or "")[1]
            if not ext:
                skipped["no_extension"] += 1; continue
            canonical = _build_canonical_filename(a, t, ext)
            if not canonical or canonical == cur:
                skipped["already_canonical"] += 1; continue
            proposals.append({
                "id":     e["id"],
                "slug":   slug,
                "before": cur,
                "after":  canonical,
                "artist": a,
                "title":  t,
            })
    return jsonify({"proposals": proposals, "skipped": skipped, "total_candidates": len(proposals)})

@app.route("/repair/apply-tag-filenames", methods=["POST"])
def apply_tag_filenames():
    """Apply the canonical-filename rewrite to entries. Body: {ids: [entry_id, ...] (optional;
    if omitted, applies to every entry that would change)}. Stores the original filename
    on first apply so the rewrite is reversible via /repair/undo-tag-filenames."""
    body = request.get_json(silent=True) or {}
    only_ids = set(body.get("ids") or [])
    applied = 0; skipped = 0
    for m in ensure_default():
        slug = m["slug"]
        entries = load_cat(slug)
        changed = False
        for e in entries:
            if only_ids and e["id"] not in only_ids: continue
            md = (e.get("data", {}) or {}).get("metadata", {}) or {}
            a = (md.get("artist") or "").strip()
            t = (md.get("title")  or "").strip()
            if (not a and not t) or a.lower() in _VARIOUS_ARTIST_HINTS:
                skipped += 1; continue
            cur = e.get("filename", "")
            ext = os.path.splitext(cur)[1] or os.path.splitext(library_path(e) or "")[1]
            if not ext: skipped += 1; continue
            canonical = _build_canonical_filename(a, t, ext)
            if not canonical or canonical == cur: skipped += 1; continue
            # Preserve original on first rewrite so we can undo later
            if "original_filename" not in e:
                e["original_filename"] = cur
            e["filename"] = canonical
            applied += 1; changed = True
        if changed:
            save_cat(slug, entries)
    usage_event("repair", op="apply-tag-filenames", changed=applied)
    return jsonify({"ok": True, "applied": applied, "skipped": skipped})

@app.route("/repair/undo-tag-filenames", methods=["POST"])
def undo_tag_filenames():
    """Restore filename from entry.original_filename for every entry that has one.
    SINGLE-SHOT: the marker is consumed on undo, so pressing the button again is a
    clean no-op instead of silently re-resetting names to ever-older values after
    later renames (Mark, 2026-08-02). A fresh tag-apply records fresh originals."""
    restored = 0
    for m in ensure_default():
        slug = m["slug"]
        entries = load_cat(slug)
        changed = False
        for e in entries:
            orig = e.get("original_filename")
            if not orig:
                continue
            if e.get("filename") != orig:
                e["filename"] = orig
                restored += 1
            del e["original_filename"]   # undo spent — marker consumed either way
            changed = True
        if changed:
            save_cat(slug, entries)
    return jsonify({"ok": True, "restored": restored})


@app.route("/repair/apply/<entry_id>", methods=["POST"])
def repair_apply(entry_id):
    """Apply chosen fields from a suggestion to an entry. Body: {genre, artist, title}"""
    body = request.json or {}
    entry, slug = find_entry_anywhere(entry_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404
    entries = load_cat(slug)
    target = next((e for e in entries if e["id"] == entry_id), None)
    if not target:
        return jsonify({"error": "Not found"}), 404
    changed = []
    if "genre" in body:
        target["genre"] = (body.get("genre") or "").strip()
        changed.append("genre")
    if "filename" in body and (body.get("filename") or "").strip():
        new_fn = body["filename"].strip()
        # The frontend reconstructs the extension from the repair row it came from and
        # misses it on some categories (missing_artist_title). Resolve it authoritatively
        # here: if the proposed name has no audio extension, inherit the library file's.
        if not os.path.splitext(new_fn)[1]:
            lib_ext = os.path.splitext(target.get("library_file") or "")[1]
            if lib_ext:
                new_fn += lib_ext
        target["filename"] = new_fn
        changed.append("filename")
    save_cat(slug, entries)
    return jsonify({"ok": True, "changed": changed, "entry": target})


def _acoustid_lookup(key, audio_path):
    """Fingerprint a track via fpcalc and look it up on AcoustID. Returns list or error dict."""
    import shutil as _sh, subprocess, urllib.request, urllib.parse
    if not _sh.which("fpcalc"):
        return {"error": "fpcalc not found. Install with: brew install chromaprint (macOS) or apt-get install libchromaprint-tools (Linux)."}
    try:
        r = subprocess.run(["fpcalc", "-json", audio_path], capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return {"error": f"fpcalc failed: {r.stderr.strip()[:200]}"}
        fp = json.loads(r.stdout)
    except Exception as e:
        return {"error": f"fpcalc error: {e}"}
    duration    = int(round(fp.get("duration", 0)))
    fingerprint = fp.get("fingerprint", "")
    if not fingerprint:
        return {"error": "Could not generate fingerprint"}
    url = "https://api.acoustid.org/v2/lookup?" + urllib.parse.urlencode({
        "client":      key,
        "duration":    duration,
        "fingerprint": fingerprint,
        "meta":        "recordings+releasegroups+compress",
    })
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Tunefield/1.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": f"AcoustID request failed: {e}"}
    if data.get("status") != "ok":
        return {"error": data.get("error", {}).get("message", "AcoustID returned an error")}
    out = []
    for r in (data.get("results") or [])[:5]:
        score = r.get("score", 0)
        for rec in (r.get("recordings") or [])[:3]:
            artists = ", ".join(a.get("name", "") for a in (rec.get("artists") or []))
            title   = rec.get("title", "")
            rg      = (rec.get("releasegroups") or [{}])[0]
            out.append({
                "artist":     artists,
                "title":      title,
                "year":       rg.get("first_release_date", "")[:4] if rg.get("first_release_date") else "",
                "label":      "",
                "country":    "",
                "genre":      "",
                "all_genres": [],
                "format":     rg.get("type", ""),
                "thumb":      "",
                "uri":        f"https://musicbrainz.org/recording/{rec.get('id')}" if rec.get('id') else "",
                "discogs_id": None,
                "score":      score,
            })
    return out


@app.route("/repair/acoustid-lookup/<entry_id>", methods=["POST"])
def repair_acoustid_lookup(entry_id):
    cfg = load_config()
    key = cfg.get("acoustid_key", "")
    if not key:
        return jsonify({"error": "AcoustID key not configured. Open the API Keys panel and add one from acoustid.org/api-key."}), 400
    entry, slug = find_entry_anywhere(entry_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404
    fpath = library_path(entry)
    if not fpath:
        return jsonify({"error": "Library file missing for this entry"}), 404
    results = _acoustid_lookup(key, fpath)
    if isinstance(results, dict) and results.get("error"):
        return jsonify(results), 502
    return jsonify({"query": {"file": os.path.basename(fpath)}, "results": results or []})


@app.route("/repair/config", methods=["GET", "POST"])
def repair_config():
    if request.method == "GET":
        cfg = load_config()
        return jsonify({
            "discogs_token": bool(cfg.get("discogs_token")),
            "acoustid_key":  bool(cfg.get("acoustid_key")),
            # Stored-path form; /repair/dedup re-validates against the configured
            # roots at use time, so a stale value degrades to "no preference".
            "dedup_preferred_root": cfg.get("dedup_preferred_root") or "",
        })
    body = request.json or {}
    cfg = load_config()
    for k in ("discogs_token", "acoustid_key", "dedup_preferred_root"):
        if k in body:
            raw = body.get(k)
            # A non-string (int, list, dict…) would 500 on .strip() — refuse it cleanly.
            if raw is not None and not isinstance(raw, str):
                return jsonify({"error": f"{k} must be a string"}), 400
            v = (raw or "").strip()
            if v: cfg[k] = v
            else: cfg.pop(k, None)
    save_config(cfg)
    return jsonify({"ok": True})


def _csv_safe(v):
    """Spreadsheet formula-injection guard. Cells starting with =, +, -, or @ are
    interpreted as formulas by Excel/Sheets/LibreOffice; prefixing with a single
    quote neutralises that without changing the visible value. Coerces to str."""
    s = "" if v is None else str(v)
    if s and s[0] in ("=", "+", "-", "@"):
        return "'" + s
    return s

@app.route("/catalog/export.csv")
def export_csv():
    """Rewritten 2026-05-31 to use the stdlib csv module — correctly quotes / escapes
    commas / quotes / newlines in any field (filenames with these survive), and runs
    every user-controlled cell through _csv_safe to neutralise formula injection."""
    slug    = req_slug()
    entries = load_cat(slug)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    # artist/title live at the END — appended 2026-08-12, and positional consumers
    # (spreadsheets, scripts indexing by column number) keep their existing offsets.
    w.writerow(["id","filename","analyzed_at","scan_duration","bpm","key","mode","mood",
                "danceability","energy","valence","vocals","duration_sec","codec",
                "bitrate_kbps","has_file","artist","title"])
    for e in entries:
        d  = e.get("data", {}) or {}
        r  = d.get("rhythm", {})  or {}
        h  = d.get("harmony", {}) or {}
        sc = d.get("scores", {})  or {}
        en = d.get("energy", {})  or {}
        ct = d.get("content", {}) or {}
        mt = d.get("metadata", {}) or {}
        w.writerow([
            _csv_safe(e.get("id","")),
            _csv_safe(e.get("filename","")),
            _csv_safe(e.get("analyzed_at","")),
            _csv_safe(e.get("scan_duration","")),
            _csv_safe(r.get("bpm","")),
            _csv_safe(h.get("root","")),
            _csv_safe(h.get("mode","")),
            _csv_safe(sc.get("mood","")),
            _csv_safe(sc.get("danceability","")),
            _csv_safe(en.get("level","")),
            _csv_safe(sc.get("valence","")),
            _csv_safe(ct.get("voice_presence","")),
            _csv_safe(mt.get("duration_sec","")),
            _csv_safe(mt.get("codec","")),
            _csv_safe(mt.get("bitrate_kbps","")),
            "true" if library_path(e) else "false",
            _csv_safe(mt.get("artist","")),
            _csv_safe(mt.get("title","")),
        ])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment;filename=catalog.csv"})


# ── Rekordbox export: bridge XML + direct collection write ─────────────────────
# Bridge: one fixed XML file that accumulates every exported playlist. The user
# points Rekordbox's "Imported Library" preference at it ONCE; every later export
# just appears in the rekordbox xml sidebar tree (right-click → Import Playlist).
# Collection (experimental): writes the playlist straight into Rekordbox's
# master.db via pyrekordbox — guarded by confirm token, a Rekordbox-must-be-
# closed check, and an automatic timestamped backup of the database files.

REKORDBOX_HOME         = os.path.expanduser(os.environ.get("TUNEFIELD_RB_HOME", "~/Music/Tunefield"))
REKORDBOX_BRIDGE_XML   = os.path.join(REKORDBOX_HOME, "tunefield.xml")
REKORDBOX_BACKUPS_DIR  = os.path.join(REKORDBOX_HOME, "rekordbox-backups")
REKORDBOX_BRIDGE_STORE = os.path.join(DATA_DIR, "rekordbox_bridge.json")
REKORDBOX_BACKUPS_KEEP = 10

def _rb_esc(s):
    """XML attribute escaping (mirror of the frontend's escXml)."""
    return (str("" if s is None else s)
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))

def _rb_file_uri(abs_path):
    """POSIX path → Rekordbox Location URI with percent-encoded segments."""
    from urllib.parse import quote
    if not abs_path:
        return ""
    return "file://localhost" + "/".join(quote(seg, safe="") for seg in str(abs_path).split("/"))

def _rb_store_load():
    try:
        with open(REKORDBOX_BRIDGE_STORE) as f:
            store = json.load(f)
        if isinstance(store.get("playlists"), list):
            return store
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return {"playlists": []}

_RB_TRACK_FIELDS = ("name", "artist", "genre", "kind", "total_time", "bit_rate",
                    "sample_rate", "bpm", "tonality", "rating", "comments", "location")

def _rb_clean_tracks(raw):
    """Validate + normalise the track list sent by the frontend."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("tracks must be a non-empty list")
    if len(raw) > 10000:
        raise ValueError("too many tracks")
    out = []
    for t in raw:
        loc = str(t.get("location", "")) if isinstance(t, dict) else ""
        # Windows-style paths would silently produce broken file:// URIs (the builder
        # splits on '/'); refuse clearly until it's tested on a real Windows Rekordbox.
        if re.match(r"[A-Za-z]:[\\/]", loc) or "\\" in loc:
            raise ValueError("Rekordbox export currently supports macOS/Linux file paths only")
        if not isinstance(t, dict) or not loc.startswith("/"):
            raise ValueError("every track needs an absolute location path")
        out.append({k: str(t.get(k, "")) for k in _RB_TRACK_FIELDS})
    return out

def _rb_build_bridge_xml(store):
    """All bridge playlists → one Rekordbox XML. Collection deduped by location."""
    date_added = datetime.now().strftime("%Y-%m-%d")
    track_id_by_loc, collection = {}, []
    for pl in store["playlists"]:
        for t in pl["tracks"]:
            loc = t["location"]
            if loc in track_id_by_loc:
                continue
            tid = len(collection) + 1
            track_id_by_loc[loc] = tid
            collection.append(
                f'    <TRACK TrackID="{tid}" Name="{_rb_esc(t["name"])}" Artist="{_rb_esc(t["artist"])}"'
                f' Genre="{_rb_esc(t["genre"])}" Kind="{_rb_esc(t["kind"])}" TotalTime="{_rb_esc(t["total_time"])}"'
                f' BitRate="{_rb_esc(t["bit_rate"])}" SampleRate="{_rb_esc(t["sample_rate"])}"'
                f' AverageBpm="{_rb_esc(t["bpm"])}" DateAdded="{date_added}" Tonality="{_rb_esc(t["tonality"])}"'
                f' Rating="{_rb_esc(t["rating"])}" PlayCount="0" Comments="{_rb_esc(t["comments"])}"'
                f' Location="{_rb_esc(_rb_file_uri(loc))}"/>')
    nodes = []
    for pl in store["playlists"]:
        refs = "\n".join(f'        <TRACK Key="{track_id_by_loc[t["location"]]}"/>' for t in pl["tracks"])
        nodes.append(f'      <NODE Name="{_rb_esc(pl["name"])}" Type="1" KeyType="0" Entries="{len(pl["tracks"])}">\n'
                     f'{refs}\n      </NODE>')
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<DJ_PLAYLISTS Version="1.0.0">\n'
            f'  <PRODUCT Name="Tunefield" Version="1.0" Company="Tunefield"/>\n'
            f'  <COLLECTION Entries="{len(collection)}">\n'
            + "\n".join(collection) + "\n"
            f'  </COLLECTION>\n'
            f'  <PLAYLISTS>\n'
            f'    <NODE Type="0" Name="ROOT" Count="{len(nodes)}">\n'
            + "\n".join(nodes) + "\n"
            f'    </NODE>\n'
            f'  </PLAYLISTS>\n'
            f'</DJ_PLAYLISTS>\n')

def _rb_pid():
    """PID of the running Rekordbox app (0 if not running)."""
    try:
        from pyrekordbox.utils import get_rekordbox_pid
        return get_rekordbox_pid() or 0
    except Exception:
        try:
            import subprocess
            out = subprocess.run(["pgrep", "-x", "rekordbox"], capture_output=True, text=True)
            return int(out.stdout.split()[0]) if out.stdout.strip() else 0
        except Exception:
            return 0

def _rb_db_paths():
    """(master.db path, its directory) for the installed Rekordbox — or (None, None)."""
    override = os.environ.get("TUNEFIELD_RB_DB_PATH")
    if override:
        return (override, os.path.dirname(override)) if os.path.exists(override) else (None, None)
    default = os.path.expanduser("~/Library/Pioneer/rekordbox/master.db")
    try:
        from pyrekordbox.config import get_config
        for ver in ("rekordbox7", "rekordbox6"):
            try:
                p = str(get_config(ver, "db_path"))
                if p and os.path.exists(p):
                    return p, os.path.dirname(p)
            except Exception:
                continue
    except Exception:
        pass
    return (default, os.path.dirname(default)) if os.path.exists(default) else (None, None)

@app.route("/export/rekordbox/status", methods=["GET"])
def rekordbox_export_status():
    try:
        import pyrekordbox  # noqa: F401
        has_pyrb = True
    except ImportError:
        has_pyrb = False
    db_path, _ = _rb_db_paths() if has_pyrb else (None, None)
    store = _rb_store_load()
    return jsonify({
        "bridge_path":      REKORDBOX_BRIDGE_XML,
        "bridge_exists":    os.path.exists(REKORDBOX_BRIDGE_XML),
        "bridge_playlists": [p["name"] for p in store["playlists"]],
        "pyrekordbox":      has_pyrb,
        "rekordbox_db":     db_path,
        "rekordbox_running": bool(_rb_pid()),
    })

@app.route("/export/rekordbox/bridge", methods=["POST"])
def rekordbox_export_bridge():
    body   = request.get_json(force=True) or {}
    name   = str(body.get("name", "")).strip()[:200] or "Tunefield"
    tracks = _rb_clean_tracks(body.get("tracks"))
    store  = _rb_store_load()
    entry  = {"name": name, "updated_at": datetime.now().isoformat(timespec="seconds"), "tracks": tracks}
    replaced = False
    for i, pl in enumerate(store["playlists"]):
        if pl["name"] == name:
            store["playlists"][i] = entry
            replaced = True
            break
    if not replaced:
        store["playlists"].append(entry)
    atomic_json_dump(REKORDBOX_BRIDGE_STORE, store)
    os.makedirs(REKORDBOX_HOME, exist_ok=True)
    xml = _rb_build_bridge_xml(store)
    tmp = REKORDBOX_BRIDGE_XML + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(xml)
        f.flush()
        try: os.fsync(f.fileno())
        except OSError: pass
    os.replace(tmp, REKORDBOX_BRIDGE_XML)
    return jsonify({"path": REKORDBOX_BRIDGE_XML, "playlist": name, "replaced": replaced,
                    "playlists": len(store["playlists"]),
                    "tracks": sum(len(p["tracks"]) for p in store["playlists"])})

def _rb_backup_db(db_dir):
    """Timestamped copy of master.db + masterPlaylists6.xml before any write.
    Returns the backup directory. Prunes to the newest REKORDBOX_BACKUPS_KEEP."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(REKORDBOX_BACKUPS_DIR, stamp)
    os.makedirs(dest, exist_ok=True)
    for fn in ("master.db", "master.db-wal", "master.db-shm", "masterPlaylists6.xml"):
        src = os.path.join(db_dir, fn)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, fn))
    if not os.path.exists(os.path.join(dest, "master.db")):
        raise RuntimeError("backup failed — master.db not copied, aborting export")
    kept = sorted(os.listdir(REKORDBOX_BACKUPS_DIR))
    for old in kept[:-REKORDBOX_BACKUPS_KEEP]:
        shutil.rmtree(os.path.join(REKORDBOX_BACKUPS_DIR, old), ignore_errors=True)
    return dest

@app.route("/export/rekordbox/collection", methods=["POST"])
def rekordbox_export_collection():
    err = _require_confirm()
    if err: return err
    body   = request.get_json(force=True) or {}
    name   = str(body.get("name", "")).strip()[:200] or "Tunefield"
    tracks = _rb_clean_tracks(body.get("tracks"))
    try:
        from pyrekordbox import Rekordbox6Database
    except ImportError:
        return jsonify({"error": "pyrekordbox is not installed — run: pip install pyrekordbox"}), 501
    allow_running = os.environ.get("TUNEFIELD_RB_ALLOW_RUNNING") == "1"  # test-copy runs only
    if _rb_pid() and not allow_running:
        return jsonify({"error": "Rekordbox is running — quit it completely (⌘Q) and try again"}), 409
    db_path, db_dir = _rb_db_paths()
    if not db_path:
        return jsonify({"error": "Rekordbox database not found — has Rekordbox 6/7 been run on this Mac?"}), 404
    backup = _rb_backup_db(db_dir)
    if allow_running:
        import pyrekordbox.db6.database as _rbdbmod
        _rbdbmod.get_rekordbox_pid = lambda: 0
    try:
        db = Rekordbox6Database(path=db_path)
    except Exception as e:
        # Constructor failures (no sqlcipher wheel for this Python, unsupported newer
        # Rekordbox schema, key extraction) previously surfaced as a blank 500.
        app.logger.exception("rekordbox collection open failed")
        return jsonify({"error": "could not open the Rekordbox database — this can happen on "
                                 "Python versions without a sqlcipher3 wheel or with a newer "
                                 f"Rekordbox release ({type(e).__name__}: {str(e)[:160]}). "
                                 "Your Rekordbox database was NOT modified; the XML/bridge "
                                 "exports still work."}), 500
    try:
        # unique playlist name: "Name", "Name (2)", …
        final_name, n = name, 1
        while db.get_playlist(Name=final_name).first() is not None:
            n += 1
            final_name = f"{name} ({n})"
        added, reused, missing = 0, 0, []
        contents = []
        artist_write_failed = False
        for t in tracks:
            loc = t["location"]
            if not os.path.exists(loc):
                missing.append(loc)
                continue
            c = db.get_content(FolderPath=loc).first()
            if c is None:
                kwargs = {"Title": t["name"] or os.path.basename(loc)}
                try:
                    bpm = float(t["bpm"])
                    if bpm > 0: kwargs["BPM"] = int(round(bpm * 100))
                except ValueError:
                    pass
                c = db.add_content(loc, **kwargs)
                added += 1
                # Artist is a LINKED row (djmdArtist), not a content column — look it
                # up or create it, then point the content at it. The artist API surface
                # varies across pyrekordbox releases, so any failure here is logged
                # once and the export proceeds exactly as before: Title/BPM only.
                artist_name = (t.get("artist") or "").strip()
                if artist_name and not artist_write_failed:
                    try:
                        art = db.get_artist(Name=artist_name).first()
                        if art is None:
                            art = db.add_artist(artist_name)
                        c.ArtistID = art.ID
                    except Exception as e:
                        artist_write_failed = True
                        app.logger.warning(
                            "rekordbox artist write failed (%s: %s) — "
                            "continuing Title/BPM only", type(e).__name__, str(e)[:160])
            else:
                reused += 1
            contents.append(c)
        if not contents:
            return jsonify({"error": "no exportable tracks — all file paths are missing on disk",
                            "missing": missing}), 400
        pl = db.create_playlist(final_name)
        for i, c in enumerate(contents):
            db.add_to_playlist(pl, c, track_no=i + 1)
        db.commit()
    finally:
        try: db.close()
        except Exception: pass
    return jsonify({"playlist": final_name, "tracks": len(contents), "added_to_collection": added,
                    "already_in_collection": reused, "missing": missing, "backup": backup})


@app.route("/export/als", methods=["POST"])
def export_als():
    """Ableton Live Set download. Body: {name, tracks:[{location, artist, title,
    bpm, key, duration_sec, sample_rate_hz}], warp?, scene_tempo?}. The client
    sends the same resolved rows every other exporter uses; `location` is the
    entry's library_file (absolute or root-relative — resolved here). Builds a
    Session-View set: two alternating deck tracks, one scene per track, clips
    warped to the detected BPM, per-scene tempo. Opens in any Live edition."""
    body = request.get_json(silent=True) or {}
    raw = body.get("tracks")
    if not isinstance(raw, list) or not raw:
        return jsonify({"error": "tracks must be a non-empty list"}), 400
    if len(raw) > 10000:
        return jsonify({"error": "too many tracks"}), 400
    entries, offline = [], 0
    for t in raw:
        if not isinstance(t, dict):
            continue
        # absolute_form, not resolve_path: files on an unmounted volume export
        # fine — Live shows them offline and relinks when the drive mounts.
        p = absolute_form(t.get("location"))
        if not p:
            continue
        if not os.path.exists(p):
            offline += 1
        entries.append(AlsTrack(
            path=p, title=t.get("title"), artist=t.get("artist"),
            bpm=t.get("bpm"), key=t.get("key"),
            duration_sec=t.get("duration_sec"),
            sample_rate_hz=t.get("sample_rate_hz")))
    if not entries:
        return jsonify({"error": "no exportable tracks (missing file paths)"}), 400
    try:
        data = build_live_set(entries,
                              warp=bool(body.get("warp", True)),
                              scene_tempo=bool(body.get("scene_tempo", True)))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    name = re.sub(r'[\\/:*?"<>|]+', "_", str(body.get("name") or "tunefield-set")).strip() or "tunefield-set"
    return Response(data, mimetype="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{name}.als"',
                             "X-Tracks-Exported": str(len(entries)),
                             "X-Tracks-Offline": str(offline)})


@app.route("/system/health", methods=["GET"])
def system_health():
    """Startup diagnostics. Frontend can show a 'health' badge in the header and warn
    about missing external binaries (ffprobe / ffmpeg / fpcalc) at boot rather than
    surfacing a cryptic error mid-analysis. Safe to call without confirm token."""
    import platform as _plat
    out = {
        "tunefield":  TUNEFIELD_VERSION,
        "python":     _plat.python_version(),
        "platform":   _plat.system(),
        "root":       TUNEFIELD_ROOT,
        "root_mode":  TUNEFIELD_ROOT_MODE,   # env | installed | portable | source
        "data_dir":   DATA_DIR,
        "log_file":   LOG_FILE if os.path.exists(LOG_FILE) else None,
        "usage_file": USAGE_FILE if os.path.exists(USAGE_FILE) else None,
        "ffmpeg":     bool(shutil.which("ffmpeg")),
        "ffprobe":    bool(shutil.which("ffprobe")),
        "fpcalc":     bool(shutil.which("fpcalc")),
    }
    try:
        import librosa as _librosa
        out["librosa"] = getattr(_librosa, "__version__", "unknown")
    except Exception:
        out["librosa"] = None
    try:
        import pyloudnorm as _pyln  # noqa: F401
        out["pyloudnorm"] = True
    except Exception:
        out["pyloudnorm"] = False
    try:
        import flask as _flask
        out["flask"] = getattr(_flask, "__version__", "unknown")
    except Exception:
        out["flask"] = None
    return jsonify(out)


@app.route("/system/token", methods=["GET"])
def system_token():
    """Same-origin endpoint that returns the destructive-action confirm token.
    Frontend fetches once at boot, stashes on window, and passes via header on every
    destructive request. SOP/absence-of-CORS already stops a cross-origin page reading the
    response; the explicit Origin/Referer check below is defence-in-depth so the guarantee
    doesn't silently depend on nobody ever adding permissive CORS headers globally."""
    if not _same_origin_ok():
        return jsonify({"error": "same-origin only"}), 403
    return jsonify({"token": TUNEFIELD_CONFIRM_TOKEN, "version": TUNEFIELD_VERSION})


# ── Playlists ──────────────────────────────────────────────────────
# Auto-snapshot before every mutation (undo history is full). This is enforced by calling
# pl_snapshot() at each mutation site, not by a counter.
SNAPSHOT_KEEP  = 50    # keep last N snapshots — deeper history for per-step undo

def _pl_reconstruct_meta_from_disk():
    """Rebuild the playlist meta list from the playlist files themselves — the second half
    of the corrupt-meta recovery (mirrors _reconstruct_meta_from_disk for catalogs).
    Without it, a corrupted _meta.json makes every on-disk playlist invisible AND
    playlists_create can compute a colliding slug and clobber an orphaned playlist file
    (tracks + entire snapshot history) with an empty one."""
    out = []
    try:
        for fn in sorted(os.listdir(PLAYLISTS_DIR)):
            if not fn.endswith(".json") or fn.startswith("_") or fn == "explore.json":
                continue
            p = os.path.join(PLAYLISTS_DIR, fn)
            if not os.path.isfile(p):
                continue
            try:
                with open(p) as f:
                    d = json.load(f)
                if not isinstance(d, dict):
                    continue
                slug = d.get("slug") or os.path.splitext(fn)[0]
                out.append({
                    "slug": slug,
                    "name": d.get("name") or slug,
                    "locked": bool(d.get("locked", False)),
                    "count": len(d.get("tracks") or []),
                    "created_at": d.get("created_at", ""),
                    "updated_at": d.get("updated_at", ""),
                })
            except Exception:
                continue
    except FileNotFoundError:
        pass
    return out

def pl_load_meta():
    """Same resilience as load_meta() — bad JSON moved aside, then meta is RECONSTRUCTED
    from the playlist files on disk so they stay visible (and un-clobberable)."""
    meta = None
    if os.path.exists(PL_META_FILE):
        try:
            with open(PL_META_FILE) as f:
                data = json.load(f)
            meta = data if isinstance(data, list) else []
        except Exception as e:
            try:
                os.replace(PL_META_FILE, PL_META_FILE + ".corrupt")
                print(f"[pl_load_meta] corrupted {PL_META_FILE} → moved to .corrupt ({e})")
            except Exception:
                pass
            meta = None
    if meta is None or (not meta and os.path.isdir(PLAYLISTS_DIR)):
        reconstructed = _pl_reconstruct_meta_from_disk()
        if reconstructed:
            with _FS_LOCK:
                atomic_json_dump(PL_META_FILE, reconstructed)
            return reconstructed
    return meta or []

def pl_save_meta(meta):
    atomic_json_dump(PL_META_FILE, meta)

def pl_load_state():
    if os.path.exists(PL_STATE_FILE):
        try:
            with open(PL_STATE_FILE) as f: return json.load(f)
        except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
            # Torn state file degrades to "no active playlist", never a dead panel.
            try:
                os.replace(PL_STATE_FILE, PL_STATE_FILE + ".corrupt")
                print(f"[pl_load_state] corrupted {PL_STATE_FILE} → moved to .corrupt ({e})")
            except Exception:
                pass
    return {"active_slug": None, "session_id": None, "session_started_at": None}

def pl_save_state(state):
    atomic_json_dump(PL_STATE_FILE, state)

def pl_file(slug):
    return os.path.join(PLAYLISTS_DIR, f"{_safe_slug(slug)}.json")

def _pl_slugs_on_disk():
    """Slugs of every playlist FILE present, regardless of meta state. Used by the create
    paths so make_slug never returns a slug whose file already exists on disk — writing
    it would silently destroy that playlist's tracks and snapshot history."""
    try:
        return {os.path.splitext(fn)[0] for fn in os.listdir(PLAYLISTS_DIR)
                if fn.endswith(".json") and not fn.startswith("_") and fn != "explore.json"}
    except FileNotFoundError:
        return set()

def pl_load(slug):
    p = pl_file(slug)
    if not os.path.exists(p): return None
    # Same corruption resilience as load_cat/pl_load_meta: a torn file (crash mid-write,
    # USB pull) is quarantined and reads as "gone" (callers already 404 on None) instead
    # of bricking every playlist surface with raw 400s.
    try:
        with open(p) as f: return json.load(f)
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        try:
            os.replace(p, p + ".corrupt")
            print(f"[pl_load] corrupted {p} → moved to .corrupt ({e})")
        except Exception:
            pass
        return None

def pl_save(pl):
    # explore.json is written by the Explore-session path and carries no "slug" key, so a
    # PATCH that reaches it (rename/lock) used to die with KeyError and a raw 500
    # (2026-08-29, seen in Mark's log). Callers that know the slug pass it in the dict;
    # this is the belt-and-braces so a slug-less file can never crash the save.
    slug = pl.get("slug")
    if not slug:
        raise KeyError("playlist has no slug — refusing to guess a filename")
    pl["updated_at"] = datetime.now().isoformat(timespec="seconds")
    atomic_json_dump(pl_file(slug), pl)
    # mirror name/locked into _meta.json
    meta = pl_load_meta()
    for m in meta:
        if m["slug"] == pl["slug"]:
            m["name"]   = pl["name"]
            m["locked"] = pl.get("locked", False)
            m["count"]  = len(pl.get("tracks", []))
            m["updated_at"] = pl["updated_at"]
            break
    pl_save_meta(meta)

def pl_snapshot(pl, reason="auto"):
    # Any new mutation invalidates the undo chain (standard undo semantics) — also
    # keeps the cursor from going stale when the snapshot cap trims indices below.
    pl.pop("undo_cursor", None)
    snaps = pl.setdefault("snapshots", [])
    snaps.append({
        # Unique id — the revert lookup keys off this. `at` (second precision) is NOT
        # unique when two mutations land in the same wall-clock second, so matching on it
        # could revert to the wrong snapshot; `id` is collision-proof.
        "id":     uuid.uuid4().hex[:12],
        "at":     datetime.now().isoformat(timespec="seconds"),
        "reason": reason,
        "tracks": [dict(t) for t in pl.get("tracks", [])],
    })
    # cap history
    if len(snaps) > SNAPSHOT_KEEP:
        del snaps[: len(snaps) - SNAPSHOT_KEEP]

@app.route("/playlists", methods=["GET"])
def playlists_list():
    meta  = pl_load_meta()
    state = pl_load_state()
    return jsonify({"playlists": meta, "active_slug": state.get("active_slug")})

@app.route("/playlists", methods=["POST"])
def playlists_create():
    body = request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip() or "Untitled playlist"
    meta = pl_load_meta()
    # Collide against on-disk files too, not just meta — an orphaned playlist file
    # (surviving a meta corruption) must never be overwritten by a new empty one.
    slug = make_slug(name, {m["slug"] for m in meta} | _pl_slugs_on_disk())
    now  = datetime.now().isoformat(timespec="seconds")
    pl   = {
        "slug": slug, "name": name, "locked": False,
        "anchor_track_id": None,
        "created_at": now, "updated_at": now,
        "tracks": [], "snapshots": [],
    }
    atomic_json_dump(pl_file(slug), pl)
    meta.append({"slug": slug, "name": name, "locked": False, "count": 0,
                 "created_at": now, "updated_at": now})
    pl_save_meta(meta)
    # auto-activate first playlist
    state = pl_load_state()
    if not state.get("active_slug"):
        state["active_slug"] = slug
        pl_save_state(state)
    return jsonify({"slug": slug, "name": name})

@app.route("/playlists/<slug>", methods=["GET"])
def playlists_get(slug):
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    return jsonify(pl)

@app.route("/playlists/<slug>", methods=["DELETE"])
def playlists_delete(slug):
    all_meta = pl_load_meta()
    if not any(m["slug"] == slug for m in all_meta):
        return jsonify({"error": "not found"}), 404
    meta = [m for m in all_meta if m["slug"] != slug]
    pl_save_meta(meta)
    # Soft delete: move the file to a trash folder so the deletion is undoable (see /restore).
    p = pl_file(slug)
    if os.path.exists(p):
        trash_dir = os.path.join(PLAYLISTS_DIR, "_trash")
        os.makedirs(trash_dir, exist_ok=True)
        shutil.move(p, os.path.join(trash_dir, f"{_safe_slug(slug)}.json"))
    state = pl_load_state()
    if state.get("active_slug") == slug:
        state["active_slug"] = meta[0]["slug"] if meta else None
        pl_save_state(state)
    return jsonify({"ok": True, "active_slug": state.get("active_slug"), "deleted_slug": slug, "restorable": True})

@app.route("/playlists/<slug>/restore", methods=["POST"])
def playlists_restore(slug):
    """Undo a playlist deletion — move it back out of the trash and re-register it."""
    trash_dir = os.path.join(PLAYLISTS_DIR, "_trash")
    tp = os.path.join(trash_dir, f"{_safe_slug(slug)}.json")
    if not os.path.exists(tp):
        return jsonify({"error": "nothing to restore"}), 404
    if os.path.exists(pl_file(slug)):
        return jsonify({"error": "playlist already exists"}), 409
    shutil.move(tp, pl_file(slug))
    pl = pl_load(slug) or {}
    meta = pl_load_meta()
    if not any(m["slug"] == slug for m in meta):
        meta.append({"slug": slug, "name": pl.get("name", slug), "locked": pl.get("locked", False),
                     "count": len(pl.get("tracks", [])),
                     "created_at": pl.get("created_at"), "updated_at": pl.get("updated_at")})
        pl_save_meta(meta)
    state = pl_load_state()
    state["active_slug"] = slug
    pl_save_state(state)
    return jsonify({"ok": True, "slug": slug, "active_slug": slug})

@app.route("/playlists/<slug>", methods=["PATCH"])
def playlists_patch(slug):
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    pl["slug"] = slug          # the route is the authority; older files may not carry one
    body = request.get_json(force=True, silent=True) or {}
    if "name"   in body and body["name"].strip(): pl["name"]   = body["name"].strip()
    if "locked" in body: pl["locked"] = bool(body["locked"])
    if "anchor_track_id" in body:                 pl["anchor_track_id"] = body["anchor_track_id"]
    pl_save(pl)
    return jsonify(pl)

@app.route("/playlists/<slug>/tracks", methods=["POST"])
def playlists_append_track(slug):
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    if pl.get("locked"): return jsonify({"error": "playlist is locked"}), 423
    body = request.get_json(force=True, silent=True) or {}
    track_id    = body.get("track_id")
    source_mode = body.get("source_mode", "learn")
    at_index    = body.get("at_index")  # optional — insert at position; default is append
    if not track_id: return jsonify({"error": "track_id required"}), 400
    # Snapshot the PRE-mutation state so every add is individually undoable.
    pl_snapshot(pl, "pre-add")
    new_track = {
        "track_id":    track_id,
        "added_at":    datetime.now().isoformat(timespec="seconds"),
        "source_mode": source_mode,
    }
    if isinstance(at_index, int) and 0 <= at_index <= len(pl["tracks"]):
        pl["tracks"].insert(at_index, new_track)
    else:
        pl["tracks"].append(new_track)
    pl_save(pl)
    return jsonify({"ok": True, "count": len(pl["tracks"])})

@app.route("/playlists/<slug>/tracks/<int:idx>", methods=["DELETE"])
def playlists_remove_track(slug, idx):
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    if pl.get("locked"): return jsonify({"error": "playlist is locked"}), 423
    if idx < 0 or idx >= len(pl["tracks"]):
        return jsonify({"error": "index out of range"}), 400
    # Snapshot the PRE-mutation state so this delete is undoable
    pl_snapshot(pl, "pre-delete")
    pl["tracks"].pop(idx)
    pl_save(pl)
    return jsonify({"ok": True, "count": len(pl["tracks"])})

@app.route("/playlists/<slug>/tracks", methods=["DELETE"])
def playlists_clear_tracks(slug):
    """Bulk-clear all tracks — single snapshot so one Undo restores everything.
    Used by the Clear button (2-step confirm on the client)."""
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    if pl.get("locked"): return jsonify({"error": "playlist is locked"}), 423
    pl_snapshot(pl, "pre-clear")
    pl["tracks"] = []
    pl_save(pl)
    return jsonify({"ok": True, "count": 0})

@app.route("/playlists/<slug>/tracks", methods=["PATCH"])
def playlists_reorder(slug):
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    if pl.get("locked"): return jsonify({"error": "playlist is locked"}), 423
    body  = request.get_json(force=True, silent=True) or {}
    order = body.get("order")
    if not isinstance(order, list) or sorted(order) != list(range(len(pl["tracks"]))):
        return jsonify({"error": "order must be a permutation of [0..n-1]"}), 400
    # Snapshot the PRE-mutation state so this reorder is undoable
    pl_snapshot(pl, "pre-reorder")
    pl["tracks"] = [pl["tracks"][i] for i in order]
    pl_save(pl)
    return jsonify({"ok": True})

@app.route("/playlists/snapshots", methods=["GET"])
def playlists_all_snapshots():
    """Flattened snapshot list across every playlist. Newest first.
    Used by the Playlists-tab Snapshots sidebar."""
    meta = pl_load_meta()
    out  = []
    for m in meta:
        slug = m.get("slug")
        pl   = pl_load(slug)
        if not pl: continue
        snaps = pl.get("snapshots", []) or []
        for idx, s in enumerate(snaps):
            out.append({
                "slug":         slug,
                "name":         pl.get("name", slug),
                "snapshot_id":  s.get("id"),      # collision-proof revert key
                "snapshot_idx": idx,
                "at":           s.get("at"),
                "reason":       s.get("reason", "auto"),
                "track_count":  len(s.get("tracks") or []),
            })
    out.sort(key=lambda x: x.get("at") or "", reverse=True)
    return jsonify({"snapshots": out, "total": len(out)})

@app.route("/playlists/<slug>/snapshot", methods=["POST"])
def playlists_snapshot(slug):
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    body   = request.get_json(force=True, silent=True) or {}
    reason = body.get("reason", "manual")
    pl_snapshot(pl, reason)
    pl_save(pl)
    return jsonify({"ok": True, "snapshots": len(pl["snapshots"])})

@app.route("/playlists/<slug>/revert", methods=["POST"])
def playlists_revert(slug):
    pl = pl_load(slug)
    if not pl: return jsonify({"error": "not found"}), 404
    if pl.get("locked"): return jsonify({"error": "playlist is locked"}), 423
    body  = request.get_json(force=True, silent=True) or {}
    snaps = pl.get("snapshots", [])
    if not snaps: return jsonify({"error": "no snapshots"}), 400
    snap = None
    # Prefer the collision-proof snapshot_id. Fall back to snapshot_at (legacy, may be
    # ambiguous within a second) then snapshot_idx (positional, back-compat).
    sid = body.get("snapshot_id")
    at  = body.get("snapshot_at")
    if sid:
        snap = next((s for s in snaps if s.get("id") == sid), None)
        if snap is None:
            return jsonify({"error": f"snapshot not found (id={sid})"}), 404
    elif at:
        snap = next((s for s in snaps if s.get("at") == at), None)
        if snap is None:
            return jsonify({"error": f"snapshot not found (at={at})"}), 404
    elif "snapshot_idx" in body:
        idx = body.get("snapshot_idx")
        if not isinstance(idx, int) or not (0 <= idx < len(snaps)):
            return jsonify({"error": "snapshot_idx out of range"}), 400
        snap = snaps[idx]
    undo_mode = snap is None
    if undo_mode:
        # No selector at all → the Undo button (POST /revert with {}). Walk BACK through
        # the snapshot list with a cursor persisted on the playlist: each Undo reverts to
        # the snapshot just below the last one we reverted to. Simply picking "the newest
        # snapshot" ping-pongs (redo), and "newest that differs" bounces once you are two
        # levels back — only a cursor gives real multi-step undo. Any other mutation
        # clears the cursor (see pl_snapshot), which also guards against index shift
        # from snapshot-cap trimming. No pre-revert snapshot is pushed in undo mode.
        cur = pl.get("tracks", [])
        cursor = pl.get("undo_cursor")
        target = (cursor if isinstance(cursor, int) and 0 <= cursor <= len(snaps) else len(snaps)) - 1
        # Skip snapshots identical to the current state (no-op reverts)
        while target >= 0 and snaps[target].get("tracks") == cur:
            target -= 1
        if target < 0:
            return jsonify({"error": "nothing to undo"}), 400
        snap = snaps[target]
        pl["tracks"] = [dict(t) for t in snap["tracks"]]
        pl["undo_cursor"] = target
        pl_save(pl)
        return jsonify({"ok": True, "count": len(pl["tracks"])})
    # Explicit snapshot-picker revert — snapshot current state first so it is itself
    # undoable (this also clears any undo cursor via pl_snapshot).
    pl_snapshot(pl, "pre-revert")
    pl["tracks"] = [dict(t) for t in snap["tracks"]]
    pl_save(pl)
    return jsonify({"ok": True, "count": len(pl["tracks"])})

@app.route("/playlists/active", methods=["GET"])
def playlists_get_active():
    return jsonify({"active_slug": pl_load_state().get("active_slug")})

@app.route("/playlists/active", methods=["PUT"])
def playlists_set_active():
    body = request.get_json(force=True, silent=True) or {}
    slug = (body.get("slug") or "").strip() or None
    if slug and not os.path.exists(pl_file(slug)):
        return jsonify({"error": "not found"}), 404
    st = pl_load_state(); st["active_slug"] = slug; pl_save_state(st)
    return jsonify({"active_slug": slug})



def find_free_port(start=5050, span=30):
    """Scan upward for a free TCP port. Returns the first one or the start if none free."""
    import socket
    for p in range(start, start + span):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", p))
                return p
        except OSError:
            continue
    return start


def _existing_instance(start=5050, span=30):
    """Probe busy ports for a Tunefield already serving OUR data root. A double-clicked
    launcher started twice used to silently boot a SECOND server on the next free port —
    both processes then read/write the same data/ tree with no cross-process locking
    (lost updates, .tmp rename races). Returns the running instance's URL, or None."""
    import socket, urllib.request
    for p in range(start, start + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                continue          # port free → nothing running there
            except OSError:
                pass              # busy → probe it
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{p}/system/health", timeout=0.8) as r:
                info = json.load(r)
            if isinstance(info, dict) and "tunefield" in info and \
               os.path.abspath(str(info.get("root", ""))) == TUNEFIELD_ROOT:
                return f"http://localhost:{p}"
        except Exception:
            continue
    return None


def _window_mode(url, port=None):
    """Native window (pywebview → WKWebView) behind TUNEFIELD_WINDOW=1 — item 29 spike.

    Returns False when pywebview isn't importable so the caller falls back to the
    browser path (frozen builds don't bundle it yet). Otherwise blocks until the
    window closes, then hard-exits: library_analyse's pool workers are non-daemon
    and joined at interpreter exit, so a normal exit mid-scan would leave a
    windowless process grinding for minutes — os._exit skips the join, and the
    fsync'd catalog journal bounds the loss to the track inside librosa."""
    try:
        import webview
    except ImportError:
        usage_event("window_unavailable")
        return False
    if port is not None:
        threading.Thread(target=lambda: app.run(debug=False, port=port), daemon=True).start()
        import urllib.request
        up = False
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/system/health", timeout=0.5):
                    up = True
                    break
            except Exception:
                time.sleep(0.1)
        if not up:
            print(f"\n  Tunefield's server did not come up on port {port} within 15s —")
            print("  not opening a window onto a dead URL. Check the terminal for a")
            print("  startup error (port conflict, data-dir permissions) and retry.\n")
            usage_event("window_server_failed", port=port)
            raise SystemExit(1)
    # No JS from the 'closing' event: pywebview runs those handlers inline on the
    # Cocoa main thread and evaluate_js blocks on a semaphore only that same run
    # loop can release — a guaranteed deadlock (verified against pywebview 6.2.1
    # source). The client flushes itself on 'pagehide' instead (sendBeacon-based,
    # survives page teardown; WKWebView fires it on window destroy).
    try:
        # ALLOW_DOWNLOADS is load-bearing too (Mark, 2026-08-28: ".als export not
        # working"): pywebview's default (False) makes WKWebView silently DROP every
        # programmatic download — the blob + a.download flow every exporter uses
        # (.als, CSV, M3U8, Traktor, Rekordbox XML, Field views) did nothing in the
        # native window while the toast claimed success. True routes each download
        # through the OS save panel. Must be set BEFORE create_window.
        webview.settings['ALLOW_DOWNLOADS'] = True
        webview.create_window("Tunefield", url, width=1440, height=900)
        # private_mode=False is load-bearing: pywebview's default (True) wipes
        # localStorage every launch. (Cocoa ignores storage_path and always uses
        # the default WKWebsiteDataStore — don't pass one.)
        webview.start(private_mode=False)
    except Exception:
        usage_event("window_failed")
        if port is None:
            return False        # caller opens the existing instance in a browser
        # Our Flask daemon thread already owns the port — app.run() again would
        # crash on the bind. Serve browser-style from right here instead.
        print("  Window mode failed — falling back to the browser.")
        if os.environ.get("TUNEFIELD_NO_BROWSER") != "1":
            import webbrowser
            webbrowser.open(url)
        threading.Event().wait()   # keep the daemon server alive until Ctrl-C
    time.sleep(0.5)  # let the pagehide beacons' POSTs land
    usage_event("quit", mode="window")
    os._exit(0)


# Native window is the DEFAULT from 2026-08-27 (was an opt-in spike). Tunefield is an
# app, and it should behave like one: a real window that quits when you close it, not a
# browser tab that leaves a server running invisibly behind it. TUNEFIELD_WINDOW=0 opts
# back out — useful for headless work, the smoke test, and anyone who prefers the tab.
# _window_mode() still returns False when pywebview cannot be imported, so a build
# without it degrades to the browser rather than failing to start.
_WINDOW_MODE_ON = os.environ.get("TUNEFIELD_WINDOW", "1") != "0"


if __name__ == "__main__":
    desired = int(os.environ.get("PORT", 5050))
    existing = _existing_instance(desired)
    if existing:
        print(f"\n  Tunefield is ALREADY running for this folder → {existing}")
        print("  Opening it in your browser instead of starting a second copy")
        print("  (two servers on one data folder can overwrite each other's changes).\n")
        if _WINDOW_MODE_ON:
            _window_mode(existing)  # exits the process unless pywebview is missing
        if os.environ.get("TUNEFIELD_NO_BROWSER") != "1":
            import webbrowser
            webbrowser.open(existing)
        raise SystemExit(0)
    port    = find_free_port(desired)
    ensure_default()
    # migrate_catalog_paths() already ran at import (so it also runs under WSGI).
    url = f"http://localhost:{port}"
    usage_event("start", version=TUNEFIELD_VERSION, mode=TUNEFIELD_ROOT_MODE, port=port)
    print(f"\n  Tunefield running → {url}")
    if port != desired:
        print(f"  (port {desired} was in use)")
    print(f"  Root: {TUNEFIELD_ROOT}")
    print(f"  Data: {DATA_DIR}\n")
    if _WINDOW_MODE_ON:
        _window_mode(url, port=port)  # exits the process unless pywebview is missing
    # Auto-open browser unless TUNEFIELD_NO_BROWSER=1 — handy for double-click launchers
    if os.environ.get("TUNEFIELD_NO_BROWSER") != "1":
        import webbrowser
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    app.run(debug=False, port=port)
