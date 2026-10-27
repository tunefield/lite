# Tunefield beta — monitoring brief for Claude on a test machine

You are on a TEST machine for Tunefield, an offline DJ track analyser (local Flask
server + browser UI). Your job: help verify the install and interpret what the app has
been doing. Everything is local — the app never phones home; all evidence is on disk.

## The one command

    ./tunefield-doctor.sh --launch

(sits next to this file; add the .app path as an argument if it isn't in /Applications).
It checks arch, quarantine, finds the running server on ports 5050–5080, dumps
`/system/health`, and summarises the usage log. Read its output top to bottom; `[!!]`
lines are the problems.

## Where everything lives

| What | Installed (.dmg) | Portable (USB) |
|---|---|---|
| data root | `~/Library/Application Support/Tunefield/data/` | `data/` next to the .app |
| app log | `<data>/logs/app.log` — every request, error, traceback | same |
| usage log | `<data>/logs/usage.jsonl` — one JSON line per event | same |
| catalogs | `<data>/catalogs/*.json` | same |

Usage events: `start` (version, mode, port), `analyze` (format, ms, cover found),
`analyze_reject` (undecodable file — expected sometimes), `error` (internal — never
expected; each has a matching traceback in app.log).

## Live endpoints (while the app runs)

- `GET /system/health` — version, root mode (installed/portable), data paths, deps
- `GET /catalogs` — catalog names + track counts

## Known-good facts (don't chase these as bugs)

- **Notarized builds (1.0.0-beta3 onward) open with a plain double-click** — no
  approval dance. Only unsigned dev builds get blocked, once: on macOS 15 Sequoia+
  the approval is System Settings → Privacy & Security → "Open Anyway"
  (right-click → Open no longer works there); on Sonoma and older, right-click →
  Open. "App is damaged" means quarantine: `xattr -dr com.apple.quarantine <app>`.
- **arm64 only.** Will not start on Intel.
- **ffmpeg is NOT needed and NOT bundled** — health showing `ffmpeg: false` is correct.
- **Some Ableton AIFC factory samples** (the ones using Ableton's own "able" compression)
  are rejected with "no decoder available" / "compression variant with no available
  decoder" — genuine, nothing on the machine can decode those. Not a bug. Other
  compressed AIFC (e.g. IMA4) decodes fine via CoreAudio, as do .opus, .m4b and .aifc —
  all supported since 2026-08-12.
- **Uploads over 500 MB** are refused with advice to use a library-root folder scan.
- Key detection can flip major/minor vs the dev machine on near-tie tracks (~1%).

## What IS a bug

Any `error` event in usage.jsonl; any Traceback in app.log; analysis failing on a
normal mp3/flac/aiff bought from a store; the server not answering any port in
5050–5080 while the process runs. For those: save the doctor output plus the last
~50 lines of app.log, and report back to the main dev session (Mac Studio, DevPro
repo, `_local/SESSION-HANDOFF.md` has full context).
