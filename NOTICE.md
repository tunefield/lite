# Third-party notices

Tunefield is licensed AGPL-3.0-or-later (see `LICENSE`). It bundles, depends
on, or distributes work from the following third parties, each under its own
licence. Nothing here changes the AGPL terms on Tunefield's own code; this
file documents the dependencies that ship alongside or are required at
runtime.

## Vendored at runtime (in this repository)

| Component | Version | Licence | Source |
|---|---|---|---|
| three.js | 0.166.x | MIT | https://github.com/mrdoob/three.js |
| OrbitControls (three/examples/jsm) | 0.166.x | MIT | https://github.com/mrdoob/three.js |

Vendored files live under `static/vendor/three/`. The MIT licence text is
preserved at the top of `three.module.js` per upstream.

## Python runtime dependencies (installed via `pip install -r requirements.txt`)

| Package | Licence | Project |
|---|---|---|
| Flask | BSD-3-Clause | https://flask.palletsprojects.com/ |
| librosa | ISC | https://librosa.org/ |
| numpy | BSD-3-Clause | https://numpy.org/ |
| scipy | BSD-3-Clause | https://scipy.org/ |
| soundfile | BSD-3-Clause | https://python-soundfile.readthedocs.io/ |
| pyloudnorm | MIT | https://github.com/csteinmetz1/pyloudnorm |
| cryptography | Apache-2.0 OR BSD-3-Clause | https://cryptography.io/ |

## Bundled in the packaged macOS app (in addition to the above)

The `.app` freezes the Python runtime and its dependencies with PyInstaller, so the
following travel inside it as well:

| Package | Licence | Project |
|---|---|---|
| PyInstaller runtime | GPL-2.0-or-later **with the bootloader exception** (the exception is what permits distributing the frozen app under our own terms) | https://pyinstaller.org/ |
| pywebview | BSD-3-Clause | https://pywebview.flowrl.com/ |
| pyobjc (AppKit, Foundation, Quartz, WebKit) | MIT | https://pyobjc.readthedocs.io/ |
| numba / llvmlite | BSD-2-Clause | https://numba.pydata.org/ |
| certifi | MPL-2.0 | https://github.com/certifi/python-certifi |
| Werkzeug, Jinja2, itsdangerous, click, MarkupSafe, blinker | BSD-3-Clause | https://palletsprojects.com/ |

## Vendored JavaScript

| Library | Licence | Project |
|---|---|---|
| three.js (r166, `static/vendor/three/`) | MIT | https://threejs.org/ |

## External binaries — NOT bundled, and not required

Tunefield decodes audio and reads tags itself; **no shipped build contains ffmpeg,
ffprobe or fpcalc**, and none is needed to analyse a library. The optional AcoustID
lookup in Repair uses `fpcalc` only if the user has installed it themselves.

| Tool | Licence | Project |
|---|---|---|
| chromaprint / fpcalc *(optional, user-installed, for AcoustID)* | LGPL-2.1 | https://acoustid.org/chromaprint |

Because these binaries are not distributed with Tunefield, no LGPL §6 source offer is
required of us. Anyone who *does* redistribute a bundle containing them takes on that
obligation themselves.

## Web fonts / icons

Tunefield's UI uses a system font stack (Avenir Next / Avenir / Futura / Century
Gothic / Nunito Sans, falling back to `-apple-system`, `BlinkMacSystemFont`,
`system-ui`, `sans-serif`). Icons are inline SVG drawn in the page, with a small number
of Unicode symbols alongside. **No embedded font files, no icon-font dependency, and no
webfont is ever fetched** — consistent with the app working fully offline.

## Project metadata

- Tunefield Lite source: https://github.com/tunefield/lite
- Copyright (c) 2024–2026 Mark Burnett (and contributors).
- AGPL-3.0-or-later — see `LICENSE`.
