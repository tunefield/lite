# Changelog

## 1.1.0 — unreleased

**Pro**
- Unlock export with a Tunefield Pro key (Settings → Pro, or either Export button). Checked offline on your Mac; keeps working in every later version.
- New exports: set sheet (running order as CSV), Ableton Arrangement mix, Serato crates, collect a set to a folder with a playlist, and writing BPM, key and energy into your files (opt-in, with Undo).
- Energy, mood and vocals can travel into Rekordbox (Comments, Colour, Grouping) and Traktor (Comment); you confirm the mapping once.
- Tunefield asks before it writes anywhere outside its own folder (the Rekordbox file, Serato's folders, collect and music folders), once per Mac; Settings → Export locations lists every approval.

**Analysis**
- Tempo is measured more precisely, with fewer half- and double-time misses. Existing libraries are offered an update.
- A file replaced on disk under the same name is offered for update too.
- VBR MP3s without a length header get their real length; beatless material no longer reads as a strong pulse; very short and silent files get no made-up BPM or key. Applies to newly analysed tracks.

**Library and stick**
- Undo after a deletion restores exactly that deletion, with its covers, and after removing a folder brings the folder back too.
- Two windows rating different tracks keep both; ratings save per track.
- USB sticks: hidden `._` files, a full stick and same-named sticks no longer break anything; a read-only stick says so instead of silently using the Mac's data; the analysis queue writes far less; the playback cache keeps space free.
- Folder art is shrunk to 400 px; a folder of unreadable formats says which.
- Settings → USB stick puts Tunefield on a stick, updates it or repairs it, from the Mac app. Only the app is replaced, beside the library; a stick pulled out halfway keeps a working app. The separate USB download is gone, and with it the folder that Finder could drag over a stick's library.

**Field and sets**
- No Field selected is never a dead end; Esc closes pickers before it stops the music; Next carries on into Up next; route tools show progress and can be cancelled; with a track twice in a set, Next follows the copy that played.

Plus the remaining findings of the 2 Nov debug sweep and the 30 Oct review.

## 1.0.0 — 2026-11-03

Tunefield Lite: first public beta.
