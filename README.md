# Tunefield Lite

Tunefield Lite helps a DJ build a set from a selection of music. It analyses your tracks on your own Mac and lays them out as a 3D field, shaped by tempo, loudness, key and mood, so *where things are* means something. Build a set in the field, play it through, and export it to Rekordbox, Traktor, Ableton or M3U8.

Free. Runs entirely on your Mac: your music, your analysis and your sets never leave it. Public beta.

## Download

**[Latest release →](https://github.com/tunefield/lite/releases/latest)**

| File | For |
|---|---|
| `Tunefield-Lite-<version>-arm64.dmg` | Installing on your Mac: open it and drag Tunefield into Applications |
| `Tunefield-Lite-<version>-arm64-USB.zip` | Running from a USB stick, library and all |

**Needs** a Mac with Apple Silicon (M1 or newer) and macOS 14 Sonoma or newer.

## Using it

The [manual](MANUAL.md) covers everything; it is also inside the app. The short version: **Analyse → Add music**, pick a folder; open the **Field**; **＋ New set** and double-click tracks to add them; **▶ Play**; **Export set**.

## Feedback

Use the **Feedback** button in the app, which fills in a diagnostics snapshot for you. Or email mark@tunefield.app.

## Running from source

Python 3.12 from python.org:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python app.py
```

It opens in your browser at `http://localhost:5050`, or the next free port. The release builds are made with `packaging/release-macos.sh`.

## Licence

AGPL-3.0, see [LICENSE](LICENSE). Third-party notices are in [NOTICE.md](NOTICE.md). Changes are in [CHANGELOG.md](CHANGELOG.md).
