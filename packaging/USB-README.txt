TUNEFIELD — portable (USB) build, arm64 macOS
==============================================

WHAT THIS IS
  Tunefield runs entirely from this folder. Your catalogs, covers and settings
  live in a data/ folder that appears HERE, next to the app — nothing is written
  to the computer you plug into. Take the stick, take your analysis with you.

  NOTE: the stick carries what Tunefield MEASURED, not your music - it never
  moves or changes your audio files. One exception: FLAC and Ogg tracks you PLAY
  in the app window are decoded into data/_stream_cache on this stick so they
  can play at all (max 4 GB, oldest dropped first, safe to delete any time).
  On a machine that cannot see your music files, those tracks show as
  "not found" until the drive holding them is connected.

FIRST LAUNCH
  Official beta releases are signed and notarized by Apple: just double-click
  Tunefield.app and it opens like any other app, in its own window, on
  every machine you plug into. If it opened, you're done; skip the rest of
  this section. (On some setups it opens a browser tab at
  http://localhost:5050 instead — that page is the app, same thing.)

ONLY IF macOS BLOCKS IT — unsigned development builds
  Then you have an unsigned development build, which macOS blocks once per
  machine. How you approve it CHANGED in macOS Sequoia.

  macOS 15 Sequoia and NEWER (incl. 26 Tahoe) — right-click > Open NO LONGER
  works; Apple removed that bypass:
    1. Double-click Tunefield.app, get the warning, click Done/Cancel
    2. System Settings > Privacy & Security > scroll to Security
    3. Click "Open Anyway" next to "Tunefield.app was blocked...", authenticate
    4. Double-click the app again and click Open

  macOS 14 Sonoma and OLDER:
    RIGHT-CLICK (or Ctrl-click) Tunefield.app > Open, then Open.

  ALWAYS WORKS, either version — paste into Terminal, replacing the path with
  wherever this folder actually is (drag the .app onto the Terminal window to
  fill the path in for you):

      xattr -dr com.apple.quarantine /Volumes/YOUR-STICK/Tunefield-USB/Tunefield.app

  Do this once per machine. Double-clicking is fine afterwards.

IF IT WON'T OPEN FROM A USB STICK AT ALL (no warning, it just never appears)
  Sticks formatted for CDJs (FAT32/exFAT) can't hold Mac file attributes, so
  macOS parks them in hidden "._" files beside each real file. Normally harmless -
  but if a copy ever went wrong, they can break the app's Apple seal and macOS
  silently refuses to start it. One line in Terminal cleans them up:

      dot_clean -m /Volumes/YOUR-STICK/Tunefield-USB

  Then double-click the app again.

IF IT OPENS BUT NO data/ FOLDER APPEARS ON THE STICK (beta8 only)
  macOS marks everything you download as "from the internet". If that mark is
  still on Tunefield.app when you double-click it on the stick, macOS quietly
  runs a hidden copy of the app instead of the one you clicked. Beta8 can't
  see the PORTABLE file from there and keeps your data on the Mac, not the
  stick. Nothing is broken and nothing is lost. From beta9 on the app notices
  this itself and uses the stick anyway. On beta8, remove the mark once, in
  Terminal (drag the .app onto the window to fill in the path); the
  "Operation not permitted" lines it prints on a stick are harmless:

      xattr -dr com.apple.quarantine /Volumes/YOUR-STICK/Tunefield-USB/Tunefield.app

  Quit Tunefield and double-click it again: data/ now appears next to the app.

YOUR BETA KEY
  You were sent a licence key by email. Paste it into
      the gear icon (top right) > Settings > Unlock key   ->  Unlock
  It is checked on this machine only - no account, nothing sent anywhere.
  Questions or problems: the Feedback button, or mark@tunefield.app.

HOW PORTABLE MODE WORKS
  The file named PORTABLE next to the app is the switch. While it is there, all
  data stays in this folder. Delete it and the app behaves like an installed
  copy instead, keeping data in ~/Library/Application Support/Tunefield on
  whatever machine runs it.

  DON'T DELETE IT BY ACCIDENT. Removing PORTABLE makes the app look at the
  computer's own data folder instead, so the library on this stick appears to
  have vanished. Nothing is lost - put the file back and it returns.

NOTES
  * Apple Silicon (M1/M2/M3/M4) only. It will not run on Intel Macs.
  * Quit by closing the Tunefield window in the menu bar / Dock, or Cmd-Q.
  * Analysing straight from the stick works; a slow stick makes analysis slower,
    not wrong. The safest moment to unplug is when the app is not analysing.
