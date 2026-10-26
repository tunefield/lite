# Tunefield — User Manual

*Private beta (the app's exact version is in the `VERSION` file, and in the hover tooltip of the status dot at the top of the app)*

Tunefield turns your music library into a navigable space. Every track becomes a point in a 3D field shaped by the music itself — tempo, loudness, key, mood, era — so *where things are* means something, and finding music becomes exploration instead of scrolling. It runs entirely on your own machine: your music, your data, your field. Nothing leaves your computer unless you choose it — first launch downloads its engine once, and the optional Discogs/AcoustID lookups are the only features that ever call out. (The longer story of why is in [`MISSION.md`](MISSION.md).)

This manual is the full reference. If you just want to get running, read [`QUICKSTART.md`](QUICKSTART.md) first — it covers installation, first launch, and the fastest path to a working field.

---

## Contents

1. [Getting started](#1-getting-started)
2. [The Analyse tab](#2-the-analyse-tab)
3. [The Field tab](#3-the-field-tab)
4. [The Playlists tab](#4-the-playlists-tab)
5. [The List tab](#5-the-list-tab)
6. [The Repair tab](#6-the-repair-tab)
7. [Keyboard & FPS reference](#7-keyboard--fps-reference)
7b. [Supporting the project](#7b-supporting-the-project)
8. [Exporting — Rekordbox, Ableton and friends](#8-exporting--rekordbox-ableton-and-friends)
9. [Troubleshooting / FAQ](#9-troubleshooting--faq)
10. [Appendix: what the metrics mean](#10-appendix-what-the-metrics-mean)

---

## 1. Getting started

Everything about installing Python, double-clicking the launcher, and first-run setup lives in [`QUICKSTART.md`](QUICKSTART.md) — start there. (Running the packaged `Tunefield.app` from the .dmg or USB build? Then nothing needs installing at all — see the README that ships beside it.) The short version for the from-source launcher:

1. Install Python (one-time — it's the only thing Tunefield needs). Tunefield needs **Python 3.10 or newer** — install **3.12 from python.org** (not Apple's built-in — 3.12 is the tested version; newer usually works and the launcher warns if it doesn't).
2. Double-click `Tunefield.command` (macOS), `Tunefield.bat` (Windows), or `Tunefield.sh` (Linux).
3. First launch builds a private environment (needs internet, once). After that it starts instantly and opens in your browser, fully offline.

Everything you create lives in the `data/` folder — copy the folder to a USB stick and the whole app travels with you. Deleted audio goes to `data/_trash/` first, never straight to oblivion.

The five tabs across the top, in workflow order:

| Tab | What it's for |
|---|---|
| **Analyse** | Add music folders, watch them get analysed |
| **Field** | The 3D field — the heart of the app |
| **Playlists** | Manage playlists, compare them side by side |
| **List** | Everything as a sortable table — filters, ratings, tags |
| **Repair** | Library health: find and fix covers, genres, paths, duplicates |

And whenever something breaks or confuses you: **💬 Feedback** (top-right). It shows the diagnostics snapshot it is about to send; **Copy & open form ↗** opens a 30-second Google Form with **your name and those diagnostics already filled in** (they go to your clipboard too, as a backup). All you add is what happened — then submit. (If the form ever won't open, email mark@tunefield.app instead.)

---

## 2. The Analyse tab

This is where music enters Tunefield.

**Point it at a folder**: paste a folder path into the box (or click **📁 Browse…** to pick one). Once the scan lists what it found, choose a **Scan length** — it sits right beside the **Analyse** buttons — how much of each track to analyse, as a share of its own length: **25%**, **50%** or **100%**. Proportional, so a three-minute edit and a twelve-minute mix both get fair coverage. Anything less than the whole track is sampled in blocks spread across the record rather than one continuous window, so a quick scan still hears the intro, the middle and the end.

**Folders belong to Fields.** Every music folder is assigned to a Field — the selector on each folder row shows (and changes) the assignment, and "— all Fields" makes a folder shared everywhere. The panel groups folders under a heading per Field, and the **destination selector in step 1 is the single source of scope** — the folder panel and the scan below always follow the Field you're adding to (plus shared folders). Which Fields you're *viewing* elsewhere doesn't matter here.

**Folders can nest.** Add your big master folder as shared, then assign its sub-folders to specific Fields: every file belongs to its *deepest* containing folder, so an assigned sub-folder carves its files out of the parent's scope and nothing is ever scanned twice. The scan list shows, for every already-analysed file, **every Field it's analysed into**.

**A track can live in as many Fields as you like.** The scan judges "already analysed" against the *destination* Field only: a file that's in another Field shows as **"in X — add here"** and stays selectable, and adding it **copies the existing analysis across instantly** (no second decode) — the copy remembers where it came from. Only files already in the destination are greyed out. **Reassigning a folder from one Field to another asks whether to move its tracks with it** (copied across instantly, removed from the old one), and **removing a folder asks whether to remove its tracks from that Field too** — in both cases catalog records only, audio untouched, undoable from the toast. Say no if you just want the folder out of the list.

A few things worth knowing:

- **Analysis is fully local.** No audio ever leaves your machine. The two optional lookups in Repair are the only features that call out, and only when you click them: **Discogs** sends the artist and title text, and **AcoustID** sends an acoustic fingerprint of the track (a compact summary, not the audio) together with its duration. Everything else — every measurement, every decision — happens on your own computer.
- **Batches are resumable.** The run is driven by the app window, so reloading or closing it stops the batch — but the queue is saved, and reopening Tunefield offers to **Resume interrupted analysis**. **The ANALYSE tab button itself is the progress bar** — it fills as the run advances, the badge shows the percentage, and the small **✕** on it cancels the run. (Repair tasks fill the REPAIR tab button the same way, so two tasks can show at once — visible from every page.)
- **Stems and acapellas classify correctly.** Content labels in filenames or tags — `(Acapella)`, `(Instrumental)`, `Karaoke`, `Vocals Only`, `Drum Stem`, `(Vocal Mix)` and similar — override the vocal-detection heuristic, so an acapella never gets scored as "instrumental" just because of how it measures. Ordinary titles like "Drop the Bass" won't trigger this.
- **Corrupt or very short files fail gracefully** with an error row rather than breaking the batch. Silent tracks report key "unknown" instead of pretending to be C major.

Start with **20–30 tracks you know well**. You'll be judging the field by ear, and that's much easier when you already know what the answers should be.

### Free & Pro

Tunefield's core is free: the 3D field and all its controls, playlists and modes, analysis, ratings and tags. The free tier holds **up to 3 Fields of 500 tracks each** — counted per Field, so filling one leaves the others untouched. Analysis stops at the ceiling and the files it couldn't take are marked **over cap** in the scan list rather than silently retried. **Pro** unlocks unlimited Fields and library size, the **ƒx formula editor** (the built-in formula presets are free for everyone), the ⋈ vector-maths suite (including PCA/t-SNE and the Set builder), the **DJ-software exports** (Rekordbox, Traktor, and the Ableton `.als` — **CSV and M3U8 are free**), the heavy half of Repair (**duplicates and broken paths** — finding and fixing missing covers, artist/title, genres and loudness is free), and Discogs/AcoustID enrichment. Locked buttons stay visible with a small **PRO** badge — clicking one explains rather than failing silently. A licence key goes into **⚙ Settings → Unlock key**; it's checked on your machine, no account, nothing phones home. (The 🙂 tip jar is separate from all of this — nothing is ever locked behind it.)

### Beta check-ins

During the beta, Tunefield occasionally asks a tiny question — six in total, spread across your first hours of actual use (who you are, first impressions, what clicked and what didn't, what's missing). Each takes about fifteen seconds, every one is **skippable**, and the card only appears when nothing would be interrupted — never during Playback or an analysis run. Your answers are stored in your own `data/` folder and **nothing is sent unless you press Review &amp; send**, which shows you exactly what leaves the machine first. One click on **Don't ask again** (or **⚙ Settings → Check-ins → Off**) switches the whole thing off for good.

---

## 3. The Field tab

Every track is a sphere floating in space. **Position, colour and size each represent a metric you choose** — so *you* decide what "close together" means. The field stays fast even with many thousands of tracks: the whole thing draws as a single batched object, so an 8,000-track library renders in a handful of draw operations instead of thousands.

### 3.1 The axes

The **AXES drawer** (slim tab on the field's left edge) holds the dropdowns that set **X / Y / Z / Size / Colour** — click the tab to slide it out, and again to tuck it away — plus the **Views** block and, under it, **Formulas**: a presets &amp; patches picker that re-arranges the field the moment you choose one, and an **ƒx Edit** button that opens the full formula editor in its own window. Its left-edge siblings are **FIELDS** (tick which Fields are in view — this is where you choose what the field shows), **FILTERS** (the track filters), **KEY** (the Camelot wheel). Drawers start closed each time you enter the Field tab. **As many drawers can be open at once as fit** — they stack down the left edge and share the height between them, and each slim tab slides down with its own card, so the tab you clicked stays attached to what it opened. When there genuinely isn't room, the one you opened longest ago folds away to make space, and comes back on its own once there is room again (make the window taller, or turn the drawer size down). ⚙ Settings → **Drawer size** scales them all together, 50–150 %. **Filtered-out tracks** (also in ⚙ Settings, 0–60 %) sets how visible tracks your filters have excluded stay: 0 % hides them completely, which is the default, and raising it leaves them as faint but still-clickable ghosts so you can see what you just excluded. The playlist always stays on screen; **↺ Undo** in the top bar reverses the last destructive thing you did — clearing your path, deleting a playlist, removing tracks from a Field, an edit to the open playlist — and unlike the toasts it has no time limit: hover it to see what it will undo. App-wide options (the user manual, unlock key, usage-data download, import, API keys, appearance, and the wheel's notation — note names, **Camelot** `8B`, or **Open Key** `1d` as used by Mixed In Key and Rekordbox) live behind the **⚙** button in the header, and the **ⓘ** button beside it toggles the tooltips: lit = hints everywhere, dim = a clean, hint-free interface. Available metrics: BPM, Loudness, Danceability, Brightness, **Key (Camelot)** (position 1–12, majors offset +0.5 — put it on X to line the library up by the wheel), Vocals, **Mood** (deliberately coarse — four bands, so it reads as a grouping), Rating, **Released** (release date — put it on X for a timeline of your library), Genre (group), and any tags you've created. As a Colour, Key uses the Camelot wheel hues. (Energy and Valence are gone as axes: energy was renamed **Loudness** when it became a pure loudness reading, and valence turned out to be arithmetic on other metrics — LUFS survives as a List column.)

Fresh installs start at X=BPM, Y=Loudness, Z=Danceability, Colour=Key (Camelot).

**Every axis says which way it runs.** The arrowhead end carries the metric's name plus its high-end word — `fast ▸`, `loud ▸`, `danceable ▸`, `bright ▸`, `newer ▸` — and the opposite end is a small dot with the low-end word (`◂ slow`, `◂ quiet`, `◂ older`…). Key runs `1A → 12B`, Rating `unrated → 5★`, tags `off → on`, and formula axes simply `− → +` — a formula axis labels itself with its ingredient metrics (`ƒz (bpm, ene)`), not the full maths, which lives in the ƒx editor. The labels keep a fixed apparent size no matter how far you zoom, so the field always reads at a glance.



Two quiet rules keep the geometry honest: the field renders at a **constant size** no matter how many tracks it holds (a small collection is sparse in the same frame a huge one fills — it only grows if tracks would occupy more than half the available room), and, once a Field holds 40+ tracks, each axis **folds its extreme 5%** of values into the edge margins so a single outlier track can't squash the whole distribution into a blob (tiny starter libraries stay plain min-max). Outliers stay visible and clickable at the edge.

### 3.2 ƒx Formula axes — programmable space

The formula tools live in the **AXES drawer**: the **presets &amp; patches picker** applies a formula the moment you choose one (free for everyone), and **ƒx Edit** opens the full editor in its own window (Pro). Type maths over the track metrics and the whole field re-arranges to match:

```
x=bpm*5(ene-dnc)  y=dnc^2/(bri/ene)  z=key(grp)*key  size=ene
```

- **Variables** are short names over the raw values (real BPM, real years — normalisation happens *after* your formula, so maths behaves like maths): `bpm ene dnc bri voc rat rel dur key mod grp rough perc onsd puls chfx dyn` (`ene` is the 0–1 loudness reading, `onsd`/`puls` are onsets-per-second and pulse clarity, `chfx` is harmonic movement, `dyn` is dynamic range). A collapsible legend in the panel lists them all.
- **Friendly aliases** work too: `energy`, `dance`, `dynamics`, `brightness`, `vocals`, `rating`, `released`, `year`, `duration`, `group`, `genre`, `mode`, `tempo`.
- **Notation**: implicit multiplication (`bpm(ene-dnc)`), `^` as power, and the usual functions — `sin cos tan sqrt abs log ln exp min max pow floor round sign`.
- **`size=` is a fourth channel.** As well as `x` `y` `z` you can write `size=…`, and node radius follows your maths — normalised like a position axis, so only the ordering matters, not the units. It's the cheapest way to get a fourth quantity into one picture.
- **Axes you don't mention keep their dropdown metric** — write just `x=…` and Y/Z stay as they were.
- **Errors are friendly**: an unknown name gets a clear inline error; undefined results (divide-by-zero, log of a negative) pin that track to the median instead of flinging it into deep space.
- **22 built-in presets** ship in the selector, grouped by what they're for — Harmonic geometry (the Camelot wheel as a literal circle), DJ set-craft (peak-time finder, half-time twins, distance from your set tempo), Mood, Library archaeology (the loudness war drawn from your own shelves), Sonic character and a few wild cards. Pick one to see what the box can do. **Every preset sets `size` too**, each carrying something its three axes don't already show — *Half-time twins*, for instance, folds tempo onto X, so size holds the real BPM and you can tell a 70 from a 140 inside the same stack.
- **Save** stores the current formula as a named **patch** of your own, listed under the presets; **Clear** returns to the dropdown metrics. Built-in presets can't be deleted — saving makes your own copy.

### 3.3 ⋈ Vector maths — the tools that compare fingerprints

When Tunefield analyses a track it writes down numbers — how fast, how loud, how bright, how danceable, how much voice — sixteen measurements per track. Think of it as a **fingerprint**. The 3D field only ever shows three of those numbers at a time; these tools work with the *whole* fingerprint. There's no AI guessing here, no internet, no listening history — just your own library's measurements, compared honestly.

They live in two places. The floating **Set tools** box — opened by the **Set tools** button in the Playlist Builder, Curate mode only — holds **Similar tracks**, the **Set builder** and **Groups by sound**. **Analyse my set** sits on the Playlists page, one button per playlist card. Every option is in the open rather than hidden behind a menu: how many tracks to return, how many groups to split into, the start and end of a set and the shape it should follow.

#### Similar tracks — "find me more like this one"

Click a track so it's selected, press **Find similar**, and you get the closest fingerprints in your library, nearest first — click any result to hear it. Closeness here means the *whole character* matches: tempo, energy, brightness, mood, all at once. The fastest answer to "what could follow this?".

#### Groups by sound — "colour my library into families"

One press sorts everything into groups of tracks that measure alike and paints the field by group. You'll recognise the families instantly even though no genre tag was read to make them — deep rollers here, bright peak-time there, the ambient corner in its own colour. Good for spotting what you own a lot of, and what you barely own at all.

#### Set builder — "design the whole night before you play a note"

You choose where the set **starts**, optionally where it **ends**, **how many tracks** it runs, and — the heart of it — **what shape the energy makes** along the way. Tunefield picks the tracks: every hop stays musically smooth while the set as a whole traces your shape.

1. Select a track, press **Start here**.
2. Optionally select another and press **End here** — with no End marked, the journey lands wherever the music takes it, and pressing **End here** again on the same track clears it. (A set with an End *always* finishes on it.)
3. Set **Tracks** — from a tight 10 up to the **All** button, which orders the entire Field.
4. Pick a **shape** (each curve button is a drawing of its shape) — or press **DRAW** and draw your own.
5. Press **Build set** and read the preview.

**The shapes** — the line is energy; left is your first track, right is your last:

<!-- curves:gallery -->

**Cycle is the wavelength.** Shapes marked *cycle* repeat, and the **Cycle** box says how many tracks make one full wave — Cycle 8 on Waves means one complete breath every eight tracks. Small numbers pulse, big numbers swell. One-shape curves (build, peak, slow burn…) ignore it.

**Flow ↔ Curve is the honesty slider.** Sometimes the track that best fits your shape is a jarring jump from the one before it. Left: every transition as smooth as possible, the shape becomes a gentle suggestion. Right: hit the shape as exactly as the library allows, even if some hops are bold. The middle is a good night out.

**The curve can shape more than energy** — the small dropdown switches it to BPM, Danceability, Brightness, Vocals or your Ratings.

**Drawing a shape (DRAW)** — up to 20 points on a graph: drag each point's level (0–20), type the number of tracks between points; the last number walks back to point 1, closing the loop. Whatever you draw is one full cycle and repeats — your drawing carries its own wavelength, so the Cycle box takes the night off. It's remembered between sessions, and the ✎ button becomes a miniature of your drawing.

**Need to get from A to B?** Mark the Start and End, keep the track count modest, and the Set builder *is* the route tool — every hop the smallest musical jump that still lands on your closer.

**The preview** opens before anything is saved: the dashed line is the shape you asked for, the dots are the tracks found, sitting wherever their real energy puts them. Dots hugging the line = your library can play that story; dots straying = it did its best with what you own — a 17-track Field can only sketch a curve that thousands would trace faithfully. Click any row to hear it, then **Save New Playlist** (keeps it on the shelf) — or grab **⠿ Drag To Playlist**: the whole button is the handle. The preview goes ghost while you drag so the Builder shows through; drop anywhere in its playlist and the entire set inserts at that row, in order, each track individually undoable.

#### Analyse my set

On the Playlists page, the ⌁ button on a playlist card: one press reads that **playlist** back at you — its energy shape as a small bar chart, how big the average jump between tracks is, and where the roughest transition sits.

#### The ⋈ panel: auto axes, arithmetic, weights

- **PCA** — hands the axes to the maths: it finds the three directions your library actually varies along, each labelled with what it's made of (e.g. `−perc +bri −rough` is a texture axis) and how much variation it explains. Put PCA 1/2/3 on X/Y/Z for a view shaped by your collection rather than a metric you picked.
- **t-SNE** — pulls similar tracks into visible clumps, like iron filings finding magnets. It runs in the background with a progress bar and a cancel — a minute or so on a few thousand tracks; big libraries are sampled, and it tells you when that happens.
- **Vector arithmetic** — start from a track and nudge it: `-voc +2rough` means "this, but less vocal and much rougher". The numbers are standard deviations, and the results are the nearest **real** tracks to that imaginary point.
- **Weights** (bottom of the panel) decide what "similar" means to *you* — five faders for tempo, harmony, energy, timbre and vocal. 0 ignores an aspect, 2 doubles it — and every tool on this panel instantly hears the library your way. Two details worth knowing: tempo is compared as *log* tempo, so 124→128 counts the same as 62→64; and key enters as its position on the Camelot wheel, so 12A and 1A are neighbours in the maths exactly as they are on the wheel.

### 3.4 ◎ Focus — always land close

**◎ Focus** (tool ring) is a camera behaviour: with it on, **every selection jumps the view in close** to the newly selected track — the camera flies in along your current view direction and settles just off the node. The field itself never moves or re-arranges. Double-click your way across the library and the view keeps landing right where the action is. **Orbiting away by hand releases Focus** — a manual camera drag means you want your own framing, so the button un-lights and a quiet "Focus released" toast confirms it; tap ◎ to re-arm.

**In Explore, Focus goes further: it engages the Fly camera.** With ◎ on, the same cinematic auto-pilot that Play uses takes the view — it flies to whatever is playing, settles into a slow orbit around it and breathes the zoom in and out, and when Flow (or you) moves to the next track the camera follows. It waits until something is actually playing or selected, so arming it on a silent field does nothing. **Grabbing the view, scrolling, or flying with the keys hands control straight back** and un-lights ◎, exactly as a drag does elsewhere. In Curate, Focus stays the one-shot jump described above; in Play the camera is governed by the **Fly** switch, not by Focus.

### 3.5 ◐ The lens — how flying works

Flying into a tight cluster, the nearest spheres would block everything behind them — so Tunefield always flies you inside a **transparent bubble**: any track that would crowd inside it slides radially outward onto the bubble's surface — all around you, not just ahead — and flows over the glass as you move, settling back exactly where it belongs once you've passed. Dense clouds part around you while everything beyond the bubble stays put. It's a pure display effect: true positions (and every calculation built on them) are untouched, and clicking follows what you see. Everything attached to a track — rings, halos, cover art, the playlist marker, key-relationship lines — rides along with it, so the picture stays coherent; only the pathway tube keeps drawing the true route, because it's the map. There is nothing to switch: this is simply how the field behaves.

### 3.6 The orientation gizmo

A small six-pointed axis cross (±X ±Y ±Z) sits bottom-right, rotating with the camera and labelled with the live axis sources — `bpm/ene/dnc`, or `ƒx/ƒy/ƒz` when formulas are driving. Glance at it whenever you've flown yourself into disorientation.

### 3.7 Mouse

- **Drag** to rotate · **scroll** to zoom · **Reset** (red, top of the toolbar) re-frames everything
- **Click** a node → preview it · **Double-click** → select it (and, in Curate mode, add it)
- **Hold on a node and drag up/down** → scrub through the track
- Hover shows a compact two-line label — artist and title, then **BPM · Key · Genre** — which politely dodges the cluster it would otherwise cover. (The key follows your ⚙ wheel-notation setting, so it reads `6A`, `11m` or `G minor` to match the wheel.)

### 3.8 Keyboard flight


The panels and modes are on keys too: **`1`–`5`** press the tool ring around the Spread dial — `1` Reset, `2` ◎ Focus, `3` ⋈ Vector maths, `4` Covers, `5` Pathway — the same order you read them in on screen — **`Z` `X` `C`** open the Axes / Filters / Key drawers, **`M`** steps through the play modes (Explore → Curate → Play), and **`Y`** toggles FLY.

### 3.9 ✛ A hidden mode

Somewhere in the Field is a first-person flight mode — for those who find it. A certain classic sequence of keys, entered on the Field tab, unlocks it for good; once found, a **✛** button joins the tool ring and **`F`** toggles it. Inside: the mouse steers where you look, WASD flies, and a crosshair becomes your cursor — **click** previews whatever it's on, **Shift+click** or **double-click** selects. **`Esc`** leaves, and leaving never stops the music. (Where the system can't lock the pointer — some embedded windows — hold the mouse button and drag to look instead; picking then follows the visible cursor.) **Flight speed** is adjustable in ⚙ Settings (25–250%): speed always auto-adapts to how close you are to the nearest track, and the setting scales the whole model. Engaging never snaps the view — it picks up exactly where your camera is pointing, and exiting places the orbit pivot in front of you so mouse-orbit feels continuous. This is the most fun way to explore a big library.

### Flow — endless listening in Explore

**Explore is the listening mode**, and it has no Playlist Builder: nothing in Explore writes to a playlist. Instead it has **Flow** — a sequence that never ends, built from your own library, steered by five dials.

- **Roam** — how far each choice travels from the record playing. All the way left it hugs one sound; all the way right it ranges across the library.
- **Familiarity** — records you already know, versus ones you have never played.
- **Key discipline** — from "anything goes" to "every change stays in a compatible key".
- **Energy shape** — eight curves: **steady**, **rising**, **waves**, **wind down**, **peak** (up to the middle, release out of it), **valley** (start high, dig into something quieter, come back), **slow burn** (held back, then it goes) and **steps** (plateaus rather than a ramp).

**Playtime** decides how long the shape takes to run. A peak over twelve records is a different instruction from a peak over eighty — the first climbs and releases inside an hour, the second spends your whole night getting there. The readout shows both figures at once — the track count, which is what the shape actually counts, and roughly how long that is, estimated from the real average length of what is in your field. **All the way right is ∞**: the set has no end, the shape loops, and Flow plays every track in the field once before any of them comes round again. Picking a curve (or changing the length) starts that shape **from here**, so choosing *peak* mid-session means "build to a peak from now", not "resume someone else's peak".

Under the dials, a sentence tells you **what this will do** before you press start, and the five records queued ahead are listed in order, each one a step further along your chosen curve. Nothing is guessing behind your back.

**It learns.** Skipping a track pushes Flow away from that kind of record; letting one play to its end pulls it toward that kind. Over time this becomes your **fingerprint**. It shapes what Flow reaches for next; there is no screen that reads it back to you yet — showing it well is a design problem we would rather solve than fudge, so for now it works quietly in the background.

**Save the dials you like.** Name a setting — "Sunday morning", "3am warehouse" — and it comes back with one click. Fingerprints are just settings, so they carry no music and nothing private.

**Explore keeps no playlist — it keeps a path.** Nothing in Explore writes to an active playlist. Instead, everything you listen to there is traced through the field as a **path**, in order, whether Flow chose it or you did. Under the dials you'll find that path listed newest-first, with:

- **Clear** — forget it and start a fresh wander. It's undoable from the **↺ Undo** button
  in the top bar, and anything you traced since the clear is kept.
- **Export** — opens a short dialog: save the path as a **new playlist** (the name is
  suggested and editable) or **add it to an existing one**.

Exporting deliberately does *not* make the new playlist active: Explore stays unbound, which is the whole point of the mode. The **Playlist Builder is hidden in Explore** and returns in Curate and Play (Play drops its Set-tools row and footer) — Play is for listening, where the field already draws the pathway.

Flow is deliberately not the Set builder. The Set builder **designs a finite set to perform**; Flow **plays endlessly and adapts**. Different jobs, different modes.

### 3.10 Covers and Pathway

- **🎨 Covers** wraps album art onto every sphere. It's instant (a pure visual toggle — it never moves your tracks; every node reserves the same space regardless of style), and art loads on demand for the nearest tracks rather than fetching your whole library.
- **🐍 Pathway** — the route through the active playlist (or, in Explore, your own path) is **always drawn**: a pulsing golden trail, graded with a subtle full-spectrum gradient, a bright marker on the current track. The button is a two-way switch for what the *rest of the field* does around it: **the whole field**, or **only the tracks on the route** and nothing else. There is no middle "dim the others" state — the field fades tracks for exactly one reason, a filter excluded them, and the pathway never competes with that.

### 3.11 The Camelot wheel: filter, modes, and what happens to what you exclude

The key wheel **always filters the field**, and everything around it is arranged as one unit:

- **Touch the wheel = Manual mode.** Click any key and you're instantly in Manual — the mode pads dim and the click toggles that key on your current selection, whatever built it. **Clear** (the hub button in the wheel's centre) empties the whole key selection — your track's key stays outlined as a "you are here" marker, but nothing filters.
- **The mode bank** is four **miniature key-wheel pads** — Safe / Wider / +Mood / All — each printed with the exact pattern it selects, like the algorithm pads on an FM synth. One click selects the mode (centred on your selected track's key); **clicking the active pad again cycles its ring bias**: normal → **dark** (minor keys only) → **light** (major keys only) → normal, shown as a tint overlay.
- **Clear** is the ⊘ button in the middle of the wheel. It clears the *whole* key selection — the current track's key stays outlined as a "you are here" marker but filters nothing. It is independent of **Clear filters**: clearing the filters leaves your keys alone, and clearing the keys leaves your filters alone. **Drawer size** (50–150%) is in ⚙ Settings and scales all the drawers.
- **The tool ring** floats top-centre of the field in a lean capsule, flanking the Spread dial: **Reset** and **◎ Focus** to its left, **⋈ Vector maths**, **Covers** and **Pathway** to its right — circular buttons at the dial's own scale. Each has a tooltip, and each is on a number key **`1`–`5`**. (One more joins the ring for those who find §3.9.) The **Spread dial** itself stretches or squeezes the whole field, **×0.5 to ×3** — drag up/down or scroll, and **double-click to snap back to ×1**. Play mode strips the ring down to the dial itself, and the Playlist Builder now runs the full height of the sidebar. (ƒx formulas live in the AXES drawer, §3.2.)
- **◯ Rings / — Lines / ⊙ Preview** each stand on their own — there's no master switch. **Lines only ever radiate from one origin**: your full-selected track (with nothing selected there are no lines at all). Rings mark the same set at the other end.

  **They show a shortlist, not everything.** In a big library a single track can be harmonically compatible with hundreds of others, and drawing all of them says *everything is an option*, which is the same as saying nothing — while hiding the field behind it. So Tunefield draws the **twelve nearest** compatible tracks, picked one per direction around your origin so they read as routes rather than a cone, and **faded by rank**: the closest is brightest, the twelfth is a whisper. Nearness is measured in the field itself, so the shortlist re-ranks when you change axes — put BPM on X and it becomes "compatible and close in tempo". Flip **⊙ Preview** (or press **V**) and the lines follow whatever track you're *previewing* instead, so you can audition nodes and watch each one's harmonic web live. Double-clicking a new node re-centres the wheel on that track's key.

### 3.12 Building a set: Explore, Curate, Play

Three mode pills sit at the top of the **Playlist Builder** panel:

- **✦ Explore** — browse freely, nothing writes to a playlist *(the default)* — though your flight is auto-saved as an **Explore session** (see [§4](#4-the-playlists-tab)). Your selected track honours the preview window's *start* — each launch begins there, so you can audition a section — then plays on to its natural end (the end marker only cues an advance in Play, §3.13; with no window set, launches start from the very beginning).
- **Appearance** and **Field background** live in ⚙ Settings. Appearance changes the whole interface — **Light** (Bauhaus bone), **Dark** (the original), or **Vintage**: mahogany, brass and aged cream, a lamplit listening-room skin with real wood grain and brushed-brass controls. **Background** stays its own switch and works under any Appearance — it sets the ground behind *every* work surface (the Field canvas and the page behind List, Playlists, Analyse and Repair), and in the Field it also re-weights the track, cluster, key, axis and edge colours so the space reads properly on either ground.
- **Cover art picks itself** — there is no density setting to manage. With 🎨 Covers on, a smaller field (under about a thousand visible tracks) shows every sleeve; above that, art appears around what you're attending to — nearest the camera, your selection, the playing track — re-picked as you move, with a hard cap so the field stays responsive. Tracks with no embedded art simply stay as coloured spheres.
- **Playlists reach across Fields.** If a playlist holds tracks from a Field you aren't currently viewing, those tracks are pulled into the field anyway — otherwise they'd have no node, the pathway would skip them, and Playback's camera would have nothing to fly along. A brief note tells you when it happens.
- **Play modes**: **straight through** (play the list once and stop), **repeat all** (loop the list), **repeat one** (loop the current track), and **shuffle** (random order, but every track once before any repeats). The choice is remembered between sessions.
- **⏺ Curate** — double-clicking a track adds it to the active playlist, inserted **right after the current playback point** rather than dumped at the end — build a set by inserting where you are. Consecutive adds chain forward and the pathway re-renders per insertion.
- **▶ Play** — plays the playlist in order while the camera flies the route (§3.13).

**The preview window** lives on the transport's **dial** — the ring around the play button, divided into **24 segments**, each 1/24 of the track (12 o'clock = the start). **Click a segment to switch it on or off; drag to paint several at once** — a drag flips the range to whatever the first segment flipped to, and never moves the selection. **Double-click a segment to isolate it** — the window collapses to just that segment, and normal toggling resumes from there. The lit segments are your window: it always stays one contiguous block, and **switching everything off returns to the full track**. The segments are the editor — the thin outer arc mirrors the active window on the ring (a previously saved finer-grained range still shows there exactly, while the segments show its nearest 1/24 approximation). The inner coloured arc is the live position, and **clicking the inner disc seeks** to that point in the track. In Explore and Curate a track simply plays past the end marker to its natural end. **In Play, crossing the marker is the cue to advance to the next track** — and with no window set (all segments off), every track plays full-length and the advance happens at its natural end. At the capsule's right end sits the **volume dial** — the same ring language as the field's Spread dial: **drag up/down** (or scroll) for level, **click to mute** and click again to return to where you were; the level survives restarts, and the anti-click fades always land back on it.

Every *launch* — first play, clicking a track, skipping, an auto-advance — starts inside the preview window, in every mode, whether or not the track is the current one. The only way to hear a track from the very beginning is to switch all the segments off.

**In the builder**: drag rows by the grip handle on the left to reorder (saved immediately, pathway follows), and **↶ Undo** steps back through every add, delete, and reorder — each edit is snapshotted server-side, and repeated Undo genuinely walks back through history.

### 3.13 Cinematic Playback and Fly

Switching to Play strips the chrome — toolbar, filters, wheel, legend — down to the Spread dial, the transport, and the Playlist Builder (so you can still see the queue and leave). The pathway turns on, only its tracks show, covers are always on in Play (your Explore/Explore/Curate preference is remembered and restored on exit), all filters are suspended, and the camera flies itself: descending into a low orbit over the playing node, circling slowly, then travelling the pathway to the next node when the track advances — travel speed scales with the gap and eases in and out.

**Fly** (green button, top-left of the canvas, paired with the red **Reset**) masters the auto-camera. Grab the view — mouse, WASD, or FPS — and the camera is yours; click **Fly** to hand it back and resume the flyby from the current node. In Playback the Spread slider becomes a **zoom** (~0.3× out to ~7× in): pull back to see the whole route or push right up onto a track's cover art.

Playback leaves no fingerprints: your Pathway/Fly/filter preferences are all restored the moment you leave.

---

## 4. The Playlists tab

Every playlist as a card: view, duplicate, compare side by side, and copy tracks between playlists.

- **Deleting is undoable.** Delete soft-deletes to a server-side trash and shows an **Undo** toast (8 seconds) that restores everything — tracks, order, anchor, snapshot history. No scary confirm needed.
- **Undo goes back a long way.** Every add, delete and reorder is recorded server-side; **↶ Undo** steps back to the last state that actually differs, and pressing it repeatedly keeps walking back through the session. The **Snapshots pane** on this tab lists the history, and ↶ Undo walks back through it.
- **Locking** protects a finished playlist from edits — locked playlists refuse changes rather than silently losing tracks.
- Playlists drive the field: the active playlist is what the 🐍 Pathway draws and what ▶ Play plays.
- **Explore sessions** — every Explore-mode flight quietly records the tracks you committed to as a session (the last 20 are kept). The **Explore sessions** list on this tab lets you rename or delete them, and **promote one to a real playlist** — either *full* (every commit, repeats kept: the honest flight log) or *unique* (each track once). Great for "what was that run I did last Tuesday?".

---

## 5. The List tab

The tracks of whichever Fields you tick in the toolbar's **Fields ▾** menu, as one sortable table — the spreadsheet view of your field. Ticks in that menu are **staged**: change as many as you like (All / None included) and nothing reloads until you press **Apply** — closing by clicking elsewhere applies too, and if you didn't actually change anything, nothing reloads at all. (The FIELDS drawer on the Field tab stays live per tick, as before.)

**Columns** (click a header to sort; **drag a header onto another to reorder** — the order sticks; drag widths; show/hide via the column picker): #, cover (click it to preview), Artist, Title, ★ rating, Tags, BPM, Key, Mood, Genre, Dance, Loudness, LUFS, Vocals, Length, Format, Bitrate, Check, Analysed. **Key** follows your chosen notation — `8A`, `1d`, or `Dm` — and **Mood** is a colour dot (the name is in its tooltip; each mood *filter* pill wears the same colour, so dot and filter map by eye). Wide tables scroll inside their own container rather than stretching the page.

**The filter panel folds sideways**: the chevron by *Filters* collapses the whole sidebar to a slim rail so the table takes the width — the active-filter count stays on the rail, so a collapsed panel can never hide that something is filtering.

- **Check** — tempo confidence as a traffic light: **red** = low (the file's tag and the analysis disagree — worth a listen), **blue** = no pulse to read at all, **yellow** = medium (including untagged tracks where the pulse was weak), **green** = high (including anything you've confirmed by hand). The dot's tooltip carries the reason and the underlying score, and sorting still uses the real score — reds in exact order first, blues grouped after them. Check the top of the list and stop when it turns green.

- **Ratings** — click the ★ column to rate 0–5. Ratings are usable as a field metric (axis, colour, size) and in formulas (`rat`).
- **Tags** — create your own tags and apply them per track. Each tag becomes an on/off metric in the Field's axis dropdowns (`Tag: <name>`), so you can literally give "peak time" its own axis.
- **Filters** — search, mood, mode (major/minor), vocals, and range sliders for the numeric metrics, plus genre filters with user-definable genre *groups*. Slider extremes mean "no limit", so nothing silently vanishes outside a default range. **Clear filters** resets everything.
- **Add to playlist** — right-click any row and pick a playlist from the menu (a 🔒 marks locked playlists, which won't take adds; the dot marks the one loaded in the Builder). The Playlist Builder panel itself lives on the Field tab — the List sidebar keeps just the filters.
- **Export / Import** — **↓ Export ▾** lives in the page header next to Feedback, available from every tab (see [§8](#8-exporting--rekordbox-ableton-and-friends)); **↑ Import** (⚙ Settings → Data) brings in ratings and tags from Rekordbox, Apple Music, or M3U playlists.
- Row delete asks for confirmation, and deleted entries go to the trash, not straight to deletion.
- The filters live in the sidebar with the key wheel. Click the **Filters** header to fold the whole block away — filters and wheel together — when you want the table to breathe. The active-filter count stays on the header, so you always know whether something is still filtering.

---

## 6. The Repair tab

Field health. The **Fields ▾** menu in the toolbar picks which Fields the scan covers; **🩺 Scan health** then checks every entry and groups the findings into cards:

| Card | What it means | Fix offered |
|---|---|---|
| ⚠️ Broken file paths | Entry points at a file that no longer exists | Delete orphan entries, or relink |
| 🖼 Missing cover art | No embedded art, no folder cover.jpg | The three-rung ladder (below) |
| 🪪 Missing artist / title | Tags never extracted | Backfill from files; per-track 🔎 Discogs lookup |
| 🏷 Missing genre | No genre tag | Extract genres; per-track 🔎 Discogs lookup |
| 🔊 Missing LUFS loudness | Analysed before LUFS existed | Rescan all |
| ❌ Failed / partial analysis | BPM=0 or duration=0 | Rescan all |
| 🔀 Catalog name ↔ tag mismatch | ID3 tags disagree with the name Tunefield stores | Auto-apply tags to catalog names (undoable) — **files on disk are never renamed** |
| 👯 Duplicates (by file / by title) | Same track catalogued more than once | Auto-delete duplicates (keep best) |
| 🎼 Unrecognised musical key | Key root outside the standard 12-note set | None — an analysis quirk, listed so you can see it |

**Covers are a three-rung ladder**, each rung filling only what the rung above left empty: **Extract covers** pulls the art embedded in your files; **Fetch missing covers online** asks Discogs for tracks whose files carry no art (throttled, fill-only, never overwrites); and **Generate key-colour covers** draws a cover from the track's key colour, artist and title for whatever Discogs doesn't know either — so every track can end up with a sleeve.

Per-row buttons let you fix, 🔎 look up, or 🚫 **ignore** individual issues (ignored issues stay out of future scans until you clear the ignored list). The optional Discogs/AcoustID lookups are the only Repair features that use the internet, and only when you click them.

> ### ⚠️ Caution: delete and dedup actions permanently remove catalog entries
>
> **"Delete all orphan entries"** and **"Auto-delete duplicates (keep best)…"** genuinely remove entries from your catalog — analysis data, rating, and tags for those entries go with them. The safety nets are real but not infinite:
>
> - Dedup always shows a **dry-run preview** of exactly what would be deleted, and you confirm before anything runs.
> - An **Undo toast** is offered immediately after, and removed entries are kept in the app's trash **for a while** — not forever.
> - Orphan deletion is scoped to the Fields ticked in the Fields ▾ menu, and **refuses to run when a library drive is unreachable** (an unmounted USB drive is not the same as deleted files — entries on unreachable volumes are protected, and you're asked before the rest proceed).
> - Deleting an entry never trashes an audio file still referenced by another catalog.
>
> Even so: **read the preview before you confirm**, especially with a portable library. If an external drive should be mounted and isn't, mount it and re-scan first.

---

## 7. Keyboard & FPS reference

This table matches the in-app overlay — press **`?`** any time on the Field tab.

**Fly the tunefield**

| Key | Action |
|---|---|
| `W` `S` | forward / back |
| `A` `D` | strafe left / right |
| `Q` `E` | rise / sink |
| `Shift` | hold to sprint (×3) |

**First-person mode** *(once unlocked — see §3.9)*

| Key | Action |
|---|---|
| `F` | enter / leave FPS mode (or the ✛ FPS button) |
| mouse | look around — the crosshair is your cursor. Where the window won't hand over the pointer (the packaged app is one), Tunefield says so and switches to **hold a mouse button and drag** to look, with your ordinary cursor doing the pointing |
| click | preview what you are pointing at — the crosshair, or the cursor in drag-look |
| `Shift`+click | select / add it (double-click too) |
| `Esc` | leave FPS mode (music keeps playing) |

**Pick tracks**

| Key | Action |
|---|---|
| `←` `↑` `→` `↓` | hop to the next track in that direction |
| `Enter` | preview it (like a click) |
| `Shift`+`Enter` | select / add it (like a double-click) — `Enter` twice does the same |

**Tools, drawers & modes**

| Key | Action |
|---|---|
| `1`–`5` | the tool ring, left to right: `1` Reset · `2` ◎ Focus · `3` ⋈ Vector maths · `4` Covers · `5` Pathway (toggles: route only ⇄ whole field) |
| `Z` `X` `C` | open / close the Axes, Filters and Key drawers |
| `M` | step through the play modes (Explore → Curate → Play) |
| `Y` | toggle FLY |
| `V` | Rings/Lines follow the *previewed* track instead of the selected one |

**Play**

| Key | Action |
|---|---|
| `Space` | play / pause |
| `Esc` | back to the selected track, or stop |
| `?` | show / hide this list |

Keys never fire while you're typing in a search box or dragging a slider. Flying in Play hands the camera over from the cinematic Fly mode — click **Fly** to give it back. Holding a key never machine-guns its action, and keys held when a dialog opens stop driving the camera immediately.

---

## 7b. Supporting the project

A 🙂 support button sits next to the gear once a tip jar is configured — Tunefield is free
and stays free, and a tip jar is voluntary, completely separate from Pro, with nothing ever
locked behind it. It is switched off in the beta, so you won't see the button yet.

## 8. Exporting — Rekordbox, Ableton and friends

The **↓ Export ▾** menu (page header, next to 💬 Feedback — available from every tab) offers:

The menu opens with a **Source** choice — **Filtered Field** or **Active playlist** — which decides what the playlist formats contain (CSV alone always exports everything).

Every export saves through the system **save panel**, defaulting to your **Downloads** folder with the filename pre-filled.

| Menu item | What it does |
|---|---|
| **CSV — all metadata** | The full library's analysis data as a `.csv` (ignores filters and playlist selection) — for spreadsheets and your own tooling |
| **M3U8 — absolute paths** | Standard playlist file with full file paths — for players on this machine |
| **M3U8 — relative (filenames)** | Filenames only — place the file alongside your audio and it works anywhere |
| **Rekordbox — bridge (auto)** *(Pro)* | The recommended Rekordbox route — see below |
| **Rekordbox — collection** *(Pro)* ⚠ experimental | Writes directly into Rekordbox's database (only shown when the optional `pyrekordbox` package is installed) |
| **Rekordbox XML — download** *(Pro)* | Classic one-off XML download — for taking a playlist to another machine |
| **Ableton Live Set** *(Pro)* | A ready-to-open `.als` — two alternating deck tracks, one scene per track (named with position, BPM and key), every clip warped to its detected BPM, and the scene tempo following your set's journey. Opens in **any** Live edition (Intro / Lite / Standard / Suite). Audio is referenced in place — tracks on an unplugged drive show as offline media and relink when it mounts |
| **Traktor NML** *(Pro)* | Drop into Traktor's Playlists folder, or import via Traktor's File menu |

### The Rekordbox bridge (recommended)

All exported playlists accumulate in **one fixed XML file** (`~/Music/Tunefield/tunefield.xml`) that Rekordbox watches. Set it up once — click **setup** next to the menu item for the in-app card with a copyable path:

1. **Rekordbox → Preferences → Advanced → Database** — under "rekordbox xml", set **Imported Library** to the file above.
2. **View → Layout** — tick **rekordbox xml** so the sidebar section shows.

After that, every export just appears in Rekordbox's xml sidebar: right-click → **Import Playlist**. Re-exporting a playlist updates it in place. The bridge is **read-only for Rekordbox** — your collection database is never touched.

*(For USB sticks and CDJs, do the final "Export to device" step from Rekordbox itself — that part isn't something Tunefield can do.)*

### The collection export (experimental)

**Rekordbox — collection** writes the playlist directly into Rekordbox 6/7's `master.db`, so it appears natively in the Playlists tree on next launch, no import step. Because it touches the real database, it's belt-and-braces: it refuses to run while Rekordbox is open, takes an automatic timestamped backup of `master.db` and `masterPlaylists6.xml` (last 10 kept, restore instructions in the dialog), deduplicates collection tracks by file path, and gives name-clashing playlists a "(2)" suffix instead of overwriting. Quit Rekordbox completely (⌘Q) before running it.

---

## 9. Troubleshooting / FAQ

**Nothing opens / terminal errors on first run.** Python probably isn't installed — see QUICKSTART §1 (ffmpeg is *not* needed; Tunefield reads audio and tags itself). The launcher window shows the actual error; a screenshot of it is the perfect feedback report.

**macOS blocks the launcher ("unidentified developer").** On macOS 15 Sequoia and newer, right-click → Open no longer works: double-click it, dismiss the warning, then **System Settings → Privacy & Security → Open Anyway**, and open it again. On macOS 14 Sonoma and older, right-click `Tunefield.command` → **Open** → **Open**. Either way, only needed once. (The notarized `Tunefield.app` builds open with a plain double-click.)

**A track fails to analyse.** Corrupt or very short files are expected to fail cleanly; anything else isn't — note the format and send the filename via 💬 Feedback.

**The BPM is half or double what it should be.** Tempo detection sometimes lands on the wrong multiple — most often a triplet feel, less often the octave. Fix it in one click on the track card: **÷2, ×⅔, ×1½ and ×2** sit under the BPM, with a reset. Corrections are stored separately from the analysis, so re-scanning never wipes them. (Where a file ships its own BPM tag, that is used in the first place — distributors are right more often than detection.)

**The key looks wrong.** Key detection's classic confusions are the fifth, the relative major/minor, and near-tie mode flips. Correct it on the track card: **‹ ›** step a semitone, **maj↔min** flips the mode, **rel** swaps to the relative key, plus a reset — stored like tempo corrections, surviving re-analysis, applied everywhere including exports. Silent or near-silent tracks report "unknown" rather than guessing.

**My acapella / stem is classified wrong.** Put a label in the filename or tags — `(Acapella)`, `(Instrumental)`, `Vocals Only`, … — and the declaration overrides detection.


**Filtered-out tracks are hidden.** A filter takes them off the screen, and while they are off the screen they cannot be hovered, clicked or hopped to. If you would rather still see them, **⚙ Settings → Filtered-out tracks** raises them to a faint ghost at whatever strength you pick — and at any setting above 0% those ghosts preview and select normally. The one exception is pathway SOLO, where off-route tracks are gone whatever the setting says.

**"Running on port 5051" toast.** Another program (or a second Tunefield) was already using port 5050, so the app started on the next free port and told you loudly. Everything works normally — but browser-stored cosmetics (column widths, toggles) are per-port, so if things look reset, that's why. Close the other program and relaunch to get 5050 back.

**The app feels stuck.** Try **⟳ Refresh** in the top bar (or ⌘R / Ctrl+R). Note that this *stops* a running analysis — it asks first, and the remaining tracks are offered back as **Resume interrupted analysis** next time you open Tunefield.

**I deleted something I shouldn't have.** Playlist deletion has an 8-second Undo; Repair deletions offer an Undo toast; deleted audio files move to `data/_trash/YYYYMMDD/` rather than being unlinked. Check there before panicking.

**My ratings/tags/layout vanished in a different browser.** Ratings, tags and saved views are stored in the app's own `data/` folder and follow you across browsers, profiles and ports. Only cosmetic state — column widths, panel toggles — is per-browser.

**Where are my API keys stored?** Discogs/AcoustID keys sit in `data/config.json` in plain text (they're never sent to the browser). Keychain integration is planned.

**Start over cleanly.** Quit, delete the `data/` folder, relaunch.

---

## 10. Appendix: what the metrics mean

A honest note up front: BPM and key come from the file's own tags where they exist, and signal analysis where they don't, and are usually right (see the FAQ for the known failure modes — and for the one-click corrections when they miss). Loudness is a real measurement; **danceability, brightness and vocals are heuristic scores** — rough estimates good for *arranging* music in space, not gospel. If a score contradicts your ears, trust your ears (and send feedback).

**BPM** — the track's tempo in beats per minute. Where the file ships its own BPM tag that is used (obviously wrong tags are ignored); otherwise it's detected from the audio — half-time misreads are rescued upward when the track's own pulse supports a faster tempo (so fast genres can read up to ~240 BPM, and slow material down to ~40), and only otherwise folded into a 70–180 band. It's the most load-bearing number for DJs, which is why it's the default X axis: left-to-right becomes slow-to-fast. Halftime genres can land at half or double the "felt" tempo — the correction buttons on the track card fix that in one click.

**Key (Camelot)** — the detected musical key, shown in Camelot wheel notation: a number 1–12 plus **A** (minor) or **B** (major). Adjacent numbers, and the A/B pair on the same number, mix harmonically — which is exactly what the wheel's compat modes and the Rings/Lines visuals show. In formulas, `key` gives the number (with +0.5 for major) and `mod` gives minor=1/major=0.

Key is detected with **key profiles built from electronic dance music** (Faraldo et al., 2016) rather than the classical-music profiles most software still uses — measured on a 615-track Beatport benchmark and on real tagged libraries, that is worth around three points of accuracy on each. It is the difference between a detector tuned for Chopin and one tuned for the records you actually play. Tunefield also measures how far each record sits from concert pitch — vinyl rips, tape transfers and 432 Hz releases all drift off A440 — and when it genuinely cannot tell, it says so instead of guessing.

No key detector is right every time, on any software. Where Tunefield differs is that it tells you **how sure it is**: a key it is confident about stands clear of every unrelated key, and one it isn't is worth ten seconds of listening before you trust it. Near-relations are deliberately not counted against it — a track that reads A minor but could be C major mixes happily with both, so that ambiguity isn't a failure worth flagging.

**Loudness** — a 0–1 reading derived from the track's integrated LUFS on a curve that can't saturate. It measures level, nothing else: 50% is about as loud as a streaming-normalised release, and nothing reaches 100% — the loudest master measured lands around 87%. The default Y axis. (This used to be called "Energy"; it was renamed when it became a pure loudness reading.)

**Mood** — one of four deliberately coarse bands: **euphoric** (loud + positive), **intense** (loud + dark), **upbeat** (gentle + positive), **melancholic** (gentle + dark). The positive/dark half comes from an internal heuristic over mode, brightness and tempo — treat it as a grouping, not a verdict. Usable as a colour, a filter, and a (four-band) axis.

**Danceability** — a 0–1 score for how much the rhythm invites movement: a danceable tempo, bass presence, and a clear repeating pulse. A steady four-to-the-floor scores high; rubato jazz or beatless ambient scores low. It is not a quality judgment — plenty of great music is undanceable on purpose.

**LUFS** — the track's integrated loudness in LUFS, the broadcast-standard measure of perceived loudness. It's a negative number: closer to 0 is louder (a brickwalled master might hit −6; a dynamic recording −18). It lives as a List column rather than an axis — an absolute unit is what you want for gain staging, while the 0–1 Loudness reading above orders tracks identically for plotting.

**Brightness** — a 0–1 score for spectral tilt: how much of the track's energy lives in the high frequencies. Crisp hi-hats and airy pads score high; sub-heavy, muffled or lo-fi material scores low. Handy for matching tonal character across a transition.

**Roughness** — a 0–1 score for *sensory* roughness: how much the sound beats and grinds, measured from the fast wobble in the track's own level (not "noisiness", and deliberately independent of Brightness). Organ clusters, distortion and chiptune score high; clean ballads and solo piano score low. It's a formula variable (`rough`), a List filter, and part of what "similar" means.

**Vocals** — a 0–1 score for detected voice presence, from fully instrumental to vocal-led. Filename/tag declarations (`(Acapella)`, `(Instrumental)`, …) override the detection, so labelled stems are always classified correctly.

**Released** — when the track came out, shown as a year. It prefers the audio file's own year/date tag; a bare year is pinned to mid-year so it sorts sensibly between fully-dated releases; failing any tag, it falls back to the file's creation date, then the analysis date. Put it on an axis for an instant timeline of your library — or use `rel` in a formula to weight the field by era.

---

*Something in here wrong, unclear, or missing? That's exactly what **💬 Feedback** is for.*
