#!/usr/bin/env python3
"""Regression: the Ableton Live Arrangement-View export (1.1.0, E6) in als_export.py.

Builds sets from synthetic AlsTrack lists (the audio paths do not exist; the builder never
reads audio), gunzips and parses the XML, and checks the timeline, the warp, Live's id and
slot invariants, and that the Session-View export is byte-for-byte what it was before the
arrangement option existed (the baseline is the newest als_export.py in git history without
it, imported into a temp module).

Structural checks only: whether Live opens the result is checked by hand in Live.

    python3 scripts/test_als_arrangement.py
"""
import os, sys, gzip, math, shutil, tempfile, subprocess, importlib.util
import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
os.chdir(REPO)

import als_export as ax
from als_export import AlsTrack, build_live_set, write_als

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []

def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

TMP = tempfile.mkdtemp(prefix="tf-als-")
EPS = 1e-5

# ── helpers: read a built set the way Live would see it ──

def parse(data):
    return ET.fromstring(gzip.decompress(data)).find("LiveSet")

def V(el, path):
    return el.find(path).get("Value")

def F(el, path):
    return float(V(el, path))

def decks(ls):
    return [t for t in ls.find("Tracks") if t.tag == "AudioTrack"]

def arr_clips(track):
    return list(track.find("DeviceChain/MainSequencer/Sample/ArrangerAutomation/Events"))

def is_pointee(tag):
    return tag == "Pointee" or tag.endswith("AutomationTarget") or tag.endswith("ModulationTarget")

def pointee_problems(ls):
    ids = [int(n.get("Id")) for n in ls.iter() if is_pointee(n.tag) and n.get("Id") is not None]
    dups = sorted({i for i in ids if ids.count(i) > 1}) if len(ids) != len(set(ids)) else []
    nxt = int(V(ls, "NextPointeeId"))
    out = []
    if dups: out.append(f"duplicate pointee ids {dups[:5]}")
    if nxt <= max(ids): out.append(f"NextPointeeId {nxt} <= max {max(ids)}")
    return out

def slot_problems(ls):
    scenes = ls.findall("Scenes/Scene")
    n = len(scenes)
    out = []
    if [s.get("Id") for s in scenes] != [str(i) for i in range(n)]:
        out.append(f"scene ids {[s.get('Id') for s in scenes]}")
    for csl in ls.iter("ClipSlotList"):
        slots = csl.findall("ClipSlot")
        if not slots:
            continue                      # return tracks: Live writes them empty
        if len(slots) != n:
            out.append(f"ClipSlotList of {len(slots)} with {n} scenes")
        elif [s.get("Id") for s in slots] != [str(i) for i in range(n)]:
            out.append(f"ClipSlot ids {[s.get('Id') for s in slots]}")
    return out

def expected_plan(entries, tempo, overlap_bars):
    """Independent restatement of the spec: lengths in each clip's own beats,
    overlap = bars*4 clamped to 0..256 and to half of either neighbour."""
    want = min(max(overlap_bars, 0), 64) * 4
    L = [e.duration_sec * (e.bpm or tempo) / 60 if e.duration_sec else 128.0 for e in entries]
    over = [min(want, L[i] / 2, L[i + 1] / 2) for i in range(len(L) - 1)]
    starts = [0.0]
    for i, o in enumerate(over):
        starts.append(starts[-1] + L[i] - o)
    return starts, L, over

def timeline(ls):
    """{entry index: clip element} plus the deck each sits on, from the XML."""
    out = {}
    for d, tr in enumerate(decks(ls)):
        for c in arr_clips(tr):
            out[int(c.get("Id"))] = (d, c)
    return out

def check_mix(label, entries, *, tempo=None, overlap_bars=8, set_tempo=None):
    """All structural checks for one arrangement build."""
    kw = {} if tempo is None else {"tempo": tempo}
    data = build_live_set(entries, view="arrangement", overlap_bars=overlap_bars, **kw)
    ls = parse(data)
    set_tempo = set_tempo if set_tempo is not None else tempo
    starts, L, over = expected_plan(entries, set_tempo, overlap_bars)
    tl = timeline(ls)
    n = len(entries)
    tr = decks(ls)

    check(f"{label}: two deck tracks, named, before the returns",
          [V(t, "Name/EffectiveName") for t in tr] == ["TF Deck A", "TF Deck B"]
          and [t.tag for t in ls.find("Tracks")][:2] == ["AudioTrack", "AudioTrack"]
          and all(t.tag == "ReturnTrack" for t in list(ls.find("Tracks"))[2:]))
    check(f"{label}: one clip per entry, ids 0..n-1", sorted(tl) == list(range(n)), sorted(tl))
    if sorted(tl) != list(range(n)):
        return ls
    check(f"{label}: entries alternate Deck A / Deck B",
          all(tl[i][0] == i % 2 for i in range(n))
          and all(V(tl[i][1], "Name") == entries[i].display_name for i in range(n)),
          [(i, tl[i][0], V(tl[i][1], "Name")) for i in range(n)])

    pos = [(float(tl[i][1].get("Time")), F(tl[i][1], "CurrentStart"), F(tl[i][1], "CurrentEnd")) for i in range(n)]
    check(f"{label}: Time == CurrentStart on every clip", all(t == s for t, s, _ in pos), pos[:3])
    check(f"{label}: positions in beats as specified",
          all(abs(pos[i][0] - starts[i]) < EPS for i in range(n)),
          [(round(p[0], 4), round(s, 4)) for p, s in zip(pos, starts)][:6])
    check(f"{label}: clip lengths = duration x own BPM (or set tempo) / 60",
          all(abs((pos[i][2] - pos[i][1]) - L[i]) < EPS for i in range(n)),
          [(round(p[2] - p[1], 4), round(l, 4)) for p, l in zip(pos, L)][:6])
    real_over = [pos[i][2] - pos[i + 1][1] for i in range(n - 1)]
    check(f"{label}: consecutive overlaps as specified",
          all(abs(a - b) < EPS for a, b in zip(real_over, over)),
          [(round(a, 4), round(b, 4)) for a, b in zip(real_over, over)][:6])
    same = []
    for t in tr:
        cs = arr_clips(t)
        same.append([float(c.get("Time")) for c in cs] == sorted(float(c.get("Time")) for c in cs))
        for a, b in zip(cs, cs[1:]):
            same.append(F(b, "CurrentStart") >= F(a, "CurrentEnd"))
    check(f"{label}: same-deck clips never overlap; Events in time order", all(same))

    loops = []
    for i in range(n):
        c = tl[i][1]
        lp = c.find("Loop")
        loops.append(V(lp, "LoopOn") == "false" and F(lp, "LoopStart") == 0
                     and F(lp, "StartRelative") == 0
                     and abs((F(c, "CurrentEnd") - F(c, "CurrentStart")) - (F(lp, "LoopEnd") - F(lp, "LoopStart"))) < 1e-9
                     and F(lp, "OutMarker") == F(lp, "LoopEnd") == F(lp, "HiddenLoopEnd"))
    check(f"{label}: unlooped clips, CurrentEnd-CurrentStart == LoopEnd-LoopStart", all(loops))

    warp = []
    for i, e in enumerate(entries):
        c = tl[i][1]
        wm = c.findall("WarpMarkers/WarpMarker")
        bpm = e.bpm or set_tempo
        ok = V(c, "IsWarped") == "true" and len(wm) == 2 \
            and float(wm[0].get("SecTime")) == 0 and float(wm[0].get("BeatTime")) == 0
        if ok:
            sec, beat = float(wm[1].get("SecTime")), float(wm[1].get("BeatTime"))
            ok = abs(beat / sec * 60 - bpm) < 1e-6 * bpm
            if e.duration_sec:            # same two-marker grid as the session export
                ok = ok and sec == e.duration_sec and abs(beat - L[i]) < EPS
        warp.append(ok)
    check(f"{label}: warp markers put each clip's own BPM on the grid", all(warp),
          [i for i, w in enumerate(warp) if not w])
    main = ls.find("MainTrack")
    tempo_el = main.find(".//Tempo")
    target = tempo_el.find("AutomationTarget").get("Id")
    env = [e for e in main.findall("AutomationEnvelopes/Envelopes/AutomationEnvelope")
           if V(e, "EnvelopeTarget/PointeeId") == target]
    check(f"{label}: set tempo {set_tempo} in Manual and in the tempo envelope",
          F(tempo_el, "Manual") == set_tempo and len(env) == 1
          and [float(ev.get("Value")) for ev in env[0].find("Automation/Events")] == [set_tempo],
          (V(tempo_el, "Manual"), [ev.attrib for ev in env[0].find("Automation/Events")] if env else None))

    probs = pointee_problems(ls)
    check(f"{label}: pointee ids unique, NextPointeeId > max", not probs, probs)
    probs = slot_problems(ls)
    check(f"{label}: one scene; every ClipSlotList matches it", not probs and len(ls.findall("Scenes/Scene")) == 1, probs)
    check(f"{label}: session grid empty, decks follow the arrangement (SavedPlayingSlot -1)",
          all(t.find("DeviceChain/MainSequencer/ClipSlotList/ClipSlot/ClipSlot/Value/AudioClip") is None
              and V(t, "SavedPlayingSlot") == "-1" for t in tr))
    check(f"{label}: freeze sequencers left empty",
          all(len(t.find("DeviceChain/FreezeSequencer/Sample/ArrangerAutomation/Events")) == 0 for t in tr))
    ids_ok = all(len({c.get("Id") for c in arr_clips(t)}) == len(arr_clips(t)) for t in tr)
    check(f"{label}: clip ids unique within each track", ids_ok)
    tags_ok = all([ch.tag for ch in tl[i][1]] == TEMPLATE_CLIP_TAGS for i in range(n))
    check(f"{label}: arrangement clips keep the Live-written AudioClip layout", tags_ok)

    end = max(p[2] for p in pos)
    t = ls.find("Transport")
    check(f"{label}: loop brace covers the mix (off), playhead at 0",
          F(t, "LoopStart") == 0 and abs(F(t, "LoopLength") - end) < 1e-9
          and V(t, "LoopOn") == "false" and F(t, "CurrentTime") == 0,
          {c.tag: c.get("Value") for c in t})
    nav = ls.find("SequencerNavigator")
    shown = F(nav, "BeatTimeHelper/CurrentZoom") * int(nav.find("ClientSize").get("X"))
    check(f"{label}: opens in Arrangement View, zoomed to the whole mix",
          V(ls, "SelectedDocumentViewInMainWindow") == "0" and end <= shown <= end * 1.1
          and nav.find("ScrollerPos").get("X") == "0", (shown, end))
    return ls

# The Live-written clip the template carries; arrangement clips must mirror it.
_tmpl = ax._load_template()
TEMPLATE_CLIP_TAGS = [c.tag for c in _tmpl.find(".//ClipSlotList/ClipSlot/ClipSlot/Value/AudioClip")]

def T(i, bpm, dur, **kw):
    return AlsTrack(path=f"/no/such/dir/track{i:02d}.mp3", title=f"Track {i}", artist="Artist",
                    bpm=bpm, duration_sec=dur, sample_rate_hz=44100, **kw)

try:
    # ── the arrangement timeline ──
    MIX = [T(0, 126, 362.5, key="8A"), T(1, 128, 401.2), T(2, 124.5, 333.0, color=20),
           T(3, 130, 298.75), T(4, 127.3, 420.0), T(5, 126, 377.7), T(6, 125, 310.4)]
    check_mix("default 8 bars", MIX, set_tempo=126.0)
    check_mix("explicit tempo 124", MIX, tempo=124, set_tempo=124.0)
    check_mix("16 bars", MIX, overlap_bars=16, set_tempo=126.0)
    ls = check_mix("0 bars (end to end)", MIX, overlap_bars=0, set_tempo=126.0)
    tl = timeline(ls)
    check("0 bars: each clip starts exactly where the previous ends",
          all(abs(float(tl[i + 1][1].get("Time")) - F(tl[i][1], "CurrentEnd")) < EPS for i in range(len(MIX) - 1)))
    ls = check_mix("100 bars clamps to 64", MIX, overlap_bars=100, set_tempo=126.0)
    tl = timeline(ls)
    check("100 bars: overlap is 256 beats", abs(F(tl[0][1], "CurrentEnd") - float(tl[1][1].get("Time")) - 256) < EPS)
    ls = check_mix("-4 bars clamps to 0", MIX, overlap_bars=-4, set_tempo=126.0)
    tl = timeline(ls)
    check("-4 bars: no overlap", abs(F(tl[0][1], "CurrentEnd") - float(tl[1][1].get("Time"))) < EPS)
    check_mix("fractional 6.5 bars", MIX, overlap_bars=6.5, set_tempo=126.0)

    # Short tracks: the overlap is capped at half of either clip, so same-deck clips can't collide.
    SHORT = [T(0, 120, 10.0), T(1, 120, 600.0), T(2, 120, 12.0), T(3, 120, 9.0), T(4, 120, 400.0), T(5, 120, 2.0)]
    ls = check_mix("short clips, 8 bars", SHORT, set_tempo=120.0)
    tl = timeline(ls)
    check("short clips: a 20-beat clip overlaps its neighbour by 10 beats, not 32",
          abs(F(tl[0][1], "CurrentEnd") - float(tl[1][1].get("Time")) - 10) < EPS)
    check_mix("short clips, 64 bars", SHORT, overlap_bars=64, set_tempo=120.0)
    TINY = [T(0, 120, 600), T(1, 120, 3.0), T(2, 120, 600), T(3, 120, 3.0), T(4, 120, 600)]
    ls = check_mix("6-beat clips between long ones", TINY, overlap_bars=32, set_tempo=120.0)
    tl = timeline(ls)
    check("6-beat clip fully covered: deck A's next clip starts right where its last one ends",
          abs(float(tl[2][1].get("Time")) - F(tl[0][1], "CurrentEnd")) < EPS
          and float(tl[2][1].get("Time")) >= F(tl[0][1], "CurrentEnd"))

    # Missing data.
    NOBPM = [T(0, None, 300.0), T(1, 128, 360.0), T(2, None, 240.0), T(3, 122, None)]
    ls = check_mix("tracks without BPM / duration", NOBPM, set_tempo=128.0)
    tl = timeline(ls)
    check("no-BPM track warped at the set tempo (plays at natural speed)",
          abs(F(tl[0][1], "CurrentEnd") - 300.0 * 128 / 60) < EPS)
    c3 = tl[3][1]
    wm = c3.findall("WarpMarkers/WarpMarker")
    check("unknown duration: nominal 32 bars, Live's 1/32-beat tempo marker at its own BPM",
          abs(F(c3, "CurrentEnd") - F(c3, "CurrentStart") - 128) < EPS
          and float(wm[1].get("BeatTime")) == 0.03125
          and abs(0.03125 / float(wm[1].get("SecTime")) * 60 - 122) < 1e-6
          and V(c3, "SampleRef/DefaultDuration") == "0")
    check_mix("no BPM anywhere: 120", [T(0, None, 200.0), T(1, None, 250.0), T(2, None, 180.0)], set_tempo=120.0)
    check_mix("stringly-typed JSON numbers", [T(0, "126.0", "300"), T(1, "nan", "250.5"), T(2, 125, "inf")], set_tempo=126.0)
    ls = check_mix("single track", [T(0, 126, 300.0)], set_tempo=126.0)
    check("single track: Deck B has no clips", len(arr_clips(decks(ls)[1])) == 0)
    ls = check_mix("120-track mix", [T(i, 118 + (i * 7) % 15, 240 + (i * 37) % 200) for i in range(120)],
                   overlap_bars=16, set_tempo=118.0)

    # Names and paths.
    odd = [T(0, 126, 300.0), AlsTrack(path="/no/such/dir/x.mp3", title="Bad\x00Title\x07 & <tag>", bpm=126, duration_sec=200.0)]
    ls = parse(build_live_set(odd, view="arrangement"))
    check("control characters scrubbed, XML-special characters survive",
          V(timeline(ls)[1][1], "Name") == "Bad Title  & <tag>", V(timeline(ls)[1][1], "Name"))
    out = write_als(os.path.join(TMP, "sets", "mix.als"), MIX, view="arrangement", overlap_bars=8)
    with open(out, "rb") as fh:
        ls = parse(fh.read())
    fr = timeline(ls)[0][1].find("SampleRef/FileRef")
    check("write_als passes view through; samples referenced absolute + relative to the set",
          V(fr, "Path") == "/no/such/dir/track00.mp3" and V(fr, "RelativePathType") == "1"
          and V(fr, "RelativePath") == os.path.relpath("/no/such/dir/track00.mp3", os.path.join(TMP, "sets")))
    check("arrangement build is deterministic",
          build_live_set(MIX, view="arrangement") == build_live_set(MIX, view="arrangement"))

    # ── refusals ──
    def refused(**kw):
        try:
            build_live_set(kw.pop("entries", MIX), **kw); return None
        except ValueError as e:
            return str(e)
    check("unknown view refused", "view must be" in (refused(view="timeline") or ""))
    check("arrangement with warp=False refused", "warped" in (refused(view="arrangement", warp=False) or ""))
    check("non-numeric overlap refused",
          all(refused(view="arrangement", overlap_bars=b) for b in ("eight", None, float("nan"), True)))
    check("empty playlist refused", "empty" in (refused(entries=[], view="arrangement") or ""))
    check("bad tempo refused", "tempo" in (refused(view="arrangement", tempo=-1) or ""))

    # ── the Session-View export is unchanged, byte for byte ──
    def git(*args):
        return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, check=True).stdout
    base_src, base_rev = None, None
    try:
        for rev in git("log", "--format=%H", "--", "als_export.py").split():
            src = git("show", f"{rev}:als_export.py")
            if "view=\"arrangement\"" not in src and "_arrangement_plan" not in src:
                base_src, base_rev = src, rev; break
    except (OSError, subprocess.CalledProcessError) as e:
        base_src = None
    check("pre-arrangement als_export.py found in git history", base_src is not None)
    if base_src:
        bpath = os.path.join(TMP, "als_export_baseline.py")
        with open(bpath, "w") as fh:
            fh.write(base_src)
        spec = importlib.util.spec_from_file_location("als_export_baseline", bpath)
        base = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = base             # @dataclass looks its module up here
        spec.loader.exec_module(base)
        print(f"  (session baseline: als_export.py @ {base_rev[:7]})")

        def both(rows):
            return [AlsTrack(**r) for r in rows], [base.AlsTrack(**r) for r in rows]
        rows = [dict(path=f"/no/such/dir/t{i}.mp3", title=f"T{i}", artist="A", bpm=b, key=k,
                     duration_sec=d, sample_rate_hz=sr, color=c)
                for i, (b, k, d, sr, c) in enumerate([
                    (126, "8A", 362.5, 44100, None), (128.04, "9A", 401.2, 48000, 20), (None, None, 300.0, None, None),
                    ("124.5", "C minor", None, 44100, 5), (float("nan"), "1B", 250.0, 44100, None),
                    (130, "", 0.5, 96000, None), (127.3, "12A", 420.0, 44100, 69), (125, "3A", 310.4, 44100, None),
                    (121, "4B", 333.3, 44100, None)])]
        rows.append(dict(path="relative/odd\x01name.flac", title="Tab\tand\x0bvt", bpm=126, duration_sec=200.0))
        cases = [
            ("default, 10 tracks", rows, {}),
            ("exactly 8 tracks", rows[:8], {}),
            ("single track", rows[:1], {}),
            ("tempo + no warp", rows, dict(tempo=128.5, warp=False)),
            ("no scene tempo, custom deck names", rows, dict(scene_tempo=False, deck_names=("L", "R"))),
            ("set_path for relative paths", rows, dict(set_path=os.path.join(TMP, "out", "x.als"))),
        ]
        for label, rs, kw in cases:
            cur, old = both(rs)
            new_bytes = build_live_set(cur, **kw)
            check(f"session unchanged: {label}", new_bytes == base.build_live_set(old, **kw))
            check(f"session unchanged with view='session' + overlap_bars: {label}",
                  build_live_set(cur, view="session", overlap_bars=32, **kw) == new_bytes)
        cur, old = both(rows)
        a = write_als(os.path.join(TMP, "new", "s.als"), cur)
        b = base.write_als(os.path.join(TMP, "old", "s.als"), old)
        with open(a, "rb") as fa, open(b, "rb") as fb:
            check("session unchanged: write_als file bytes", fa.read() == fb.read())
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
