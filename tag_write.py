"""Write BPM, key and energy into the user's own audio files (E4, 1.1.0). Engine only.

These are the user's music files, so the rules are, in order:

  1. The original is never written in place. The file is copied to a temp in the same folder
     (`.tftmp-<12 hex of sha1(basename)>`), the temp gets the new tags, the temp is checked,
     then os.replace() swaps it in. Any failure removes the temp and leaves the original
     byte-identical.
  2. The audio is never touched. After writing, the audio bytes of the temp are compared with
     the original's (MP3: everything after the ID3v2 tag, ID3v1/APE included; FLAC: the
     frames after the metadata blocks; MP4: every mdat payload plus the sample-chunk offsets;
     AIFF: every chunk but the ID3 chunk), along with mutagen's stream info.
  3. Only three fields move: bpm, key, energy. Every other tag survives as it was. Where
     mutagen would silently drop or merge something on a round trip (a junk ID3 frame, a
     Vorbis comment that is not valid UTF-8, an ID3v2.2 tag), the file is refused instead.
     ID3v2.3 stays v2.3, an untagged file gets v2.4. ID3v1 tails are left alone.

Field mapping (the release/QA contract):
  bpm    MP3/AIFF TBPM (rounded integer) | FLAC BPM ("%.2f")    | MP4 tmpo (integer)
  key    MP3/AIFF TKEY                   | FLAC INITIALKEY      | MP4 ----:com.apple.iTunes:initialkey
  energy MP3/AIFF TXXX:ENERGY (1-10)     | FLAC ENERGY          | MP4 ----:com.apple.iTunes:ENERGY

API
  SUPPORTED_EXTS
  read_values(path) -> {"bpm", "key", "energy"}: the text stored in the file, None when absent
      (a list of strings when a field holds several values). Raises TagWriteError.
  check(path, fields) -> None if write() would go ahead, else the refusal reason. Writes nothing.
  write(path, fields) -> {"old": read_values before, "size", "mtime"} after. A field set to
      None is left alone. Raises TagWriteError(reason).
  restore(path, old, expect_size, expect_mtime) -> {"size", "mtime"}. Puts `old` back (as
      returned by write); a field whose old value is None is removed, a field missing from
      `old` is left alone. Refuses if the file changed since write().
  cleanup_temps(folder, older_than_s=600) -> number of leftover temps removed (one folder).

Reasons are the R_* constants below; TagWriteError.reason holds one of them.
"""

import io
import os
import sys
import math
import stat
import time
import errno
import struct
import shutil
import hashlib
import threading

from mutagen.id3 import ID3, TBPM, TKEY, TXXX, TextFrame, ID3NoHeaderError
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.mp4 import MP4, MP4FreeForm, AtomDataType
from mutagen.aiff import AIFF

try:
    # mutagen internals (pinned 1.47.0), used only to count raw ID3 frames exactly the way
    # mutagen reads them. Without them every ID3 write is refused rather than risked.
    from mutagen.id3._tags import determine_bpi as _determine_bpi
    from mutagen.id3._util import unsynch as _unsynch
    from mutagen.id3 import Frames as _ID3_FRAMES
except ImportError:  # pragma: no cover
    _determine_bpi = None

__all__ = ["SUPPORTED_EXTS", "FIELDS", "TagWriteError", "read_values", "check", "write",
           "restore", "cleanup_temps"]

SUPPORTED_EXTS = frozenset({".mp3", ".flac", ".m4a", ".m4b", ".mp4", ".aif", ".aiff"})
FIELDS = ("bpm", "key", "energy")

R_FORMAT = "format not supported for tag writing"
R_READONLY = "read-only"
R_SPACE = "not enough space"
R_VERIFY = "verification failed"
R_CHANGED = "changed since Tunefield wrote it"
R_NAME = "name too long"
R_MISSING = "file not found"
R_UNREADABLE = "file could not be read"
R_TAGS = "existing tags can't be kept intact"
R_BUSY = "file changed during the write"
R_INVALID = "invalid value"          # sent as "invalid value: <field>"
R_FAILED = "write failed"

_KIND = {".mp3": "mp3", ".flac": "flac", ".m4a": "mp4", ".m4b": "mp4", ".mp4": "mp4",
         ".aif": "aiff", ".aiff": "aiff"}
_ID3_KEYS = {"bpm": "TBPM", "key": "TKEY", "energy": "TXXX:ENERGY"}
_VC_KEYS = {"bpm": "BPM", "key": "INITIALKEY", "energy": "ENERGY"}
_MP4_KEYS = {"bpm": "tmpo", "key": "----:com.apple.iTunes:initialkey",
             "energy": "----:com.apple.iTunes:ENERGY"}

_TEMP_PREFIX = ".tftmp-"
_SIDECAR_PREFIX = "._" + _TEMP_PREFIX   # AppleDouble twin macOS makes on FAT32/exFAT
_MAX_NAME_UNITS = 255                   # UTF-16 code units (HFS+/FAT32/exFAT limit)
_SPACE_MARGIN = 1 << 20
_CHUNK = 1 << 20
_LOCK = threading.RLock()               # one write at a time per process


class TagWriteError(Exception):
    """A refusal or failure. str(e) == e.reason; e.detail says more, for logs."""

    def __init__(self, reason, detail=""):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


class _Verify(Exception):
    pass


# ── public API ───────────────────────────────────────────────────────────────
def read_values(path):
    real = os.path.realpath(path)
    kind = _kind_of(real)
    if not os.path.isfile(real):
        raise TagWriteError(R_MISSING)
    try:
        if kind == "mp3":
            try:
                tags = ID3(real, load_v1=False)
            except ID3NoHeaderError:
                tags = None
        elif kind == "aiff":
            tags = AIFF(real, load_v1=False).tags
        elif kind == "flac":
            tags = FLAC(real).tags
        else:
            tags = MP4(real).tags
        vals = {f: _get(kind, tags, f) for f in FIELDS}
    except TagWriteError:
        raise
    except Exception as e:
        raise TagWriteError(R_UNREADABLE, repr(e))
    return {f: _public(v) for f, v in vals.items()}


def check(path, fields):
    with _LOCK:
        try:
            _prepare(path, _typed_to_raw(fields))
        except TagWriteError as e:
            return e.reason
    return None


def write(path, fields):
    with _LOCK:
        job = _prepare(path, _typed_to_raw(fields))
        old = {f: _public(job.current[f]) for f in FIELDS}
        if job.changes:
            _commit(job)
        st = os.stat(job.real)
        return {"old": old, "size": st.st_size, "mtime": st.st_mtime}


def restore(path, old, expect_size, expect_mtime):
    if not isinstance(old, dict) or set(old) - set(FIELDS):
        raise TagWriteError(R_INVALID + ": old")
    raw = {f: _raw_from_old(f, old[f]) for f in FIELDS if f in old}
    with _LOCK:
        job = _prepare(path, raw, restoring=True, expect=(expect_size, expect_mtime))
        if job.changes:
            _commit(job)
        st = os.stat(job.real)
        return {"size": st.st_size, "mtime": st.st_mtime}


def cleanup_temps(folder, older_than_s=600):
    """Remove `.tftmp-*` and `._.tftmp-*` files in `folder` (not recursive) whose last change
    is older than `older_than_s` seconds. Returns how many were removed."""
    removed = 0
    with _LOCK:
        try:
            names = os.listdir(folder)
        except OSError:
            return 0
        now = time.time()
        for name in names:
            if not (name.startswith(_TEMP_PREFIX) or name.startswith(_SIDECAR_PREFIX)):
                continue
            p = os.path.join(folder, name)
            try:
                st = os.lstat(p)
                # ctime too: copy2 back-dates a fresh temp's mtime to the original's
                if not stat.S_ISREG(st.st_mode) or now - max(st.st_mtime, st.st_ctime) < older_than_s:
                    continue
                os.unlink(p)
                removed += 1
            except OSError:
                pass
    return removed


# ── field values ─────────────────────────────────────────────────────────────
def _typed_to_raw(fields):
    """Validate write()'s typed values. -> {field: value} for fields to set (None = untouched)."""
    if not isinstance(fields, dict):
        raise TagWriteError(R_INVALID + ": fields")
    out = {}
    for f, v in fields.items():
        if f not in FIELDS:
            raise TagWriteError(R_INVALID + ": " + str(f))
        if v is None:
            continue
        if f == "bpm":
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) \
                    or not 1 <= v < 1000:
                raise TagWriteError(R_INVALID + ": bpm")
            out[f] = ("bpm", float(v))
        elif f == "key":
            if not isinstance(v, str) or not 0 < len(v.strip()) <= 32 or not v.strip().isprintable():
                raise TagWriteError(R_INVALID + ": key")
            out[f] = [v.strip()]
        else:
            if isinstance(v, bool) or not isinstance(v, (int, float)) \
                    or (isinstance(v, float) and not v.is_integer()) or not 1 <= v <= 10:
                raise TagWriteError(R_INVALID + ": energy")
            out[f] = [str(int(v))]
    return out


def _raw_from_old(field, v):
    if v is None:
        return None
    vals = v if isinstance(v, (list, tuple)) else [v]
    if not vals or not all(isinstance(x, (str, int, float)) and not isinstance(x, bool) for x in vals):
        raise TagWriteError(R_INVALID + ": " + field)
    return [str(x) for x in vals]


def _desired(kind, value):
    """A validated value -> the list of strings this format stores."""
    if isinstance(value, tuple):           # ("bpm", float) from write()
        bpm = value[1]
        return ["%.2f" % bpm] if kind == "flac" else [str(int(math.floor(bpm + 0.5)))]
    return value


def _public(vals):
    if not vals:
        return None
    return vals[0] if len(vals) == 1 else list(vals)


def _get(kind, tags, field):
    """Stored values as a list of strings, or None."""
    if tags is None:
        return None
    if kind in ("mp3", "aiff"):
        fr = tags.get(_ID3_KEYS[field])
        vals = [str(t) for t in fr.text] if fr is not None else []
    elif kind == "flac":
        vals = list(tags[_VC_KEYS[field]]) if _VC_KEYS[field] in tags else []
    else:
        key = _MP4_KEYS[field]
        vals = []
        for v in (tags[key] if key in tags else []):
            if isinstance(v, MP4FreeForm):
                enc = "utf-16-be" if v.dataformat == AtomDataType.UTF16 else "utf-8"
                vals.append(bytes(v).decode(enc, "replace"))
            else:
                vals.append(str(v))
    return vals if any(vals) else None


def _set(job, field, vals):
    """Put `vals` (list of str) into the loaded tags, or remove the field when None."""
    tags = job.tags
    if job.kind in ("mp3", "aiff"):
        key = _ID3_KEYS[field]
        tags.delall(key)
        if vals:
            ascii_only = all(c < "\x80" for s in vals for c in s)
            enc = 0 if ascii_only else (3 if job.version == 4 else 1)
            if field == "energy":
                tags.add(TXXX(encoding=enc, desc="ENERGY", text=vals))
            else:
                tags.add((TBPM if field == "bpm" else TKEY)(encoding=enc, text=vals))
    elif job.kind == "flac":
        key = _VC_KEYS[field]
        if vals:
            tags[key] = list(vals)
        elif key in tags:
            del tags[key]
    else:
        key = _MP4_KEYS[field]
        if vals and field == "bpm":
            try:
                ints = [int(v) for v in vals]
            except ValueError:
                raise TagWriteError(R_INVALID + ": bpm")
            if not all(0 <= i <= 0xFFFF for i in ints):
                raise TagWriteError(R_INVALID + ": bpm")
            tags[key] = ints
        elif vals:
            tags[key] = [MP4FreeForm(v.encode("utf-8"), dataformat=AtomDataType.UTF8) for v in vals]
        elif key in tags:
            del tags[key]


# ── preparation: every refusal happens here, before anything is written ─────
class _Job:
    pass


def _kind_of(real):
    kind = _KIND.get(os.path.splitext(real)[1].lower())
    if kind is None:
        raise TagWriteError(R_FORMAT)
    return kind


def _temp_names(base):
    h = hashlib.sha1(os.fsencode(base)).hexdigest()[:12]
    return _TEMP_PREFIX + h, _SIDECAR_PREFIX + h


def _prepare(path, raw, restoring=False, expect=None):
    job = _Job()
    job.real = real = os.path.realpath(path)    # a symlink is written through, not replaced
    job.kind = kind = _kind_of(real)
    job.folder, job.base = os.path.split(real)
    try:
        job.st = st = os.stat(real)
    except OSError:
        raise TagWriteError(R_MISSING)
    if not stat.S_ISREG(st.st_mode):
        raise TagWriteError(R_MISSING)
    if expect is not None and (st.st_size != expect[0] or abs(st.st_mtime - float(expect[1])) > 1e-6):
        raise TagWriteError(R_CHANGED)
    if len(job.base.encode("utf-16-le", "surrogatepass")) // 2 > _MAX_NAME_UNITS:
        raise TagWriteError(R_NAME)
    if not os.access(real, os.W_OK) or not os.access(job.folder, os.W_OK | os.X_OK):
        raise TagWriteError(R_READONLY)
    try:
        free = shutil.disk_usage(job.folder).free
    except OSError as e:
        raise TagWriteError(R_FAILED, repr(e))
    if free < st.st_size + _SPACE_MARGIN:
        raise TagWriteError(R_SPACE)
    t, s = _temp_names(job.base)
    job.temp, job.sidecar = os.path.join(job.folder, t), os.path.join(job.folder, s)

    try:
        {"mp3": _load_mp3, "aiff": _load_aiff, "flac": _load_flac, "mp4": _load_mp4}[kind](job)
    except TagWriteError:
        raise
    except Exception as e:
        raise TagWriteError(R_UNREADABLE, repr(e))

    job.current = {f: _get(kind, job.tags, f) for f in FIELDS}
    job.want = {f: _desired(kind, v) for f, v in raw.items()}
    job.changes = {f: v for f, v in job.want.items() if v != job.current[f]}
    job.restoring = restoring
    return job


def _id3_head(b):
    """(major, flags, body_size, total_size) of an ID3v2 header at the start of b, or None."""
    if len(b) < 10 or b[:3] != b"ID3":
        return None
    major, flags, sz = b[3], b[5], b[6:10]
    if any(x & 0x80 for x in sz):
        raise TagWriteError(R_UNREADABLE, "ID3 size not syncsafe")
    body = (sz[0] << 21) | (sz[1] << 14) | (sz[2] << 7) | sz[3]
    total = 10 + body + (10 if major == 4 and flags & 0x10 else 0)   # v2.4 footer
    return major, flags, body, total


def _check_id3(job, raw_tag, tags):
    """Refuse an ID3 tag mutagen cannot carry through unchanged."""
    major, flags, body, _ = _id3_head(raw_tag)
    if major not in (3, 4) or flags & 0x40:     # v2.2 / v2.5+ / extended header
        raise TagWriteError(R_TAGS, "ID3v2.%d flags %#x" % (major, flags))
    if _determine_bpi is None:
        raise TagWriteError(R_TAGS, "mutagen internals changed")
    data = raw_tag[10:10 + body]
    if major == 3 and flags & 0x80:
        try:
            data = _unsynch.decode(data)
        except ValueError:
            pass
    bpi = _determine_bpi(data, _ID3_FRAMES) if major == 4 else int
    raw_frames = 0
    while len(data) >= 10:                      # the same walk as mutagen's read_frames
        name, size, _ = struct.unpack(">4sLH", data[:10])
        if name.strip(b"\x00") == b"":
            break
        size = bpi(size)
        data = data[10 + size:]
        if size:
            raw_frames += 1
    loaded = len(list(tags.values())) + len(tags.unknown_frames)
    if raw_frames != loaded:                    # mutagen dropped (junk) or merged (dupes) frames
        raise TagWriteError(R_TAGS, "%d frames in file, %d understood" % (raw_frames, loaded))
    job.version = major


def _id3_sig(tags):
    """Every non-target frame, as text, to prove the round trip kept them."""
    sig = {}
    for key, fr in tags.items():
        if key in _ID3_KEYS.values() or (isinstance(fr, TextFrame) and not str(fr)):
            continue
        data = getattr(fr, "data", None)
        sig[key] = (type(fr).__name__, fr.pprint(),
                    hashlib.sha1(data).hexdigest() if isinstance(data, bytes) else None)
    return sig, sorted(hashlib.sha1(u).hexdigest() for u in tags.unknown_frames)


_FOREIGN = (b"RIFF", b"FORM", b"fLaC", b"OggS", b"MAC ", b"wvpk", b"caff", b"TTA1",
            b"\x30\x26\xb2\x75")


def _load_mp3(job):
    with open(job.real, "rb") as f:
        head = _id3_head(f.read(10))
        job.old_total = head[3] if head else 0
        if job.old_total > job.st.st_size:
            raise TagWriteError(R_UNREADABLE, "ID3 tag runs past the end")
        f.seek(0)
        raw_tag = f.read(10 + head[2]) if head else b""
        f.seek(job.old_total)
        magic = f.read(12)
    if magic[:4] in _FOREIGN or magic[4:8] == b"ftyp":     # another container named .mp3
        raise TagWriteError(R_FORMAT)
    job.info = _info(MP3(job.real).info)
    if head:
        job.tags = ID3(job.real, translate=False, load_v1=False)
        _check_id3(job, raw_tag, job.tags)
    else:
        job.tags, job.version = ID3(), 4
    job.sig = _id3_sig(job.tags)


def _load_aiff(job):
    lay = _aiff_layout(job.real)
    id3 = [c for c in lay[2] if c[0] == "ID3"]
    if len(id3) > 1:
        raise TagWriteError(R_TAGS, "two ID3 chunks")
    a = AIFF(job.real, translate=False, load_v1=False)
    job.info = _info(a.info)
    if id3:
        _, off, ln = id3[0]
        with open(job.real, "rb") as f:
            f.seek(off + 8)
            raw = f.read(ln)
        head = _id3_head(raw)
        if a.tags is None or head is None or 10 + head[2] > ln:
            raise TagWriteError(R_TAGS, "ID3 chunk without a readable tag")
        _check_id3(job, raw, a.tags)
    else:
        a.add_tags()
        job.version = 4
    job.audio, job.tags = a, a.tags
    job.sig = _id3_sig(job.tags)


def _load_flac(job):
    fl = FLAC(job.real)
    job.info = _info(fl.info)
    if fl.tags is None:
        fl.add_tags()
    else:
        vendor, items = _vc_raw(_flac_layout(job.real)[1])
        rendered = [("%s=%s" % kv).encode("utf-8") for kv in fl.tags]
        if rendered != items or fl.tags.vendor.encode("utf-8") != vendor:
            raise TagWriteError(R_TAGS, "Vorbis comments mutagen would rewrite")
    job.audio, job.tags = fl, fl.tags


def _load_mp4(job):
    with open(job.real, "rb") as f:
        top = list(_mp4_atoms(f, 0, job.st.st_size))
    if any(a[0] == b"moof" for a in top):
        raise TagWriteError(R_FORMAT, "fragmented MP4")
    m = MP4(job.real)
    job.info = _info(m.info)
    if m.tags is None:
        m.add_tags()
    job.audio, job.tags = m, m.tags
    job.sig = _mp4_sig(m.tags)


def _info(info):
    return tuple(round(float(getattr(info, a, 0) or 0), 6)
                 for a in ("length", "bitrate", "sample_rate", "channels"))


# ── commit: copy, write the copy, check it, swap it in ──────────────────────
def _commit(job):
    for f, v in job.changes.items():
        _set(job, f, v)
    done = False
    try:
        _unlink_quiet(job.temp)
        _unlink_quiet(job.sidecar)
        shutil.copy2(job.real, job.temp)
        _copy_xattrs(job.real, job.temp)        # Finder tags etc.; copy2 skips them on macOS
        {"mp3": _write_mp3, "aiff": _write_aiff, "flac": _write_flac, "mp4": _write_mp4}[job.kind](job)
        _fsync_path(job.temp)
        _verify(job)
        now = os.stat(job.real)
        if (now.st_size, now.st_mtime_ns, now.st_ino) != (job.st.st_size, job.st.st_mtime_ns, job.st.st_ino):
            raise TagWriteError(R_BUSY)
        os.replace(job.temp, job.real)
        done = True
        _fsync_dir(job.folder)
    except TagWriteError:
        raise
    except _Verify as e:
        raise TagWriteError(R_VERIFY, str(e))
    except OSError as e:
        raise TagWriteError(_os_reason(e), repr(e))
    except Exception as e:
        raise TagWriteError(R_FAILED, repr(e))
    finally:
        if not done:
            _unlink_quiet(job.temp)
        _unlink_quiet(job.sidecar)              # orphan AppleDouble twin, FAT32


def _tags_empty(tags):
    return len(tags) == 0 and not getattr(tags, "unknown_frames", None)


def _write_mp3(job):
    # mutagen renders the ID3v2 tag in memory; everything after the old tag (audio, ID3v1,
    # APE) is copied byte for byte. mutagen's own MP3 save would rewrite the ID3v1 tail.
    if job.restoring and _tags_empty(job.tags):
        tag = b""                               # nothing left: the file goes back to untagged
    else:
        tag = _render_id3(job.tags, job.version, job.old_total, job.st.st_size - job.old_total)
    with open(job.temp, "r+b") as out:
        if len(tag) == job.old_total:
            out.write(tag)
        else:
            out.truncate(0)
            out.write(tag)
            with open(job.real, "rb") as src:
                src.seek(job.old_total)
                shutil.copyfileobj(src, out, _CHUNK)


def _render_id3(tags, version, old_total, rest_size):
    def padding(info):
        needed = -info.padding                  # rendering into an empty buffer: available 0
        return old_total - needed if needed <= old_total else 1024 + rest_size // 1000
    sentinel = b"\x00" * 256                    # keeps mutagen's ID3v1 probe off the tag bytes
    buf = io.BytesIO(sentinel)
    tags.save(buf, v1=0, v2_version=version, v23_sep=None, padding=padding)
    data = buf.getvalue()
    if not data.endswith(sentinel):
        raise _Verify("rendered tag damaged")
    tag = data[:-len(sentinel)]
    head = _id3_head(tag)
    if head is None or head[0] != version or head[3] != len(tag):
        raise _Verify("rendered tag malformed")
    return tag


def _write_aiff(job):
    if job.restoring and _tags_empty(job.tags):
        job.tags.delete(job.temp)
    else:
        job.tags.save(job.temp, v2_version=job.version, v23_sep=None)


def _write_flac(job):
    job.audio.save(job.temp)


def _write_mp4(job):
    job.audio.save(job.temp)


# ── verification ─────────────────────────────────────────────────────────────
def _verify(job):
    {"mp3": _verify_mp3, "aiff": _verify_aiff, "flac": _verify_flac, "mp4": _verify_mp4}[job.kind](job)
    # what the temp says now: the wanted values, nothing else moved
    if job.kind == "mp3":
        try:
            tags = ID3(job.temp, translate=False, load_v1=False)
        except ID3NoHeaderError:
            tags = ID3()
        info = MP3(job.temp).info
    elif job.kind == "aiff":
        a = AIFF(job.temp, translate=False, load_v1=False)
        tags, info = a.tags or ID3(), a.info
    elif job.kind == "flac":
        fl = FLAC(job.temp)
        tags, info = fl.tags, fl.info
    else:
        m = MP4(job.temp)
        tags, info = m.tags, m.info
    if _info(info) != job.info:
        raise _Verify("stream info changed")
    for f in FIELDS:
        expect = job.want[f] if f in job.want else job.current[f]
        if _get(job.kind, tags, f) != (expect or None):
            raise _Verify("%s reads back wrong" % f)
    if job.kind in ("mp3", "aiff") and _id3_sig(tags) != job.sig:
        raise _Verify("other ID3 frames changed")
    if job.kind == "mp4" and _mp4_sig(tags) != job.sig:
        raise _Verify("other MP4 tags changed")


def _verify_mp3(job):
    with open(job.temp, "rb") as f:
        head = _id3_head(f.read(10))
    new_total = head[3] if head else 0
    if head and head[0] != job.version:
        raise _Verify("ID3 version changed")
    old_rest = job.st.st_size - job.old_total
    if os.path.getsize(job.temp) - new_total != old_rest or \
            _hash_range(job.real, job.old_total, None) != _hash_range(job.temp, new_total, None):
        raise _Verify("audio bytes changed")


def _verify_aiff(job):
    old, new = _aiff_layout(job.real), _aiff_layout(job.temp)
    if old[0] != new[0]:
        raise _Verify("FORM type changed")

    def body(path, lay):
        return [(c[0], _hash_range(path, c[1] + 8, c[1] + 8 + c[2])) for c in lay[2] if c[0] != "ID3"]
    if body(job.real, old) != body(job.temp, new) or \
            _hash_range(job.real, old[3], None) != _hash_range(job.temp, new[3], None):
        raise _Verify("audio chunks changed")
    if old[1] + 8 == os.path.getsize(job.real) and new[1] + 8 != os.path.getsize(job.temp):
        raise _Verify("FORM size wrong")
    id3 = [c for c in new[2] if c[0] == "ID3"]
    if id3:
        with open(job.temp, "rb") as f:
            f.seek(id3[0][1] + 8)
            head = _id3_head(f.read(10))
        if head is None or head[0] != job.version:
            raise _Verify("ID3 version changed")


def _verify_flac(job):
    o_start, o_blocks, o_audio = _flac_layout(job.real)
    n_start, n_blocks, n_audio = _flac_layout(job.temp)
    if _hash_range(job.real, 0, o_start) != _hash_range(job.temp, 0, n_start):
        raise _Verify("bytes before fLaC changed")
    if [b for b in o_blocks if b[0] not in (1, 4)] != [b for b in n_blocks if b[0] not in (1, 4)]:
        raise _Verify("metadata blocks changed")
    if o_blocks[0][0] != 0 or n_blocks[0] != o_blocks[0]:
        raise _Verify("STREAMINFO changed")
    if any(b[0] == 4 for b in o_blocks):
        ov, oi = _vc_raw(o_blocks)
        nv, ni = _vc_raw(n_blocks)
        targets = {k.lower().encode() for k in _VC_KEYS.values()}

        def others(items):
            return [i for i in items if i.split(b"=", 1)[0].lower() not in targets]
        if ov != nv or others(oi) != others(ni):
            raise _Verify("other Vorbis comments changed")
    if os.path.getsize(job.real) - o_audio != os.path.getsize(job.temp) - n_audio or \
            _hash_range(job.real, o_audio, None) != _hash_range(job.temp, n_audio, None):
        raise _Verify("audio frames changed")


def _verify_mp4(job):
    with open(job.real, "rb") as fo, open(job.temp, "rb") as fn:
        o_top = list(_mp4_atoms(fo, 0, os.fstat(fo.fileno()).st_size))
        n_top = list(_mp4_atoms(fn, 0, os.fstat(fn.fileno()).st_size))

        def mdat(path, top):
            h = hashlib.sha256()
            for typ, off, hl, size in top:
                if typ == b"mdat":
                    h.update(_hash_range(path, off + hl, off + size).encode())
            return h.hexdigest()
        if mdat(job.real, o_top) != mdat(job.temp, n_top):
            raise _Verify("mdat changed")
        o_off, n_off = _mp4_chunk_offsets(fo, o_top), _mp4_chunk_offsets(fn, n_top)
        if [len(t) for t in o_off] != [len(t) for t in n_off]:
            raise _Verify("sample tables changed")
        for ot, nt in zip(o_off, n_off):
            for a, b in zip(ot, nt):        # every chunk offset still lands on the same bytes
                fo.seek(a)
                fn.seek(b)
                if fo.read(16) != fn.read(16):
                    raise _Verify("chunk offsets point at different audio")


def _mp4_sig(tags):
    return {k: v for k, v in tags.items() if k not in _MP4_KEYS.values()}


# ── container walkers (read only) ───────────────────────────────────────────
def _hash_range(path, start, end):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        f.seek(start)
        left = None if end is None else end - start
        while left is None or left > 0:
            b = f.read(_CHUNK if left is None else min(_CHUNK, left))
            if not b:
                break
            h.update(b)
            if left is not None:
                left -= len(b)
    return h.hexdigest()


def _aiff_layout(path):
    """(form_type, form_size, [(chunk_id, offset, data_len)], tail_start). Walks like mutagen."""
    with open(path, "rb") as f:
        size = os.fstat(f.fileno()).st_size
        h = f.read(12)
        if len(h) < 12 or h[:4] != b"FORM":
            raise TagWriteError(R_UNREADABLE, "no FORM")
        form_size = struct.unpack(">I", h[4:8])[0]
        end = min(8 + form_size + (form_size & 1), size)
        pos, chunks = 12, []
        while pos + 8 <= end:
            f.seek(pos)
            cid, ln = struct.unpack(">4sI", f.read(8))
            try:
                name = cid.decode("ascii").rstrip()
            except UnicodeDecodeError:
                break
            if not name or min(name) < " " or max(name) > "~":
                break
            if pos + 8 + ln > size:
                raise TagWriteError(R_UNREADABLE, "chunk runs past the end")
            chunks.append((name, pos, ln))
            pos += 8 + ln + (ln & 1)
        return h[8:12], form_size, chunks, min(pos, size)


def _flac_layout(path):
    """(offset of fLaC, [(block_type, bytes)], offset of the first audio frame)."""
    with open(path, "rb") as f:
        head = _id3_head(f.read(10))
        start = head[3] if head else 0
        f.seek(start)
        if f.read(4) != b"fLaC":
            raise TagWriteError(R_UNREADABLE, "no fLaC")
        blocks = []
        while True:
            h = f.read(4)
            if len(h) < 4:
                raise TagWriteError(R_UNREADABLE, "metadata runs past the end")
            ln = int.from_bytes(h[1:4], "big")
            data = f.read(ln)
            if len(data) < ln:
                raise TagWriteError(R_UNREADABLE, "metadata runs past the end")
            blocks.append((h[0] & 0x7F, data))
            if h[0] & 0x80:
                break
        return start, blocks, f.tell()


def _vc_raw(blocks):
    """(vendor bytes, [raw comment bytes]) of the first VORBIS_COMMENT block."""
    data = next(d for t, d in blocks if t == 4)
    vl = int.from_bytes(data[:4], "little")
    vendor, p = data[4:4 + vl], 4 + vl
    n, p = int.from_bytes(data[p:p + 4], "little"), p + 4
    items = []
    for _ in range(n):
        ln = int.from_bytes(data[p:p + 4], "little")
        items.append(data[p + 4:p + 4 + ln])
        p += 4 + ln
    if p > len(data):
        raise TagWriteError(R_UNREADABLE, "Vorbis comment block truncated")
    return vendor, items


def _mp4_atoms(f, start, end):
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        size, typ = struct.unpack(">I4s", f.read(8))
        hl = 8
        if size == 1:
            size, hl = struct.unpack(">Q", f.read(8))[0], 16
        elif size == 0:
            size = end - pos
        if size < hl or pos + size > end:
            raise TagWriteError(R_UNREADABLE, "bad MP4 atom")
        yield typ, pos, hl, size
        pos += size


def _mp4_chunk_offsets(f, top):
    """Per track: the stco/co64 chunk offsets."""
    def kids(atom):
        return list(_mp4_atoms(f, atom[1] + atom[2], atom[1] + atom[3]))

    def find(atom, path):
        for name in path:
            atom = next((a for a in kids(atom) if a[0] == name), None)
            if atom is None:
                return None
        return atom
    out = []
    for moov in (a for a in top if a[0] == b"moov"):
        for trak in (a for a in kids(moov) if a[0] == b"trak"):
            stbl = find(trak, (b"mdia", b"minf", b"stbl"))
            offs = []
            for typ, off, hl, size in (kids(stbl) if stbl else []):
                if typ in (b"stco", b"co64"):
                    f.seek(off + hl + 4)
                    n = struct.unpack(">I", f.read(4))[0]
                    fmt = ">%d%s" % (n, "I" if typ == b"stco" else "Q")
                    offs += struct.unpack(fmt, f.read(struct.calcsize(fmt)))
            out.append(offs)
    return out


# ── file system helpers ──────────────────────────────────────────────────────
def _unlink_quiet(p):
    try:
        if os.path.lexists(p):
            os.unlink(p)
    except OSError:
        pass


def _os_reason(e):
    if e.errno in (errno.ENOSPC, errno.EDQUOT):
        return R_SPACE
    if e.errno in (errno.EROFS, errno.EACCES, errno.EPERM):
        return R_READONLY
    if e.errno == errno.ENOENT:
        return R_MISSING
    if e.errno == errno.ENAMETOOLONG:
        return R_NAME
    return R_FAILED


def _fsync_path(p):
    fd = os.open(p, os.O_RDONLY)
    try:
        try:
            import fcntl
            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)   # macOS: really reach the disk
            return
        except (ImportError, AttributeError, OSError):
            pass
        try:
            os.fsync(fd)
        except OSError as e:
            if e.errno not in (errno.EINVAL, errno.ENOTSUP):
                raise
    finally:
        os.close(fd)


def _fsync_dir(folder):
    try:
        fd = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


_copyfile = None
if sys.platform == "darwin":
    try:
        import ctypes
        import ctypes.util
        _libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
        _copyfile = _libc.copyfile
        _copyfile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_uint32]
        _copyfile.restype = ctypes.c_int
    except (OSError, AttributeError):  # pragma: no cover
        _copyfile = None
_COPYFILE_XATTR = 1 << 2


def _copy_xattrs(src, dst):
    """macOS: copy extended attributes (Finder tags, comments). Linux copy2 already does."""
    if _copyfile is None:
        return
    if _copyfile(os.fsencode(src), os.fsencode(dst), None, _COPYFILE_XATTR) < 0:
        import ctypes
        err = ctypes.get_errno()
        raise OSError(err, "copyfile xattrs: " + os.strerror(err))
