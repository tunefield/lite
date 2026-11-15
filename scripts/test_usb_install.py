#!/usr/bin/env python3
"""Regression: putting Tunefield on a USB stick, or updating the copy on one (1.1.0, U1).

Fake sticks are folders under a temp VOLUMES_DIR; the payload is a fake bundle copied with
the real ditto. codesign can't verify a fake bundle, so VERIFY is a stand-in here (Release &
QA runs the real one on signed builds and disk images).

- discovery: an install needs an app of ours beside PORTABLE or data/catalogs; a plain data/
  or a stray PORTABLE is never listed; the offers are install / update / repair / newer
- an update replaces only the app: data/, music, PORTABLE and everything else byte-for-byte
  equal, mtimes included; no staging or old app left; the docs refreshed
- a missing PORTABLE stays missing on update; a fresh install creates it and no data/
- refusals: no token 403, a folder or action not on offer, running, short of space, newer,
  a failed verify (old app left as it was)
- interrupted runs: the next run rolls back or tidies first; a user's own Tunefield-old.app
  (not our bundle id) is left alone
- the pause hook stops at a phase with the old app untouched, then finishes
- running_under: real paths, translocated mounts, a same-named second stick
- space_needed: whole clusters plus a sidecar cluster per file on FAT32/exFAT

    .venv/bin/python scripts/test_usb_install.py
"""
import os, sys, json, hashlib, tempfile, shutil, plistlib, time

TMP = os.path.realpath(tempfile.mkdtemp(prefix="tf-usb-"))
ROOT = os.path.join(TMP, "root"); os.makedirs(os.path.join(ROOT, "data"))
VOLS = os.path.join(TMP, "Volumes"); os.makedirs(VOLS)
PAYLOAD = os.path.join(TMP, "payload", "Tunefield.app")
RESUME = os.path.join(TMP, "resume")
os.environ["TUNEFIELD_ROOT"] = ROOT
os.environ["TUNEFIELD_TEST_STICK_PAYLOAD"] = PAYLOAD
os.environ["TUNEFIELD_TEST_STICK_VERSION"] = "1.1.0"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO); os.chdir(REPO)

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []
def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

def make_app(path, version, bundle_id="com.futurefabrik.tunefield-lite"):
    os.makedirs(os.path.join(path, "Contents", "MacOS"))
    os.makedirs(os.path.join(path, "Contents", "Frameworks"))
    with open(os.path.join(path, "Contents", "Info.plist"), "wb") as f:
        plistlib.dump({"CFBundleIdentifier": bundle_id, "CFBundleShortVersionString": version}, f)
    with open(os.path.join(path, "Contents", "MacOS", "Tunefield"), "wb") as f:
        f.write(version.encode() * 1000)
    with open(os.path.join(path, "Contents", "Frameworks", "lib.dylib"), "wb") as f:
        f.write(b"x" * 50000)
    os.symlink("Frameworks/lib.dylib", os.path.join(path, "Contents", "lib-link"))

def make_install(folder, version, portable=True, music=True):
    os.makedirs(os.path.join(folder, "data", "catalogs"))
    json.dump([{"id": "a"}], open(os.path.join(folder, "data", "catalogs", "default.json"), "w"))
    json.dump({"pro_key": "TF1-X"}, open(os.path.join(folder, "data", "config.json"), "w"))
    if portable:
        open(os.path.join(folder, "PORTABLE"), "w").close()
    if music:
        os.makedirs(os.path.join(folder, "Music"))
        open(os.path.join(folder, "Music", "set.mp3"), "wb").write(b"ID3" + b"m" * 999)
    open(os.path.join(folder, "READ ME FIRST.txt"), "w").write("old readme")
    if version:
        make_app(os.path.join(folder, "Tunefield.app"), version)

def manifest(folder):
    """Every file outside the app, staging and the docs: path → (sha256, mtime)."""
    skip = ("Tunefield.app", ".tunefield-update", "Tunefield-old.app", "READ ME FIRST.txt",
            "LICENSE", "NOTICE.md", "tunefield-doctor.sh", "M2-MONITOR.md")
    out = {}
    for dp, dns, fns in os.walk(folder):
        rel = os.path.relpath(dp, folder)
        if rel.split(os.sep)[0] in skip:
            continue
        for n in fns:
            if rel == "." and n in skip:
                continue
            p = os.path.join(dp, n)
            out[os.path.relpath(p, folder)] = (hashlib.sha256(open(p, "rb").read()).hexdigest(), os.stat(p).st_mtime_ns)
    return out

def version_of(app):
    return plistlib.load(open(os.path.join(app, "Contents", "Info.plist"), "rb"))["CFBundleShortVersionString"]

try:
    make_app(PAYLOAD, "1.1.0")
    A = os.path.join(VOLS, "EMPTY")                 # fresh stick
    B = os.path.join(VOLS, "OLD"); BF = os.path.join(B, "Tunefield-USB")        # 1.0.0 install
    C = os.path.join(VOLS, "NOTOURS")               # Backup/data and a stray PORTABLE
    D = os.path.join(VOLS, "SAME"); DF = os.path.join(D, "DJ")                  # renamed folder, same version
    E = os.path.join(VOLS, "NEWER"); EF = os.path.join(E, "Tunefield-USB")
    F = os.path.join(VOLS, "NOPORT"); FF = os.path.join(F, "Tunefield-USB")     # PORTABLE deleted by the user
    for v in (A, B, C, D, E, F):
        os.makedirs(v)
    make_install(BF, "1.0.0"); make_install(DF, "1.1.0"); make_install(EF, "1.2.0")
    make_install(FF, "1.0.0", portable=False)
    os.makedirs(os.path.join(C, "Backup", "data", "catalogs")); open(os.path.join(C, "PORTABLE"), "w").close()
    os.symlink("/", os.path.join(VOLS, "Macintosh HD"))

    import app as tf, usb_install as ui
    ui.VOLUMES_DIR = VOLS
    ui.VERIFY = lambda p: (True, "")
    ui.running_under = lambda folder, ps_text=None, mount_text=None: False
    c = tf.app.test_client(); J = lambda r: r.get_json()
    TOKEN = {"X-Tunefield-Confirm": tf.TUNEFIELD_CONFIRM_TOKEN}

    def wait_job(timeout=30):
        t = time.time()
        while not ui.JOB["done"] and time.time() - t < timeout:
            time.sleep(0.05)
        return dict(ui.JOB)

    def run(folder, action):
        r = c.post("/usb/run", json={"folder": folder, "action": action}, headers=TOKEN)
        return r, (wait_job() if r.status_code == 200 else None)

    j = J(c.get("/usb/sticks"))
    by = {s["name"]: s for s in j["sticks"]}
    check("the boot volume (a symlink) is not a stick", "Macintosh HD" not in by, list(by))
    check("an empty stick offers a fresh install into Tunefield-USB",
          by["EMPTY"]["installs"] == [] and by["EMPTY"]["fresh"]["folder"] == os.path.join(A, "Tunefield-USB")
          and by["EMPTY"]["fresh"]["refusal"] is None, by["EMPTY"])
    o = by["OLD"]["installs"]
    check("a 1.0.0 install offers update", len(o) == 1 and o[0]["folder"] == BF and o[0]["action"] == "update"
          and o[0]["version"] == "1.0.0" and o[0]["fields"] == 1, o)
    check("a plain Backup/data and a stray PORTABLE are not installs", by["NOTOURS"]["installs"] == [], by["NOTOURS"])
    o = by["SAME"]["installs"]
    check("a renamed folder at the same version offers repair", len(o) == 1 and o[0]["folder"] == DF and o[0]["action"] == "repair", o)
    o = by["NEWER"]["installs"][0]
    check("a newer stick is refused", o["action"] == "newer" and "1.2.0" in (o["refusal"] or ""), o)
    o = by["NOPORT"]["installs"]
    check("an app + library without PORTABLE is still found", len(o) == 1 and o[0]["action"] == "update", o)

    check("no token → 403", c.post("/usb/run", json={"folder": BF, "action": "update"}).status_code == 403)
    r = c.post("/usb/run", json={"folder": os.path.join(TMP, "elsewhere"), "action": "install"}, headers=TOKEN)
    check("a folder not on offer → 409, nothing written", r.status_code == 409 and not os.path.exists(os.path.join(TMP, "elsewhere")))
    r = c.post("/usb/run", json={"folder": BF, "action": "repair"}, headers=TOKEN)
    check("an action not on offer → 409", r.status_code == 409)
    r = c.post("/usb/run", json={"folder": EF, "action": "newer"}, headers=TOKEN)
    check("a newer stick → 409", r.status_code == 409 and "newer" in J(r)["refusal"])

    # update
    before = manifest(BF)
    r, job = run(BF, "update")
    check("update runs and reports the new version", r.status_code == 200 and job["ok"] and "1.1.0" in job["message"], job)
    check("…the app is 1.1.0", version_of(os.path.join(BF, "Tunefield.app")) == "1.1.0")
    check("…data/, music, PORTABLE: byte-for-byte and mtime equal", manifest(BF) == before)
    check("…no staging folder or old app left", not os.path.exists(os.path.join(BF, ".tunefield-update"))
          and not os.path.exists(os.path.join(BF, "Tunefield-old.app")))
    check("…the read-me is the new one, the docs are there",
          open(os.path.join(BF, "READ ME FIRST.txt")).read() != "old readme"
          and all(os.path.isfile(os.path.join(BF, n)) for n in ("LICENSE", "NOTICE.md", "tunefield-doctor.sh", "M2-MONITOR.md")))
    check("…no temp doc names left", not [n for n in os.listdir(BF) if n.endswith(".tunefield-tmp")])
    check("…the symlink inside the bundle survives", os.path.islink(os.path.join(BF, "Tunefield.app", "Contents", "lib-link")))
    check("…and the listing now says repair (up to date)",
          J(c.get("/usb/sticks"))["sticks"][[s["name"] for s in J(c.get("/usb/sticks"))["sticks"]].index("OLD")]["installs"][0]["action"] == "repair")

    r, job = run(FF, "update")
    check("an update leaves a missing PORTABLE missing", job and job["ok"] and not os.path.exists(os.path.join(FF, "PORTABLE")), job)

    # fresh
    r, job = run(os.path.join(A, "Tunefield-USB"), "install")
    AF = os.path.join(A, "Tunefield-USB")
    check("fresh install: app, PORTABLE and docs, no data/", job and job["ok"]
          and version_of(os.path.join(AF, "Tunefield.app")) == "1.1.0" and os.path.isfile(os.path.join(AF, "PORTABLE"))
          and os.path.isfile(os.path.join(AF, "READ ME FIRST.txt")) and not os.path.exists(os.path.join(AF, "data")), job)
    check("…no Pro note when this Mac has no key", "Pro" not in job["message"])

    # verify failure
    ui.VERIFY = lambda p: (False, "a sealed resource is missing or invalid")
    before = manifest(DF)
    r, job = run(DF, "repair")
    check("a failed verify: job fails, old app left, no staging", job and job["ok"] is False and "didn't check out" in job["message"]
          and version_of(os.path.join(DF, "Tunefield.app")) == "1.1.0"
          and not os.path.exists(os.path.join(DF, ".tunefield-update")) and manifest(DF) == before, job)
    ui.VERIFY = lambda p: (True, "")

    # refusals: running, space
    ui.running_under = lambda folder, ps_text=None, mount_text=None: folder == DF
    r = c.post("/usb/run", json={"folder": DF, "action": "repair"}, headers=TOKEN)
    check("running from that folder → 409 with the running message", r.status_code == 409 and J(r)["refusal"] == ui.MSG["running"])
    ui.running_under = lambda folder, ps_text=None, mount_text=None: False
    real_margin, ui.MARGIN = ui.MARGIN, 10 ** 15
    r = c.post("/usb/run", json={"folder": DF, "action": "repair"}, headers=TOKEN)
    check("short of space → 409 before anything is written", r.status_code == 409 and "Not enough space" in J(r)["refusal"]
          and not os.path.exists(os.path.join(DF, ".tunefield-update")))
    ui.MARGIN = real_margin

    # interrupted between the two renames: Tunefield-old.app visible, no Tunefield.app
    os.rename(os.path.join(DF, "Tunefield.app"), os.path.join(DF, "Tunefield-old.app"))
    make_app(os.path.join(DF, ".tunefield-update", "Tunefield.app"), "1.1.0")
    o = [s for s in J(c.get("/usb/sticks"))["sticks"] if s["name"] == "SAME"][0]["installs"]
    check("an interrupted swap is still found, as repair", len(o) == 1 and o[0]["action"] == "repair", o)
    ui.recover(DF)
    check("recover: the old app goes back, staging gone", os.path.isdir(os.path.join(DF, "Tunefield.app"))
          and not os.path.exists(os.path.join(DF, "Tunefield-old.app")) and not os.path.exists(os.path.join(DF, ".tunefield-update")))
    # a user's own Tunefield-old.app is not ours
    make_app(os.path.join(DF, "Tunefield-old.app"), "9.9.9", bundle_id="org.example.other")
    ui.recover(DF)
    check("recover leaves a Tunefield-old.app that isn't ours", os.path.isdir(os.path.join(DF, "Tunefield-old.app")))
    shutil.rmtree(os.path.join(DF, "Tunefield-old.app"))

    # pause hook at swap: old app untouched while it waits, then it finishes
    os.environ["TUNEFIELD_TEST_STICK_PAUSE"] = "swap"
    os.environ["TUNEFIELD_TEST_STICK_RESUME"] = RESUME
    os.environ["TUNEFIELD_TEST_STICK_VERSION"] = "1.1.1"     # the 'later update' leg, same payload
    r = c.post("/usb/run", json={"folder": DF, "action": "update"}, headers=TOKEN)
    t = time.time()
    while not os.path.exists(RESUME + ".at") and time.time() - t < 10:
        time.sleep(0.05)
    at = open(RESUME + ".at").read().strip() if os.path.exists(RESUME + ".at") else None
    check("TEST_STICK_VERSION=1.1.1 offers update over 1.1.0, and the pause hook stops at swap",
          r.status_code == 200 and at == "swap" and not ui.JOB["done"], (r.status_code, at))
    check("…while paused the old app is in place and the verified copy is staged",
          os.path.isdir(os.path.join(DF, "Tunefield.app")) and os.path.isdir(os.path.join(DF, ".tunefield-update", "Tunefield.app")))
    open(RESUME, "w").close()
    job = wait_job()
    check("…then it finishes, verified against the payload's own plist (1.1.0)", job["ok"], job)
    for k in ("TUNEFIELD_TEST_STICK_PAUSE", "TUNEFIELD_TEST_STICK_RESUME"):
        del os.environ[k]
    os.environ["TUNEFIELD_TEST_STICK_VERSION"] = "1.1.0"

    # running_under, unmocked
    from importlib import reload
    real = reload(ui).running_under
    ps = ("  1 /sbin/launchd\n 42 /Volumes/TFTEST/Tunefield-USB/Tunefield.app/Contents/MacOS/Tunefield\n"
          " 43 /private/var/folders/x/T/AppTranslocation/ABC-1/d/Tunefield.app/Contents/MacOS/Tunefield\n")
    mounts = "/Volumes/TFTEST 1/Tunefield-USB/Tunefield.app on /private/var/folders/x/T/AppTranslocation/ABC-1 (nullfs, local, nodev, nosuid, read-only, noowners, quarantine, mounted by mark)\n"
    check("running_under: a process under the folder", real("/Volumes/TFTEST/Tunefield-USB", ps, ""))
    check("…a translocated launch of the second, same-named stick", real("/Volumes/TFTEST 1/Tunefield-USB", ps, mounts))
    check("…and nothing for a third stick", not real("/Volumes/TFTEST 2/Tunefield-USB", ps, mounts))

    # space_needed
    ui._LAYOUT["/x"] = ([1, 32768, 32769], 2)
    c32 = 32768
    check("space_needed: whole clusters + a sidecar cluster per file on FAT32 + dirs + margin",
          ui.space_needed("/x", c32, "msdos") == (c32 + c32) + (c32 + c32) + (2 * c32 + c32) + 2 * c32 + ui.MARGIN)
    check("…and no sidecars on APFS", ui.space_needed("/x", 4096, "apfs") == 4096 + 32768 + 36864 + 2 * 4096 + ui.MARGIN)
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
