TUNEFIELD LITE — portable (USB) build
=====================================

  Needs a Mac with Apple Silicon (M1 or newer) and macOS 14 Sonoma or newer.
  Intel Macs are not supported.

WHAT THIS IS
  Tunefield runs entirely from this folder. Your Fields, sets, covers and
  settings live in a data/ folder that appears HERE, next to the app — nothing
  is written to the computer you plug into. Take the stick, take your analysis
  with you.

  NOTE: the stick carries what Tunefield MEASURED, not your music - it never
  moves or changes your audio files. One exception: FLAC and Ogg tracks you PLAY
  in the app window are decoded into data/_stream_cache on this stick so they
  can play at all (max 4 GB, oldest dropped first, safe to delete any time).
  On a machine that cannot see your music files, those tracks show as
  "not found" until the drive holding them is connected.

FIRST LAUNCH
  Releases are signed and notarized by Apple: double-click Tunefield.app and it
  opens like any other app, in its own window, on every machine you plug into.
  It starts on Add music — pick a folder and it analyses everything in it.
  (On some setups it opens a browser tab at http://localhost:5050 instead —
  that page is the app, same thing.)

  macOS may ask before Tunefield reads a folder you pick (Music, Documents, an
  external drive). Allow it: Tunefield only reads the folders you add.

ONLY IF macOS BLOCKS IT — unsigned test builds
  An unsigned or un-notarized test build is blocked once per machine.

  macOS 15 Sequoia and NEWER (incl. 26 Tahoe):
    1. Double-click Tunefield.app. You get a warning. Click Done/Cancel.
    2. Apple menu > System Settings > Privacy & Security
    3. Scroll to Security: "Tunefield.app was blocked to protect your Mac"
    4. Click "Open Anyway", then authenticate (Touch ID or password)
    5. Double-click Tunefield.app again, and click Open

  macOS 14 Sonoma:
    1. RIGHT-CLICK (or Ctrl-click) Tunefield.app > Open
    2. Click Open in the dialog

  ALWAYS WORKS, either version — paste into Terminal, replacing the path with
  wherever this folder actually is (drag the .app onto the Terminal window to
  fill the path in for you). The "Operation not permitted" lines it prints on
  a stick are harmless:

      xattr -dr com.apple.quarantine /Volumes/YOUR-STICK/Tunefield-USB/Tunefield.app

IF IT WON'T OPEN FROM A USB STICK AT ALL (no warning, it just never appears)
  Sticks formatted for CDJs (FAT32/exFAT) can't hold Mac file attributes, so
  macOS parks them in hidden "._" files beside each real file. Normally harmless -
  but if a copy ever went wrong, they can break the app's Apple seal and macOS
  silently refuses to start it. One line in Terminal cleans them up:

      dot_clean -m /Volumes/YOUR-STICK/Tunefield-USB

  Then double-click the app again.

FREE, EXCEPT EXPORT
  The Field, sets, Up next, Set tools and Repair are free, with no account.
  Export (Rekordbox, Traktor, Ableton, M3U8, CSV) is Tunefield Pro: on sale
  in January 2027 for €79, one-time, or €59 if you sign up at
  tunefield.app/pro before then. Your sets are kept, ready to export when
  Pro arrives.

HOW PORTABLE MODE WORKS
  The file named PORTABLE next to the app is the switch. While it is there, all
  data stays in this folder. Delete it and the app behaves like an installed
  copy instead, keeping data in ~/Library/Application Support/Tunefield Lite on
  whatever machine runs it.

  DON'T DELETE IT BY ACCIDENT. Removing PORTABLE makes the app look at the
  computer's own data folder instead, so the library on this stick appears to
  have vanished. Nothing is lost - put the file back and it returns.

SOMETHING BROKEN, OR JUST CONFUSING?
  Use the Feedback button (top right) - it opens a short form with a
  diagnostics snapshot already filled in. Or email mark@tunefield.app.
  For a quick health check of this stick, run tunefield-doctor.sh (next to the
  app) in Terminal and paste what it prints.

NOTES
  * Quit by closing the Tunefield window in the menu bar / Dock, or Cmd-Q.
  * Analysing straight from the stick works; a slow stick makes analysis slower,
    not wrong. The safest moment to unplug is when the app is not analysing.
