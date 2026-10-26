# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the macOS app bundle.

Build:
    <venv>/bin/pyinstaller --noconfirm Tunefield.spec

Notes that cost real time to learn, kept here so they are not re-learned:

  * NO ffmpeg, NO ffprobe, NO fpcalc are bundled. tags.py reads tags and cover art in
    pure python and the whole pipeline was verified with both binaries hidden from PATH.
    That is what keeps this bundle to its dependencies rather than +70 MB of GPL-adjacent
    binaries on three platforms.

  * librosa/numba/lazy_loader defeat static analysis. librosa imports submodules lazily
    through lazy_loader, so PyInstaller sees almost none of them; they are collected
    wholesale below. Miss this and the app builds fine and dies on the first analysis.

  * soundfile ships libsndfile as a DATA file (_soundfile_data/), not a linked library,
    so it needs collect_dynamic_libs AND collect_data_files or every decode fails with
    "sndfile library not found" in a bundle that looks otherwise healthy.

  * static/ is the entire UI — one HTML file plus vendored Three.js. Without it the
    server starts and serves 404s.
"""

from PyInstaller.utils.hooks import collect_submodules, collect_data_files, collect_dynamic_libs

hidden = []
datas = []
binaries = []

# librosa and its lazily-imported world
for pkg in ("librosa", "numba", "llvmlite", "lazy_loader", "soxr", "audioread", "soundfile",
            "pooch", "scipy", "sklearn", "joblib", "decorator", "msgpack", "standard_aifc",
            "standard_sunau", "standard_chunk"):
    try:
        hidden += collect_submodules(pkg)
    except Exception:
        pass

# pywebview → the native window. Promoted from an opt-in spike to the default on
# 2026-08-27: without these the frozen app imported nothing, silently fell back to a
# browser tab, and a DJ closing that tab left an invisible server running with no way
# to quit it. pywebview reaches Cocoa/WebKit through pyobjc at runtime, so PyInstaller
# cannot see those imports statically — they have to be named here or the window mode
# is dead in the bundle while working perfectly from source.
for pkg in ("webview", "objc", "Foundation", "AppKit", "WebKit", "Quartz",
            "proxy_tools", "bottle"):
    try:
        hidden += collect_submodules(pkg)
    except Exception:
        pass

# libsndfile rides along as data, not as a linked dylib
for pkg in ("soundfile", "librosa", "sklearn", "numba"):
    try:
        datas += collect_data_files(pkg)
    except Exception:
        pass
for pkg in ("soundfile", "llvmlite", "numba", "scipy", "sklearn"):
    try:
        binaries += collect_dynamic_libs(pkg)
    except Exception:
        pass

# Apple CoreAudio backend — how M4A/AAC decode without ffmpeg on macOS
hidden += ["audioread.macca", "audioread.rawread", "audioread.ffdec"]
# Flask/werkzeug reach for these dynamically
hidden += ["werkzeug.middleware.proxy_fix", "jinja2.ext", "email.mime.text"]

# The UI, and the analysis modules app.py imports at runtime
datas += [
    ("static", "static"),
    ("analyze.py", "."),
    ("tags.py", "."),
    # Single source of truth for the version. Until 2026-08-12 this was never shipped,
    # so the frozen app fell back to a hardcoded literal and reported a version that
    # matched no artifact — testers and the tracker disagreed about which build was
    # in play (M2 report, P6).
    ("VERSION", "."),
    # AGPL §5 wants the licence to travel WITH the work — until 2026-08-29 neither the
    # .app nor the .dmg nor the USB zip carried it (2026-08-29 legal sweep).
    ("LICENSE", "."),
    ("NOTICE.md", "."),
]

import os as _os
_VER = open(_os.path.join(SPECPATH, "VERSION")).read().strip()   # e.g. "1.0.0-beta2"
_VER_SHORT = _VER.split("-")[0]                                  # plist wants x.y.z here

a = Analysis(
    ["app.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hidden)),
    hookspath=[],
    runtime_hooks=["rthook_soundfile.py"],
    # Nothing here is imported by the app; excluding them saves a lot of weight.
    excludes=["tkinter", "matplotlib", "PyQt5", "PyQt6", "PySide2", "PySide6",
              "IPython", "notebook", "pytest", "setuptools._distutils"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="Tunefield",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                 # UPX corrupts signed dylibs on arm64
    console=False,
    argv_emulation=False,
    target_arch=None,          # host arch; a universal2 build needs universal2 wheels
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False, upx_exclude=[],
    name="Tunefield",
)

app = BUNDLE(
    coll,
    name="Tunefield.app",
    # Same mark as the favicon (static/assets/tunefield-logo.png), packed to .icns via
    # sips+iconutil. Source is 256px, so 512/1024 Retina tiers are upscales — replace
    # packaging/Tunefield.icns from a 1024px master when one exists.
    icon="packaging/Tunefield.icns",
    bundle_identifier="com.futurefabrik.tunefield-lite",
    info_plist={
        "CFBundleName": "Tunefield",
        "CFBundleDisplayName": "Tunefield",
        "LSMinimumSystemVersion": "14.0",
        # ShortVersion is the marketing number (x.y.z only — Apple rejects suffixes).
        # CFBundleVersion is the BUILD identifier and must differ between builds, or
        # LaunchServices treats beta1 and beta2 as the same app; date-stamped so two
        # betas of the same marketing version stay distinguishable.
        "CFBundleShortVersionString": _VER_SHORT,
        # Derived from VERSION so it changes with every beta (it was pinned at
        # 20260812.2 from beta3 through beta6, which is exactly the collision this
        # comment warns about). "1.0.0-beta7" -> "1.0.0.7". A FINAL release gets .99,
        # not .0, because LaunchServices needs this to keep increasing — 1.0.0.0 would
        # read as a downgrade from the beta it replaces.
        "CFBundleVersion": _VER_SHORT + "." + (_VER.split("beta")[-1].split(".")[0] if "beta" in _VER else "99"),
        "NSHighResolutionCapable": True,
        # It opens a browser onto its own local server; it is not a document app.
        "LSBackgroundOnly": False,
        # Reading the user's music folders needs this on modern macOS or the picker
        # returns paths the app cannot then open.
        "NSDesktopFolderUsageDescription": "Tunefield reads the music folders you choose.",
        "NSDocumentsFolderUsageDescription": "Tunefield reads the music folders you choose.",
        "NSDownloadsFolderUsageDescription": "Tunefield reads the music folders you choose.",
        "NSRemovableVolumesUsageDescription": "Tunefield reads music from external drives you choose.",
    },
)
