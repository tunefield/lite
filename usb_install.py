"""Put Tunefield on a USB stick, or update the copy on one (1.1.0, U1).

Until 1.1.0 a stick was set up from a USB zip holding a Tunefield-USB folder. Dragging
that folder onto a stick that already had one let Finder Replace it, data/ and the
library with it. Mark's ruling (15 Nov 2026): an install process that removes the problem
completely. So the zip is retired and the Mac app copies its own signed bundle onto the
stick, beside the old app, and swaps by rename. The rules, which Release & QA tests:

  * It writes only names the release owns, inside the install folder: Tunefield.app,
    the staging folder .tunefield-update/, Tunefield-old.app during the swap, the five
    docs (each via a temp name) and PORTABLE when it is missing. It never opens data/
    or anything else a user put there (music, _Serato_, PIONEER).
  * A pulled stick or a quit at any moment leaves a visible, working app (Tunefield.app,
    or Tunefield-old.app between the two renames) on the untouched library, and the next
    run tidies up or rolls back before anything else.
  * It refuses while Tunefield runs from that folder (by real path, translocated copies
    included), on a read-only stick, short of space, or when the stick is newer.
  * The copy carries no extended attributes, resource forks or quarantine, so FAT32
    gets no ._ files inside the bundle and the stick app opens without a Gatekeeper
    prompt or translocation on any Mac.

Choosing the stick and confirming is the approval (E0) for that one run; nothing is
recorded. Test hooks (env, as TUNEFIELD_TEST_HOST_ID; a double-click never sets them):
TUNEFIELD_TEST_STICK_PAYLOAD, _VERSION, _PAUSE and _RESUME, described where they are read.
"""
import os, re, sys, shutil, signal, subprocess, threading, time, plistlib

BUNDLE_ID = "com.futurefabrik.tunefield-lite"
APP, OLD, STAGE = "Tunefield.app", "Tunefield-old.app", ".tunefield-update"
FRESH_FOLDER = "Tunefield-USB"
# (name on the stick, file in the bundle's usb/ folder or beside app.py, else packaging/ in a source run)
DOCS = (("READ ME FIRST.txt", "USB-README.txt"), ("LICENSE", "LICENSE"), ("NOTICE.md", "NOTICE.md"),
        ("tunefield-doctor.sh", "tunefield-doctor.sh"), ("M2-MONITOR.md", "M2-MONITOR.md"))
MARGIN = 50 * 1024 * 1024
VOLUMES_DIR = "/Volumes"
HERE = os.path.dirname(os.path.abspath(__file__))

MSG = {
    "running": "Tunefield is open from this stick. Quit it there, then try again.",
    "newer": "This stick has Tunefield {v}, newer than this Mac's {mine}. Update Tunefield on this Mac first.",
    "readonly": "This stick is read-only.",
    "space": "Not enough space on this stick: needs {need} free, has {free}.",
    "portable": "This copy runs from a stick. To update a stick, open Tunefield on your Mac "
                "(from Applications, or straight from the download).",
    "nobundle": "Only the downloaded app can put itself on a stick.",
    "notfolder": "{name} on this stick is a file, not a folder.",
    "busy": "A stick is already being written. Wait for it to finish.",
    "verify": "The copy on the stick didn't check out, so the old app was left as it was. Try again.",
    "gone": "That folder is no longer on a connected stick.",
}


def _mb(n):
    return f"{max(0, n) / 1e6:.0f} MB"


def version_tuple(v):
    """'1.1.0' or '1.1.0-beta3' → (1, 1, 0); None when unreadable."""
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", v or "")
    return tuple(int(x) for x in m.groups()) if m else None


def bundle_info(app_path):
    """(bundle id, short version) from an app's Info.plist; (None, None) when unreadable."""
    try:
        with open(os.path.join(app_path, "Contents", "Info.plist"), "rb") as f:
            p = plistlib.load(f)
        return p.get("CFBundleIdentifier"), p.get("CFBundleShortVersionString")
    except Exception:
        return None, None


def _is_ours(app_path):
    return bundle_info(app_path)[0] == BUNDLE_ID


def own_bundle(executable, frozen):
    """The .app to copy: the running bundle, or TUNEFIELD_TEST_STICK_PAYLOAD (a signed .app,
    so a source run on a test port can do real copies). None in a plain source run."""
    p = os.environ.get("TUNEFIELD_TEST_STICK_PAYLOAD")
    if p:
        return os.path.abspath(p)
    if not frozen:
        return None
    d = os.path.dirname(os.path.abspath(executable))           # …/Tunefield.app/Contents/MacOS
    app = os.path.dirname(os.path.dirname(d))
    return app if app.endswith(".app") else None


def my_version(app_version):
    """TUNEFIELD_TEST_STICK_VERSION is the version the tool believes it carries, so Release &
    QA can run the 'later update' leg with one signed build: update and repair are the same
    code, only the label and the downgrade check read this."""
    return os.environ.get("TUNEFIELD_TEST_STICK_VERSION") or app_version.split("-")[0]


def _mount_lines(mount_text=None):
    if mount_text is None:
        try:
            mount_text = subprocess.run(["/sbin/mount"], capture_output=True, text=True, timeout=5).stdout
        except Exception:
            mount_text = ""
    return mount_text.splitlines()


def fs_types(mount_text=None):
    """{mount point: filesystem} from the mount table ('/dev/disk4s1 on /Volumes/A B (msdos, local…)')."""
    out = {}
    for line in _mount_lines(mount_text):
        i, j = line.find(" on "), line.rfind(" (")
        if 0 < i < j:
            out[line[i + 4:j]] = line[j + 2:].split(",")[0].strip(")")
    return out


def running_under(folder, ps_text=None, mount_text=None):
    """True when a process runs from inside `folder`: argv[0] under its real path, or under an
    App Translocation mount whose source is inside it (a quarantined launch runs from a nullfs
    copy, the same mapping _resolve_root does). Two same-named sticks are told apart because
    everything here is a real path, never a volume name."""
    roots = {os.path.join(folder, ""), os.path.join(os.path.realpath(folder), "")}
    for line in _mount_lines(mount_text):
        m = re.match(r"^(.+) on (/\S*/AppTranslocation/[^/\s]+) \(nullfs", line)
        if m and any(os.path.join(m.group(1), "").startswith(r) for r in roots):
            roots.add(os.path.join(m.group(2), ""))
    if ps_text is None:
        try:
            ps_text = subprocess.run(["/bin/ps", "-axww", "-o", "pid=,command="],
                                     capture_output=True, text=True, timeout=5).stdout
        except Exception:
            return False
    me = os.getpid()
    for line in ps_text.splitlines():
        pid, _, cmd = line.strip().partition(" ")
        if pid.isdigit() and int(pid) != me and any(cmd.strip().startswith(r) for r in roots):
            return True
    return False


_LAYOUT = {}

def _layout(payload):
    """(file sizes, number of folders) of the bundle, walked once per process. Symlinks count
    as files: FAT32 and exFAT store each one as a small file of its own."""
    if payload not in _LAYOUT:
        sizes, dirs = [], 0
        for dp, dns, fns in os.walk(payload):
            dirs += 1
            for n in fns + [d for d in dns if os.path.islink(os.path.join(dp, d))]:
                try:
                    sizes.append(os.lstat(os.path.join(dp, n)).st_size)
                except OSError:
                    pass
        _LAYOUT[payload] = (sizes, dirs)
    return _LAYOUT[payload]


def space_needed(payload, cluster, fs):
    """Room the copy takes on this stick, measured by Release & QA on 15 Nov 2026: every file is
    rounded up to whole clusters, and on FAT32/exFAT each also gets a ._ sidecar of one cluster
    (the kernel tags files a downloaded app creates with com.apple.provenance, and --noextattr
    does not stop that). 259 MB of app took 334 MB with 32 KB clusters and 559 MB with 128 KB."""
    sizes, dirs = _layout(payload)
    c = max(512, cluster or 4096)
    sidecar = c if fs not in ("apfs", "hfs") else 0
    return sum(-(-n // c) * c + sidecar for n in sizes) + dirs * c + MARGIN


def _tree_size(path):
    """Bytes under `path`, for the progress bar; ._ sidecars on FAT32/exFAT don't count."""
    total = 0
    for dp, dns, fns in os.walk(path):
        for n in fns + [d for d in dns if os.path.islink(os.path.join(dp, d))]:
            if n.startswith("._"):
                continue
            try:
                total += os.lstat(os.path.join(dp, n)).st_size
            except OSError:
                pass
    return total


def _is_install(d):
    """A folder holding a stick install: an app of ours beside PORTABLE or a library
    (data/catalogs), or PORTABLE with a library or in a folder called Tunefield-USB (the app
    lost). A plain data/ folder, or a PORTABLE file alone elsewhere, is someone else's."""
    app = os.path.isdir(os.path.join(d, APP)) or os.path.isdir(os.path.join(d, OLD))
    portable = os.path.isfile(os.path.join(d, "PORTABLE"))
    library = os.path.isdir(os.path.join(d, "data", "catalogs"))
    return (app and (portable or library)) or (portable and (library or os.path.basename(d) == FRESH_FOLDER))


def _fields(d):
    try:
        return sum(1 for n in os.listdir(os.path.join(d, "data", "catalogs"))
                   if n.endswith(".json") and not n.startswith("."))
    except OSError:
        return 0


def plan(folder, mine, need, free, writable, running=None):
    """What the tool may do with `folder`: (action, refusal message or None)."""
    app = os.path.join(folder, APP)
    if not os.path.isdir(app) and os.path.isdir(os.path.join(folder, OLD)):
        app = os.path.join(folder, OLD)                         # an interrupted swap: repair it
    v = bundle_info(app)[1] if os.path.isdir(app) else None
    action = "install" if not os.path.isdir(folder) or not _is_install(folder) else (
        "repair" if v is None or version_tuple(v) == version_tuple(mine) else
        "update" if version_tuple(v) < version_tuple(mine) else "newer")
    if action == "newer":
        return action, MSG["newer"].format(v=v, mine=mine)
    if os.path.lexists(folder) and not os.path.isdir(folder):
        return action, MSG["notfolder"].format(name=os.path.basename(folder))
    if not writable:
        return action, MSG["readonly"]
    if (running or running_under)(folder):
        return action, MSG["running"]
    if free < need:
        return action, MSG["space"].format(need=_mb(need), free=_mb(free))
    return action, None


def sticks(payload, mine, exclude=(), mount_text=None, running=None):
    """Every mounted volume under VOLUMES_DIR with the installs on it (its top and one folder
    down), each with the action on offer or why not. `exclude` holds paths of the running app
    (a DMG it was opened from), whose volume is left out."""
    if mount_text is None:
        mount_text = "\n".join(_mount_lines())
    fst = fs_types(mount_text)
    out = []
    try:
        names = sorted(os.listdir(VOLUMES_DIR))
    except OSError:
        names = []
    for name in names:
        vol = os.path.join(VOLUMES_DIR, name)
        if name.startswith(".") or os.path.islink(vol) or not os.path.isdir(vol):
            continue                                            # the boot volume is a symlink to /
        if any(os.path.join(x, "").startswith(os.path.join(vol, "")) for x in exclude if x):
            continue
        try:
            st = os.statvfs(vol)
            free = st.f_bavail * st.f_frsize
            writable = os.access(vol, os.W_OK) and not (st.f_flag & os.ST_RDONLY)
        except OSError:
            continue
        need = space_needed(payload, st.f_frsize, fst.get(vol, "")) if payload else MARGIN
        cands = [vol]
        try:
            cands += [os.path.join(vol, n) for n in sorted(os.listdir(vol))
                      if not n.startswith(".") and not n.endswith(".app") and os.path.isdir(os.path.join(vol, n))]
        except OSError:
            pass
        installs = []
        for d in cands:
            if not _is_install(d):
                continue
            app = os.path.join(d, APP) if os.path.isdir(os.path.join(d, APP)) else os.path.join(d, OLD)
            action, refusal = plan(d, mine, need, free, writable, running)
            installs.append({"folder": d, "version": bundle_info(app)[1], "fields": _fields(d),
                             "action": action, "refusal": refusal, "restore": _offer(d)})
        fresh = None
        if not installs:
            d = os.path.join(vol, FRESH_FOLDER)
            action, refusal = plan(d, mine, need, free, writable, running)
            fresh = {"folder": d, "action": "install", "refusal": refusal, "restore": _offer(d)}
        out.append({"volume": vol, "name": name, "fs": fst.get(vol, ""), "free": free,
                    "writable": writable, "installs": installs, "fresh": fresh})
    return out


def _offer(folder):
    """The library backup on this stick to offer back for `folder` (stick_backup.py)."""
    try:
        import stick_backup
        return stick_backup.offer(folder)
    except Exception:
        return None


# ── the run ──────────────────────────────────────────────────────────────────

_LOCK = threading.Lock()
JOB = {"phase": None, "pct": 0, "done": True, "ok": None, "message": "", "folder": None, "action": None}


def _set(**kw):
    with _LOCK:
        JOB.update(kw)


def _pause(phase, proc=None):
    """Test hook: TUNEFIELD_TEST_STICK_PAUSE=copy-25,swap… blocks at those phases until the file
    named in TUNEFIELD_TEST_STICK_RESUME exists, and writes the phase to <RESUME>.at first so a
    test knows when to pull the stick or kill the app. A running copy is stopped, not left racing."""
    wanted = [p.strip() for p in (os.environ.get("TUNEFIELD_TEST_STICK_PAUSE") or "").split(",")]
    resume = os.environ.get("TUNEFIELD_TEST_STICK_RESUME")
    if phase not in wanted or not resume:
        return
    with open(resume + ".at", "w") as f:
        f.write(phase + "\n")
    if proc:
        proc.send_signal(signal.SIGSTOP)
    try:
        while not os.path.exists(resume):
            time.sleep(0.2)
    finally:
        if proc:
            proc.send_signal(signal.SIGCONT)


def _codesign_verify(app_path):
    r = subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", app_path],
                       capture_output=True, text=True)
    return r.returncode == 0, (r.stderr or "").strip()[-300:]

VERIFY = _codesign_verify


def _quarantined(app_path):
    for p in (app_path, os.path.join(app_path, "Contents", "MacOS", "Tunefield")):
        if os.path.exists(p) and subprocess.run(["/usr/bin/xattr", "-p", "com.apple.quarantine", p],
                                                capture_output=True).returncode == 0:
            return True
    return False      # tests swap in a stand-in: their fake bundles aren't signed


def _gone(func, path, exc):
    """On FAT32/exFAT, deleting X also deletes its ._X sidecar, which the walk listed before:
    that one is already gone, which is the goal. Anything else still stops the run."""
    if not isinstance(exc if isinstance(exc, BaseException) else exc[1], FileNotFoundError):
        raise exc if isinstance(exc, BaseException) else exc[1]


def _rmtree(path):
    if os.path.islink(path) or os.path.isfile(path):
        os.remove(path)
    elif os.path.isdir(path):
        if sys.version_info >= (3, 12):
            shutil.rmtree(path, onexc=_gone)
        else:
            shutil.rmtree(path, onerror=_gone)


def recover(folder):
    """Finish or roll back whatever an interrupted run left, before anything else. A missing
    Tunefield.app beside Tunefield-old.app is the window between the two swap renames: the old
    app goes back. Anything inside the staging folder is ours and goes; Tunefield-old.app only
    when its Info.plist says it is Tunefield, so a user's own folder of that name is left alone."""
    app, old, stage = (os.path.join(folder, n) for n in (APP, OLD, STAGE))
    if not os.path.isdir(app) and os.path.isdir(old) and _is_ours(old):
        os.rename(old, app)
    if os.path.isdir(old) and _is_ours(old):
        os.makedirs(stage, exist_ok=True)
        os.rename(old, os.path.join(stage, "old.app"))
    if os.path.lexists(stage):
        _rmtree(stage)
    for name, _ in DOCS:
        t = os.path.join(folder, f".{name}.tunefield-tmp")
        if os.path.isfile(t):
            os.remove(t)


def _doc_source(src):
    for d in (os.path.join(HERE, "usb"), HERE, os.path.join(HERE, "packaging")):
        p = os.path.join(d, src)
        if os.path.isfile(p):
            return p
    return None


def _copy(payload, dest, total):
    """ditto --norsrc --noextattr --noqtn: no ._ files, xattrs or quarantine on the stick (the
    flags the USB zip was made with, for the same reason). Progress is the staged byte count."""
    proc = subprocess.Popen(["/usr/bin/ditto", "--norsrc", "--noextattr", "--noqtn", payload, dest],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    hit = set()
    while proc.poll() is None:
        time.sleep(0.5)
        pct = min(99, int(100 * _tree_size(dest) / max(1, total))) if os.path.isdir(dest) else 0
        _set(pct=pct)
        for mark in (25, 90):
            if pct >= mark and mark not in hit:
                hit.add(mark)
                _pause(f"copy-{mark}", proc)
    if proc.returncode != 0:
        why = (proc.stderr.read() or "").strip().splitlines()
        raise RuntimeError("The copy stopped before it finished (was the stick unplugged?). The app and the "
                           "library on the stick were left as they were; run it again to finish."
                           + (f" ({why[-1][-160:]})" if why else ""))


def _restore(folder):
    """Bring the library back from the stick's backup (stick_backup.restore): the data/ there
    now is renamed and kept. Returns the sentence for the done message."""
    import stick_backup
    meta = stick_backup.read_meta(stick_backup.home(folder)) or {}
    _set(phase="restore", pct=0)
    kept = stick_backup.restore(folder)
    return (f"The library is back from the backup of {(meta.get('made_at') or '')[:16].replace('T', ' ')} "
            f"({meta.get('tracks', 0)} track{'' if meta.get('tracks') == 1 else 's'})."
            + (f" What was there before is kept in {os.path.basename(kept)}, beside it." if kept else ""))


def run(folder, action, payload, note="", restore=None, version=""):
    """The whole job, in a worker thread. Re-checks nothing the route already refused; the
    route holds the lock that keeps one run at a time. action "restore" brings the library
    back and copies nothing; restore=True/False on a fresh install answers the backup question."""
    import stick_backup
    try:
        _set(phase="prepare", pct=0)
        if action == "restore":
            _set(phase="done", ok=True, message=_restore(folder))
            return
        recover(folder)
        backup_note = ""
        if action in ("update", "repair"):
            # A 1.0.0 stick has never made a backup of its own; this is its first.
            _set(phase="backup")
            try:
                st, detail = stick_backup.make(folder, version=f"stick tool {version}")
            except Exception as e:
                st, detail = "failed", str(e)
            if st in ("space", "toobig", "failed"):
                backup_note = " The library's backup on the stick was skipped (" + {
                    "space": "not enough space", "toobig": "the library is too big for it"}.get(st, str(detail)) + ")."
        os.makedirs(folder, exist_ok=True)
        stage = os.path.join(folder, STAGE)
        os.makedirs(stage)
        new = os.path.join(stage, APP)
        _set(phase="copy")
        _copy(payload, new, _tree_size(payload))
        _set(phase="verify", pct=100)
        _pause("verify")
        ok, why = VERIFY(new)
        # The copy is compared with the payload's own Info.plist, never with
        # TUNEFIELD_TEST_STICK_VERSION. ._ sidecars inside the bundle are fine (codesign and
        # Gatekeeper accept them); a quarantine flag reaching the stick is not.
        if ok and _quarantined(new):
            ok, why = False, "quarantine flag on the copy"
        if not ok or bundle_info(new) != bundle_info(payload):
            _rmtree(stage)
            raise RuntimeError(MSG["verify"] + (f" ({why})" if why else ""))
        _set(phase="swap")
        _pause("swap")
        app, old = os.path.join(folder, APP), os.path.join(folder, OLD)
        if os.path.isdir(app):
            os.rename(app, old)
        os.rename(new, app)
        if os.path.isdir(old):
            os.rename(old, os.path.join(stage, "old.app"))     # never a visible half-deleted app
        _set(phase="cleanup")
        _pause("cleanup")
        _rmtree(stage)
        for name, src in DOCS:
            s = _doc_source(src)
            if s:
                t = os.path.join(folder, f".{name}.tunefield-tmp")
                shutil.copyfile(s, t)
                os.replace(t, os.path.join(folder, name))
        # Only a fresh install gets PORTABLE. A missing one beside an app and a library can be
        # deliberate (the README says deleting it switches to the Mac's library), so an
        # update or repair leaves that choice alone (Release & QA, 15 Nov).
        portable = os.path.join(folder, "PORTABLE")
        if action == "install" and not os.path.lexists(portable):
            open(portable, "a").close()
        v = bundle_info(app)[1]
        _set(phase="done", ok=True, message={
            "install": f"Tunefield {v} is on the stick, in {os.path.basename(folder)}. You can eject it now.",
            "update": f"The stick now has Tunefield {v}, on the same library. You can eject it now.",
            "repair": f"The app on the stick was copied fresh ({v}). Your library was not touched."}[action]
             + backup_note)
        msg = JOB["message"]
        if action == "install" and restore is True:
            msg = f"Tunefield {v} is on the stick. " + _restore(folder) + " You can eject it now."
        elif action == "install" and restore is False and stick_backup.offer(folder):
            stick_backup.decline(folder)
        _set(phase="done", message=msg + (" " + note if note else ""))
    except Exception as e:
        _set(phase="failed", ok=False, message=str(e) if isinstance(e, RuntimeError) else
             f"Writing to the stick stopped ({e.__class__.__name__}: {e}). The library was not touched; "
             "plug the stick back in and run it again to finish or undo the change.")
    finally:
        _set(done=True)


def start(folder, action, payload, note="", restore=None, version=""):
    """Start a run in the background. False when one is already going."""
    with _LOCK:
        if not JOB["done"]:
            return False
        JOB.update(phase="prepare", pct=0, done=False, ok=None, message="", folder=folder, action=action)
    threading.Thread(target=run, args=(folder, action, payload, note, restore, version), daemon=True).start()
    return True
