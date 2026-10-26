#!/usr/bin/env python3
"""Regression: in-place analyse must accept a path again once the entry, the Field, or
the whole catalog that held it has been removed.

_COMMITTED_PATHS (app.py) is a process-global {slug: set(paths)} that lets concurrent
analyse requests dedup against each other. Until 2026-09-02 nothing ever removed paths
from it, so for the life of the process any path analysed once was refused forever as
"already cataloged" — after being decoded in full — even into a Field that had been
deleted and re-created empty. Mark hit it re-creating Curve: three passes over 46
tracks, ~12 minutes of librosa, 0 added.

Runs against an isolated TUNEFIELD_ROOT and touches nothing in the repo's data/.

    python3 scripts/test_reanalyse_after_removal.py
"""
import os, sys, math, wave, struct, tempfile, shutil

ROOT = tempfile.mkdtemp(prefix="tf-reanalyse-")
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

def make_wav(path, secs=4, sr=22050, f=220.0):
    """Mono 16-bit tone with a 2 Hz amplitude pulse, so tempo estimation has something."""
    n = sr * secs
    frames = b"".join(
        struct.pack("<h", int(12000 * math.sin(2 * math.pi * f * i / sr)
                                  * (0.55 + 0.45 * math.sin(2 * math.pi * 2 * i / sr))))
        for i in range(n))
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(frames)

try:
    import app as tf
    c = tf.app.test_client()
    J = lambda r: r.get_json()

    wavs = [os.path.join(MUSIC, f"tone{i}.wav") for i in range(2)]
    for i, p in enumerate(wavs): make_wav(p, f=220.0 + 110.0 * i)

    check("create Field 'Curve' → slug curve", J(c.post("/catalogs", json={"name": "Curve"})).get("slug") == "curve")
    r = J(c.post("/library/roots", json={"path": MUSIC, "cat": "curve"}))
    check("register music folder on curve", r.get("ok") is True, r)

    def analyse(paths):
        return J(c.post("/library/analyse", json={"paths": paths, "duration": 2, "cat": "curve"}))

    j = analyse(wavs)
    check("baseline: first analyse adds both tracks", j.get("added_count") == 2, j)
    j = analyse(wavs[:1])
    check("baseline: same path again is refused (dedup intact)",
          j.get("added_count") == 0 and j.get("already_count") == 1 and not j.get("errors"), j)

    # A — Mark's case: delete the Field, re-create it (same slug), analyse the same folder
    check("A: DELETE /catalogs/curve", J(c.delete("/catalogs/curve")).get("ok") is True)
    check("A: delete_catalog drops the dedup memory", "curve" not in tf._COMMITTED_PATHS)
    check("A: re-create → same slug", J(c.post("/catalogs", json={"name": "Curve"})).get("slug") == "curve")
    j = analyse(wavs)
    check("A: analyse into the re-created Field adds both", j.get("added_count") == 2, j)

    # B — clear the Field in place
    check("B: DELETE /catalog?cat=curve (clear)", J(c.delete("/catalog?cat=curve")).get("ok") is True)
    check("B: clear_catalog drops the dedup memory", "curve" not in tf._COMMITTED_PATHS)
    j = analyse(wavs)
    check("B: analyse after clear adds both", j.get("added_count") == 2, j)

    # C — remove a single entry
    ents = J(c.get("/catalog?cat=curve"))
    check("C: Field holds 2 entries", isinstance(ents, list) and len(ents) == 2, ents)
    victim = ents[0]; vpath = os.path.join(MUSIC, victim["filename"])
    check("C: DELETE /catalog/<id>", J(c.delete(f"/catalog/{victim['id']}?cat=curve")).get("ok") is True)
    check("C: delete-entry drops the dedup memory", "curve" not in tf._COMMITTED_PATHS)
    j = analyse([vpath])
    check("C: analyse re-adds the removed track", j.get("added_count") == 1, j)
    j = analyse([os.path.join(MUSIC, ents[1]["filename"])])
    check("C: the untouched track is still refused", j.get("added_count") == 0
          and j.get("already_count") == 1 and not j.get("errors"), j)
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

if failures:
    print(f"\n{FAIL} {len(failures)} failure(s): " + "; ".join(failures)); sys.exit(1)
print(f"\n{OK} all checks passed"); sys.exit(0)
