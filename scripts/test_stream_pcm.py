#!/usr/bin/env python3
"""Regression: /catalog/<id>/stream serves FLAC to WebKit clients as PCM WAV.

AVFoundation (WebKit's media engine) cannot stream native FLAC over HTTP — Mark's
Often Pink Field, 2026-09-02. Runs against an isolated TUNEFIELD_ROOT.

    python3 scripts/test_stream_pcm.py
"""
import os, sys, math, tempfile, shutil, uuid, struct
ROOT = tempfile.mkdtemp(prefix="tf-pcm-"); os.environ["TUNEFIELD_ROOT"] = ROOT
os.makedirs(os.path.join(ROOT, "data")); MUSIC = os.path.join(ROOT, "music"); os.makedirs(MUSIC)
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, REPO); os.chdir(REPO)
OK, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"; failures = []
def check(label, cond, detail=""):
    print(f"{OK if cond else FAIL} {label}" + ("" if cond else f"\n    {detail}")); failures.append(label) if not cond else None
WEBKIT = "AppleCoreMedia/1.0.0.24G84 (Macintosh; U; Intel Mac OS X 15_6; en_us)"
SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"
CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36"
try:
    import numpy as np, soundfile as sf
    import app as tf
    c = tf.app.test_client()
    sr = 44100; n = sr * 2; t = np.arange(n) / sr
    tone = (0.4 * np.sin(2 * math.pi * 220 * t) * (0.6 + 0.4 * np.sin(2 * math.pi * 2 * t))).astype("float32")
    stereo = np.stack([tone, tone * 0.5], axis=1)
    f16 = os.path.join(MUSIC, "sixteen.flac"); sf.write(f16, stereo, sr, subtype="PCM_16", format="FLAC")
    f24 = os.path.join(MUSIC, "twentyfour.flac"); sf.write(f24, stereo, 48000, subtype="PCM_24", format="FLAC")
    w16 = os.path.join(MUSIC, "plain.wav"); sf.write(w16, stereo, sr, subtype="PCM_16")
    slug = c.post("/catalogs", json={"name": "PCM"}).get_json()["slug"]
    ids = {}
    ents = []
    for path in (f16, f24, w16):
        eid = str(uuid.uuid4()); ids[path] = eid
        ents.append({"id": eid, "filename": os.path.basename(path), "library_file": path, "data": {}})
    tf.save_cat(slug, ents)
    def get(path, ua, rng=None):
        h = {"User-Agent": ua}; h.update({"Range": rng} if rng else {})
        return c.get(f"/catalog/{ids[path]}/stream", headers=h)
    r = get(f16, WEBKIT, "bytes=0-1")
    check("WebKit media loader gets 206 PCM WAV for 16-bit FLAC", r.status_code == 206 and r.mimetype == "audio/wav", (r.status_code, r.mimetype))
    total = int(r.headers.get("Content-Range", "0/0").split("/")[-1])
    cache = [f for f in os.listdir(tf.STREAM_CACHE_DIR) if f.endswith(".wav")]
    check("cache holds one WAV keyed on id+mtime+size", len(cache) == 1 and cache[0].startswith(ids[f16]), cache)
    info = sf.info(os.path.join(tf.STREAM_CACHE_DIR, cache[0]))
    check("WAV keeps 44.1 kHz / stereo / PCM_16 and is byte-complete", info.samplerate == sr and info.channels == 2 and info.subtype == "PCM_16" and os.path.getsize(os.path.join(tf.STREAM_CACHE_DIR, cache[0])) == total, (info.samplerate, info.channels, info.subtype))
    r = get(f16, WEBKIT)
    check("full GET returns 200 with the whole WAV", r.status_code == 200 and len(r.data) == total, (r.status_code, len(r.data), total))
    r = get(f24, SAFARI, "bytes=0-1")
    info24 = sf.info(os.path.join(tf.STREAM_CACHE_DIR, [f for f in os.listdir(tf.STREAM_CACHE_DIR) if f.startswith(ids[f24])][0]))
    check("24-bit / 48 kHz FLAC keeps PCM_24 and 48 kHz (Safari page UA)", r.status_code == 206 and r.mimetype == "audio/wav" and info24.subtype == "PCM_24" and info24.samplerate == 48000, (r.status_code, info24.subtype, info24.samplerate))
    r = get(f16, CHROME, "bytes=0-1")
    check("Chrome gets the original FLAC", r.status_code == 206 and r.mimetype in ("audio/x-flac", "audio/flac"), (r.status_code, r.mimetype))
    r = get(w16, WEBKIT, "bytes=0-1")
    check("a WAV source is served as-is, not re-encoded", r.status_code == 206 and r.mimetype in ("audio/x-wav", "audio/wav") and len([f for f in os.listdir(tf.STREAM_CACHE_DIR) if f.endswith(".wav")]) == 2, r.mimetype)
    # ── Lossy sources must CLIP, not wrap (2026-09-20) ────────────────────────
    # Vorbis/Opus decode to floats that overshoot ±1.0 on loud masters. Reading those as
    # int16 made libsndfile wrap each over to the opposite rail — crackle on exactly the
    # loudest tracks. They are read as float now and clipped on write.
    hot = (1.35 * np.sin(2 * math.pi * 220 * t)).astype("float32")
    hot_st = np.stack([hot, hot], axis=1)
    for fmt, ext in (("OGG", ".ogg"), ("OGG", ".opus")):
        sub = "VORBIS" if ext == ".ogg" else "OPUS"
        if sub not in sf.available_subtypes(fmt):
            print(f"{OK} {sub} unsupported by this libsndfile — skipped"); continue
        src = os.path.join(MUSIC, "hot" + ext)
        try: sf.write(src, hot_st, 48000 if sub == "OPUS" else sr, subtype=sub, format=fmt)
        except Exception as e:
            print(f"{OK} {sub} not writable here ({e}) — skipped"); continue
        eid = str(uuid.uuid4()); ids[src] = eid
        ents.append({"id": eid, "filename": os.path.basename(src), "library_file": src, "data": {}})
        tf.save_cat(slug, ents)
        r = get(src, WEBKIT, "bytes=0-1")
        check(f"{sub}: WebKit gets a PCM WAV", r.status_code == 206 and r.mimetype == "audio/wav", (r.status_code, r.mimetype))
        wav = os.path.join(tf.STREAM_CACHE_DIR, [f for f in os.listdir(tf.STREAM_CACHE_DIR) if f.startswith(eid)][0])
        data, _ = sf.read(wav, dtype="int16")
        d = data[:, 0].astype("int32")
        # A wraparound shows up as a sign flip between adjacent samples of a smooth tone.
        flips = int(np.sum((np.sign(d[:-1]) * np.sign(d[1:]) < 0) & (np.abs(d[:-1] - d[1:]) > 40000)))
        rails = int(np.sum(np.abs(d) >= 32700))
        check(f"{sub}: overs saturate at the rails, none wrap ({rails} clipped, {flips} flips)",
              flips == 0 and rails > 0, f"flips={flips} rails={rails}")

    before = os.stat(os.path.join(tf.STREAM_CACHE_DIR, cache[0])).st_mtime
    get(f16, WEBKIT, "bytes=0-1")
    check("second request reuses the cached WAV (no re-decode)", os.stat(os.path.join(tf.STREAM_CACHE_DIR, cache[0])).st_mtime == before)
    r = get(f16, WEBKIT + "", "bytes=100-199")
    check("mid-file range honoured on the WAV", r.status_code == 206 and len(r.data) == 100 and r.headers["Content-Range"].startswith("bytes 100-199/"), r.headers.get("Content-Range"))
finally:
    shutil.rmtree(ROOT, ignore_errors=True)
if failures: print(f"\n{FAIL} {len(failures)} failure(s): " + "; ".join(failures)); sys.exit(1)
print(f"\n{OK} all checks passed"); sys.exit(0)
