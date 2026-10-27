"""Runtime hook: point soundfile at the libsndfile we bundled.

soundfile locates its library RELATIVE TO ITS OWN __file__ (_soundfile_data/ beside the
module). Inside a PyInstaller bundle the module lives in the archive, so that lookup
fails, soundfile raises, librosa silently falls back to audioread, audioread reaches for
ffmpeg, shutil.which returns None — and every analysis dies with

    expected str, bytes or os.PathLike object, not NoneType

which names neither soundfile nor ffmpeg and sends you looking in the wrong place. The
dylib IS in the bundle; it just cannot be found. Setting SOUNDFILE_LIBRARY before the
first import is the supported way to say where it is.
"""
import os
import sys

if getattr(sys, "frozen", False):
    base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    for rel in ("_soundfile_data", os.path.join("..", "Frameworks", "_soundfile_data"),
                os.path.join("..", "Resources", "_soundfile_data")):
        d = os.path.abspath(os.path.join(base, rel))
        if not os.path.isdir(d):
            continue
        for name in ("libsndfile_arm64.dylib", "libsndfile_x86_64.dylib", "libsndfile.dylib"):
            p = os.path.join(d, name)
            if os.path.exists(p):
                os.environ.setdefault("SOUNDFILE_LIBRARY", p)
                break
        if os.environ.get("SOUNDFILE_LIBRARY"):
            break
