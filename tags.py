"""Tags and cover art, without ffmpeg.

Tunefield used ffprobe to read artist/title/album/genre/year and ffmpeg to pull embedded
artwork. Everything else already works without them — decoding goes through librosa, and
on macOS even M4A resolves through Apple CoreAudio — so these two jobs were the entire
reason to consider bundling a 70 MB binary pair into every installer, on three platforms,
with the licensing questions that brings. This module does both jobs in pure python.

Design rules, in order:
  1. NEVER RAISE. A tag reader that throws on a malformed file is worse than one that
     returns nothing: it turns a cosmetic gap into a failed import. Every public function
     returns {} or None on any trouble whatsoever.
  2. Read as little as possible. Tags live at the head (or, for ID3v1, the last 128
     bytes). Nothing here reads a whole file.
  3. Be liberal. Real libraries are full of files written by taggers that disagree with
     the spec: ID3v2.2 three-character frames, unsynchronised blocks, UTF-16 without a
     BOM, sizes that overrun the frame. Each of those is handled and none of them is
     allowed to lose the rest of the tags.

Supported: MP3 (ID3v2.2/2.3/2.4 + ID3v1), WAV and AIFF (embedded ID3 chunk + RIFF INFO),
FLAC (Vorbis comments + PICTURE), M4A/MP4 (iTunes atoms), OGG (Vorbis comments).
"""

import os
import struct
import base64

__all__ = ["read_tags", "read_cover", "SUPPORTED"]

SUPPORTED = {".mp3", ".wav", ".wave", ".aif", ".aiff", ".aifc",
             ".flac", ".m4a", ".mp4", ".m4b", ".ogg", ".oga", ".opus"}

_MAX_TAG_BLOCK = 32 * 1024 * 1024      # a 32 MB ID3 block is already absurd
_MIN_ART_BYTES = 256                   # anything smaller is not a real image


# ── shared helpers ───────────────────────────────────────────────────────────
def _syncsafe(b):
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def _decode_text(raw, enc):
    """ID3 text payload → str. Encoding byte lies often enough to warrant fallbacks."""
    try:
        if enc == 0:
            return raw.decode("latin-1", "replace")
        if enc == 1:
            # UTF-16 with BOM. Some taggers omit it; utf-16 without a BOM guesses LE,
            # which is right far more often than not.
            return raw.decode("utf-16", "replace")
        if enc == 2:
            return raw.decode("utf-16-be", "replace")
        return raw.decode("utf-8", "replace")
    except Exception:
        try:
            return raw.decode("latin-1", "replace")
        except Exception:
            return ""


def _clean(s):
    """Trim, drop the trailing NULs taggers leave behind, collapse to None if empty."""
    if not s:
        return None
    s = s.replace("\x00", " ").strip()
    return s or None


def _mime_from_bytes(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


# ── ID3v2 ────────────────────────────────────────────────────────────────────
# The genre numbers ID3v1 defined and ID3v2 still references as "(17)" or a bare "17".
_ID3_GENRES = [
    "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop",
    "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock",
    "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack",
    "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance",
    "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel",
    "Noise", "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative",
    "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave",
    "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream",
    "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap",
    "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychadelic",
    "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz",
    "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock", "Folk", "Folk-Rock",
    "National Folk", "Swing", "Fast Fusion", "Bebob", "Latin", "Revival", "Celtic",
    "Bluegrass", "Avantgarde", "Gothic Rock", "Progressive Rock", "Psychedelic Rock",
    "Symphonic Rock", "Slow Rock", "Big Band", "Chorus", "Easy Listening", "Acoustic",
    "Humour", "Speech", "Chanson", "Opera", "Chamber Music", "Sonata", "Symphony",
    "Booty Bass", "Primus", "Porn Groove", "Satire", "Slow Jam", "Club", "Tango",
    "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle",
    "Duet", "Punk Rock", "Drum Solo", "A capella", "Euro-House", "Dance Hall",
]

# ID3 frame → our field name. v2.2's three-letter IDs map to the same places.
_ID3_FIELDS = {
    b"TIT2": "title",  b"TT2": "title",
    b"TPE1": "artist", b"TP1": "artist",
    b"TPE2": "albumartist", b"TP2": "albumartist",
    b"TALB": "album",  b"TAL": "album",
    b"TCON": "genre",  b"TCO": "genre",
    # Four frames mean "year" depending on tagger and ID3 version, and a file often has
    # only the one you're not looking for. Beatport writes TDRL and nothing else, which
    # is how 11 of 250 sampled files came back with no year at all on the first pass.
    # They go to distinct keys and are resolved by priority below.
    b"TYER": "_y_tyer", b"TYE": "_y_tyer",   # v2.3 year
    b"TDRC": "_y_tdrc",                      # v2.4 recording time
    b"TDRL": "_y_tdrl",                      # release time  (Beatport)
    b"TDOR": "_y_tdor", b"TORY": "_y_tdor",  # original release
    b"TRCK": "track",  b"TRK": "track",
    b"TBPM": "bpm",    b"TBP": "bpm",
    b"TKEY": "key",    b"TKE": "key",
    b"TPUB": "publisher",
    b"TCOM": "composer",
}


def _read_id3_block(f, size_hint=None):
    """Read an ID3v2 block from the current position. Returns bytes or None."""
    head = f.read(10)
    if len(head) < 10 or head[:3] != b"ID3":
        return None
    size = _syncsafe(head[6:10])
    if size <= 0 or size > _MAX_TAG_BLOCK:
        return None
    return head + f.read(size)


def _deunsync(b):
    """Undo unsynchronisation: every 0xFF 0x00 pair was really a lone 0xFF."""
    out = bytearray()
    i, n = 0, len(b)
    while i < n:
        out.append(b[i])
        if b[i] == 0xFF and i + 1 < n and b[i + 1] == 0x00:
            i += 2
        else:
            i += 1
    return bytes(out)


def _iter_id3_frames(block):
    """Yield (frame_id, payload) for an ID3v2 block, whatever minor version it is."""
    if not block or block[:3] != b"ID3":
        return
    ver, flags = block[3], block[5]
    total = min(_syncsafe(block[6:10]) + 10, len(block))
    body = block[10:total]
    if flags & 0x80 and ver < 4:           # v2.4 unsynchronises per-frame instead
        body = _deunsync(body)
    pos = 0
    if flags & 0x40:                       # extended header
        if ver >= 4:
            ext = _syncsafe(body[0:4]) if len(body) >= 4 else 0
        else:
            ext = int.from_bytes(body[0:4], "big") + 4 if len(body) >= 4 else 0
        pos += max(ext, 6)
    idlen = 3 if ver == 2 else 4
    hdrlen = 6 if ver == 2 else 10
    while pos + hdrlen <= len(body):
        fid = body[pos:pos + idlen]
        if not fid or fid[0] == 0:         # padding
            break
        if ver == 2:
            fsz = int.from_bytes(body[pos + 3:pos + 6], "big")
        elif ver == 3:
            fsz = int.from_bytes(body[pos + 4:pos + 8], "big")
        else:
            fsz = _syncsafe(body[pos + 4:pos + 8])
            # Some 2.4 writers use plain big-endian sizes. If syncsafe overruns the
            # block but big-endian fits, trust the one that lands inside.
            plain = int.from_bytes(body[pos + 4:pos + 8], "big")
            if pos + hdrlen + fsz > len(body) and pos + hdrlen + plain <= len(body):
                fsz = plain
        if fsz <= 0 or pos + hdrlen + fsz > len(body):
            break
        yield fid, body[pos + hdrlen:pos + hdrlen + fsz]
        pos += hdrlen + fsz


def _id3_genre(text):
    """'(17)' / '17' / 'Rock' / '(17)Hardcore' → a readable name."""
    t = (text or "").strip()
    if not t:
        return None
    if t.startswith("(") and ")" in t:
        num, _, rest = t[1:].partition(")")
        rest = rest.strip()
        if rest:
            return rest
        t = num
    if t.isdigit():
        i = int(t)
        return _ID3_GENRES[i] if 0 <= i < len(_ID3_GENRES) else None
    return t


def _tags_from_id3(block):
    out = {}
    for fid, payload in _iter_id3_frames(block):
        field = _ID3_FIELDS.get(fid)
        if not field or not payload:
            continue
        val = _clean(_decode_text(payload[1:], payload[0]))
        if val is None:
            continue
        if field == "genre":
            val = _id3_genre(val)
        elif field.startswith("_y_"):
            val = val[:4] if val[:4].isdigit() else None
        elif field == "track":
            val = val.split("/")[0].strip()
        if val and field not in out:       # first writer of a field wins
            out[field] = val
    # Recording date beats release date beats original-release date: we want when the
    # music is from, and a reissue's release year is the least informative of the three.
    for k in ("_y_tdrc", "_y_tyer", "_y_tdrl", "_y_tdor"):
        if out.get(k):
            out["year"] = out[k]
            break
    return {k: v for k, v in out.items() if not k.startswith("_y_")}


def _cover_from_id3(block):
    for fid, body in _iter_id3_frames(block):
        if fid not in (b"APIC", b"PIC"):
            continue
        try:
            enc = body[0]
            if fid == b"PIC":              # v2.2: fixed 3-char format, no MIME string
                i = 4
            else:
                i = body.index(b"\x00", 1) + 1
            i += 1                         # picture-type byte
            if enc in (1, 2):              # UTF-16 description ends on an aligned NUL NUL
                j = i
                while j + 1 < len(body) and body[j:j + 2] != b"\x00\x00":
                    j += 2
                j += 2
            else:
                j = body.index(b"\x00", i) + 1
            data = bytes(body[j:])
            if not _mime_from_bytes(data):
                # Some taggers omit the description terminator entirely and start the
                # image straight after the picture-type byte, which walks the offset
                # into the middle of the file (seen in the wild writing MIME "PNG"
                # rather than "image/png"). Rather than trust the offset, find the image
                # by its magic — the header can only be one of four things.
                data = _find_image(body) or data
            if len(data) >= _MIN_ART_BYTES and _mime_from_bytes(data):
                return data
        except Exception:
            continue
    return None


def _find_image(buf, start=0):
    """First embedded image in a buffer, located by signature rather than by offset."""
    best = None
    for magic in (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a"):
        i = buf.find(magic, start)
        if i >= 0 and (best is None or i < best):
            best = i
    return bytes(buf[best:]) if best is not None else None


def _id3v1(path):
    """Last-resort 128-byte trailer. Fixed-width fields, latin-1, no extensions."""
    try:
        size = os.path.getsize(path)
        if size < 128:
            return {}
        with open(path, "rb") as f:
            f.seek(-128, 2)
            b = f.read(128)
        if b[:3] != b"TAG":
            return {}
        g = lambda s, e: _clean(b[s:e].decode("latin-1", "replace"))
        out = {"title": g(3, 33), "artist": g(33, 63), "album": g(63, 93), "year": g(93, 97)}
        gi = b[127]
        if gi < len(_ID3_GENRES):
            out["genre"] = _ID3_GENRES[gi]
        if b[125] == 0 and b[126] != 0:    # ID3v1.1 track number
            out["track"] = str(b[126])
        return {k: v for k, v in out.items() if v}
    except Exception:
        return {}


# ── containers ───────────────────────────────────────────────────────────────
def _riff_id3(path):
    """The ID3 block WAV/AIFF taggers (Rekordbox, Beatport) embed as a chunk.

    ffmpeg's wav demuxer ignores this chunk entirely, so these tags were invisible to
    the old pipeline even when ffprobe was installed."""
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            if head[:4] == b"RIFF":
                endian, ids = "little", (b"id3 ", b"ID3 ")
            elif head[:4] == b"FORM":
                endian, ids = "big", (b"ID3 ", b"id3 ")
            else:
                return None
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                cid, size = hdr[:4], int.from_bytes(hdr[4:8], endian)
                if size < 0 or size > (1 << 34):
                    break
                if cid in ids:
                    blk = f.read(min(size, _MAX_TAG_BLOCK))
                    return blk if blk[:3] == b"ID3" else None
                f.seek(size + (size & 1), 1)
            # Some taggers append a bare ID3 block after the RIFF payload
            if head[:4] == b"RIFF":
                riff_end = 8 + int.from_bytes(head[4:8], "little")
                f.seek(0, 2)
                if f.tell() > riff_end + 10:
                    f.seek(riff_end)
                    tail = f.read(_MAX_TAG_BLOCK)
                    if tail[:3] == b"ID3":
                        return tail
    except Exception:
        return None
    return None


_RIFF_INFO = {b"INAM": "title", b"IART": "artist", b"IPRD": "album",
              b"IGNR": "genre", b"ICRD": "year", b"ITRK": "track",
              b"ICMT": "comment", b"IPUB": "publisher"}


def _riff_info(path):
    """WAV LIST/INFO chunk — the other place WAV tags hide."""
    out = {}
    try:
        with open(path, "rb") as f:
            if f.read(4) != b"RIFF":
                return {}
            f.seek(12)
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                cid, size = hdr[:4], int.from_bytes(hdr[4:8], "little")
                if size < 0 or size > (1 << 32):
                    break
                if cid == b"LIST":
                    # Remember where this chunk ENDS before reading a bounded slice of
                    # it: a LIST >1MB used to leave the file position mid-chunk, and the
                    # next loop turn read leftover payload bytes as a chunk header —
                    # misparsing every chunk after it (Aug 15 review, P3).
                    chunk_end = f.tell() + size + (size & 1)
                    blk = f.read(min(size, 1 << 20))
                    if blk[:4] != b"INFO":
                        f.seek(chunk_end)
                        continue
                    p = 4
                    while p + 8 <= len(blk):
                        sid = blk[p:p + 4]
                        ssz = int.from_bytes(blk[p + 4:p + 8], "little")
                        if ssz < 0 or p + 8 + ssz > len(blk):
                            break
                        field = _RIFF_INFO.get(sid)
                        if field:
                            v = _clean(blk[p + 8:p + 8 + ssz].decode("latin-1", "replace"))
                            if v:
                                out.setdefault(field, v)
                        p += 8 + ssz + (ssz & 1)
                    f.seek(chunk_end)   # oversized LIST: never leave the cursor mid-chunk
                else:
                    f.seek(size + (size & 1), 1)
    except Exception:
        return out
    return out


_VORBIS_FIELDS = {"title": "title", "artist": "artist", "album": "album",
                  "albumartist": "albumartist", "genre": "genre", "date": "year",
                  "year": "year", "tracknumber": "track", "bpm": "bpm",
                  "initialkey": "key", "publisher": "publisher", "composer": "composer"}


def _parse_vorbis_comments(blob):
    """Vorbis comment block → (tags, [base64 picture strings])."""
    out, pics = {}, []
    try:
        p = 0
        vlen = struct.unpack_from("<I", blob, p)[0]; p += 4 + vlen        # vendor string
        count = struct.unpack_from("<I", blob, p)[0]; p += 4
        for _ in range(min(count, 512)):
            ln = struct.unpack_from("<I", blob, p)[0]; p += 4
            item = blob[p:p + ln].decode("utf-8", "replace"); p += ln
            k, _, v = item.partition("=")
            k = k.strip().lower()
            if k == "metadata_block_picture":
                pics.append(v)
                continue
            field = _VORBIS_FIELDS.get(k)
            if field:
                v = _clean(v)
                if v:
                    if field == "year":
                        v = v[:4] if v[:4].isdigit() else v
                    elif field == "track":
                        v = v.split("/")[0].strip()
                    out.setdefault(field, v)
    except Exception:
        pass
    return out, pics


def _flac_blocks(path):
    """Yield (block_type, payload) for a FLAC file's metadata blocks."""
    with open(path, "rb") as f:
        if f.read(4) != b"fLaC":
            return
        while True:
            hdr = f.read(4)
            if len(hdr) < 4:
                return
            last, btype = bool(hdr[0] & 0x80), hdr[0] & 0x7F
            size = int.from_bytes(hdr[1:4], "big")
            if size > _MAX_TAG_BLOCK:
                return
            yield btype, f.read(size)
            if last:
                return


def _flac_picture_bytes(payload):
    """FLAC PICTURE block (also the payload behind METADATA_BLOCK_PICTURE)."""
    try:
        p = 4                                        # picture type
        mlen = int.from_bytes(payload[p:p + 4], "big"); p += 4 + mlen
        dlen = int.from_bytes(payload[p:p + 4], "big"); p += 4 + dlen
        p += 16                                      # w, h, depth, colours
        blen = int.from_bytes(payload[p:p + 4], "big"); p += 4
        data = bytes(payload[p:p + blen])
        return data if len(data) >= _MIN_ART_BYTES else None
    except Exception:
        return None


_MP4_FIELDS = {b"\xa9nam": "title", b"\xa9ART": "artist", b"aART": "albumartist",
               b"\xa9alb": "album", b"\xa9gen": "genre", b"\xa9day": "year",
               b"\xa9wrt": "composer", b"tmpo": "bpm"}


def _mp4_atoms(f, end, want, depth=0):
    """Walk MP4 atoms, descending only into the containers that lead to tags."""
    if depth > 8:
        return
    while f.tell() < end:
        start = f.tell()
        hdr = f.read(8)
        if len(hdr) < 8:
            return
        size = int.from_bytes(hdr[:4], "big")
        name = hdr[4:8]
        if size == 1:                                # 64-bit extended size
            size = int.from_bytes(f.read(8), "big")
        if size < 8 or start + size > end:
            return
        if name in want:
            yield name, start + size, f.tell()
        if name in (b"moov", b"udta", b"meta", b"ilst"):
            inner = f.tell()
            if name == b"meta":
                inner += 4                           # meta carries a version/flags word
            f.seek(inner)
            for item in _mp4_atoms(f, start + size, want, depth + 1):
                yield item
        f.seek(start + size)


def _mp4_tags_and_cover(path):
    tags, cover = {}, None
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            want = set(_MP4_FIELDS) | {b"covr", b"gnre", b"trkn"}
            for name, atom_end, pos in _mp4_atoms(f, size, want):
                f.seek(pos)
                blob = f.read(min(atom_end - pos, 8 << 20))
                # each value sits in a 'data' sub-atom: size, 'data', type, locale
                d = blob.find(b"data")
                if d < 4:
                    continue
                dsize = int.from_bytes(blob[d - 4:d], "big")
                dtype = int.from_bytes(blob[d + 4:d + 8], "big")
                val = blob[d + 12:d - 4 + dsize] if dsize >= 16 else b""
                if name == b"covr":
                    if len(val) >= _MIN_ART_BYTES and _mime_from_bytes(val):
                        cover = bytes(val)
                elif name == b"gnre":                # numeric ID3v1 genre
                    if len(val) >= 2:
                        gi = int.from_bytes(val[:2], "big") - 1
                        if 0 <= gi < len(_ID3_GENRES):
                            tags.setdefault("genre", _ID3_GENRES[gi])
                elif name == b"trkn":
                    if len(val) >= 4:
                        tags.setdefault("track", str(int.from_bytes(val[2:4], "big")))
                else:
                    field = _MP4_FIELDS.get(name)
                    if not field:
                        continue
                    if dtype == 0 and field == "bpm":            # binary integer
                        tags.setdefault("bpm", str(int.from_bytes(val, "big")))
                    else:
                        v = _clean(val.decode("utf-8", "replace"))
                        if v:
                            if field == "year":
                                v = v[:4] if v[:4].isdigit() else v
                            tags.setdefault(field, v)
    except Exception:
        pass
    return tags, cover


def _ogg_first_comment_block(path):
    """Pull the Vorbis/Opus comment header out of the opening Ogg pages."""
    try:
        with open(path, "rb") as f:
            buf = f.read(512 * 1024)
        packets, p = bytearray(), 0
        while p + 27 <= len(buf) and buf[p:p + 4] == b"OggS":
            nseg = buf[p + 26]
            segs = buf[p + 27:p + 27 + nseg]
            body = p + 27 + nseg
            total = sum(segs)
            packets += buf[body:body + total]
            p = body + total
        i = packets.find(b"\x03vorbis")
        if i >= 0:
            return bytes(packets[i + 7:])
        i = packets.find(b"OpusTags")
        if i >= 0:
            return bytes(packets[i + 8:])
    except Exception:
        return None
    return None


# ── public API ───────────────────────────────────────────────────────────────
def read_tags(path):
    """Every tag we can find, as a dict of str. Missing fields are simply absent.

    Keys: title, artist, albumartist, album, genre, year, track, bpm, key, publisher,
    composer, comment. Returns {} for anything unreadable — never raises."""
    try:
        ext = os.path.splitext(path)[1].lower()
        out = {}
        if ext == ".mp3":
            with open(path, "rb") as f:
                blk = _read_id3_block(f)
            if blk:
                out = _tags_from_id3(blk)
            for k, v in _id3v1(path).items():        # fill gaps only
                out.setdefault(k, v)
        elif ext in (".wav", ".wave", ".aif", ".aiff", ".aifc"):
            blk = _riff_id3(path)
            if blk:
                out = _tags_from_id3(blk)
            for k, v in _riff_info(path).items():
                out.setdefault(k, v)
        elif ext == ".flac":
            for btype, payload in _flac_blocks(path):
                if btype == 4:
                    t, _ = _parse_vorbis_comments(payload)
                    out.update({k: v for k, v in t.items() if k not in out})
        elif ext in (".m4a", ".mp4", ".m4b"):
            out, _ = _mp4_tags_and_cover(path)
        elif ext in (".ogg", ".oga", ".opus"):
            blob = _ogg_first_comment_block(path)
            if blob:
                out, _ = _parse_vorbis_comments(blob)
        return {k: v for k, v in out.items() if v}
    except Exception:
        return {}


def read_cover(path):
    """Embedded artwork as (bytes, mime), or None. Never raises."""
    try:
        ext = os.path.splitext(path)[1].lower()
        data = None
        if ext == ".mp3":
            with open(path, "rb") as f:
                blk = _read_id3_block(f)
            if blk:
                data = _cover_from_id3(blk)
        elif ext in (".wav", ".wave", ".aif", ".aiff", ".aifc"):
            blk = _riff_id3(path)
            if blk:
                data = _cover_from_id3(blk)
        elif ext == ".flac":
            for btype, payload in _flac_blocks(path):
                if btype == 6:
                    data = _flac_picture_bytes(payload)
                    if data:
                        break
                elif btype == 4 and data is None:
                    _, pics = _parse_vorbis_comments(payload)
                    for b64 in pics:
                        try:
                            data = _flac_picture_bytes(base64.b64decode(b64))
                        except Exception:
                            data = None
                        if data:
                            break
        elif ext in (".m4a", ".mp4", ".m4b"):
            _, data = _mp4_tags_and_cover(path)
        elif ext in (".ogg", ".oga", ".opus"):
            blob = _ogg_first_comment_block(path)
            if blob:
                _, pics = _parse_vorbis_comments(blob)
                for b64 in pics:
                    try:
                        data = _flac_picture_bytes(base64.b64decode(b64))
                    except Exception:
                        data = None
                    if data:
                        break
        if not data:
            return None
        mime = _mime_from_bytes(data)
        return (data, mime) if mime else None
    except Exception:
        return None
