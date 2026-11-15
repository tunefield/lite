TUNEFIELD LITE — on a USB stick
===============================

  Needs a Mac with Apple Silicon (M1 or newer) and macOS 14 Sonoma or newer.
  Intel Macs are not supported.

WHAT THIS IS
  Tunefield runs entirely from this folder. Your Fields, sets, covers, ratings
  and tags live in a data/ folder that appears HERE, next to the app (display
  settings stay with the computer you plug into). Your music
  data stays on the stick; small caches stay on the computer. Take the stick,
  take your analysis with you.

  NOTE: the stick carries what Tunefield MEASURED, not your music - it never
  moves your audio files, and changes them only if you switch on Settings >
  Write tags into music files and confirm a run (BPM, key and energy only;
  Undo puts the old values back). One more thing it keeps: FLAC and Ogg tracks
  you PLAY in the app window are decoded into data/_stream_cache on this stick
  so they can play at all (max 4 GB, less when the stick is nearly full; oldest
  dropped first; safe to delete any time).
  On a machine that cannot see your music files, those tracks show as
  "not found" until the drive holding them is connected.

FIRST LAUNCH
  Double-click Tunefield.app. It opens like any other app, in its own window,
  on every Mac you plug into. It starts on Add music — pick a folder and it
  analyses everything in it. (On some setups it opens a browser tab at
  http://localhost:5050 instead — that page is the app, same thing.)

  macOS may ask before Tunefield reads a folder you pick (Music, Documents, an
  external drive). Allow it: Tunefield only reads the folders you add.

UPDATING TO A NEW VERSION
  On your Mac, open Tunefield (from Applications, or straight from the
  download), then Settings > USB stick > Update. It swaps only the app;
  data/ and PORTABLE stay as they are, and so does your library.
  Quit Tunefield on the stick first. Don't drag an app or a folder onto the
  stick yourself: Settings > USB stick does it the safe way.

YOUR LIBRARY HAS A BACKUP
  Tunefield keeps a copy of your library in a hidden folder at the top of this
  stick, .tunefield-backup. Leave it there: if this Tunefield-USB folder is ever
  replaced or deleted, Tunefield offers to bring your library back.

IF IT WON'T OPEN FROM THE STICK
  On your Mac, open Tunefield, then Settings > USB stick > Repair. It puts a
  fresh copy of the app on the stick and leaves your library alone.

FREE, EXCEPT EXPORT
  The Field, sets, Up next, Set tools and Repair are free, with no account.
  Export is Tunefield Pro: Rekordbox, Traktor, Ableton (Session or
  Arrangement), Serato crates, M3U8, CSV, a set sheet, collecting a set into a
  folder, and (if you switch it on) writing BPM, key and energy into your
  files. Pro is a one-time purchase and keeps working in every later version.
  Get your key at tunefield.app/pro. Your sets are kept, ready to export as
  soon as Pro is unlocked.

  Have a key? Settings > Pro, paste it, Unlock. It is checked on this Mac, no
  account. The key is saved on this stick, so Pro comes with it to any Mac.

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

NOTES
  * Quit by closing the Tunefield window in the menu bar / Dock, or Cmd-Q.
  * Analysing straight from the stick works; a slow stick makes analysis slower,
    not wrong. The safest moment to unplug is when the app is not analysing.
