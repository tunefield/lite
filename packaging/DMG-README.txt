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
  Export (Rekordbox, Traktor, Ableton, M3U8, CSV) is Tunefield Pro: on sale
  in January 2027 for €79, one-time, or €59 if you sign up at
  tunefield.app/pro before then. Your sets are kept, ready to export when
  Pro arrives.

WHERE YOUR DATA LIVES
  ~/Library/Application Support/Tunefield Lite
  Fields, sets, covers and settings live there.
YOUR MUSIC IS NEVER MOVED OR CHANGED - Tunefield analyses your files where they
  already are. Besides its measurements it keeps one thing: a playback cache of
  FLAC and Ogg tracks you have played in the app (max 4 GB, oldest dropped
  first, safe to delete). Deleting the app does not touch your music.

SOMETHING BROKEN, OR JUST CONFUSING?
  Use the Feedback button (top right) - it opens a short form with a
  diagnostics snapshot already filled in. Or email mark@tunefield.app.
  Screenshots are welcome by email; the form cannot take attachments.
