#!/usr/bin/env python3
"""Regression: serato_crate.py (build/read round trip, volume grouping, safe atomic write).

    python3 scripts/test_serato_crate.py
"""
import os, sys, tempfile, struct
from unittest import mock

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
import serato_crate as sc

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []

def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

# round trip, unicode, long paths
paths = ["Users/x/Music/a.mp3", "Música/Café Tacvba - Ré.mp3", "Müller/Über.flac",
         "音楽/日本語の曲.mp3", "d/" * 100 + "long.mp3"]
data = sc.build_crate(paths)
check("round trip", sc.read_crate(data) == paths)
check("empty crate round trip", sc.read_crate(sc.build_crate([])) == [])
check("starts with vrsn", data[:4] == b"vrsn" and struct.unpack(">I", data[4:8])[0] == 2 * len(sc.VERSION))
check("version string UTF-16BE", sc.VERSION.encode("utf-16-be") in data[:80])
check("column records present", all(c.encode("utf-16-be") in data for c in ("song", "artist", "bpm", "key", "length")))
try:
    sc.read_crate(data[:-3]); check("truncated data rejected", False)
except ValueError:
    check("truncated data rejected", True)

# grouping
t = sc.crate_targets(["/Users/x/Music/a.mp3", "/Volumes/SSD/DJ/b.mp3", "/Volumes/SSD/c.mp3",
                      "/Volumes/USB 2/Tunes/d.mp3", "/opt/e.mp3"], home="/Users/x")
sysd = "/Users/x/Music/_Serato_/Subcrates"
check("three targets", set(t) == {sysd, "/Volumes/SSD/_Serato_/Subcrates", "/Volumes/USB 2/_Serato_/Subcrates"}, str(t))
check("system disk relative to /", t[sysd] == ["Users/x/Music/a.mp3", "opt/e.mp3"], str(t[sysd]))
check("volume relative to volume root", t["/Volumes/SSD/_Serato_/Subcrates"] == ["DJ/b.mp3", "c.mp3"])
check("no leading slash anywhere", all(not p.startswith("/") for v in t.values() for p in v))
check("home default", list(sc.crate_targets(["/x/a.mp3"]))[0].startswith(os.path.expanduser("~")))
try:
    sc.crate_targets(["rel/a.mp3"]); check("relative input rejected", False)
except ValueError:
    check("relative input rejected", True)

# filename
fn = sc.crate_filename
check("plain", fn("My Set") == "My Set.crate")
check("slash/colon", "/" not in fn("a/b:c") and ":" not in fn("a/b:c"), fn("a/b:c"))
check("control chars", fn("a\nb\x00c") == "a_b_c.crate", fn("a\nb\x00c"))
check("leading dots", not fn("..hidden").startswith("."), fn("..hidden"))
check("no %%", "%%" not in fn("a%%b%%%%c"), fn("a%%b%%%%c"))
check("empty -> Untitled", fn("") == "Untitled.crate" and fn("...") == "Untitled.crate")
check("unicode kept", fn("日本 é") == "日本 é.crate")
check("long name capped", len(fn("é" * 500).encode()) <= 255)

# write
d = tempfile.mkdtemp(prefix="tf-crate-")
sub = os.path.join(d, "_Serato_", "Subcrates")
try:
    sc.write_crate(sub, "S", ["a.mp3"]); check("missing _Serato_ raises", False)
except FileNotFoundError:
    check("missing _Serato_ raises", True)
check("_Serato_ not created", not os.path.exists(os.path.join(d, "_Serato_")))
os.makedirs(os.path.join(d, "_Serato_"))
p = sc.write_crate(sub, "S", ["a.mp3"])
check("creates Subcrates under existing _Serato_", p == os.path.join(sub, "S.crate") and sc.read_crate(open(p, "rb").read()) == ["a.mp3"])
try:
    sc.write_crate(sub, "S", ["b.mp3"]); check("refuses overwrite", False)
except FileExistsError:
    check("refuses overwrite", True)
check("old crate intact after refusal", sc.read_crate(open(p, "rb").read()) == ["a.mp3"])
sc.write_crate(sub, "S", ["b.mp3"], overwrite=True)
check("overwrite=True replaces", sc.read_crate(open(p, "rb").read()) == ["b.mp3"])
with mock.patch("os.replace", side_effect=OSError("boom")):
    try:
        sc.write_crate(sub, "S", ["c.mp3"], overwrite=True); check("failure propagates", False)
    except OSError:
        check("failure propagates", True)
check("no temp left after failed replace", os.listdir(sub) == ["S.crate"], str(os.listdir(sub)))
check("old crate intact after failure", sc.read_crate(open(p, "rb").read()) == ["b.mp3"])
with mock.patch("serato_crate.build_crate", side_effect=RuntimeError("x")):
    try: sc.write_crate(sub, "T", ["c.mp3"])
    except RuntimeError: pass
check("no temp after build failure", os.listdir(sub) == ["S.crate"])
with mock.patch("os.fsync", side_effect=OSError("disk")):
    try: sc.write_crate(sub, "U", ["c.mp3"])
    except OSError: pass
check("no temp/partial after mid-write failure", os.listdir(sub) == ["S.crate"], str(os.listdir(sub)))

print(f"\n{len(failures)} failed" if failures else "\nall passed")
sys.exit(1 if failures else 0)
