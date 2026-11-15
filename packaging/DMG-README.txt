TUNEFIELD LITE — public beta
============================

  Needs a Mac with Apple Silicon (M1 or newer) and macOS 14 Sonoma or newer.
  Intel Macs are not supported.

INSTALL
  Drag Tunefield.app onto the Applications folder alias next to it.

FIRST LAUNCH
  Releases are signed and notarized by Apple: double-click Tunefield.app and it
  opens like any other app, in its own window. It starts on Add music — pick a
  folder and it analyses everything in it.
  (On some setups it opens a browser tab at http://localhost:5050 instead —
  that page is the app, same thing.)

  macOS may ask before Tunefield reads a folder you pick (Music, Documents, an
  external drive). Allow it: Tunefield only reads the folders you add.

ONLY IF macOS BLOCKS IT — unsigned test builds
  An unsigned or un-notarized test build is blocked once.

  macOS 15 Sequoia and NEWER (incl. 26 Tahoe):
    1. Double-click Tunefield.app. You get a warning. Click Done/Cancel.
    2. Apple menu > System Settings > Privacy & Security
    3. Scroll to Security: "Tunefield.app was blocked to protect your Mac"
    4. Click "Open Anyway", then authenticate (Touch ID or password)
    5. Double-click Tunefield.app again, and click Open

  macOS 14 Sonoma:
    1. RIGHT-CLICK (or Ctrl-click) Tunefield.app > Open
    2. Click Open in the dialog

FREE, EXCEPT EXPORT
  The Field, sets, Up next, Set tools and Repair are free, with no account.
  Export is Tunefield Pro: Rekordbox, Traktor, Ableton (Session or
  Arrangement), Serato crates, M3U8, CSV, a set sheet, collecting a set into a
  folder, and (if you switch it on) writing BPM, key and energy into your
  files. Pro is a one-time purchase and keeps working in every later version.
  Get your key at tunefield.app/pro. Your sets are kept, ready to export as
  soon as Pro is unlocked.

  Have a key? Settings > Pro, paste it, Unlock. It is checked on this Mac, no
  account.

WHERE YOUR DATA LIVES
  ~/Library/Application Support/Tunefield Lite
  Fields, sets, covers, ratings and tags live there; display settings live in
  the app's own browser storage.
YOUR MUSIC IS NEVER MOVED - Tunefield analyses your files where they already
  are. It changes them only if you switch on Settings > Write tags into music
  files and confirm a run (BPM, key and energy only; Undo puts the old values
  back). Besides its measurements it keeps one thing: a playback cache of FLAC
  and Ogg tracks you have played in the app (max 4 GB, oldest dropped first,
  safe to delete). Deleting the app does not touch your music.

UPDATING TO A NEW VERSION
  Drag the new Tunefield.app onto the Applications folder and choose Replace.
  Your library in ~/Library/Application Support/Tunefield Lite stays as it is.

SOMETHING BROKEN, OR JUST CONFUSING?
  Use the Feedback button (top right) - it opens a short form with a
  diagnostics snapshot already filled in. Or email mark@tunefield.app.
  Screenshots are welcome by email; the form cannot take attachments.
