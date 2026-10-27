# Tunefield Lite — User Manual

*Public beta. The exact version is in the `VERSION` file and at the top of every Feedback report.*

Tunefield turns your music into a space you can fly through. Every track becomes a point in a 3D field shaped by the music itself — tempo, loudness, key, mood — so *where things are* means something. **Tunefield Lite does one job: it helps a DJ build a set from a selection of music.** Add a folder, see it as a field, build the set, play it through, export it to your DJ software.

It runs entirely on your own Mac. Your music, your analysis and your sets never leave the machine; the only thing that ever goes out is a Feedback report, and only when you send it.

**Needs:** a Mac with Apple Silicon (M1 or newer), macOS 14 Sonoma or newer.

---

## Contents

1. [The loop in two minutes](#1-the-loop-in-two-minutes)
2. [The Analyse tab](#2-the-analyse-tab)
3. [The Field tab](#3-the-field-tab)
4. [Building a set](#4-building-a-set)
5. [Up next](#5-up-next)
6. [Set tools](#6-set-tools)
7. [Playing a set](#7-playing-a-set)
8. [The Playlists tab](#8-the-playlists-tab)
9. [The List tab](#9-the-list-tab)
10. [The Repair tab](#10-the-repair-tab)
11. [Exporting — Rekordbox, Traktor, Ableton](#11-exporting--rekordbox-traktor-ableton)
12. [Keyboard reference](#12-keyboard-reference)
13. [Settings](#13-settings)
14. [Troubleshooting / FAQ](#14-troubleshooting--faq)
15. [Appendix: what the metrics mean](#15-appendix-what-the-metrics-mean)

---

## 1. The loop in two minutes

1. **Analyse → Add music.** Pick a folder. Everything new in it is analysed; a big progress panel shows how far it has got and how long is left.
2. **Field.** Your tracks appear as coloured spheres — left to right is slow to fast, bottom to top is quiet to loud, colour is the key.
3. **＋ New set**, then **double-click** tracks to add them. **Up next** under the set suggests what could follow.
4. **▶ Play.** The set plays through, each track's preview section, and the camera flies to each track as it starts.
5. **Export set.** Rekordbox, Traktor, Ableton or M3U8.

Everything you create lives in the `data/` folder next to the app (or on the USB stick, for the portable build). Deleted audio goes to `data/_trash/` first, never straight to oblivion.

The five tabs across the top, in workflow order:

| Tab | What it's for |
|---|---|
| **Analyse** | Add music folders and watch them get analysed |
| **Field** | The 3D field, with your set beside it |
| **Playlists** | All your sets |
| **List** | Everything as a sortable table, with the same filters as the Field |
| **Repair** | Library health: covers, tags, genres, paths, duplicates |

Whenever something breaks or confuses you, press **Feedback** (top right). It shows the diagnostics it will attach — version, macOS, where your data lives, the last error, how long it took you to reach your first export, and the tail of the crash log if there is one. **Copy & open form ↗** opens a short Google Form with those diagnostics already filled in (and copied to your clipboard as a backup). Nothing is sent until you press submit there.

---

## 2. The Analyse tab

This is where music enters Tunefield.

**Add music** opens the folder picker. Pick a folder and Tunefield adds it, looks through it, and analyses every track that isn't already in this Field — one action, nothing to tick. **Or paste a folder path** does the same from a typed path.

While it runs:

- **The progress panel is unmissable.** Within a second of pressing Add music it says what it is doing. The first few tracks take longest while the analyser warms up; after that you see *Analysing 120 of 1,376* and *about 9 min left*.
- **Cancel** stops after the batch in flight. Everything analysed so far stays.
- **You can use the Field while it runs.** Analysis slows itself down slightly while the Field or the List is on screen, so neither stutters.
- **Interrupted runs come back.** If the app quits or crashes mid-run, the next launch opens on Analyse with *Analysis was interrupted — N files still to go* and a **Resume** button. Closing the window mid-run asks first.

When it finishes, the panel says what happened: *120 tracks added · 30 already in this Field · 2 files couldn't be read*. **Tracks already in the Field are a count, never an error.** Files that genuinely can't be decoded are listed under *details* with the reason.

**Analysis is fully local.** No audio ever leaves your machine. Each track is analysed over half its length, sampled in blocks spread across the record, so a quick pass still hears the intro, the middle and the end.

**Fields.** A Field is a named collection — your whole library, or one gig's worth. The **Field** selector at the top of the tab picks which one you're adding to; **＋ New Field**, **Rename** and **Delete** manage them. **Music folders in this Field** lists the folders you've added; **Check for new music** looks through them all again and analyses what's new; **Remove** takes a folder off the list (your audio files are never touched).

**First launch** opens straight on Analyse with one thing to do: Add music. An empty Field says so, with the same button, instead of showing an empty space.

---

## 3. The Field tab

Every track is a sphere floating in space. **Position, colour and size each represent a metric you choose** — so you decide what "close together" means. The field stays fast with many thousands of tracks.

### 3.1 The drawers

Four slim tabs sit on the field's left edge:

- **FIELDS** — tick which Fields are in view.
- **AXES** — the dropdowns for **X / Y / Z / Size / Colour**, saved **Views**, and **Formulas** (a presets & patches picker, and **ƒx Edit** for writing your own axis maths).
- **FILTERS** — search, mood, vocals, and ranges for BPM, danceability, loudness, length and release year.
- **KEY** — the Camelot wheel.

Click a tab to slide its drawer out; click again to tuck it away. Several can be open at once. **Drawer size** in ⚙ Settings scales them all.

Available metrics: BPM, Loudness, Danceability, Brightness, **Key (Camelot)** (put it on X to line the library up by the wheel), Vocals, **Mood** (four coarse bands), Rating, **Released** (a timeline of your library), Genre, and any tags you've created. Fresh installs start at X = BPM, Y = Loudness, Z = Danceability, Colour = Key.

**Every axis says which way it runs** — the arrowhead end carries the metric and its high-end word (`fast ▸`, `loud ▸`, `danceable ▸`), the other end the low-end word (`◂ slow`, `◂ quiet`). A small axis cross bottom right turns with the camera, for when you've flown yourself into disorientation.

**Formulas.** In the AXES drawer, pick one of the built-in presets and the whole field re-arranges — the Camelot wheel as a literal circle, a peak-time finder, half-time twins. **ƒx Edit** lets you write your own, e.g. `x=bpm*5(ene-dnc) y=dnc^2/(bri/ene) size=ene`, using short names for the metrics (`bpm ene dnc bri voc rat rel dur key mod grp rough perc onsd puls chfx dyn`). Undefined results pin a track to the middle instead of flinging it into deep space.

### 3.2 Mouse

- **Drag** to rotate · **scroll** to zoom · **Reset** (left of the tool ring) re-frames everything
- **Click** a track → select it and hear its preview
- **Double-click** a track → **add it to your set** (and hear it)
- **Hold on a track and drag up/down** → scrub through it
- Hover shows artist and title, then BPM · Key · Genre

### 3.3 The tool ring and the Spread dial

Top centre of the field: **Reset**, **◎ Focus** (every selection flies the camera in close; orbiting by hand releases it), **⋈ Vector maths** (the advanced panel — see §6), **Covers** (album art on every sphere) and **Pathway**. The **Spread dial** in the middle stretches or squeezes the whole field ×0.5 to ×3 — drag up/down or scroll, double-click to snap back to ×1. Keys `1`–`5` press the ring left to right.

**Pathway.** Your set's route through the field is always drawn as a line. The Pathway button switches what the rest of the field does around it: **the whole field**, or **only the tracks in your set**. Only-the-set takes effect once the set has at least two tracks, and every launch starts with the whole field showing.

### 3.4 The Camelot wheel

The KEY drawer's wheel **filters the field by key**.

- **Click a key** to show only that key; click more to add them. The **⊘** button in the middle clears the key selection — your track's key stays outlined as a "you are here" marker.
- **The mode pads** — **Safe / Wider / +Mood / All** — select keys that mix with your selected track's key. Clicking the active pad again cycles **dark** (minor only) → **light** (major only) → normal.
- **◯ Rings / — Lines / ⊙ Preview** show the twelve nearest harmonically compatible tracks from your selected track, faded by rank. ⊙ Preview (or `V`) makes them follow whatever you're previewing instead.
- **Wheel labels** — note names, Camelot `8B`, or Open Key `1d` — are in ⚙ Settings, or step through them with the small key button beside the wheel.

The FILTERS and KEY drawers are the same filters the List tab uses: a key picked in one applies in the other.

### 3.5 ✛ A hidden mode

Somewhere in the Field is a first-person flight mode — for those who find it. A certain classic sequence of keys, entered on the Field tab, unlocks it for good; once found, a **✛** button joins the tool ring and **`F`** toggles it. Inside, the mouse steers, WASD flies, and the crosshair is your cursor — click previews, Shift+click or double-click adds. **`Esc`** leaves, and leaving never stops the music. **Flight speed** is in ⚙ Settings.

---

## 4. Building a set

The **Your set** panel sits beside the Field.

- **＋ New set** creates a set and opens it. The selector beside it switches between sets; **✎** renames, **×** deletes.
- **Double-click** a track in the Field to add it. Each add lands **right after the track you last added or played**, so you build forward from where you are.
- **Drag** a row by its grip to reorder. **×** on a row removes it. **Clear** empties the set.
- **↶ Undo** steps back through every add, removal and reorder — press it repeatedly to keep walking back.
- **Lock** protects a finished set from edits.

The top of the panel shows the track count and the total running time.

---

## 5. Up next

Under the set, **Up next** keeps five tracks ready that would follow well — Spotify-style, but steered by you:

- **↗ up / → steady / ↘ down** — the energy shape. *Up* builds the loudness as the set grows, *down* winds it down, *steady* holds it.
- **Roam** — how far each suggestion may travel from the track before it. Left hugs one sound; right reaches across the library.
- **Key** — how strictly suggestions keep to harmonically compatible keys. Left: anything goes. Right: compatible keys only.

Up next follows **the track you last double-clicked** — add a track and the suggestions re-aim from it. (With nothing added yet, it follows the last track in the set.) It only suggests tracks your filters allow, and never one already in the set.

- **Click** a suggestion to hear it.
- **＋** (or double-click) **keeps** it — it joins the set.
- **×** drops it; it isn't offered again this session.

**A playing set never runs dry.** When the set reaches its last track, the first Up next track joins the set and plays, and so on — the set keeps growing for as long as you let it play.

---

## 6. Set tools

**⋈ Set tools** in the set panel opens one-click tools that compare tracks by their whole sound — sixteen measurements per track, not just the three the field shows. No AI, no internet: your own library's measurements, compared honestly. Results list underneath; click any to hear it, and **＋ Add all to the set** takes them.

**This track** — click a track in the Field first:

| Button | What it does |
|---|---|
| **More like this** | The ten tracks closest in overall sound |
| **Bridge to here** | Stepping-stone tracks from the last track in your set to the selected one |
| **Less vocal / More energy / Darker / Brighter** | Tracks like this one, nudged in that direction |
| **Distance as axis** | Puts "how far from this track" on the X axis — nearest on the left |
| **Build a set from here** | A 20-track set starting here, shaped by energy — preview it, then save it |

**This set:**

| Button | What it does |
|---|---|
| **More like this set** | Tracks closest to the set as a whole |
| **Smooth the order** | Reorders the set so each step is as small as possible (Undo reverses it) |
| **Check the flow** | The set as a journey: its energy shape, the average step, the roughest transition |
| **Fix the worst jump** | Finds the roughest step and offers a track to insert between the two |
| **Odd one out** | The track that sits furthest from the rest, with a Remove button |

**The Field:** **Arrange by sound** lays the field out along the three directions your library actually varies (PCA); **Map by similarity** pulls similar tracks into visible clumps (t-SNE); **Group by sound** colours the field into sound families; **⟲ Reset view** puts the axes back.

**Library:** **Near-duplicates** lists pairs of tracks that sound almost identical — the same record twice, or two edits.

**The advanced panel.** ⚙ Settings → **⋈ Advanced vector panel** (or key `3`) opens the full tools: PCA and t-SNE with their detail, free-form vector arithmetic (`-voc +2rough` — "this, but less vocal and much rougher", in standard deviations), and the **Weights** that decide what "similar" means to you. The weights affect every Set tool.

---

## 7. Playing a set

Press **▶** on the transport at the bottom. The set plays through in order, starting from the track you last added or played, and **the camera flies to each track as it starts** — a slow orbit that breathes in and out. Grab the view (drag, scroll or the flight keys) and the camera is yours; the **Fly** button hands it back.

**The preview window** is the ring around the play button: **24 segments**, each 1/24 of a track, 12 o'clock = the start. Click a segment to switch it on or off; drag to paint several; double-click to isolate one. The lit segments are the part of every track you hear:

- A track you **click in the Field** plays its preview section and **stops at the end of it**.
- In a **playing set**, reaching the end of the section moves on to the next track.
- **Every segment off** plays every track in full.

The transport also has **⏮ / ⏭** (previous / next), **⏹** stop, and the **volume dial** at its right end: drag up/down or scroll for level, click to mute.

---

## 8. The Playlists tab

Every set as a card, with its tracks.

- **＋ New set** creates one.
- **Drag** tracks between cards to move them; hold **Alt** while dropping to copy; **×** removes.
- Each card has **Set active** (open it in the set panel), **Duplicate**, **Rename**, **Lock** and **Delete**. Deleting is undoable from the toast that follows.
- **Analyse my set** on a card is the same report as Set tools → Check the flow.

---

## 9. The List tab

The tracks of whichever Fields are ticked in **Fields ▾**, as one sortable table.

- **Columns** — click a header to sort; drag a header onto another to reorder; drag edges for width; **⊞ Columns** shows or hides them. **Key** follows your wheel-label setting.
- **The sidebar** holds the same filters and Camelot wheel as the Field's drawers — they're shared, so filtering here filters the Field too.
- **Ratings** — click the ★ column to rate 0–5. Ratings work as a field metric and in formulas (`rat`).
- **Check** — tempo confidence as a traffic light: **red** = the file's tag and the analysis disagree (worth a listen), **yellow** = medium, **green** = high. Sort by it and check the top until it turns green.
- **Right-click** a row to add it to a set.
- **Export ▾** exports what the filters show (see §11).
- **Table / Cards** switches the view.

---

## 10. The Repair tab

Field health. Pick the Field, press **Scan health**, and the findings group into cards:

| Card | What it means | Fix offered |
|---|---|---|
| Broken file paths | Entry points at a file that no longer exists | Delete orphan entries, or relink |
| Missing cover art | No embedded art, no folder cover.jpg | Extract covers, then Generate key-colour covers |
| Missing artist / title | Tags never extracted | Backfill tags from files |
| Missing genre | No genre tag | Extract genres |
| Failed / partial analysis | BPM = 0 or duration = 0 | Rescan all |
| Catalog name ↔ tag mismatch | Tags disagree with the stored name | Apply tags to catalog names (undoable) — files on disk are never renamed |
| Duplicates | Same track catalogued more than once | Auto-delete duplicates (keep best), after a preview |

**Covers:** **Extract covers** pulls the art embedded in your files; **Generate key-colour covers** draws a sleeve from the track's key colour, artist and title for whatever is left — so every track can end up with one. Long jobs show their progress on the Repair tab with a **Cancel**. Per-row buttons fix or **ignore** individual issues; ignored issues stay out of future scans until you clear the ignored list.

When a file simply carries no tags, Repair says so plainly — *the remaining tracks have no artist/title tags in the file* — rather than reporting a failure. **Rescan all** re-analyses tracks whose files were copied into Tunefield's own library; tracks analysed in place from your own folders are re-analysed by removing and re-adding them on the Analyse tab.

> **Caution: delete and dedup actions remove catalog entries** — the analysis, rating and tags for those entries go with them. Dedup always shows a preview of exactly what would be deleted, you confirm before anything runs, an Undo is offered straight after, and orphan deletion refuses to run while a library drive is unplugged. Even so, read the preview before you confirm.

---

## 11. Exporting — Rekordbox, Traktor, Ableton

**Export set** (set panel) exports the open set; **Export ▾** (List tab) exports what the filters show. You can switch the **Source** at the top of the menu either way.

| Menu item | What it does |
|---|---|
| **M3U8 — absolute paths** | A standard playlist with full file paths — for players on this machine |
| **M3U8 — relative (filenames)** | Filenames only — place it alongside your audio and it works anywhere |
| **Rekordbox — bridge (auto)** | The recommended Rekordbox route — see below |
| **Rekordbox XML — download** | A one-off XML — for taking a set to another machine |
| **Ableton Live Set** | A ready-to-open `.als`: two alternating deck tracks, one scene per track, every clip warped to its BPM. Opens in any Live edition; audio is referenced in place |
| **Traktor NML** | Drop into Traktor's Playlists folder, or import via Traktor's File menu |
| **CSV — all metadata** | The whole Field's analysis as a spreadsheet |

### The Rekordbox bridge

Every exported set collects in **one fixed XML file** (`~/Music/Tunefield/tunefield.xml`) that Rekordbox watches. Set it up once — **setup** beside the menu item shows the path to copy:

1. **Rekordbox → Preferences → Advanced → Database** — under "rekordbox xml", set **Imported Library** to that file.
2. **View → Layout** — tick **rekordbox xml** so the sidebar section shows.

After that, every export appears in Rekordbox's xml sidebar: right-click → **Import Playlist**. Re-exporting a set updates it in place. Your Rekordbox collection itself is never touched. *(For USB sticks and CDJs, do the final "Export to device" from Rekordbox.)*

---

## 12. Keyboard reference

Press **`?`** on the Field tab for this list in the app.

**Fly the field**

| Key | Action |
|---|---|
| `W` `S` | forward / back |
| `A` `D` | strafe left / right |
| `Q` `E` | rise / sink |
| `Shift` | hold to sprint (×3) |

**Pick tracks**

| Key | Action |
|---|---|
| `←` `↑` `→` `↓` | hop to the next track in that direction |
| `Enter` | preview it (like a click) |
| `Shift`+`Enter` | add it (like a double-click) |

**Tools and drawers**

| Key | Action |
|---|---|
| `1`–`5` | the tool ring: Reset · ◎ Focus · ⋈ Vector maths · Covers · Pathway |
| `Z` `X` `C` | open / close the Axes, Filters and Key drawers |
| `Y` | Fly on / off |
| `V` | Rings / Lines follow the previewed track |
| `⌘ ,` | Settings |

**Play**

| Key | Action |
|---|---|
| `Space` | play / pause |
| `Esc` | back to the selected track, or stop |
| `?` | show / hide the key list |

**First-person** *(once unlocked — §3.5)*: `F` enters and leaves, the mouse looks, click previews, Shift+click adds, `Esc` leaves.

Keys never fire while you're typing in a box or dragging a slider.

---

## 13. Settings

**⚙** (top right, or `⌘ ,`):

| Row | What it does |
|---|---|
| **Help** | Opens this manual |
| **Beta** | Saves the local usage log, if you want to send it with feedback |
| **Wheel labels** | Note names, Camelot (`1A/1B`) or Open Key (`1m/1d`) |
| **Vector maths** | Opens the advanced ⋈ panel |
| **Appearance** | Light or Dark interface |
| **Background** | Light or dark ground behind the Field and the pages |
| **Drawer size** | Scales the Field's drawers, 50–150% |
| **Filtered-out tracks** | 0% hides tracks your filters exclude (the default); higher leaves them as faint, still-clickable ghosts |
| **Flight speed** | First-person and keyboard flight, 25–250% |
| **Distance fog** | Far tracks fade into the ground, for depth |

---

## 14. Troubleshooting / FAQ

**macOS says it can't check the app.** The downloaded app is signed and notarized, so a plain double-click should open it. If you copied it from somewhere else and macOS still objects: **System Settings → Privacy & Security → Open Anyway**, once.

**macOS asks to access your Music, Documents or a drive.** That's macOS checking before Tunefield reads a folder you picked. Allow it — Tunefield only reads the folders you add. If you said no by mistake, change it in **System Settings → Privacy & Security → Files and Folders**.

**A track fails to analyse.** Corrupt or very short files fail cleanly and are listed under *details* in the Analyse panel. Anything else isn't expected — send it via Feedback with the filename.

**The BPM is half or double.** Tempo detection sometimes lands on the wrong multiple. Fix it on the track's card in the List: **÷2, ×⅔, ×1½, ×2**, with a reset. Corrections survive re-analysis.

**The key looks wrong.** Correct it on the track card: **‹ ›** step a semitone, **maj↔min** flips the mode, **rel** swaps to the relative key. Stored like tempo corrections and used everywhere, including exports.

**My acapella or stem is classified wrong.** Put a label in the filename or tags — `(Acapella)`, `(Instrumental)`, `Vocals Only` — and it overrides detection.

**Filtered-out tracks disappear.** A filter takes them off the screen. **⚙ Settings → Filtered-out tracks** keeps them as faint ghosts instead.

**I deleted something I shouldn't have.** Set deletion has an Undo toast; Repair deletions offer an Undo; deleted audio moves to `data/_trash/` rather than being erased.

**Start over cleanly.** Quit, delete the `data/` folder, relaunch.

---

## 15. Appendix: what the metrics mean

An honest note up front: BPM and key come from the file's own tags where they exist, and signal analysis where they don't, and are usually right (see the FAQ for the known failure modes and the one-click corrections). Loudness is a real measurement; **danceability, brightness and vocals are heuristic scores** — good for *arranging* music in space, not gospel. If a score contradicts your ears, trust your ears (and send feedback).

**BPM** — tempo in beats per minute. Where the file ships its own BPM tag that is used (obviously wrong tags are ignored); otherwise it's detected from the audio, with half-time misreads rescued upward when the track's own pulse supports a faster tempo. The default X axis: left to right is slow to fast.

**Key (Camelot)** — the detected key in Camelot notation: a number 1–12 plus **A** (minor) or **B** (major). Adjacent numbers, and the A/B pair on the same number, mix harmonically. Key is detected with **key profiles built from electronic dance music** (Faraldo et al., 2016) rather than the classical profiles most software still uses — worth around three points of accuracy on dance records. Tunefield also measures how far a record sits from concert pitch, and when it genuinely cannot tell, it says so instead of guessing.

**Loudness** — a 0–1 reading derived from the track's integrated LUFS. 50% is about as loud as a streaming-normalised release; nothing reaches 100%. The default Y axis.

**Mood** — four deliberately coarse bands: **euphoric** (loud + positive), **intense** (loud + dark), **upbeat** (gentle + positive), **melancholic** (gentle + dark). Treat it as a grouping, not a verdict.

**Danceability** — 0–1 for how much the rhythm invites movement: a danceable tempo, bass presence and a clear repeating pulse. Not a quality judgment.

**LUFS** — integrated loudness, the broadcast-standard measure. Negative: closer to 0 is louder. A List column, useful for gain staging.

**Brightness** — 0–1 for how much of the track's energy lives in the high frequencies. Handy for matching tonal character across a transition.

**Roughness** — 0–1 for how much the sound beats and grinds, measured from the fast wobble in the track's own level. A formula variable (`rough`) and part of what "similar" means.

**Vocals** — 0–1 for detected voice presence. Filename and tag labels override the detection.

**Released** — when the track came out, from the file's year or date tag, falling back to the file's date. Put it on an axis for a timeline of your library.

---

*Something in here wrong, unclear, or missing? That's exactly what **Feedback** is for.*
