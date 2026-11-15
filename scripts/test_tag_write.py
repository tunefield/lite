#!/usr/bin/env python3
"""Regression: E4 tag writing engine (tag_write.py, 1.1.0).

Writes BPM / key / energy into real MP3, FLAC, M4A and AIFF files made with ffmpeg, then
proves: each field reads back, untouched fields and other tags stay, ID3v2.3 stays v2.3,
the audio is byte-identical (own extraction AND ffmpeg -map 0:a -c copy md5), restore puts
the old values back (removing fields that were absent), and every refusal / failure path
leaves the original byte-identical with no `.tftmp-*` or `._.tftmp-*` left behind.

Works in a fresh temp folder only; never touches a music library. Needs ffmpeg.

    .venv/bin/python scripts/test_tag_write.py
"""
import os, sys, stat, time, errno, shutil, struct, hashlib, tempfile, subprocess, contextlib, collections

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
os.chdir(REPO)

import tag_write as tw
import mutagen
from mutagen.id3 import ID3, COMM, APIC, TYER
from mutagen.flac import FLAC
from mutagen.mp4 import MP4
from mutagen.aiff import AIFF

OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"
failures = []

def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}"))
    if not cond: failures.append(label)

FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
W = tempfile.mkdtemp(prefix="tf-tagwrite-")
FIX = os.path.join(W, "fixtures"); os.makedirs(FIX)

def ff(name, *args):
    out = os.path.join(FIX, name)
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    *args, out], check=True)
    return out

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

def ffmd5(p):
    r = subprocess.run([FFMPEG, "-v", "error", "-i", p, "-map", "0:a", "-c", "copy", "-f", "md5", "-"],
                       capture_output=True, text=True)
    return r.stdout.strip() or ("ERR " + r.stderr.strip())

# ── independent audio extraction (deliberately not tag_write's code) ──
def payload(p, ext=None):
    b = open(p, "rb").read()
    ext = ext or os.path.splitext(p)[1].lower()
    if ext == ".mp3":
        start = 0
        if b[:3] == b"ID3":
            s = b[6:10]
            start = 10 + ((s[0] << 21) | (s[1] << 14) | (s[2] << 7) | s[3]) + (10 if b[3] == 4 and b[5] & 0x10 else 0)
        end = len(b)
        if b[end - 128:end - 125] == b"TAG": end -= 128
        if b[end - 32:end - 24] == b"APETAGEX":
            size, flags = struct.unpack("<I4xI", b[end - 20:end - 8])
            end -= size + (32 if flags & 0x80000000 else 0)
        return b[start:end]
    if ext == ".flac":
        q = b.index(b"fLaC") + 4
        while True:
            last, ln = b[q] & 0x80, int.from_bytes(b[q + 1:q + 4], "big")
            q += 4 + ln
            if last: return b[q:]
    if ext in (".m4a", ".mp4", ".m4b"):
        out, q = [], 0
        while q + 8 <= len(b):
            size, typ = struct.unpack(">I4s", b[q:q + 8]); hl = 8
            if size == 1: size, hl = struct.unpack(">Q", b[q + 8:q + 16])[0], 16
            elif size == 0: size = len(b) - q
            if typ == b"mdat": out.append(b[q + hl:q + size])
            q += size
        return b"".join(out)
    if ext in (".aif", ".aiff"):
        q = 12
        while q + 8 <= len(b):
            cid, ln = struct.unpack(">4sI", b[q:q + 8])
            if cid == b"SSND": return b[q + 8:q + 8 + ln]
            q += 8 + ln + (ln & 1)
    raise ValueError(p)

def id3_version(p):
    b = open(p, "rb").read(10)
    return b[3] if b[:3] == b"ID3" else None

def temps_left(folder):
    return [n for n in os.listdir(folder) if n.startswith(".tftmp-") or n.startswith("._.tftmp-")]

def reason(fn, *a):
    try:
        fn(*a); return None
    except tw.TagWriteError as e:
        return e.reason

@contextlib.contextmanager
def patched(obj, name, value):
    old = getattr(obj, name)
    setattr(obj, name, value)
    try: yield
    finally: setattr(obj, name, old)

def place(src, folder, name):
    os.makedirs(folder, exist_ok=True)
    dst = os.path.join(folder, name)
    shutil.copy2(src, dst)
    return dst

try:
    # ── fixtures ──
    sine = ["-ar", "44100", "-ac", "2"]
    mp3_v23 = ff("v23.mp3", *sine, "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3",
                 "-metadata", "title=Old Title", "-metadata", "artist=Old Artist", "-metadata", "genre=Techno",
                 "-metadata", "TBPM=120", "-metadata", "TKEY=Am", "-metadata", "ENERGY=5", "-metadata", "MOOD=calm")
    t = ID3(mp3_v23, translate=False)                   # add frames ffmpeg doesn't write
    t.add(COMM(encoding=1, lang="eng", desc="", text=["a comment, keep me"]))
    t.add(TYER(encoding=0, text=["1999"]))
    t.add(APIC(encoding=0, mime="image/png", type=3, desc="cover", data=b"\x89PNG" + os.urandom(3000)))
    t.save(mp3_v23, v2_version=3, v1=0)
    mp3_none = ff("none.mp3", *sine, "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0", "-write_id3v1", "0")
    mp3_v1 = ff("v1.mp3", *sine, "-c:a", "libmp3lame", "-b:a", "192k", "-write_id3v1", "1",
                "-metadata", "title=V1 Title", "-metadata", "artist=V1 Artist")
    flac = ff("t.flac", *sine, "-c:a", "flac", "-metadata", "title=Flac Title", "-metadata", "MOOD=calm",
              "-metadata", "comment=flac comment")
    m4a = ff("t.m4a", *sine, "-c:a", "aac", "-b:a", "128k", "-metadata", "title=M4A Title", "-metadata", "genre=House")
    m4a_fs = ff("fs.m4a", *sine, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-metadata", "title=FS Title")
    aiff24 = ff("v24.aiff", *sine, "-c:a", "pcm_s16be", "-write_id3v2", "1", "-metadata", "title=Aiff Title")
    aiff23 = ff("v23.aif", *sine, "-c:a", "pcm_s16be", "-write_id3v2", "1", "-id3v2_version", "3",
                "-metadata", "title=Aiff23", "-metadata", "TBPM=100", "-metadata", "TKEY=F#m")
    aiff_none = ff("none.aiff", *sine, "-c:a", "pcm_s16be")
    wav = ff("t.wav", *sine, "-c:a", "pcm_s16le")
    ogg = ff("t.ogg", "-ar", "48000", "-ac", "2", "-c:a", "libopus")

    check("fixture: v2.3 MP3 carries TBPM/TKEY/TXXX:ENERGY/TXXX:MOOD/COMM/APIC",
          id3_version(mp3_v23) == 3 and all(k in ID3(mp3_v23) for k in
              ("TBPM", "TKEY", "TXXX:ENERGY", "TXXX:MOOD", "COMM::eng", "APIC:cover")), ID3(mp3_v23).keys())
    check("fixture: untagged MP3 starts with an MPEG frame", open(mp3_none, "rb").read(2)[0] == 0xFF)
    check("fixture: ID3v1 MP3 ends with TAG", open(mp3_v1, "rb").read()[-128:-125] == b"TAG")
    check("fixture: AIFFs carry ID3v2.4 / v2.3 / nothing",
          AIFF(aiff24).tags.version[1] == 4 and AIFF(aiff23).tags.version[1] == 3 and AIFF(aiff_none).tags is None)

    # ── per format: write, read back, audio identical, restore ──
    BPM_TXT = {"mp3": "128", "aiff": "128", "mp4": "128", "flac": "127.60"}
    cases = [("mp3 v2.3", mp3_v23, "mp3"), ("mp3 untagged", mp3_none, "mp3"), ("mp3 + ID3v1", mp3_v1, "mp3"),
             ("flac", flac, "flac"), ("m4a", m4a, "mp4"), ("m4a faststart", m4a_fs, "mp4"),
             ("aiff v2.4", aiff24, "aiff"), ("aiff v2.3", aiff23, "aiff"), ("aiff untagged", aiff_none, "aiff")]
    for label, src, kind in cases:
        p = place(src, os.path.join(W, "fmt"), os.path.basename(src))
        sha0, md50, pay0, ver0 = sha(p), ffmd5(p), payload(p), id3_version(p)
        before = tw.read_values(p)
        others0 = mutagen.File(p).tags
        others0 = {k: v for k, v in (others0.items() if others0 is not None else [])}
        check(f"{label}: check() says writable", tw.check(p, {"bpm": 127.6, "key": "8A", "energy": 7}) is None)
        r = tw.write(p, {"bpm": 127.6, "key": "8A", "energy": 7})
        st = os.stat(p)
        check(f"{label}: write returns old values, size, mtime",
              r["old"] == before and r["size"] == st.st_size and r["mtime"] == st.st_mtime, r)
        got = tw.read_values(p)
        check(f"{label}: bpm/key/energy read back", got == {"bpm": BPM_TXT[kind], "key": "8A", "energy": "7"}, got)
        # an independent read of the exact atoms / frames the contract names
        if kind in ("mp3", "aiff"):
            t = ID3(p) if kind == "mp3" else AIFF(p).tags
            raw_ok = t["TBPM"].text == ["128"] and t["TKEY"].text == ["8A"] and t["TXXX:ENERGY"].text == ["7"]
        elif kind == "flac":
            t = FLAC(p).tags
            raw_ok = t["BPM"] == ["127.60"] and t["INITIALKEY"] == ["8A"] and t["ENERGY"] == ["7"]
        else:
            t = MP4(p).tags
            raw_ok = (t["tmpo"] == [128] and bytes(t["----:com.apple.iTunes:initialkey"][0]) == b"8A"
                      and bytes(t["----:com.apple.iTunes:ENERGY"][0]) == b"7")
        check(f"{label}: stored in the contract's frames/atoms", raw_ok)
        check(f"{label}: audio payload byte-identical (own extraction)", payload(p) == pay0)
        check(f"{label}: ffmpeg -map 0:a -c copy md5 unchanged", ffmd5(p) == md50, (md50, ffmd5(p)))
        others1 = {k: v for k, v in mutagen.File(p).tags.items()}
        targets = {"TBPM", "TKEY", "TXXX:ENERGY", "bpm", "initialkey", "energy", "tmpo",
                   "----:com.apple.iTunes:initialkey", "----:com.apple.iTunes:ENERGY"}
        kept = all(str(others1.get(k)) == str(v) for k, v in others0.items() if k not in targets)
        check(f"{label}: every other tag unchanged", kept,
              [k for k, v in others0.items() if k not in targets and str(others1.get(k)) != str(v)])
        if kind in ("mp3",):
            check(f"{label}: ID3 version kept (none -> v2.4)", id3_version(p) == (ver0 or 4), id3_version(p))
        if kind == "aiff":
            check(f"{label}: AIFF ID3 version kept (none -> v2.4)",
                  AIFF(p).tags.version[1] == (AIFF(src).tags.version[1] if AIFF(src).tags else 4))
        check(f"{label}: no temp files left", temps_left(os.path.dirname(p)) == [])
        if label == "m4a faststart":
            check("m4a faststart: mdat moved, so the chunk-offset path was exercised",
                  open(p, "rb").read().find(b"mdat") != open(src, "rb").read().find(b"mdat"))

        r2 = tw.restore(p, r["old"], r["size"], r["mtime"])
        st = os.stat(p)
        check(f"{label}: restore brings the old values back", tw.read_values(p) == before, tw.read_values(p))
        check(f"{label}: restore returns size/mtime", r2 == {"size": st.st_size, "mtime": st.st_mtime})
        check(f"{label}: audio still identical after restore", payload(p) == pay0 and ffmd5(p) == md50)
        if kind in ("mp3", "aiff") and ver0:
            check(f"{label}: version still v2.{ver0} after restore" if kind == "mp3" else f"{label}: version kept after restore",
                  (id3_version(p) if kind == "mp3" else AIFF(p).tags.version[1]) ==
                  (ver0 if kind == "mp3" else AIFF(src).tags.version[1]))
        if label in ("mp3 untagged", "aiff untagged"):
            check(f"{label}: restore leaves the file byte-identical to the original", sha(p) == sha0)
        check(f"{label}: no temp files left after restore", temps_left(os.path.dirname(p)) == [])

    # ── untouched fields, v2.3, ID3v1 ──
    d = os.path.join(W, "partial")
    p = place(mp3_v23, d, "v23.mp3")
    tw.write(p, {"bpm": 124, "key": None, "energy": None})
    v = tw.read_values(p)
    check("only bpm written: key and energy untouched", v == {"bpm": "124", "key": "Am", "energy": "5"}, v)
    t = ID3(p, translate=False)
    check("v2.3 stays v2.3", id3_version(p) == 3 and t.version[:2] == (2, 3))
    check("title/artist/genre/comment/TYER/TXXX:MOOD/APIC kept",
          str(t["TIT2"]) == "Old Title" and str(t["TPE1"]) == "Old Artist" and str(t["TCON"]) == "Techno"
          and t["COMM::eng"].text == ["a comment, keep me"] and str(t["TYER"]) == "1999"
          and t["TXXX:MOOD"].text == ["calm"] and len(t["APIC:cover"].data) == 3004)
    m0 = os.stat(p).st_mtime_ns
    r = tw.write(p, {"bpm": 124.2, "key": "Am"})
    check("same values again: file not rewritten", os.stat(p).st_mtime_ns == m0 and r["old"]["bpm"] == "124")

    p = place(mp3_v1, d, "v1.mp3")
    tail0 = open(p, "rb").read()[-128:]
    tw.write(p, {"bpm": 90, "key": "C#", "energy": 3})
    check("ID3v1 tail byte-identical", open(p, "rb").read()[-128:] == tail0)
    check("ID3v1 title still there", open(p, "rb").read()[-125:-95].rstrip(b"\0 ") == b"V1 Title")

    p = place(flac, d, "nobpm.flac")
    r = tw.write(p, {"bpm": 140})
    check("FLAC without BPM: old bpm is None", r["old"]["bpm"] is None and tw.read_values(p)["bpm"] == "140.00")
    tw.restore(p, r["old"], r["size"], r["mtime"])
    check("restore removes BPM that was absent", "BPM" not in FLAC(p).tags and FLAC(p).tags["MOOD"] == ["calm"])

    p = place(mp3_v23, d, "only-old-keys.mp3")
    r = tw.write(p, {"bpm": 99, "energy": 9})
    tw.restore(p, {"bpm": r["old"]["bpm"]}, r["size"], r["mtime"])
    check("restore with only some keys leaves the others", tw.read_values(p) == {"bpm": "120", "key": "Am", "energy": "9"},
          tw.read_values(p))

    # ── restore refuses after the file changed ──
    p = place(mp3_none, d, "changed.mp3")
    r = tw.write(p, {"bpm": 128})
    os.utime(p, (r["mtime"] + 5, r["mtime"] + 5))
    sha1 = sha(p)
    check("restore refuses when mtime moved", reason(tw.restore, p, r["old"], r["size"], r["mtime"]) == tw.R_CHANGED)
    with open(p, "ab") as f: f.write(b"\0")
    check("restore refuses when size moved", reason(tw.restore, p, r["old"], r["size"], os.stat(p).st_mtime) == tw.R_CHANGED)
    check("refused restore left the file alone", tw.read_values(p)["bpm"] == "128")

    # ── refusals ──
    d = os.path.join(W, "refuse")
    p = place(mp3_v23, d, "ro.mp3"); sha0 = sha(p)
    os.chmod(p, 0o444)
    check("read-only file: check() says read-only", tw.check(p, {"bpm": 120}) == tw.R_READONLY)
    check("read-only file: write refused", reason(tw.write, p, {"bpm": 120}) == tw.R_READONLY and sha(p) == sha0)
    os.chmod(p, 0o644)
    rod = os.path.join(W, "ro-folder"); p = place(mp3_v23, rod, "song.mp3"); sha0 = sha(p)
    os.chmod(rod, 0o555)
    check("read-only folder: check() says read-only", tw.check(p, {"bpm": 120}) == tw.R_READONLY)
    check("read-only folder: write refused", reason(tw.write, p, {"bpm": 120}) == tw.R_READONLY and sha(p) == sha0)
    os.chmod(rod, 0o755)
    for src in (wav, ogg):
        p = place(src, d, os.path.basename(src)); sha0, m0 = sha(p), os.stat(p).st_mtime_ns
        with patched(tw.shutil, "copy2", lambda *a, **k: (_ for _ in ()).throw(AssertionError("copied"))):
            check(f"{os.path.basename(src)}: refused 'format not supported for tag writing'",
                  tw.check(p, {"bpm": 120}) == tw.R_FORMAT and reason(tw.write, p, {"bpm": 120}) == tw.R_FORMAT
                  and reason(tw.read_values, p) == tw.R_FORMAT)
        check(f"{os.path.basename(src)}: untouched", sha(p) == sha0 and os.stat(p).st_mtime_ns == m0)
    p = place(mp3_v23, d, "space.mp3"); sha0 = sha(p)
    Usage = collections.namedtuple("Usage", "total used free")
    with patched(tw.shutil, "disk_usage", lambda _: Usage(10**9, 10**9, os.path.getsize(p) + 1000)):
        check("low disk: check() says not enough space", tw.check(p, {"bpm": 120}) == tw.R_SPACE)
        check("low disk: write refused, file untouched", reason(tw.write, p, {"bpm": 120}) == tw.R_SPACE and sha(p) == sha0)
    with patched(tw, "_MAX_NAME_UNITS", 8):
        check("name over the UTF-16 limit: 'name too long', untouched",
              tw.check(p, {"bpm": 120}) == tw.R_NAME and reason(tw.write, p, {"bpm": 120}) == tw.R_NAME and sha(p) == sha0)
    for bad in ({"energy": 11}, {"energy": 0}, {"energy": 7.5}, {"bpm": 0}, {"bpm": float("nan")},
                {"bpm": True}, {"key": ""}, {"key": "A\nm"}, {"title": "x"}):
        check(f"invalid {bad}: refused", (tw.check(p, bad) or "").startswith(tw.R_INVALID) and sha(p) == sha0)
    check("missing file: 'file not found'", tw.check(os.path.join(d, "nope.mp3"), {"bpm": 1}) == tw.R_MISSING)

    # tags mutagen can't carry through unchanged
    raw = open(mp3_none, "rb").read()
    def id3_tag(major, frames):
        n = len(frames) + 64
        return b"ID3" + bytes([major, 0, 0]) + bytes([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]) + frames + b"\0" * 64
    junk = b"TIT2" + struct.pack(">IH", 4, 0) + b"\x00abc" + b"COMM" + struct.pack(">IH", 4, 0) + b"\x09xyz"
    p = os.path.join(d, "junk.mp3"); open(p, "wb").write(id3_tag(3, junk) + raw); sha0 = sha(p)
    check("ID3 frame mutagen would drop: refused, untouched",
          tw.check(p, {"bpm": 120}) == tw.R_TAGS and reason(tw.write, p, {"bpm": 120}) == tw.R_TAGS and sha(p) == sha0)
    p = os.path.join(d, "v22.mp3"); open(p, "wb").write(id3_tag(2, b"TT2\x00\x00\x04\x00abc") + raw); sha0 = sha(p)
    check("ID3v2.2 tag: refused, untouched", tw.check(p, {"bpm": 120}) == tw.R_TAGS and sha(p) == sha0)
    fb = bytearray(open(flac, "rb").read()); q = 4
    while fb[q] & 0x7F != 4: q += 4 + int.from_bytes(fb[q + 1:q + 4], "big")
    ln = int.from_bytes(fb[q + 1:q + 4], "big")
    vc = bytes(fb[q + 4:q + 4 + ln])
    vl = int.from_bytes(vc[:4], "little"); cnt = int.from_bytes(vc[4 + vl:8 + vl], "little")
    bad = b"ARTIST=\xff\xfe broken"
    vc2 = vc[:4 + vl] + (cnt + 1).to_bytes(4, "little") + vc[8 + vl:] + len(bad).to_bytes(4, "little") + bad
    fb[q + 1:q + 4 + ln] = len(vc2).to_bytes(3, "big") + vc2
    p = os.path.join(d, "badutf8.flac"); open(p, "wb").write(bytes(fb)); sha0 = sha(p)
    check("FLAC comment that is not UTF-8: refused, untouched", tw.check(p, {"bpm": 120}) == tw.R_TAGS and sha(p) == sha0)

    # ── failures mid-write leave the original byte-identical and no temp ──
    d = os.path.join(W, "fail")
    def boom(*a, **k): raise OSError(errno.EIO, "simulated failure")
    def plant_sidecar(src, dst):        # what macOS does on FAT32: an AppleDouble twin of the temp
        open(os.path.join(os.path.dirname(dst), "._" + os.path.basename(dst)), "wb").write(b"\0" * 82)
    def flip_audio(temp_attr):          # flip one bit in the middle of the temp's audio payload
        def write(job):
            orig(job)
            pay, b = payload(job.temp, os.path.splitext(job.real)[1]), open(job.temp, "rb").read()
            at = b.find(pay) + len(pay) // 2
            with open(job.temp, "r+b") as f:
                f.seek(at); f.write(bytes([b[at] ^ 1]))
        return write
    for label, src, target, name, value, want in [
        ("os.replace raises", mp3_v23, tw.os, "replace", boom, tw.R_FAILED),
        ("mutagen ID3 save raises", mp3_v23, tw.ID3, "save", boom, tw.R_FAILED),
        ("mutagen FLAC save raises", flac, tw.FLAC, "save", boom, tw.R_FAILED),
        ("mutagen MP4 save raises", m4a_fs, tw.MP4, "save", boom, tw.R_FAILED),
        ("mutagen AIFF ID3 save raises", aiff24, type(AIFF(aiff24).tags), "save", boom, tw.R_FAILED),
        ("fsync raises", flac, tw, "_fsync_path", boom, tw.R_FAILED),
    ]:
        p = place(src, d, os.path.basename(src)); sha0 = sha(p)
        with patched(target, name, value), patched(tw, "_copy_xattrs", plant_sidecar):
            got = reason(tw.write, p, {"bpm": 125, "key": "5A", "energy": 6})
        check(f"{label}: refused '{want}', original byte-identical, no .tftmp/._.tftmp left",
              got == want and sha(p) == sha0 and temps_left(d) == [], (got, temps_left(d)))
    for src, fn in [(mp3_v23, "_write_mp3"), (flac, "_write_flac"), (m4a, "_write_mp4"), (aiff24, "_write_aiff")]:
        p = place(src, d, "corrupt-" + os.path.basename(src)); sha0 = sha(p)
        orig = getattr(tw, fn)
        with patched(tw, fn, flip_audio(fn)):
            got = reason(tw.write, p, {"bpm": 125})
        check(f"{os.path.splitext(src)[1]}: an audio byte flipped in the temp -> 'verification failed', untouched",
              got == tw.R_VERIFY and sha(p) == sha0 and temps_left(d) == [], got)
    p = place(mp3_v23, d, "sidecar.mp3")
    with patched(tw, "_copy_xattrs", plant_sidecar):
        tw.write(p, {"bpm": 126})
    check("after a good write: no ._.tftmp sidecar left", temps_left(d) == [] and tw.read_values(p)["bpm"] == "126")

    # ── names and paths ──
    uni = os.path.join(W, "Tëst Földer ♫ mit Leerzeichen")
    for name in ("Café del Mar – Ñandú 🎵.mp3", "_Intro Edit.mp3", "Long " + "x" * 190 + " ä.flac"):
        src = flac if name.endswith(".flac") else mp3_v23
        p = place(src, uni, name); pay0 = payload(p)
        r = tw.write(p, {"bpm": 100, "key": "Gm", "energy": 4})
        ok = tw.read_values(p)["key"] == "Gm" and payload(p) == pay0 and temps_left(uni) == []
        tw.restore(p, r["old"], r["size"], r["mtime"])
        check(f"name {name[:40]!r}{'…' if len(name) > 40 else ''} ({len(name)} chars): write + restore, no temps",
              ok and tw.read_values(p) == r["old"] and temps_left(uni) == [])
    tname, sname = tw._temp_names("_Intro Edit.mp3")
    check("temp name is .tftmp-<12 hex>, never derived from the name itself",
          tname.startswith(".tftmp-") and len(tname) == 19 and "Intro" not in tname and sname == "._" + tname)

    real = place(mp3_none, os.path.join(W, "real"), "real.mp3")
    link = os.path.join(W, "link.mp3"); os.symlink(real, link)
    tw.write(link, {"bpm": 111})
    check("symlink: the target is tagged, the link stays a link",
          os.path.islink(link) and tw.read_values(real)["bpm"] == "111" and temps_left(W) == [])
    if sys.platform == "darwin":
        p = place(mp3_v23, os.path.join(W, "xattr"), "tagged.mp3")
        subprocess.run(["xattr", "-w", "com.tunefield.test", "finder-tag-stand-in", p], check=True)
        tw.write(p, {"bpm": 101})
        got = subprocess.run(["xattr", "-p", "com.tunefield.test", p], capture_output=True, text=True).stdout.strip()
        check("macOS extended attributes (Finder tags) survive the swap", got == "finder-tag-stand-in", got)

    # ── cleanup_temps ──
    c = os.path.join(W, "cleanup"); os.makedirs(os.path.join(c, "sub"))
    for n in (".tftmp-0123456789ab", "._.tftmp-x", "._.tftmp-0123456789ab"):
        open(os.path.join(c, n), "wb").write(b"old")
    open(os.path.join(c, "sub", ".tftmp-aaaaaaaaaaaa"), "wb").write(b"old, but not this folder")
    time.sleep(1.2)
    for n in (".tftmp-fresh0000000", "._.tftmp-fresh0000000", "song.mp3", "x.tftmp-0123456789ab"):
        open(os.path.join(c, n), "wb").write(b"new")
    n = tw.cleanup_temps(c, older_than_s=1)
    left = sorted(os.listdir(c))
    check("cleanup_temps removes only old .tftmp-* and ._.tftmp-* (planted ._.tftmp-x included)",
          n == 3 and left == ["._.tftmp-fresh0000000", ".tftmp-fresh0000000", "song.mp3", "sub", "x.tftmp-0123456789ab"],
          (n, left))
    check("cleanup_temps is not recursive", os.listdir(os.path.join(c, "sub")) == [".tftmp-aaaaaaaaaaaa"])
    check("cleanup_temps default keeps everything young", tw.cleanup_temps(c) == 0)
    check("cleanup_temps on a missing folder returns 0", tw.cleanup_temps(os.path.join(W, "nope")) == 0)
finally:
    for root, dirs, files in os.walk(W):
        for x in dirs:
            try: os.chmod(os.path.join(root, x), 0o755)
            except OSError: pass
    shutil.rmtree(W, ignore_errors=True)

print()
if failures:
    print(f"{len(failures)} FAILED"); sys.exit(1)
print("all passed")
