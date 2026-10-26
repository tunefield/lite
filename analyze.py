#!/usr/bin/env python3
"""
Tunefield: Free, fully offline music analysis tool.

Covers: BPM, key, energy, danceability, valence/mood, voice presence,
        timbre, brightness, harmonic/percussive ratio.
"""

import os
import threading
import math
import re
import sys
import json
import subprocess
import warnings
import argparse
import numpy as np

# ── Feature-set epoch ────────────────────────────────────────────────────────
# THE single source of truth for the analysis epoch. scripts/re_analyse.py imports
# this to decide what needs re-analysing; it used to hard-code ">= 2", so bumping
# the number here without touching that file turned the whole re-analysis into a
# silent no-op that still reported success (review, 2026-08-26). Never inline it.
#   2 = 2026-08-19: danceability reweighted, roughness = AM depth, BPM octave rescue.
#   3 = 2026-08-26: EDM (edma) key profiles + tuning measurement + key confidence.
#   4 = 2026-08-27: key read from the WHOLE track (streamed) instead of the scan window
#       — +6.6 MIREX on the library set, +8.9 on GiantSteps+.
# Bump when a change alters stored values library-wide.
FEATURES_VERSION = 4

warnings.filterwarnings("ignore")

try:
    import librosa
    LIBROSA_OK = True
except ImportError:
    LIBROSA_OK = False

try:
    import pyloudnorm as pyln
    LOUDNESS_OK = True
except ImportError:
    LOUDNESS_OK = False

try:
    import soundfile as _sf
    SOUNDFILE_OK = True
except ImportError:
    SOUNDFILE_OK = False


# ── libsndfile is not safe to open from two threads at once ──────────────────
# Every MP3 open inside libsndfile's bundled mpg123 runs a CPU-feature probe
# (_INT123_getcpuflags) that installs a PROCESS-GLOBAL SIGILL handler with sigaction()
# and sigsetjmp()s into a SINGLE FIXED GLOBAL jmp_buf — with no locking. Two threads in
# there together lose the sigaction restore, leaving mpg123's handler armed, and a later
# siglongjmp lands on a dead stack frame. The process takes a SIGBUS and dies instantly:
# no Python exception, no traceback, nothing any try/except can see.
#
# Measured, not guessed: 1 thread x 12,800 opens = 0 crashes; 2 threads = 12/12 runs
# crashed; 4 threads = 12/12. It reproduces on a synthesised, provably-clean MP3, so no
# audio file is at fault. It killed a 24,000-track batch five times, and it is reachable
# from the app itself — library_analyse runs a thread pool over exactly this code.
#
# The lock covers only the OPEN. Decoding stays fully parallel, and open is roughly 3%
# of an analysis, so this costs almost nothing. Verified at 0 crashes in 160,000
# lockstep opens against 13/15 runs crashing without it.
_SF_OPEN_LOCK = threading.Lock()

def _install_sf_open_lock():
    try:
        import soundfile as _sf
    except ImportError:
        return
    if getattr(_sf.SoundFile, "_tf_locked", False):
        return
    _orig = _sf.SoundFile.__init__
    def _locked(self, *a, **kw):
        with _SF_OPEN_LOCK:
            return _orig(self, *a, **kw)
    _sf.SoundFile.__init__ = _locked
    _sf.SoundFile._tf_locked = True

_install_sf_open_lock()


def _num(value, cast, default=0):
    """Parse a possibly-non-numeric field. ffprobe emits the literal string "N/A"
    (and sometimes None) for duration/bit_rate/sample_rate on unseekable or streamed
    inputs; a bare float("N/A")/int("N/A") would raise ValueError and crash the whole
    analyze() call. This coerces safely to `default` instead."""
    try:
        return cast(value)
    except (TypeError, ValueError):
        return default


def _r(value, ndigits):
    """Round a numeric result, mapping non-finite values (NaN/Inf) to None. Only
    `loudness_lufs` was previously NaN-guarded; every other numeric field is built from
    np.mean/np.std over feature arrays and could in principle leak a NaN, which serialises
    as invalid JSON (Python's json allows NaN by default) and breaks JSON.parse on the
    client. This makes the whole numeric surface defensive."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(value):
        return None
    return round(value, ndigits)


def _soundfile_metadata(filepath):
    """Fallback numeric metadata when ffprobe is missing/failing — soundfile can read
    sample rate, channels and frame count (→ duration) directly, so analysis still works
    (we just lose the ID3 tags: genre/artist/title/etc). Returns {} if soundfile can't
    open it either."""
    if not SOUNDFILE_OK:
        return {}
    try:
        info = _sf.info(filepath)
        dur = (info.frames / info.samplerate) if info.samplerate else 0.0
        return {
            "duration_sec":   round(float(dur), 1),
            "codec":          (info.format or "unknown"),
            "bitrate_kbps":   0,
            "sample_rate_hz": int(info.samplerate or 0),
            "channels":       int(info.channels or 0),
            "genre": "", "artist": "", "title": "", "album": "", "year": "",
            "_probe_failed":  True,
        }
    except Exception:
        return {"_probe_failed": True}


def get_metadata(filepath):
    """Numbers from soundfile, words from tags.py — no external binary in the path.

    ffprobe used to do both. It is a 70 MB dependency to bundle on three platforms for
    two jobs we can do ourselves, and on a real 250-file sample tags.py agreed with it
    on 98.8% of fields, found 12 tags it could not see, missed none that it found, and
    ran ~240x faster because there is no subprocess to spawn. ffprobe stays as a
    fallback only for containers we do not parse; if it is absent, nothing breaks."""
    md = _soundfile_metadata(filepath) or {}
    try:
        import tags as _tags
        t = _tags.read_tags(filepath)
    except Exception:
        t = {}
    # soundfile reports no bitrate, and it is a column users read. For constant-rate
    # files size/duration is exact; for VBR it is the average, which is what a bitrate
    # column means anyway.
    if not md.get("bitrate_kbps") and md.get("duration_sec"):
        try:
            md["bitrate_kbps"] = int(os.path.getsize(filepath) * 8 / md["duration_sec"] / 1000)
        except (OSError, ZeroDivisionError):
            pass
    if md.get("codec"):
        md["codec"] = str(md["codec"]).lower()
    # Containers libsndfile can't open (m4a/aac) leave duration_sec unset, and duration
    # is not a nicety: it gates the pure-python path below AND sets the 20%-in analysis
    # offset. Without it the bundle read tags and then discarded them, and analysed the
    # intro while a ffprobe-equipped source run analysed 20% in — same file, different
    # key and LUFS. audioread (CoreAudio on macOS, gstreamer elsewhere) fills the gap
    # with no subprocess.
    if not md.get("duration_sec"):
        try:
            import audioread
            with audioread.audio_open(filepath) as f:
                md["duration_sec"]   = round(float(f.duration), 1)
                md["sample_rate_hz"] = int(f.samplerate)
                md["channels"]       = int(f.channels)
                md.setdefault("codec", os.path.splitext(filepath)[1].lstrip(".").lower() or "unknown")
        except Exception:
            pass
    if t:
        md.setdefault("codec", os.path.splitext(filepath)[1].lstrip(".").lower() or "unknown")
        for src, dst in (("genre", "genre"), ("artist", "artist"), ("title", "title"),
                         ("album", "album"), ("year", "year"), ("comment", "comment")):
            if t.get(src):
                md[dst] = t[src]
        if not md.get("artist") and t.get("albumartist"):
            md["artist"] = t["albumartist"]
    # Everything we need? Then never touch a subprocess.
    if md.get("duration_sec") and (t or md.get("codec")):
        for k in ("genre", "artist", "title", "album", "year", "comment"):
            md.setdefault(k, "")
        # _soundfile_metadata sets this to mean "ffprobe was not consulted". Since
        # ffprobe is deliberately gone, leaving it set would brand the normal, intended
        # path a failure — a false signal for whoever debugs this next. It survives only
        # when metadata genuinely could not be read.
        md.pop("_probe_failed", None)
        return md
    # Last resort. _ffprobe_metadata never returns None — on failure it hands back a
    # near-empty flagged dict, which is still truthy, so a plain `or md` would discard
    # tags we already hold. Only prefer the probe when it actually learned something.
    probed = _ffprobe_metadata(filepath)
    if probed and probed.get("duration_sec"):
        for k in ("genre", "artist", "title", "album", "year", "comment"):
            if not probed.get(k) and md.get(k):
                probed[k] = md[k]
        return probed
    return md or {"_probe_failed": True}


def _ffprobe_metadata(filepath):
    """Legacy path. Used only when the pure-python readers came back empty-handed."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", filepath
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        # ffprobe not on PATH (common on Windows / ffmpeg-only installs) — degrade
        # to soundfile-derived numeric fields rather than failing every analysis.
        return _soundfile_metadata(filepath)
    except subprocess.TimeoutExpired:
        # A hung probe (malformed / network-mounted file) — don't block the thread.
        return _soundfile_metadata(filepath)
    if result.returncode != 0:
        # Corrupt / unreadable by ffprobe — try soundfile, else empty (flagged).
        md = _soundfile_metadata(filepath)
        if result.stderr:
            print(f"  ffprobe: {result.stderr.strip()[:200]}", file=sys.stderr)
        return md or {"_probe_failed": True}
    try:
        data = json.loads(result.stdout)
    except (ValueError, json.JSONDecodeError):
        return _soundfile_metadata(filepath) or {"_probe_failed": True}
    fmt = data.get("format", {})
    streams = data.get("streams", [])
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    a_tags = {k.lower(): v for k, v in (audio.get("tags") or {}).items()}
    def _tag(name):
        v = tags.get(name) or a_tags.get(name) or ""
        return v.strip() if isinstance(v, str) else ""
    return {
        "duration_sec":  round(_num(fmt.get("duration"), float, 0.0), 1),
        "codec":         audio.get("codec_name", "unknown"),
        "bitrate_kbps":  _num(fmt.get("bit_rate"), int, 0) // 1000,
        "sample_rate_hz":_num(audio.get("sample_rate"), int, 0),
        "channels":      _num(audio.get("channels"), int, 0),
        "genre":         _tag("genre"),
        "artist":        _tag("artist") or _tag("album_artist"),
        "title":         _tag("title"),
        "album":         _tag("album"),
        "year":          _tag("date") or _tag("year"),
        "comment":       _tag("comment") or _tag("description"),
    }


# ── Key profiles ─────────────────────────────────────────────────────────────
# Each profile is a 12-slot template for a MAJOR and a MINOR key rooted on C; the
# detector rotates them to all 12 roots and correlates against the track's chroma.
#
# 'krumhansl' is the 1982 Krumhansl-Kessler profile from probe-tone experiments with
# classical listeners. It shipped until 2026-08-26 and measured MIREX 47.5 on the
# library's own key tags — bottom of its algorithm class.
#
# 'edma' is corpus-derived from ELECTRONIC DANCE MUSIC: Faraldo, Gomez, Jorda &
# Herrera, "Key Estimation in Electronic Dance Music", ECIR 2016, pp. 335-347.
# Published as probability distributions, which is why both vectors sum to ~1.0 —
# a useful transcription check (they sum to 1.00000008 and 1.00000002). Keep the raw
# 8-dp values: the 2-dp tonic-normalised form published elsewhere is NOT an exact
# affine transform of these and measurably perturbs the runner-up margin, which is
# what key_confidence is computed from.
KEY_PROFILES = {
    "krumhansl": (
        [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
        [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    ),
    "edma": (
        [0.16519551, 0.04749026, 0.08293076, 0.06687112, 0.09994645, 0.09274123,
         0.05294487, 0.13159476, 0.05218986, 0.07443653, 0.06940723, 0.06425150],
        [0.17235348, 0.05336489, 0.07610090, 0.10043649, 0.05621498, 0.08527853,
         0.04979150, 0.13451001, 0.07458916, 0.05003023, 0.09187879, 0.05545106],
    ),
}
KEY_PROFILE_DEFAULT = "edma"
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _rot_matrix(profile):
    """12 rotations of a profile, mean-centred and unit-normalised, so a correlation
    against a mean-centred unit chroma vector is a plain matrix product.

    Returns (matrix, ok). `ok` is False for a zero-variance profile: np.corrcoef
    against a constant vector does NOT return NaN — float64 residue makes it return
    ~-4e-17 with no warning, which would let rounding error pick a key. Callers must
    honour the flag rather than trusting the numbers."""
    P = np.stack([np.roll(np.asarray(profile, float), i) for i in range(12)])
    P -= P.mean(axis=1, keepdims=True)
    n = np.linalg.norm(P, axis=1, keepdims=True)
    ok = bool(n.min() >= 1e-12)
    return P / np.where(n < 1e-12, 1.0, n), ok


_ROT = {name: (_rot_matrix(maj), _rot_matrix(mnr))
        for name, (maj, mnr) in KEY_PROFILES.items()}


def key_scores(chroma_mean, profile=KEY_PROFILE_DEFAULT):
    """Correlation of a 12-slot chroma mean against all 24 rotated key templates.

    Index i < 12 is major on NOTES[i]; i >= 12 is minor on NOTES[i-12]. Returns None
    when the input cannot support a key decision. Numerically identical to the old
    24x np.corrcoef loop and about 4x faster."""
    z = np.asarray(chroma_mean, float)
    if z.size != 12 or not np.all(np.isfinite(z)):
        return None
    z = z - z.mean()
    n = float(np.linalg.norm(z))
    # The old guard was std < 1e-9, and ||z|| = std*sqrt(12) — guarding on ||z|| alone
    # would be 3.46x looser and let near-constant chroma return a key made of noise.
    if n < 1e-9 * np.sqrt(12.0):
        return None
    z = z / n
    (Rmaj, ok_maj), (Rmin, ok_min) = _ROT[profile]
    s = np.full(24, -np.inf)
    if ok_maj:
        s[:12] = Rmaj @ z
    if ok_min:
        s[12:] = Rmin @ z
    return s if np.any(np.isfinite(s)) else None


def detect_key(chroma, profile=KEY_PROFILE_DEFAULT):
    """Key of a chroma matrix as (key, mode). Kept for callers that only want the pair;
    detect_key_full carries the confidence."""
    r = detect_key_full(chroma, profile)
    return r["key"], r["mode"]


def detect_key_full(chroma, profile=KEY_PROFILE_DEFAULT):
    """Key, mode and a confidence in [0,1].

    Confidence is the normalised margin between the winner and the best candidate that
    is NOT a near-relation of it (relative, parallel, dominant, subdominant). Scoring
    the margin against those would punish exactly the ambiguity every key detector has
    and every DJ tolerates — a track called A minor that could be C major still mixes
    with both. A wide margin over an UNRELATED key is what "trust this" means.

    The direction of this number was checked against ground truth before shipping: a
    confidence that anti-correlates with correctness is worse than none at all, which
    is why the BPM confidence score measured in this project was never shipped."""
    chroma = np.asarray(chroma, float)
    if chroma.ndim == 2:
        chroma_mean = chroma.mean(axis=1)
    else:
        chroma_mean = chroma
    if chroma_mean.size == 0:
        return {"key": "unknown", "mode": "unknown", "confidence": 0.0}
    s = key_scores(chroma_mean, profile)
    if s is None:
        return {"key": "unknown", "mode": "unknown", "confidence": 0.0}

    # argmax ONCE and reuse: argsort()[::-1][0] resolves ties to the LAST maximum
    # while argmax resolves to the FIRST, so computing them separately can disagree
    # about which candidate actually won.
    b = int(np.argmax(s))
    root, is_minor = b % 12, b >= 12

    # Near-relations of the winner, which must not count as competitors.
    rel = {b}
    if is_minor:
        rel.add((root + 3) % 12)              # relative major
        rel.add(root)                         # parallel major
    else:
        rel.add(12 + (root + 9) % 12)         # relative minor
        rel.add(12 + root)                    # parallel minor
    rel.add(((root + 7) % 12) + (12 if is_minor else 0))   # dominant, same mode
    rel.add(((root + 5) % 12) + (12 if is_minor else 0))   # subdominant, same mode

    others = [s[i] for i in range(24) if i not in rel and np.isfinite(s[i])]
    best = float(s[b])
    if others:
        margin = best - max(others)
        # Correlations live in [-1,1], so a margin over an unrelated key spans [0,2].
        conf = float(np.clip(margin / 0.5, 0.0, 1.0))
    else:
        conf = 0.0
    return {
        "key": NOTES[root],
        "mode": "minor" if is_minor else "major",
        "confidence": round(conf, 3),
    }


def estimate_tuning_gated(y, sr, decoded_sec):
    """Tuning offset in cents, with an honesty gate.

    Why this exists: librosa's automatic correction runs at bins_per_octave=36, so its
    residual is confined to +/-16.7 cents and it WRAPS — a record 30 cents flat is
    "corrected" in the wrong direction, and on pure noise it applies a confident
    garbage offset silently. Measuring at bins_per_octave=12 covers the full +/-50
    cents a semitone can hide.

    Returns (cents, dispersion, valid). Sub-windows are combined with CIRCULAR
    statistics because tuning is modulo one semitone: a linear mean of
    (+49, +49, -50, +48) gives ~+11.5, which is wrong; circularly it is ~+0.7."""
    y = np.asarray(y, float)
    if y.size < sr * 2:
        return 0.0, 0.0, False
    # Adaptive sub-window count: at the real 30 s window a fixed 4 gives 7.5 s pieces,
    # and fewer than 3 survivors cannot support a dispersion estimate at all.
    n_sub = int(np.clip(decoded_sec // 7.5, 3, 6))
    seg = y.size // n_sub
    if seg < sr:
        return 0.0, 0.0, False
    subs = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")          # librosa's "empty frequency set"
        for i in range(n_sub):
            piece = y[i * seg:(i + 1) * seg]
            if not np.any(np.abs(piece) > 1e-6):
                continue
            try:
                t = librosa.estimate_tuning(y=piece, sr=sr, bins_per_octave=12)
            except Exception:
                continue
            if np.isfinite(t):
                subs.append(float(t) * 100.0)    # -> cents in [-50, +50)
    if len(subs) < 3:
        return 0.0, 0.0, False
    theta = 2 * np.pi * np.asarray(subs) / 100.0
    C, S = float(np.cos(theta).mean()), float(np.sin(theta).mean())
    R = float(np.hypot(C, S))
    cents = float(np.degrees(np.arctan2(S, C))) / 360.0 * 100.0
    sd = 100.0 / (2 * np.pi) * np.sqrt(max(0.0, -2.0 * np.log(max(R, 1e-12))))
    return round(cents, 1), round(sd, 1), bool(sd <= 8.0)


# librosa applies tuning as fmin * 2**(tuning / bins_per_octave); chroma_cqt uses
# bins_per_octave=36, so a shift of N cents is N * 36/1200 in librosa's units.
CENTS_TO_CHROMA_TUNING = 36.0 / 1200.0


def detect_key_legacy(chroma):
    """Krumhansl-Schmuckler key-finding algorithm.

    Returns (key, mode). On a zero-variance chroma vector (pure silence, DC-only
    content), np.corrcoef divides by a zero std and returns NaN for every candidate;
    `nan > best` is always False so the loop would otherwise silently fall through to
    its C-major default and mislabel every silent track. We detect that and return
    ("unknown", "unknown") instead."""
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    chroma_mean = chroma.mean(axis=1)
    # Zero-variance → correlation is undefined; don't fabricate a key.
    if chroma_mean.size == 0 or float(np.std(chroma_mean)) < 1e-9:
        return "unknown", "unknown"
    best_score, best_key, best_mode = -np.inf, None, None
    for i in range(12):
        for profile, mode_name in [(major, "major"), (minor, "minor")]:
            score = np.corrcoef(np.roll(profile, i), chroma_mean)[0, 1]
            if np.isfinite(score) and score > best_score:
                best_score, best_key, best_mode = score, notes[i], mode_name
    if best_key is None:      # every candidate was NaN
        return "unknown", "unknown"
    return best_key, best_mode


# ── Declared content (stems / acapellas / instrumentals) ─────────────────────
# Stems and DJ tools are almost always labelled in the filename or tags
# ("Track (Acapella).wav", "(Instrumental)", "Drums Only", genre "Karaoke").
# A declared label is near-100% precision, so when one is present it OVERRIDES the
# audio heuristic's vocal booleans. Patterns are deliberately conservative — bare
# words like "bass" or "vocal" in ordinary titles ("Drop the Bass") must not fire;
# they only count inside stem-style phrasing or standalone (bracketed) markers.
_DECL_VOCAL = [
    r"\ba+[\s\-]?c+a+p+e+l+a+\b",                 # acapella / a cappella / acappella (+ typos)
    r"\bvocals?[\s\-]+only\b", r"\b(vocal|vox)[\s\-]+stem\b",
    r"\blead[\s\-]+vocals?\b",
    r"\bvocal[\s\-]+(mix|version|edit)\b",         # remix convention: vocals present
    r"[\(\[]\s*(vocals?|vox)\s*[\)\]]",
]
_DECL_INSTRUMENTAL = [
    r"\binstrumentals?\b", r"\bkaraoke\b", r"\bno[\s\-]+vocals?\b",
    r"[\(\[]\s*inst\.?\s*[\)\]]",
]
_DECL_DRUMS = [
    r"\bdrum(s)?[\s\-]+(stem|bus)\b", r"\bdrums?[\s\-]+only\b",
    r"[\(\[]\s*drums\s*[\)\]]",
]
_DECL_BASS = [
    r"\bbass(line)?[\s\-]+stem\b", r"\bbass[\s\-]+only\b",
    r"[\(\[]\s*bass\s*[\)\]]",
]

def detect_declared_content(filename, md):
    """Scan filename + tags for an explicit content declaration.
    Returns {"kind": ..., "has_vocals": bool} or None when nothing is declared —
    or when declarations CONTRADICT (e.g. an "Acapella + Instrumental" bundle title),
    in which case the heuristic stays in charge."""
    md = md or {}
    hay = " ".join(str(md.get(k) or "") for k in ("title", "album", "genre", "comment"))
    hay = f"{filename or ''} {hay}".lower()
    vocal = any(re.search(p, hay) for p in _DECL_VOCAL)
    inst  = any(re.search(p, hay) for p in _DECL_INSTRUMENTAL)
    drums = any(re.search(p, hay) for p in _DECL_DRUMS)
    bass  = any(re.search(p, hay) for p in _DECL_BASS)
    if vocal and (inst or drums or bass):
        return None
    if vocal:
        return {"kind": "acapella", "has_vocals": True}
    if drums:
        return {"kind": "drum-stem", "has_vocals": False}
    if bass:
        return {"kind": "bass-stem", "has_vocals": False}
    if inst:
        return {"kind": "instrumental", "has_vocals": False}
    return None


def estimate_voice_presence(y, sr, y_harmonic):
    """
    Multi-factor vocal-presence heuristic. Pure spectral analysis is fundamentally
    unreliable for vocal detection (a bass + drums instrumental shares the singing
    fundamental band with vocals), so we combine three signals that all need to fire
    for a high score:

      f_band     — harmonic energy concentrated in 200–600 Hz (singing fundamentals,
                    narrower than the old 80–500 to dodge bass)
      f_centroid — spectral centroid of the harmonic component sits where speech does
                    (~700–2500 Hz); pure-bass instrumentals score low here
      f_contrast — formant-style spectral contrast in the mid bands (voice has clear
                    peaks/valleys from vocal-tract resonance; sustained instruments
                    have flatter spectra)

    Combined as a product (so any one weak signal drags the score down) then
    amplified mildly. Treat the result as a rough hint, not a vocals detector —
    proper accuracy needs source separation (Spleeter/Demucs) which we may add later.
    """
    # Factor 1: harmonic energy in singing-fundamentals band
    pitches, magnitudes = librosa.piptrack(y=y_harmonic, sr=sr, threshold=0.1)
    voice_mask = (pitches > 200) & (pitches < 600)
    band_ratio = float(magnitudes[voice_mask].sum() / (magnitudes.sum() + 1e-8))
    # Squashed so even high concentrations cap below 1
    f_band = min(1.0, band_ratio * 2.5)

    # Factor 2: spectral centroid in the speech range
    try:
        centroid_hz = float(np.mean(librosa.feature.spectral_centroid(y=y_harmonic, sr=sr)))
    except Exception:
        centroid_hz = 0.0
    # 0 at <= 400 Hz, 1 at >= 2400 Hz, linear between
    f_centroid = float(np.clip((centroid_hz - 400.0) / 2000.0, 0.0, 1.0))

    # Factor 3: spectral contrast in mid bands (formant region ~500–4000 Hz)
    try:
        contrast = librosa.feature.spectral_contrast(y=y_harmonic, sr=sr)
        mid_contrast = float(np.mean(contrast[2:5]))  # bands ~500–4000 Hz
    except Exception:
        mid_contrast = 0.0
    # 0 at <= 12 dB, 1 at >= 28 dB
    f_contrast = float(np.clip((mid_contrast - 12.0) / 16.0, 0.0, 1.0))

    # All three must agree — geometric mean (cube root of product) so any weak factor pulls it down
    score = (f_band * f_centroid * f_contrast) ** (1.0 / 3.0)
    return float(np.clip(score * 1.1, 0.0, 1.0))


def compute_danceability(tempo, pulse_clarity, y, sr):
    """
    Heuristic danceability: tempo range + bass presence + pulse clarity.

    Two terms from the original formula are gone (2026-08-19, items 22): beat
    regularity was the rhythm_regularity statistic removed from the vector on
    2026-08-05 — near-constant (0.93–0.98 across 24,259 tracks) because it
    measures librosa's own tempo grid, its 0.25 weight injected a fixed ~0.24
    offset that compressed every score into 0.63–0.83; beat_strength was the
    same audit's other casualty, a within-track percentile that can't be
    compared between tracks. pulse_clarity — how strongly the onset envelope
    actually repeats at a fixed period — is the audit's replacement for that
    family and takes beat_strength's slot.
    """
    # Tempo score: sweet spot 110–135 BPM
    if 110 <= tempo <= 135:
        tempo_score = 1.0
    elif 90 <= tempo < 110 or 135 < tempo <= 160:
        tempo_score = 0.7
    elif 70 <= tempo < 90 or 160 < tempo <= 180:
        tempo_score = 0.4
    else:
        tempo_score = 0.2

    # Bass energy (sub-300 Hz content → groove)
    stft = np.abs(librosa.stft(y))
    freqs = librosa.fft_frequencies(sr=sr)
    bass_ratio = float(min(stft[freqs < 300].mean() / (stft.mean() + 1e-8) * 4, 1.0))

    return float(np.clip(
        tempo_score * 0.40 +
        bass_ratio * 0.33 +
        pulse_clarity * 0.27,
        0, 1
    ))


def bpm_octave_rescue(tempo, onset_env, sr):
    """
    Upward-only octave correction: does the tempogram actually support 2× or
    1.5× the beat tracker's answer? beat_track's 120-centred prior halves fast
    material wholesale — measured on this library, 76% of tracks tagged ≥160 BPM
    came back wrong, almost all at half tempo (Pendulum's own album split into
    174-correct and 87-halved). Returns the rescued tempo, or None to keep the
    existing fold path.

    Every parameter here was fitted and verified on 539 real tracks against tag
    ground truth (2026-08-19): upward-only candidates {2T, 1.5T}, flat-top prior,
    0.95 threshold → 36 fixes, 0 regressions; ≥160-tag accuracy 23.6% → 45.3%.
    Downward candidates, the 4/3 triplet, and stricter hysteresis were all tested
    and made things worse — salience is structurally higher at longer lags, so
    downward overrides halve correct detections. Do not "complete" the candidate
    set without re-running that benchmark.

    A fired candidate can legitimately land in 40–69 or 181–240 BPM — ranges the
    old blind fold never emitted but the tag path always admitted (40–250), so
    every consumer already handles them.
    """
    # Degenerate evidence → let the fold handle it. Under a full tempogram window
    # (384 frames ≈ 9 s) there is no real salience curve, and on a flat curve the
    # 0.95 gate is a coin toss that systematically doubles weak-pulse material —
    # a corner structurally outside the 539-track benchmark (tagged = rhythmic).
    # Both guards are inert for that benchmark: a 60 s scan yields ~2,580 frames
    # and rhythmic material has strongly peaked tempograms.
    if onset_env.size < 384:
        return None
    tg = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr, hop_length=512)
    sal_curve = tg.mean(axis=1)
    freqs = librosa.tempo_frequencies(tg.shape[0], sr=sr, hop_length=512)
    # freqs[0] is inf and the axis is descending — slice it off and reverse for interp
    xs, ys = freqs[1:][::-1], sal_curve[1:][::-1]

    in_band = ys[(xs >= 40.0) & (xs <= 240.0)]
    if in_band.size == 0 or in_band.max() <= 1.05 * in_band.mean():
        return None

    def sal(b):
        return float(np.interp(b, xs, ys))

    def prior(c):
        if 60.0 <= c <= 190.0:
            return 1.0
        if 40.0 <= c < 60.0 or 190.0 < c <= 220.0:
            return 0.3
        return 0.05

    base = sal(tempo) * prior(tempo)
    best, best_score = None, 0.0
    for c in (tempo * 2.0, tempo * 1.5):
        if not (40.0 <= c <= 240.0):
            continue
        s = sal(c) * prior(c)
        if s > 0.95 * base and s > best_score:
            best, best_score = c, s
    return best


# ── Energy scale ────────────────────────────────────────────────────────────
# energy used to be `clip(mean_rms / 0.25, 0, 1)`, and the clip was doing real damage:
# in a 14,694-track library 28.1% of tracks sat at EXACTLY 1.000, flattening 9.0 dB of
# genuine loudness (-15.3 to -6.3 LUFS) into a single value. Anything above the ceiling
# was indistinguishable from anything else above it — so a third of the library carried
# no energy information at all, and every similarity, route and cluster that leaned on
# energy was working with a blank in that range.
#
# The replacement is a logistic on integrated LUFS: perceptual, standardised, already
# measured for every track, and asymptotic so it can never pin. The constants are
# ABSOLUTE, not derived from any one library, so "energy 70%" means the same thing in
# every Field and in everyone's copy, and values don't drift as a collection grows.
ENERGY_LUFS_MID   = -14.0   # LUFS at which energy = 0.5 — the streaming-normalisation
                            # reference. Deliberately NOT this library's median (-15.3):
                            # a constant tuned to one collection is not library-
                            # independent, it only looks it. Anchored here, "energy 0.5"
                            # means "as loud as a streaming-normalised master" for
                            # everyone. Never replace with a percentile or z-score.
ENERGY_LUFS_SLOPE = 4.0     # dB per logistic unit; 0.1 dB ~ 0.006 energy, well above
                            # LUFS measurement noise. p5..p95 of real music spans .10-.71

# Thresholds that used to be read against the old scale, restated on the new one. Chosen
# to hold the previous population splits (drift measured at +0.1, -0.4, -0.5 points over
# 14,694 tracks), so this fix does not silently relabel a quarter of anyone's library.
# Each one inverts to a physical statement, which is how they should be reviewed.
# Stamped on every analysed track. app.py's backfill skips anything already carrying it;
# without the stamp a fresh no-LUFS track would be "migrated" a second time, putting a
# new-scale value through the RMS fallback and corrupting it.
ENERGY_SCALE      = "lufs-v2"

ENERGY_ENERGETIC  = 0.35    # was 0.6  = louder than -16.5 LUFS
ENERGY_BASS_STRON = 0.28    # was 0.5  = louder than -17.8 LUFS
ENERGY_BASS_MOD   = 0.09    # was 0.25 = louder than -23.3 LUFS

# Fallback when pyloudnorm is unavailable or the measurement fails. Regressed against
# 10,556 real tracks that had both: LUFS = -1.92 + 0.886 x dBFS_rms, residual sd 0.80 dB.
# Close enough that the two paths land on the same scale rather than two different ones.
_RMS_TO_LUFS_A, _RMS_TO_LUFS_B = -1.92, 0.886


def loudness_to_energy(lufs):
    """Integrated LUFS -> 0..1. Monotonic, and it never reaches either end."""
    if lufs is None:
        return None
    try:
        z = (float(lufs) - ENERGY_LUFS_MID) / ENERGY_LUFS_SLOPE
    except (TypeError, ValueError):
        return None
    if math.isnan(z):                 # unmeasurable is not the same as loud
        return None
    if math.isinf(z):                 # digital silence measures as -inf
        return 0.0 if z < 0 else 1.0
    if z < -60:                       # guard exp() overflow; both ends are already flat
        return 0.0
    if z > 60:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


def rms_to_energy(mean_rms):
    """Same scale as loudness_to_energy, for when LUFS could not be measured."""
    if mean_rms is None or mean_rms <= 0:
        return 0.0
    return loudness_to_energy(_RMS_TO_LUFS_A + _RMS_TO_LUFS_B * 20.0 * math.log10(mean_rms))


def compute_valence(mode, brightness, tempo, energy):
    """
    Heuristic valence (positivity/happiness). Major key + bright + mid-fast tempo → high valence.
    """
    mode_score = 0.65 if mode == "major" else 0.35
    if 100 <= tempo <= 160:
        tempo_score = 0.7
    elif 80 <= tempo < 100 or 160 < tempo <= 180:
        tempo_score = 0.5
    else:
        tempo_score = 0.3
    return float(np.clip(
        mode_score * 0.45 +
        brightness * 0.25 +
        tempo_score * 0.20 +
        energy * 0.10,
        0, 1
    ))


def assign_mood(energy, valence):
    """Map to Russell's circumplex mood quadrant with vibe tags."""
    if energy > ENERGY_ENERGETIC and valence > 0.55:
        return "euphoric", ["uplifting", "energetic", "bright", "driving"]
    elif energy > ENERGY_ENERGETIC and valence <= 0.55:
        return "intense", ["dark", "driving", "powerful", "edgy"]
    elif energy <= ENERGY_ENERGETIC and valence > 0.55:
        return "upbeat", ["warm", "groovy", "positive", "chill"]
    else:
        return "melancholic", ["dark", "introspective", "calm", "moody"]


SAMPLE_BLOCKS = 6          # how many places across the track a partial scan listens at
_SAMPLE_TAPER_MS = 12      # fade in/out on each block edge


def _load_sampled(filepath, duration, frac, sr=22050):
    """Load `frac` of a track as several blocks spread evenly across it, concatenated.

    A partial scan that reads one contiguous window only ever hears one part of the
    record — an intro, or whatever happens to sit 20% in. Sampling across the whole
    thing gives a partial scan a representative view for the same decode budget.

    The joins matter: splicing audio creates a step discontinuity, which the onset
    detector reads as a transient and the beat tracker as a spurious beat. Each block is
    therefore tapered at both edges, which turns a click into a short fade. Five joins
    across a 6-block scan is small against the real onset count, and tempo estimation is
    statistical (autocorrelation over the onset envelope), so a few soft edges do not
    move it — but this is the reason the taper is not optional.
    """
    total = max(1.0, duration * float(frac))
    n = SAMPLE_BLOCKS
    blk = total / n
    # Ignore the outer 5%: intros and run-outs are the least representative part of a
    # record, and the fixed-window scan skipped them for the same reason.
    lo, hi = duration * 0.05, duration * 0.95
    span = max(blk, hi - lo)
    step = (span - blk) / max(1, n - 1)
    taper = max(1, int(sr * _SAMPLE_TAPER_MS / 1000.0))
    parts = []
    for i in range(n):
        off = lo + i * step
        if off + blk > duration:
            off = max(0.0, duration - blk)
        try:
            piece, sr = librosa.load(filepath, sr=sr, offset=off, duration=blk, mono=True)
        except Exception:
            continue
        if piece.size < taper * 2:
            continue
        w = np.linspace(0.0, 1.0, taper, dtype=piece.dtype)
        piece[:taper] *= w
        piece[-taper:] *= w[::-1]
        parts.append(piece)
    if not parts:
        # Nothing sampled cleanly — fall back to a plain contiguous read rather than
        # failing the whole analysis.
        return librosa.load(filepath, sr=sr, offset=0.0, duration=min(duration, total), mono=True)
    return np.concatenate(parts), sr


# ── Whole-track chroma, streamed ────────────────────────────────────────────────
# Key read from a 30 s window is read from 30 seconds of a record that may modulate,
# open on a pad and land somewhere else. Reading the WHOLE track measurably helps — but
# the obvious way to do it (librosa.load with no duration) peaks at ~1.2 GB on a 400 s
# file, and at four analysis workers that is ~5 GB.
#
# Streaming fixes the memory without giving up the coverage: read native blocks with
# soundfile, resample each to 11,025 Hz (plenty for chroma — the top CQT bin is far
# below Nyquist), accumulate the per-block chroma mean, and never hold more than one
# block. Measured: 252 MB peak, the same as today's 30 s window, and ~0.6 s.
# Both deps are already shipped, so this costs no bundle size.
CHROMA_SR = 11025
CHROMA_HOP = 2048
_CHROMA_BLOCK_SEC = 30


def whole_track_chroma_mean(filepath, duration=0.0):
    """Mean chroma over the WHOLE track, at bounded memory. None if it can't be read."""
    try:
        import soundfile as _sf
        from scipy.signal import resample_poly as _rp
    except Exception:
        return None
    try:
        info = _sf.info(filepath)
        native = int(info.samplerate)
        if native <= 0:
            return None
    except Exception:
        return None
    from math import gcd
    g = gcd(CHROMA_SR, native)
    up, down = CHROMA_SR // g, native // g
    acc = None
    frames = 0
    try:
        for blk in _sf.blocks(filepath, blocksize=native * _CHROMA_BLOCK_SEC,
                              dtype="float32", always_2d=True):
            if blk.size == 0:
                continue
            mono = blk.mean(axis=1)
            if mono.size < down * 4:
                continue
            y = _rp(mono, up, down)
            if y.size < CHROMA_HOP * 4:
                continue
            c = librosa.feature.chroma_cqt(y=y, sr=CHROMA_SR, hop_length=CHROMA_HOP)
            if c.size == 0:
                continue
            # Weight each block by its frame count so a short tail block does not count
            # as much as a full one.
            s = c.sum(axis=1)
            acc = s if acc is None else acc + s
            frames += c.shape[1]
    except Exception:
        return None
    if acc is None or not frames:
        return None
    return acc / float(frames)


def analyze(filepath, duration_limit=60, verbose=True):
    def log(msg):
        if verbose:
            print(f"  {msg}", file=sys.stderr)

    if verbose:
        print(f"\nAnalyzing: {filepath}", file=sys.stderr)

    result = {}
    result["metadata"] = get_metadata(filepath)

    if not LIBROSA_OK:
        result["error"] = "librosa not installed — run: pip install librosa"
        return result

    duration = result["metadata"].get("duration_sec", 0)

    # Full-track mode (duration_limit ≥ 9999) loads the whole file from the start, but
    # capped so a multi-hour podcast / DJ mix can't blow out memory on a big STFT.
    # Shorter scans skip the first 20% to avoid intros (when the track is long enough).
    FULL_TRACK_CAP = 900  # seconds (15 min) — sane ceiling for "full track"
    full_track = duration_limit >= 9999
    # FRACTIONAL scan lengths (Mark, 2026-08-26): a value in (0, 1] means "this fraction
    # of the track" rather than a number of seconds, so a 3-minute edit and a 12-minute
    # mix both get proportional coverage instead of the same fixed 30 s. Legacy second
    # values (30, 60, ... 99999) still work — the smallest of those is 30, so nothing
    # ambiguous falls in the (0, 1] band.
    fractional = (0.0 < duration_limit <= 1.0) and duration > 0
    if fractional:
        full_track = duration_limit >= 0.999
        offset = 0.0
        load_dur = min(duration, FULL_TRACK_CAP)
    elif full_track:
        offset = 0.0
        load_dur = min(duration, FULL_TRACK_CAP) if duration > 0 else FULL_TRACK_CAP
    else:
        offset = (duration * 0.2 if duration > 90 else 0.0)
        load_dur = min(duration_limit, duration - offset) if duration > 0 else duration_limit
    # Clamp on BOTH branches. Without this, a scripted duration of e.g. 5000 loads
    # uncapped audio, and a NEGATIVE duration is worse — librosa.load(duration=-1)
    # loads the ENTIRE file, bypassing the cap on a 4-hour mix (multi-GB peak between
    # y, the STFT and hpss buffers). The server routes validate too; this is the
    # defence that holds for direct/CLI callers.
    load_dur = max(1.0, min(float(load_dur), float(FULL_TRACK_CAP)))

    # Everything below can raise on exotic/corrupt input; wrap so a bad file yields a
    # clean, diagnosable error dict rather than an unhandled exception (which callers
    # would otherwise surface as a blank {"error": ""} or an HTTP 500).
    try:
        log(f"Loading {round(load_dur)}s of audio (offset {round(offset)}s)...")
        if fractional and not full_track:
            y, sr = _load_sampled(filepath, duration, duration_limit)
        else:
            y, sr = librosa.load(filepath, sr=22050, offset=offset, duration=load_dur, mono=True)

        # A truncated file whose container header over-reports its length (interrupted
        # download, cut-off rip) can put `offset` past all decodable audio → empty array;
        # a 0-byte / undecodable file yields the same. Guard here rather than crashing
        # downstream in zero_crossing_rate / feature extraction.
        if (y is None or getattr(y, "size", 0) == 0) and offset > 0:
            # The container header over-reported the length (interrupted copy, cut-off
            # rip), so the skip-the-intro offset landed past every decodable frame.
            # Retry from the top before giving up: a file claiming 235s but holding 2.6s
            # of real audio still yields a key and a rough energy read, and a degraded
            # answer beats an invisible track. (Mark's library, 2026-08-05.)
            log(f"offset {round(offset)}s past end of decodable audio — retrying from 0")
            offset = 0.0
            y, sr = librosa.load(filepath, sr=22050, offset=0.0, duration=load_dur, mono=True)
            if y is not None and getattr(y, "size", 0):
                result.setdefault("warnings", []).append(
                    "file is shorter than its header claims — analysed from the start")

        if y is None or getattr(y, "size", 0) == 0:
            result["error"] = "no decodable audio (empty, silent-length or truncated file)"
            return result

        # A truncated file whose offset still lands inside decodable audio never hits
        # the retry branch above, so it used to pass silently with a fraction of the
        # requested window analysed. load_dur is what the header promised us (capped by
        # the scan setting); decoding materially less means the file ends early. A
        # WARNING only, never an error — short decodes and bpm==0 are legitimate for
        # loops and ambient material, and rejecting them deletes valid uploads.
        decoded_sec = y.size / float(sr)
        if duration > 30 and decoded_sec < 0.7 * load_dur and not result.get("warnings"):
            result.setdefault("warnings", []).append(
                f"only {round(decoded_sec)}s of the expected {round(load_dur)}s decoded — "
                "file may be shorter than its header claims")

        # ── Rhythm ────────────────────────────────────────────────────────────────
        log("Rhythm analysis...")
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(tempo)[0])
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        # Octave correction: beat_track frequently reports half time (its prior is
        # centred on 120), so first ask the tempogram whether 2× or 1.5× is better
        # supported (bpm_octave_rescue). Only when no candidate fires, fall back to
        # the blind 70–180 fold — that fold can't fix in-band halvings (a true 174
        # detected as 87 is "plausible" to it) but still catches out-of-band output
        # on beatless material. (Guarded on tempo>0 so a pure tone doesn't loop.)
        if tempo > 0:
            _rescued = bpm_octave_rescue(tempo, onset_env, sr)
            if _rescued is not None:
                tempo = _rescued
            else:
                while tempo < 70:  tempo *= 2
                while tempo > 180: tempo /= 2

        # PULSE CLARITY replaces the old rhythm_regularity, which was
        #   1 - CV(inter-beat intervals)
        # measured on librosa's OWN beat track. That tracker fits a tempo prior, so it
        # emits near-uniform beats for a drum machine and a rubato piano alike: across
        # 24,259 real tracks the old number sat between 0.93 and 0.98, normalised entropy
        # 0.42. It reported the tracker's confidence in its own grid, not the music.
        #
        # This measures the AUDIO: how strongly the onset envelope repeats at a fixed
        # period. Tall normalised autocorrelation peak in the plausible tempo band = a
        # clear, machine-like pulse; flat = rubato, ambient, free time.
        pulse_clarity = 0.0
        if onset_env.size > 8:
            ac = librosa.autocorrelate(onset_env - onset_env.mean())
            if ac.size and ac[0] > 0:
                ac = ac / ac[0]
                fps = sr / 512.0                       # onset_strength hop is 512
                lo = max(1, int(fps * 60.0 / 240.0))   # 240 BPM
                hi = min(ac.size - 1, int(fps * 60.0 / 40.0))   # 40 BPM
                if hi > lo:
                    pulse_clarity = float(np.clip(ac[lo:hi].max(), 0.0, 1.0))

        # ONSET DENSITY replaces beat_strength, which was
        #   percentile(onset, 75) / max(onset)
        # — divided by the track's OWN peak, so it was a within-track shape statistic
        # that could not be compared between tracks, and it never approached 1 (median
        # 0.127, p95 0.228). Events per second is an absolute quantity: it means the same
        # thing for every track, and it separates sparse dub from busy drum'n'bass.
        onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="time")
        dur_s = max(1e-6, len(y) / float(sr))
        onset_density = float(len(onsets) / dur_s)

        # A tempo written into the file by whoever released it beats one inferred from
        # the audio. Measured across this library on the tracks that carry a BPM tag,
        # PRE-RESCUE (before the 2026-08-19 bpm_octave_rescue, which further shrank the
        # octave share): the detector matches it 78% of the time, reads a TRIPLET
        # multiple (2/3, 4/3) about 10%, and the classic octave error (x2, /2) only
        # 4.5%. So the tag is worth deferring to — but the detected value is kept
        # alongside it, because a tag can be wrong too and throwing away the
        # measurement would make that unrecoverable.
        bpm_source = "audio"
        bpm_detected = tempo
        try:
            import tags as _tags
            _t = _tags.read_tags(filepath).get("bpm")
            # Full float, not int-truncation: DJ tags carry meaningful decimals
            # (127.8 is not 127) — Aug 15 review, P3.
            _tb = float(str(_t).replace(",", ".")) if _t else 0.0
            if 40.0 <= _tb <= 250.0 and abs(tempo - _tb) / _tb > 0.03:
                tempo, bpm_source = _tb, "tag"
        except Exception:
            pass                       # a tag reader must never cost us the analysis

        result["rhythm"] = {
            "bpm": _r(tempo, 1),
            "bpm_source": bpm_source,
            "bpm_detected": _r(bpm_detected, 1),
            "pulse_clarity": _r(pulse_clarity, 3),
            "onset_density": _r(onset_density, 3),
        }

        # ── Harmonic / Key ────────────────────────────────────────────────────────
        log("Harmonic analysis...")
        y_harmonic, y_percussive = librosa.effects.hpss(y)
        # Chroma stays on the HARMONIC component. A first pass at this change moved it
        # to the raw signal on the strength of a +2.1 MIREX gain over the library's own
        # key tags — which did NOT replicate: on GiantSteps (the 615-track Beatport
        # benchmark) raw chroma scored 0.3 LOWER, and hpss+edma beat raw+edma+tuning by
        # 1.9 points. Two datasets, opposite signs, so that gain was sample noise, not a
        # finding. What replicated on BOTH sets was the profile swap alone (below).
        # The runtime argument for raw chroma was wrong too: hpss runs unconditionally
        # a line above for percussive_ratio and voice_presence, so reusing y_harmonic
        # here is free — the ~920 ms "saving" was an artefact of timing hpss in isolation.
        tuning_cents, tuning_sd, tuning_valid = estimate_tuning_gated(y, sr, float(len(y)) / sr)
        # tuning is MEASURED and stored (it is real provenance: vinyl rips, tape, 432 Hz,
        # and librosa's own correction wraps beyond +/-16.7 cents) but deliberately NOT
        # applied to this chroma: +0.4 on one benchmark, -0.3 on the other is a wash, and
        # an unapplied measurement cannot introduce a new failure mode.
        chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)
        # KEY is read from the WHOLE track, not from this window (2026-08-27). A record
        # can open on a pad, modulate, and end somewhere else; 30 seconds of it is a
        # sample, and reading the whole thing is worth more than every other key change
        # combined. Measured MIREX-weighted, and unlike the raw-chroma experiment it
        # REPLICATED on both benchmarks:
        #     library     52.7 -> 59.3  (+6.6)
        #     GiantSteps+ 61.5 -> 70.4  (+8.9)
        # It is streamed (see whole_track_chroma_mean) so it costs ~1.1 s and 283 MB
        # rather than the ~1.2 GB an unstreamed whole-track decode would take.
        # chroma_flux still comes from the WINDOW: it is a time series, and the whole-
        # track function returns a mean vector, not a matrix.
        _wt = whole_track_chroma_mean(filepath, duration)
        _key = detect_key_full(_wt if _wt is not None else chroma)
        key, mode = _key["key"], _key["mode"]
        key_scope = "whole" if _wt is not None else "window"
        # HARMONIC MOVEMENT — how much the chroma profile changes over time. A one-chord
        # groove sits near 0; a jazz progression or a through-composed piece sits high.
        # This is the closest thing to "harmonic complexity" available without chord
        # recognition, and nothing else in the feature set captures it.
        chroma_flux = float(np.mean(np.abs(np.diff(chroma, axis=1)))) if chroma.shape[1] > 1 else 0.0
        result["harmony"] = {
            "key": (f"{key} {mode}" if key != "unknown" else "unknown"),
            "root": key,
            "mode": mode,
            "chroma_flux": _r(chroma_flux, 4),
            # How far the winning key stands clear of the best UNRELATED key, 0-1.
            "key_confidence": _key["confidence"],
            "key_profile": KEY_PROFILE_DEFAULT,
            # "whole" = read from the entire track, "window" = the streamed read failed
            # and it fell back to the scan window. A library full of "window" means
            # soundfile/scipy went missing from the build.
            "key_scope": key_scope,
            # Cents off A440. Stored for provenance (vinyl rips, tape, 432 Hz releases);
            # tuning_valid=False means "couldn't tell", which is not the same as 0.
            "tuning_cents": tuning_cents,
            "tuning_valid": tuning_valid,
        }

        # ── Energy ────────────────────────────────────────────────────────────────
        log("Energy analysis...")
        rms = librosa.feature.rms(y=y)[0]
        mean_rms = float(np.mean(rms))
        dynamic_range = float(np.clip(np.std(rms) / (np.mean(rms) + 1e-8), 0, 1))
        loudness_lufs = None
        if LOUDNESS_OK:
            try:
                meter = pyln.Meter(sr)
                loudness_lufs = float(meter.integrated_loudness(y))
                if not np.isfinite(loudness_lufs):
                    loudness_lufs = None
            except Exception:
                loudness_lufs = None
        # LUFS first (perceptual and standardised); RMS only when it couldn't be measured.
        energy_norm = loudness_to_energy(loudness_lufs)
        if energy_norm is None:
            energy_norm = rms_to_energy(mean_rms)
        result["energy"] = {
            "level": _r(energy_norm, 3),
            "scale": ENERGY_SCALE,
            "dynamic_range": _r(dynamic_range, 3),
            "loudness_lufs": _r(loudness_lufs, 1) if loudness_lufs is not None else None,
        }

        # ── Timbre / Spectral ─────────────────────────────────────────────────────
        log("Timbre analysis...")
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        # Normalize: 200 Hz (very dark/warm) → 0.0, 8000 Hz (very bright) → 1.0
        brightness = float(np.clip((np.mean(centroid) - 200) / 7800, 0, 1))
        # ROUGHNESS — sensory roughness: amplitude-modulation depth in the 15–300 Hz
        # beating band. Replaced mean zero-crossing rate on 2026-08-19 (item 23): ZCR
        # tracks where the spectral balance point sits, which is what the centroid
        # (brightness) already measures — the two correlated at r=0.83 across 24k
        # tracks. AM depth lives in the modulation domain instead: on a 450-track
        # stratified sample it came out near-orthogonal to brightness (r=-0.07, max
        # |r|=0.44 vs any stored dim), with organ clusters/noise/chiptune at the top
        # and crooner ballads/solo piano at the bottom. The 0.5–15 Hz band (rhythm,
        # not roughness) sits in the denominator on purpose: rhythmic-but-smooth
        # material scores low. B2_NORM is that sample's P95, frozen — stored values
        # stay absolute and library-independent like every other feature.
        env = librosa.feature.rms(y=y, frame_length=512, hop_length=32)[0]
        env = env - env.mean()
        _esp = np.abs(np.fft.rfft(env * np.hanning(env.size))) ** 2
        _efr = np.fft.rfftfreq(env.size, d=32.0 / sr)
        _beating = _esp[(_efr >= 15.0) & (_efr <= 300.0)].sum()
        _envtot = _esp[(_efr >= 0.5) & (_efr <= 300.0)].sum() + 1e-12
        B2_NORM = 0.152
        roughness = float(np.clip((_beating / _envtot) / B2_NORM, 0, 1))
        harm_rms = float(np.mean(librosa.feature.rms(y=y_harmonic)[0]))
        perc_rms = float(np.mean(librosa.feature.rms(y=y_percussive)[0]))
        percussive_ratio = float(perc_rms / (harm_rms + perc_rms + 1e-8))
        # TIMBRAL FINGERPRINT — MFCCs 3 and 4, averaged over the track. Stored raw; the
        # vector space z-scores every column anyway.
        #
        # Every candidate here was measured against the existing dimensions on a
        # 180-track sample before being kept, using ADJUSTED R^2 so the number isn't
        # inflated by the predictor count. Two were rejected:
        #   spectral flatness ("noisiness")  adj R^2 0.897 vs the pre-2026-08-19 set,
        #                                    where roughness was still zero-crossing
        #                                    rate — worth re-auditing now that
        #                                    roughness measures AM depth instead
        #   MFCC 2                           adj R^2 0.850 — tracks brightness
        # The survivors add real information: MFCC 3 at 0.461 and MFCC 4 at 0.152.
        _mf = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=5)
        mfcc = [float(np.mean(_mf[i])) for i in (2, 3)]

        # warmth (1 - brightness) and harmonic_ratio (1 - percussive_ratio) used to be
        # stored here. Both were exact complements of the value beside them — the same
        # measurement written twice, which cost storage, drew a redundant bar on every
        # card, and in harmonic_ratio's case put a duplicate into the distance metric.
        result["timbre"] = {
            "brightness": _r(brightness, 3),      # 0=dark/warm, 1=bright/sharp
            "roughness": _r(roughness, 3),
            "percussive_ratio": _r(percussive_ratio, 3),
            "mfcc": [_r(v, 2) for v in mfcc],
        }

        # ── Content (voice / instruments) ─────────────────────────────────────────
        log("Content analysis...")
        voice_presence = estimate_voice_presence(y, sr, y_harmonic)
        # A declaration in the filename/tags (stem, acapella, instrumental, karaoke)
        # beats the heuristic: near-100% precision when present, and stems with long
        # silent stretches can dilute the measured score below its thresholds.
        declared = detect_declared_content(os.path.basename(filepath), result.get("metadata"))
        if result["energy"]["level"] is not None and result["energy"]["level"] > ENERGY_BASS_STRON and brightness < 0.4:
            bass_presence = "strong"
        elif result["energy"]["level"] is not None and result["energy"]["level"] > ENERGY_BASS_MOD:
            bass_presence = "moderate"
        else:
            bass_presence = "weak"
        has_vocals = declared["has_vocals"] if declared else voice_presence > 0.40
        likely_instrumental = (not declared["has_vocals"]) if declared else voice_presence < 0.20
        result["content"] = {
            "voice_presence": _r(voice_presence, 3),   # measured value stays informative
            "has_vocals": has_vocals,
            "likely_instrumental": likely_instrumental,
            # Provenance: "declared:<kind>" when filename/tags stated it, else "detected"
            "content_source": f"declared:{declared['kind']}" if declared else "detected",
            "percussive_content": "high" if percussive_ratio > 0.55 else ("medium" if percussive_ratio > 0.30 else "low"),
            "bass_presence": bass_presence,
        }

        # ── Derived Scores ────────────────────────────────────────────────────────
        log("Computing scores...")
        danceability = compute_danceability(tempo, pulse_clarity, y, sr)
        valence = compute_valence(mode, brightness, tempo, energy_norm)
        mood, vibe_tags = assign_mood(energy_norm, valence)
        result["scores"] = {
            "danceability": _r(danceability, 3),
            "energy": _r(energy_norm, 3),
            "valence": _r(valence, 3),
            "mood": mood,
        }
        result["vibe_tags"] = vibe_tags

        # ── Human-readable summary ────────────────────────────────────────────────
        if declared:
            vocal_str = declared["kind"]        # e.g. "acapella", "instrumental", "drum-stem"
        else:
            vocal_str = "vocal" if voice_presence > 0.40 else ("instrumental" if voice_presence < 0.20 else "possibly vocal")
        key_str = f"{key} {mode}" if key != "unknown" else "unknown key"
        result["summary"] = (
            f"{round(tempo)} BPM · {key_str} · {mood} · "
            f"danceability {round(danceability * 100)}% · energy {round(energy_norm * 100)}% · {vocal_str}"
        )

        # Feature-set epoch, stamped ONLY on a fully successful analysis — the
        # catch-all below returns partial dicts, and a version marker on a partial
        # result would let scripts/re_analyse.py mark a failed track done forever.
        # The epoch itself lives at the top of this file (FEATURES_VERSION) so the
        # re-analysis driver and the stamp can never disagree.
        result["features_version"] = FEATURES_VERSION
        return result
    except Exception as e:
        result["error"] = _describe_analysis_error(e)
        return result


def _describe_analysis_error(e):
    """Rejection text reaches non-technical testers verbatim ("analysis failed:
    NoBackendError: no detail"), so the failures we can identify get named in their
    terms. Everything else keeps the exception class — a bug report still needs it."""
    name = type(e).__name__
    if name == "NoBackendError":       # audioread: nothing installed can decode this
        return "no decoder available for this file format"
    if name == "LibsndfileError" and "unimplemented format" in str(e).lower():
        return "this file uses a compression variant with no available decoder"
    return f"analysis failed: {name}: {str(e) or 'no detail'}"


def main():
    parser = argparse.ArgumentParser(
        description="Analyze music files for BPM, key, energy, danceability, mood, and content.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python analyze.py track.mp3 --pretty
  python analyze.py *.flac --duration 90 --pretty
  python analyze.py track.mp3 | jq .summary
        """
    )
    parser.add_argument("files", nargs="+", help="Audio file(s) to analyze")
    parser.add_argument(
        "--duration", type=int, default=60,
        help="Seconds of audio to analyse per track (default: 60). More = slower but more accurate."
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")
    args = parser.parse_args()

    results = []
    for filepath in args.files:
        try:
            r = analyze(filepath, duration_limit=args.duration, verbose=not args.quiet)
            r["file"] = filepath
            results.append(r)
        except Exception as e:
            results.append({"file": filepath, "error": str(e)})

    output = results[0] if len(results) == 1 else results
    print(json.dumps(output, indent=2 if args.pretty else None))


if __name__ == "__main__":
    main()
