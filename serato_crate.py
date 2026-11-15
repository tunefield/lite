"""Serato crate export engine (Tunefield Lite 1.1.0, E3). Stdlib only, no UI, no routes.

A Serato crate is one file `<name>.crate` in `<volume root>/_Serato_/Subcrates/`. This
module groups tracks by volume, builds/reads the binary content and writes it atomically.

FORMAT (all from community reverse engineering; Serato publishes no spec, and no real
Serato install was available to verify against):
  * Concatenated records: 4-byte ASCII tag, 4-byte big-endian length, value.
    Tag family by first letter: o* nested records, t* UTF-16BE text, p* UTF-16BE path,
    u*/s* 32-bit big-endian uint/int, b* raw byte.
    pyserato 0.2.0 docs https://pypi.org/project/pyserato/0.2.0/ ;
    kerrickstaley parser https://gist.github.com/kerrickstaley/8eb04988c02fa7c62e75c4c34c04cf02
  * `vrsn` = "1.0/Serato ScratchLive Crate" (UTF-16BE), first record (pyserato docs).
  * `osrt` { `tvcn` sort column name, `brev` 1 byte reverse flag }; `ovct` { `tvcn` column
    name, `tvcw` width as text } per column; then one `otrk` { `ptrk` path } per track.
    Layout and example values (columns song/artist/bpm/playCount, tvcw "0", brev False)
    from the serato-tools dump https://github.com/bvandercar-vt/serato-tools and the
    kerrickstaley gist.
  * Paths are relative to the root of the drive holding the crate, no leading slash;
    one crate file per drive; same-named crates from different drives are merged by
    Serato DJ (https://slensky.com/python-serato-crates/api_reference.html).
  * Crates live in `_Serato_/Subcrates` at the drive root; on the system disk that is
    `~/Music/_Serato_/Subcrates` (task brief; Serato support page not fetchable).
  * Sub-crate nesting is encoded in the file name with `%%` (task brief).

UNSURE (not verifiable here): the default column set song/artist/bpm/key/length and
width "0" (real crates may carry other names/widths); the exact `brev` byte; whether
Serato requires `osrt` before the columns; Latin-1 `orvc` variants of ptrk are ignored.
"""
import os
import re
import struct
import tempfile

VERSION = "1.0/Serato ScratchLive Crate"
DEFAULT_COLUMNS = ("song", "artist", "bpm", "key", "length")
DEFAULT_SORT = "song"
_MAX_NAME_BYTES = 200  # leaves room for ".crate" under the 255-byte file name limit


def _rec(tag, value=b""):
    return tag.encode("ascii") + struct.pack(">I", len(value)) + value


def _u16(s):
    return s.encode("utf-16-be")


def build_crate(rel_paths):
    out = [_rec("vrsn", _u16(VERSION)),
           _rec("osrt", _rec("tvcn", _u16(DEFAULT_SORT)) + _rec("brev", b"\x00"))]
    for col in DEFAULT_COLUMNS:
        out.append(_rec("ovct", _rec("tvcn", _u16(col)) + _rec("tvcw", _u16("0"))))
    for p in rel_paths:
        out.append(_rec("otrk", _rec("ptrk", _u16(p))))
    return b"".join(out)


def _records(data):
    i, n = 0, len(data)
    while i < n:
        if i + 8 > n:
            raise ValueError("truncated crate record header")
        tag = data[i:i + 4].decode("ascii", "replace")
        (ln,) = struct.unpack(">I", data[i + 4:i + 8])
        if i + 8 + ln > n:
            raise ValueError("truncated crate record body")
        yield tag, data[i + 8:i + 8 + ln]
        i += 8 + ln


def read_crate(data):
    paths = []
    for tag, val in _records(data):
        if tag == "otrk":
            for t2, v2 in _records(val):
                if t2 == "ptrk":
                    paths.append(v2.decode("utf-16-be"))
    return paths


def crate_filename(name):
    s = re.sub(r'[\x00-\x1f\x7f/\\:]', "_", str(name))
    s = s.lstrip(". ").rstrip(". ")
    while "%%" in s:
        s = s.replace("%%", "%")
    s = s.encode("utf-8")[:_MAX_NAME_BYTES].decode("utf-8", "ignore").rstrip(". ")
    return (s or "Untitled") + ".crate"


def crate_targets(abs_paths, home=None):
    home = os.path.abspath(home or os.path.expanduser("~"))
    sys_dir = os.path.join(home, "Music", "_Serato_", "Subcrates")
    out = {}
    for p in abs_paths:
        if not os.path.isabs(p):
            raise ValueError(f"not an absolute path: {p!r}")
        parts = os.path.normpath(p).split(os.sep)
        if len(parts) >= 3 and parts[1] == "Volumes":
            if len(parts) == 3:
                raise ValueError(f"path is a volume, not a file: {p!r}")
            target = os.path.join("/Volumes", parts[2], "_Serato_", "Subcrates")
            rel = "/".join(parts[3:])
        else:
            target = sys_dir
            rel = "/".join(parts[1:])
        out.setdefault(target, []).append(rel)
    return out


def write_crate(subcrates_dir, name, rel_paths, overwrite=False):
    subcrates_dir = os.path.abspath(subcrates_dir)
    serato = os.path.dirname(subcrates_dir)
    if not os.path.isdir(subcrates_dir):
        if not os.path.isdir(serato):
            raise FileNotFoundError(
                f"Serato folder not found: {serato} (not creating it; ask the user first)")
        os.mkdir(subcrates_dir)
    dest = os.path.join(subcrates_dir, crate_filename(name))
    if os.path.exists(dest) and not overwrite:
        raise FileExistsError(dest)
    data = build_crate(rel_paths)
    fd, tmp = tempfile.mkstemp(prefix=".tf-crate-", suffix=".tmp", dir=subcrates_dir)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return dest
