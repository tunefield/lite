TUNEFIELD — private beta, arm64 macOS
=====================================

INSTALL
  Drag Tunefield.app onto the Applications folder alias next to it.

FIRST LAUNCH
  Official beta releases are signed and notarized by Apple: just double-click
  Tunefield.app and it opens like any other app, in its own window. If it
  opened, you're done; skip the rest of this section.
  (On some setups it opens a browser tab at http://localhost:5050 instead —
  that page is the app, same thing.)

ONLY IF macOS BLOCKS IT — unsigned development builds
  Then you have an unsigned development build, which macOS blocks once.
  How you approve it CHANGED in macOS Sequoia. Check: Apple menu > About This Mac.

  macOS 15 Sequoia and NEWER (incl. 26 Tahoe) — right-click > Open NO LONGER
  works; Apple removed that bypass. Do this instead:
    1. Double-click Tunefield.app. You get a warning. Click Done/Cancel.
    2. Apple menu > System Settings > Privacy & Security
    3. Scroll to Security. You will see:
         "Tunefield.app was blocked to protect your Mac"
    4. Click "Open Anyway", then authenticate (Touch ID or password)
    5. Double-click Tunefield.app again, and click Open

  macOS 14 Sonoma and OLDER:
    1. RIGHT-CLICK (or Ctrl-click) Tunefield.app > Open
    2. Click Open in the dialog

  EITHER VERSION — the one-line shortcut that always works. Copy the app to
  Applications first, then paste this into Terminal and press Return:

      xattr -dr com.apple.quarantine /Applications/Tunefield.app

  That removes the "downloaded from the internet" mark, and the app then opens
  by double-click like any other. Use this if the steps above stall, or if
  macOS claims the app "is damaged" (that message means quarantined, not broken).

YOUR BETA KEY
  You were sent a licence key by email. Paste it into
      the gear icon (top right) > Settings > Unlock key   ->  Unlock
  Without it you are on the free tier: the field, playlists, analysis, ratings,
  tags, CSV/M3U8 export and basic repair all work, but Set tools, the
  vector-maths panel, the formula editor, the heavy half of Repair (duplicates
  and broken paths), the Discogs/AcoustID lookups and the
  Rekordbox/Traktor/Ableton exports stay locked, and
  you are capped at 3 Fields of 500 tracks. The key is checked on this machine
  only - no account, nothing sent anywhere.

WHERE YOUR DATA LIVES
  ~/Library/Application Support/Tunefield
  Catalogs, covers, settings and extracted artwork live there.
YOUR MUSIC IS NEVER MOVED OR CHANGED - Tunefield analyses your files where they
  already are. Besides its measurements it keeps one thing: a playback cache of
  FLAC and Ogg tracks you have played in the app (max 4 GB, oldest dropped
  first, safe to delete). Deleting the app does not touch your music, and
  deleting music does not confuse the app: it says so instead.

SOMETHING BROKEN, OR JUST CONFUSING?
  Use the Feedback button (top right) - it opens a short form with your name and
  a diagnostics snapshot already filled in. Or email mark@tunefield.app.
  Screenshots are welcome by email; the form cannot take attachments.

  Apple Silicon (M1/M2/M3/M4) only. Intel builds come later.
