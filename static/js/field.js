// The 3D Field, lifted from the pilot (index.html @ 7c8c0e7) by scripts, function names kept.
// "// pilot N" marks each statement's source line. Handover §7, §9.

// Owned by modules not written yet (list, playlists, transport, repair); no-ops until they land.
function adoptPlaylistStrays() {}
function audioPlayById() {}
function matrixCommitIdx() {}
function renderCatalog() { window.listRenderCatalog?.(); }   // the List tab owns the table
function renderRepair() {}
function returnToAnchor() {}
function setMode() {}
function syncTransportPos() {}

// pilot 5641
const MOOD_COLOR = { euphoric:'#ffd700', intense:'#ff4444', upbeat:'#44dd88', melancholic:'#4488ff' };
// pilot 5648
let _genreColorCache = null, _genreColorSig = '';
// pilot 5649
function _genreColorMap() {
  const list = listGenres();                       // distinct genres, sorted (stable order)
  const sig  = list.join('');
  if (sig === _genreColorSig && _genreColorCache) return _genreColorCache;
  const n = list.length || 1, m = new Map();
  list.forEach((g, i) => {
    const hue   = Math.round((i / n) * 360);
    const sat   = i % 2 ? 62 : 80;
    const light = i % 3 === 0 ? 60 : (i % 3 === 1 ? 50 : 68);
    m.set(g.toLowerCase(), `hsl(${hue}, ${sat}%, ${light}%)`);
  });
  _genreColorCache = m; _genreColorSig = sig;
  return m;
}
// pilot 5663
function genreColor(g) {
  const s = (g || '').trim().toLowerCase();
  if (!s) return '#444';
  const m = _genreColorMap();
  if (m.has(s)) return m.get(s);
  // Genre not in the catalog's list (shouldn't normally happen) — stable hashed fallback
  // onto one of the assigned colours so it still renders deterministically.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const vals = [...m.values()];
  return vals.length ? vals[Math.abs(h) % vals.length] : '#888';
}
// pilot 5675
function listGenres() {
  const set = new Set();
  catalog.forEach(e => { const g = (e.genre || '').trim(); if (g) set.add(g); });
  return [...set].sort();
}
// pilot 5680
function genreIndex(g) {
  const list = listGenres();
  const i = list.indexOf((g || '').trim());
  return i < 0 ? -1 : i;
}
// pilot 5749
let catalog        = [];
// pilot 5757
let activeFilters  = {
  moods:new Set(), modes:new Set(), vocals:'',
  bpmMin:60,    bpmMax:200,
  danceMin:0,   danceMax:100,
  energyMin:0,  energyMax:100,
  durMin:0,     durMax:900,
  relMin:1950,  relMax:2027,   // release period (years); full span = no filter
  keys:new Set(), tags:new Set(),
  genres:new Set(),            // selected genre keys (lowercase trimmed catalog values)
};
// pilot 5772
const DEFAULT_GENRE_GROUPS = [
  { name:'Dance',      keywords:['house','techno','garage','dnb','drum','bass','electro','dance','hardcore','breakbeat','jungle'] },
  { name:'Rock',       keywords:['rock','metal','punk','grunge'] },
  { name:'Indie',      keywords:['indie','alt'] },
  { name:'Pop',        keywords:['pop'] },
  { name:'Electronic', keywords:['electronic','edm','ambient','idm','downtempo','trance','synthwave','techno','minimal'] },
  { name:'Hip-Hop',    keywords:['hip','hop','rap','trap','grime'] },
  { name:'Jazz',       keywords:['jazz','blues','soul','funk'] },
];
// pilot 5781
function loadGenreGroups() {
  try {
    const saved = JSON.parse(localStorage.getItem('genre-groups') || 'null');
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_GENRE_GROUPS.slice();
  } catch (_) { return DEFAULT_GENRE_GROUPS.slice(); }
}
// pilot 5790
function genreGroupMembers(group) {
  // Returns the subset of currently-cataloged genres (lowercased) that belong to this group.
  const kws = (group.keywords || []).map(k => k.toLowerCase());
  return listGenres().filter(g => {
    const gl = g.toLowerCase();
    return kws.some(k => gl.includes(k));
  });
}
// pilot 5865
const RATINGS = (() => {
  try { return JSON.parse(localStorage.getItem('track-ratings')) || {}; }
  catch { return {}; }
})();
// pilot 5878
function getRating(id) { return RATINGS[id] || 0; }
// pilot 5904
let allTags = (() => { try { const v = JSON.parse(localStorage.getItem('all-tags')) || []; return Array.isArray(v) ? v : []; } catch { return []; } })();
// pilot 5905
let trackTags = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem('track-tags')) || {};
    const out = {};
    Object.entries(raw).forEach(([k,v]) => { out[k] = new Set(v); });
    return out;
  } catch { return {}; }
})();
// pilot 5920
function getTrackTags(id) { return trackTags[id] || new Set(); }
// pilot 5931
const _annoQ = {};
// pilot 5932
let _annoT = null;
// pilot 5933
function annoPush(section) {
  _annoQ[section] = true;
  clearTimeout(_annoT);
  _annoT = setTimeout(_annoFlush, 1500);
}
// pilot 5938
function _annoSnapshot() {
  const body = {};
  if (_annoQ.ratings)    body.ratings = { ...RATINGS };
  if (_annoQ.tags)       body.tags = Object.fromEntries(allTags.map(t => [t.id, { name: t.name, color: t.color }]));
  if (_annoQ.track_tags) { const raw = {}; Object.entries(trackTags).forEach(([k, v]) => { if (v.size) raw[k] = [...v]; }); body.track_tags = raw; }
  if (_annoQ.views)      body.views = _viewsLoad();
  return body;
}
// pilot 5946
function _annoFlush() {
  clearTimeout(_annoT); _annoT = null;
  const body = _annoSnapshot();
  if (!Object.keys(body).length) return;
  Object.keys(_annoQ).forEach(k => delete _annoQ[k]);
  const json = JSON.stringify(body);
  if (!(navigator.sendBeacon && navigator.sendBeacon('/annotations',
        new Blob([json], { type: 'application/json' })))) {
    fetch('/annotations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: json, keepalive: true }).catch(() => {});
  }
}
// pilot 5958
window.addEventListener('beforeunload', _annoFlush);
// pilot 5961
window.addEventListener('pagehide', _annoFlush);
// pilot 6073
let allCatalogs    = [];        // [{name, slug, count}]
// pilot 6074
let activeCatalog  = null;      // slug for uploads + delete target
// pilot 6075
let viewedCatalogs = new Set(); // slugs shown in table/matrix
// pilot 6076
const CAT_COLORS   = ['#7c6cff','#ff8844','#44dd88','#ff4488','#44ccff','#ffd700','#aa88ff','#ff6644'];
// pilot 6077
function catalogColor(slug) {
  const i = allCatalogs.findIndex(c => c.slug === slug);
  return CAT_COLORS[Math.max(0,i) % CAT_COLORS.length];
}
// pilot 6086
const CAMELOT = [
  {pos:1,  A:{note:'G#',label:'G#'},  B:{note:'B', label:'B' }},
  {pos:2,  A:{note:'D#',label:'D#'},  B:{note:'F#',label:'F#'}},
  {pos:3,  A:{note:'A#',label:'A#'},  B:{note:'C#',label:'C#'}},
  {pos:4,  A:{note:'F', label:'F' },  B:{note:'G#',label:'G#'}},
  {pos:5,  A:{note:'C', label:'C' },  B:{note:'D#',label:'D#'}},
  {pos:6,  A:{note:'G', label:'G' },  B:{note:'A#',label:'A#'}},
  {pos:7,  A:{note:'D', label:'D' },  B:{note:'F', label:'F' }},
  {pos:8,  A:{note:'A', label:'A' },  B:{note:'C', label:'C' }},
  {pos:9,  A:{note:'E', label:'E' },  B:{note:'G', label:'G' }},
  {pos:10, A:{note:'B', label:'B' },  B:{note:'D', label:'D' }},
  {pos:11, A:{note:'F#',label:'F#'},  B:{note:'A', label:'A' }},
  {pos:12, A:{note:'C#',label:'C#'},  B:{note:'E', label:'E' }},
];
// pilot 6104
function camelotToOpenKey(cam) {
  const m = /^(\d{1,2})([AB])$/.exec(String(cam || '').trim());
  if (!m) return '';
  return `${((+m[1] - 8 + 12) % 12) + 1}${m[2] === 'A' ? 'm' : 'd'}`;
}
// pilot 6111
const NOTE_TO_CAMELOT = {};
// pilot 6112
CAMELOT.forEach(c => {
  (NOTE_TO_CAMELOT[c.A.note] ??= {}).minor = `${c.pos}A`;
  (NOTE_TO_CAMELOT[c.B.note] ??= {}).major = `${c.pos}B`;
});
// pilot 6116
function noteToCamelot(note, mode) { return NOTE_TO_CAMELOT[note]?.[mode] || null; }
// pilot 7444
async function loadCatalogMeta() {
  let meta;
  try {
    const res = await fetch('/catalogs');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    meta = await res.json();
  } catch (e) {
    showToast('Could not load Fields: ' + (e.message || e));
    return;
  }
  allCatalogs = meta;
  // Restore the user's previously-active library from localStorage if it still exists.
  // Falls back to the first library only when there's no saved choice (or it was deleted).
  if (!activeCatalog || !allCatalogs.find(c => c.slug === activeCatalog)) {
    const savedActive = localStorage.getItem('active-catalog');
    const savedExists = savedActive && allCatalogs.find(c => c.slug === savedActive);
    activeCatalog = savedExists ? savedActive : (allCatalogs[0]?.slug || null);
    // Restore the viewed-catalogs chip selection. A deliberately-saved EMPTY selection
    // (deselect-all is a valid view) is honoured; only a missing/garbage value falls
    // back to the active catalog.
    try {
      const raw = localStorage.getItem('viewed-catalogs');
      const savedViewed = raw !== null ? JSON.parse(raw) : null;
      if (Array.isArray(savedViewed)) {
        const kept = savedViewed.filter(s => allCatalogs.find(c => c.slug === s));
        // A deliberately-saved EMPTY selection stays honoured — but a NON-empty saved
        // selection whose Fields have all since been deleted/renamed is stale, not a
        // choice: booting every tab into "no Fields selected" with no chip row to
        // notice it on would just read as data loss (review, 2026-08-25).
        viewedCatalogs = (savedViewed.length > 0 && kept.length === 0)
          ? new Set(activeCatalog ? [activeCatalog] : [])
          : new Set(kept);
      } else {
        viewedCatalogs = new Set(activeCatalog ? [activeCatalog] : []);
      }
    } catch (_) {
      viewedCatalogs = new Set(activeCatalog ? [activeCatalog] : []);
    }
  }
  renderCatSelector();
  renderCombineChips();
  // The Add Music panel renders once when /library/roots returns — which is BEFORE this
  // function has restored viewedCatalogs (roots is the cheaper endpoint, so it always
  // wins the race). On a browser profile with virgin localStorage that left the panel
  // showing "No Fields selected" over a correctly-selected Default, with the user's
  // folders buried under "Other Fields' folders" — every reload, until any tab click
  // repainted it (M2 report P7). Re-render now that the selection actually exists.
  window.renderLibRoots?.();
}
// pilot 7548
async function loadCatalog() {
  if (!activeCatalog) { catalog = []; applyFilters(); return; }
  const slugs = [...viewedCatalogs];
  let results;
  try {
    results = await Promise.all(slugs.map(async slug => {
      const res = await fetch(`/catalog?cat=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const entries = await res.json();
      entries.forEach(e => { e._cat = slug; });
      return entries;
    }));
  } catch (e) {
    showToast('Could not load tracks: ' + (e.message || e));
    return;
  }
  const seen = new Set();
  catalog = [];
  results.flat().forEach(e => { if (!seen.has(e.id)) { seen.add(e.id); catalog.push(e); } });
  // Changing the field chips rebuilds `catalog` from scratch, which would drop any track
  // adopted for the active playlist — so re-adopt here, BEFORE the signature below, or the
  // rebuild check wouldn't see them and the field would be built without their nodes.
  if (typeof adoptPlaylistStrays === 'function') { try { await adoptPlaylistStrays(); } catch (_) {} }
  // The 3D field's meshes are built FROM this array. Every Field tab entry re-fetches
  // the catalog (the .then chain in switchTab), so flag dirty ONLY when the content
  // actually changed — cheap rolling hash over id+analyzed_at+genre. Unchanged content →
  // the tab entry takes the visibility-only fast path instead of a full mesh rebuild.
  {
    let h = 0;
    for (const e of catalog) {
      // bpm_user / key_user / filename included since 2026-08-24: corrections and
      // filename repairs are stored WITHOUT touching analyzed_at (by design — the
      // server re-applies them on read), so the old id+analyzed_at+genre hash could
      // never see them and the canvas stayed stale until an unrelated change.
      const s = e.id + (e.analyzed_at || '') + (e.genre || '') + (e.bpm_user || '')
              + (e.key_user ? e.key_user.root + '' + e.key_user.mode : '') + (e.filename || '');
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    const sig = catalog.length + ':' + h;
    if (window._neuralCatalogSig !== sig) {
      window._neuralCatalogSig = sig;
      window._neuralGraphDirty = true;
      // PCA/t-SNE/cluster/sim layers were computed from the OLD catalog — without
      // this they outlive it and new/re-analysed tracks pile at the origin.
      if (typeof _vecComputed !== 'undefined')
        _vecComputed = { pca:null, tsne:null, clusters:null, sim:null };
    }
  }
  updateTabCounts();
  applyFilters();
}
// pilot 7600
function renderCatSelector() {
  const opts = allCatalogs.map(c =>
    `<option value="${esc(c.slug)}" ${c.slug===activeCatalog?'selected':''}>${esc(c.name)} (${c.count})</option>`
  ).join('');
  const sel = document.getElementById('cat-select');
  if (sel) sel.innerHTML = opts;
  const usel = document.getElementById('upload-cat-select');
  if (usel) {
    const catOpts = allCatalogs.map(c =>
      `<option value="${esc(c.slug)}" ${c.slug===activeCatalog?'selected':''}>${esc(c.name)}</option>`
    ).join('');
    usel.innerHTML = catOpts + `<option disabled style="color:var(--muted)">──────────</option><option value="__new__">＋ New Field…</option>`;
  }
  // Reflect the active catalog name on the Analyse-tab Step 1 indicator
  const step1 = document.getElementById('step1-active-cat');
  if (step1) {
    const active = allCatalogs.find(c => c.slug === activeCatalog);
    step1.textContent = active ? `Active: ${active.name}` : 'No Field yet';
  }
}
// pilot 7637
function renderCombineChips() {
  renderFieldChecks();     // one selection, many surfaces (Neural drawer + dropdown pickers)
  const el = document.getElementById('combine-chips');
  if (!el) return;
  el.innerHTML = allCatalogs.map(c => {
    const on  = viewedCatalogs.has(c.slug);
    const col = catalogColor(c.slug);
    const title = on ? 'Currently viewed — click to remove from the combined view'
                     : 'Click to add to the combined view';
    return `<span class="cat-chip${on?' active':''}" data-slug="${esc(c.slug)}"
      style="--ch-c:${col}"
      onclick="toggleViewedCatalog('${esc(c.slug)}', event)"
      title="${title}">${esc(c.name)}</span>`;
  }).join('');
}
// pilot 7824
function getFilteredCatalog() {
  const q = (document.getElementById('cat-search')?.value || '').toLowerCase()   /* search box lives on the List tab */;
  return catalog.filter(e => {
    const d = e.data;
    if (!d) return false;
    if (q && !e.filename.toLowerCase().includes(q)) return false;
    if (activeFilters.moods.size > 0 && !activeFilters.moods.has(d.scores?.mood))    return false;
    if (activeFilters.modes.size > 0 && !activeFilters.modes.has(d.harmony?.mode))  return false;
    if (activeFilters.keys.size  > 0 && !activeFilters.keys.has(noteToCamelot(d.harmony?.root, d.harmony?.mode))) {
      // The anchored, playing AND playlist-anchor tracks ALL stay visible regardless of the
      // key filter (a Set, not an ||-chain that only kept the first one) — the listener
      // never loses sight of what they're hearing or where they're anchored.
      const keep = new Set();
      if (typeof neuralRingIdx !== 'undefined' && neuralRingIdx >= 0 && neuralNodeData?.[neuralRingIdx]?.catalogId) keep.add(neuralNodeData[neuralRingIdx].catalogId);
      if (typeof audioCurrentId !== 'undefined' && audioCurrentId) keep.add(audioCurrentId);
      if (typeof activePlaylist !== 'undefined' && activePlaylist?.anchor_track_id) keep.add(activePlaylist.anchor_track_id);
      if (!keep.has(e.id)) return false;
    }
    if (activeFilters.tags.size  > 0) { const tt=getTrackTags(e.id); for (const tid of activeFilters.tags) { if (!tt.has(tid)) return false; } }
    if (activeFilters.vocals === 'yes' && !d.content?.has_vocals)           return false;
    if (activeFilters.vocals === 'no'  &&  d.content?.has_vocals)           return false;
    // Slider extremes are open-ended (2026-07-24): with the BPM slider parked at its own
    // travel limits (60–200) the filter must be a NO-OP — previously tracks at <60 or >200
    // BPM (or with no BPM) were silently hidden while the UI reported "no filters active".
    const bpm = d.rhythm?.bpm || 0;
    const bpmLo = activeFilters.bpmMin <= 60  ? -Infinity : activeFilters.bpmMin;
    const bpmHi = activeFilters.bpmMax >= 200 ?  Infinity : activeFilters.bpmMax;
    if (bpm < bpmLo || bpm > bpmHi)                                          return false;
    const dance100   = (d.scores?.danceability || 0) * 100;
    if (dance100   < activeFilters.danceMin   || dance100   > activeFilters.danceMax)   return false;
    const energy100  = (d.energy?.level      || 0) * 100;
    if (energy100  < activeFilters.energyMin  || energy100  > activeFilters.energyMax)  return false;
    // Same open-ended rule for duration: slider max (900 s) means "no upper bound" — 15-min+
    // mixes must not vanish under the default filter state.
    const dur = d.metadata?.duration_sec || 0;
    const durHi = activeFilters.durMax >= 900 ? Infinity : activeFilters.durMax;
    if (dur < activeFilters.durMin || dur > durHi)                          return false;
    // Release period — year from tags, file-creation fallback (releasedValue). Slider
    // extremes are open-ended like BPM/duration: full span = no filter at all.
    if (activeFilters.relMin > 1950 || activeFilters.relMax < 2027) {
      const relYear = new Date(releasedValue(d, e)).getFullYear();
      const relLo = activeFilters.relMin <= 1950 ? -Infinity : activeFilters.relMin;
      const relHi = activeFilters.relMax >= 2027 ?  Infinity : activeFilters.relMax;
      if (!(relYear >= relLo && relYear <= relHi))                          return false;
    }
    // Genre filter — checkbox-driven from the neural legend. Empty set = no filter.
    if (activeFilters.genres.size > 0) {
      const g = (e.genre || '').trim().toLowerCase();
      if (!g || !activeFilters.genres.has(g)) return false;
    }
    return true;
  });
}
// pilot 7888
function applyFilters() {
  renderCatalog();
  refreshActiveFilterCount();
  // Matrix is layout-stable: a filter change only toggles per-node visibility, never
  // re-lays positions. That keeps the camera, anchor ring, and currently-playing track
  // exactly where they were when you picked a key on the Camelot wheel.
  if (document.getElementById('tab-neural')?.classList.contains('active')
      && typeof neuralMeshes !== 'undefined') {
    if (!neuralMeshes.length && typeof rebuildGraph === 'function') {
      rebuildGraph();
      return;
    }
    // If catalog membership matches what's already in the matrix, just toggle visibility.
    // Otherwise a structural rebuild is required (new / removed tracks).
    const currentIds  = new Set(catalog.filter(e => e.data).map(t => t.id));
    const existingIds = new Set(neuralNodeData.map(n => n.catalogId));
    let sameMembership = currentIds.size === existingIds.size;
    if (sameMembership) {
      for (const id of currentIds) if (!existingIds.has(id)) { sameMembership = false; break; }
    }
    if (sameMembership && typeof updateMatrixVisibility === 'function') {
      updateMatrixVisibility();
    } else if (typeof rebuildGraph === 'function') {
      rebuildGraph();
    }
  }
}
// pilot 8307
let _fpStaged = null;
// pilot 8310
let _fdStaged = null;
// pilot 8311
function _fdDirty() {
  return !!_fdStaged && (_fdStaged.size !== viewedCatalogs.size
                         || [..._fdStaged].some(sl => !viewedCatalogs.has(sl)));
}
// pilot 8316
function applyFieldDrawer(closing) {
  if (!_fdStaged) return;
  const changed = _fdDirty();
  const staged = _fdStaged;
  _fdStaged = null;                      // clear FIRST so the re-render shows live state
  // Apply is a button INSIDE the drawer, so the drawer is normally still open afterwards.
  // Re-arm staging in that case, or the very next tick would fall through to the live path
  // and apply instantly — the inconsistency this whole change exists to remove.
  // `closing` is passed explicitly by toggleDrawer: it commits BEFORE the DOM's data-open
  // flips, so reading the attribute here would say "open" during a close and leave a stale
  // staged set behind — which fieldPickerAll() checks first, so the List dropdown's All/None
  // would then stage into the closed drawer instead of the popover.
  const rearm = () => {
    if (!closing) _fdStaged = new Set(viewedCatalogs);
    renderFieldChecks();
  };
  if (!changed) { rearm(); return; }
  viewedCatalogs = new Set(staged);
  try { localStorage.setItem('viewed-catalogs', JSON.stringify([...viewedCatalogs])); } catch (_) {}
  renderCombineChips();
  loadCatalog();
  if (typeof renderRepair === 'function') {
    if (document.body.classList.contains('on-tab-repair')) renderRepair();
    else if (typeof repairData !== 'undefined' && repairData) renderRepair();
  }
  rearm();
}
// pilot 8379
function fieldPickerAll(on) {
  // Popover FIRST. Both can be armed at once — the FIELDS drawer stays armed after you leave
  // the Field tab, so opening the List tab's dropdown on top of it armed _fpStaged too. With
  // _fdStaged tested first, All/None staged into the drawer the user could not see and the
  // popover's own checkboxes never moved: the buttons read as simply dead. The popover can
  // only be armed by the user having just opened it, so it is always the surface in hand.
  if (_fpStaged) {   // popover open → stage; the close applies
    _fpStaged = on ? new Set((allCatalogs || []).map(c => c.slug)) : new Set();
    renderFieldChecks();
    return;
  }
  if (_fdStaged) {   // FIELDS drawer open → stage; Apply (or closing) commits
    _fdStaged = on ? new Set((allCatalogs || []).map(c => c.slug)) : new Set();
    renderFieldChecks();
    return;
  }
  viewedCatalogs = on ? new Set((allCatalogs || []).map(c => c.slug)) : new Set();
  try { localStorage.setItem('viewed-catalogs', JSON.stringify([...viewedCatalogs])); } catch (_) {}
  renderCombineChips();
  loadCatalog();
  if (typeof renderRepair === 'function') {
    if (document.body.classList.contains('on-tab-repair')) renderRepair();
    else if (typeof repairData !== 'undefined' && repairData) renderRepair();
  }
}
// pilot 8591
function splitArtistTitle(filename) {
  const base = (filename || '').replace(/\.[^./\\]+$/, '');
  const m = base.match(/^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base };
}
// pilot 8604
function trackArtistTitle(e) {
  const d  = e.data || {};
  const md = d.metadata || {};
  const fb = splitArtistTitle(e.filename || d.original_filename);
  // Sloppy taggers store literal HTML entities ("Somerville &amp; Wilson") — surfaced
  // the moment generated covers drew tag text verbatim. Decode the common ones here so
  // every consumer (list, exports, covers) gets the intended characters.
  const ent = s => s.replace(/&amp;/gi, '&').replace(/&apos;|&#39;/gi, "'").replace(/&quot;/gi, '"');
  const artist = ent((md.artist || '').trim() || fb.artist);
  const title  = ent((md.title  || '').trim() || fb.title);
  return { artist, title };
}
// pilot 9330
function pct(v) { return Math.round((v||0)*100); }
// pilot 9331
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// pilot 9340
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
}
// pilot 9462
let repairData = null;
// pilot 10562
let camelotCompatMode = 'off';
// pilot 10565
let wheelNotation = (typeof localStorage !== 'undefined' && localStorage.getItem('wheel-notation')) || 'standard';
// pilot 10567
const EDGE_DRAWERS = ['fields-drawer', 'axes-drawer', 'filters-drawer', 'key-drawer'];
// pilot 10578
const DRAWER_GAP = 8;      // px between stacked cards
// pilot 10579
const DRAWER_MIN_H = 150;  // px — below this a card is too small to be worth keeping open
// pilot 10580
const DRAWER_BOT_PAD = 10; // px of breathing room above the bottom edge
// pilot 10586
let _drawerWanted = new Set();
// pilot 10587
let _drawerOrder = [];   // least-recently-opened FIRST — the fold order when space runs out
// pilot 10588
function _drawerTouch(id) {
  _drawerOrder = _drawerOrder.filter(x => x !== id);
  _drawerOrder.push(id);
}
// pilot 10592
function _drawerSetWanted(id, want) {
  if (want) { _drawerWanted.add(id); _drawerTouch(id); }
  else { _drawerWanted.delete(id); _drawerOrder = _drawerOrder.filter(x => x !== id); }
  try { localStorage.setItem('drawer-' + id, want ? '1' : '0'); } catch (_) {}
}
// pilot 10606
function layoutEdgeDrawers(protect) {
  const rail = document.querySelector('.edge-drawer-rail');
  if (!rail) return;
  const host = rail.offsetParent || rail.parentElement;
  if (!host) return;

  // Every wanted drawer starts open; the loop below folds back only what won't fit.
  const all = EDGE_DRAWERS.map(id => document.getElementById(id)).filter(Boolean);
  for (const d of all) d.dataset.open = _drawerWanted.has(d.id) ? '1' : '0';
  // A fold for SPACE is not a user close — staged Field ticks survive it and reappear when
  // the drawer opens again. Only toggleDrawer() (a real close) or Apply commits them.

  // If the pane can't be measured — hidden tab, minimised window, a browser that hasn't
  // laid out yet — DON'T guess. Drop back to the plain CSS placement and wait to be
  // called again on resize; folding on a bogus measurement is how preferences get eaten.
  const measurable = host.clientHeight > 80 && window.innerWidth > 0;
  if (!measurable) {
    for (const d of all) {
      d.style.transform = '';
      const b = d.querySelector('.drawer-body');
      if (b) { b.style.top = ''; b.style.maxHeight = ''; }
    }
    return;
  }

  const scale = parseFloat(getComputedStyle(document.body).getPropertyValue('--drawer-scale')) || 1;
  // Space from the rail's top edge down to the bottom of the field.
  const avail = host.clientHeight - rail.offsetTop - DRAWER_BOT_PAD;
  const tabH = d => d.querySelector('.drawer-tab')?.offsetHeight || 0;

  for (let guard = 0; guard < EDGE_DRAWERS.length + 1; guard++) {
    const els = all.filter(d => d.dataset.open === '1');
    if (!els.length) {
      // Nothing open — every tab back to its natural rail slot.
      for (const d of all) d.style.transform = '';
      return;
    }
    const bodies = els.map(d => d.querySelector('.drawer-body'));

    // Natural height of each card with its cap lifted, in UNSCALED px.
    const nat = bodies.map(b => {
      const prevMax = b.style.maxHeight, prevTop = b.style.top;
      b.style.maxHeight = 'none'; b.style.top = '0px';
      const h = b.offsetHeight;
      b.style.maxHeight = prevMax; b.style.top = prevTop;
      return h;
    });

    const n = els.length;
    const startY = all[0].offsetTop;
    // Budget is in SCALED px (what the user actually sees on screen). Closed tabs sit
    // IN the stack now — the cursor walks over them — so their heights come out of the
    // shared budget along with the gap after every drawer but the last.
    const closedH = all.filter(d => d.dataset.open !== '1').reduce((s, d) => s + tabH(d), 0);
    const budget = (avail - startY) - DRAWER_GAP * (all.length - 1) - closedH;
    // Water-fill: short cards keep their natural height, tall ones share what's left.
    const order = nat.map((h, i) => i).sort((a, b) => nat[a] - nat[b]);
    const give = new Array(n);
    let remaining = budget, left = n;
    for (const i of order) {
      const share = remaining / left;
      give[i] = Math.min(nat[i] * scale, share);
      remaining -= give[i]; left--;
    }
    // Any card squeezed below the usable minimum → not enough space. Fold the oldest
    // (never the one just opened) and try again with one fewer card. The minimum scales
    // WITH the drawer size: at 150% a card needs 1.5x the pixels to show the same rows,
    // so "enough space" has to mean the same amount of content either way.
    const minH = DRAWER_MIN_H * scale;
    const tooTight = give.some((h, i) => h < Math.min(minH, nat[i] * scale) - 0.5);
    if (tooTight && n > 1) {
      const victim = _drawerOrder.find(id => id !== protect && els.some(e => e.id === id))
                  || els.map(e => e.id).find(id => id !== protect);
      const v = victim && document.getElementById(victim);
      // Display-only: dataset.open goes to 0, _drawerWanted is untouched, so this drawer
      // reopens by itself when the window grows or the drawer scale comes back down.
      if (v) { v.dataset.open = '0'; continue; }
    }
    // Place them: ONE cursor walks the whole rail. Every drawer — open or closed —
    // lands at max(cursor, its natural slot); the tab is translated there and an open
    // card sits at top:0 off its own (moved) tab, so the pair never separates.
    let y = startY, gi = 0;
    for (const d of all) {
      y = Math.max(y, d.offsetTop);
      const dy = y - d.offsetTop;
      d.style.transform = dy > 0.5 ? `translateY(${dy}px)` : '';
      if (d.dataset.open === '1') {
        const b = d.querySelector('.drawer-body');
        b.style.top = '0px';
        // max-height is applied BEFORE the transform, so convert the on-screen budget back.
        b.style.maxHeight = (give[gi] / scale) + 'px';
        y += Math.max(give[gi], tabH(d)) + DRAWER_GAP;
        gi++;
      } else {
        y += tabH(d) + DRAWER_GAP;
      }
    }
    return;
  }
}
// pilot (closeAllDrawers) — the canvas opens clean on every Field-tab entry (Mark, 2026-08-24).
// applyFieldDrawer(true) first: closing commits staged Field ticks instead of dropping them.
function closeAllDrawers() {
  if (typeof applyFieldDrawer === 'function') applyFieldDrawer(true);
  EDGE_DRAWERS.forEach(id => _drawerSetWanted(id, false));
  layoutEdgeDrawers();
}
// pilot 10722
function toggleDrawer(id) {
  const d = document.getElementById(id);
  if (!d) return;
  // Toggle the PREFERENCE. A drawer folded for space still counts as wanted, so clicking
  // its tab closes it outright rather than needing two clicks.
  const want = !_drawerWanted.has(id);
  if (id === 'fields-drawer') {
    if (want) _fdStaged = new Set(viewedCatalogs);      // arm staging on open
    else applyFieldDrawer(true);                        // closing commits, like clicking outside the dropdown
  }
  _drawerSetWanted(id, want);
  // The Set builder's curve strip renders lazily — it used to render when the ⋈ panel
  // opened; since 2026-08-26 the section lives in the SET TOOLS drawer instead.
  layoutEdgeDrawers(want ? id : null);
}
// pilot 10737
(function restoreDrawers() {
  const apply = () => {
    EDGE_DRAWERS.forEach(id => {
      if (!document.getElementById(id)) return;
      let want = false;
      try { want = localStorage.getItem('drawer-' + id) === '1'; } catch (_) {}
      if (want) {
        _drawerWanted.add(id); _drawerTouch(id);
        // Restored open → arm its staging now, or the first tick would apply instantly.
        if (id === 'fields-drawer') _fdStaged = new Set(viewedCatalogs);
      }
    });
    layoutEdgeDrawers();
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  // Available room changes with the window; the KEY card also changes height when the wheel
  // is reparented in/out. Re-fit on both, and once more after first paint — at DOMContentLoaded
  // a background/suspended tab often still measures zero.
  window.addEventListener('resize', () => layoutEdgeDrawers());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) layoutEdgeDrawers(); });
  requestAnimationFrame(() => requestAnimationFrame(() => layoutEdgeDrawers()));
})();
// pilot 10791
const WHEEL_NOTATION_TITLE = {
  openkey:  'Open Key notation (1m, 12d) — as used by Mixed In Key and Rekordbox. Click for Camelot.',
  camelot:  'Camelot notation (8B, 1A). Click for note names.',
  standard: 'Note names (C maj, A min). Click for Open Key.',
};
// pilot 10800
function _syncNotationCycleBtn() {
  const b = document.getElementById('cw-notation-cycle');
  if (b) {
    // Pathway-style three states: standard = plain, openkey = walls, camelot = lit.
    b.classList.toggle('walls', wheelNotation === 'openkey');
    b.classList.toggle('on',    wheelNotation === 'camelot');
    b.title = WHEEL_NOTATION_TITLE[wheelNotation] || 'Key notation';
  }
}
// pilot 10820
(function syncNotationToggleAtBoot() {
  const apply = () => {
    document.querySelectorAll('#cw-notation .cwn-stop').forEach(b => {
      b.classList.toggle('active', b.dataset.val === wheelNotation);
    });
    _syncNotationCycleBtn();
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once:true });
  else apply();
})();
// pilot 10853
(function applyVecPrefsAtBoot() {
  const apply = () => setVecEnabled(vecEnabled);
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 10927
function compatKeysFor(id, mode, dir) {
  const pos = parseInt(id), ring = id.slice(-1), other = ring === 'A' ? 'B' : 'A';
  const prev = pos === 1 ? 12 : pos - 1, next = pos === 12 ? 1 : pos + 1;
  // Parallel = same root, opposite mode: minor→major = +3, major→minor = -3 (mod 12)
  const parallelPos = ring === 'A'
    ? ((pos - 1 + 3) % 12) + 1
    : ((pos - 1 + 9) % 12) + 1;
  const parPrev = parallelPos === 1 ? 12 : parallelPos - 1;
  const parNext = parallelPos === 12 ? 1 : parallelPos + 1;
  const keys = {};
  keys.tight    = new Set([id, `${pos}${other}`, `${prev}${ring}`, `${next}${ring}`]);
  keys.extended = new Set([...keys.tight, `${prev}${other}`, `${next}${other}`]);
  keys.parallel = new Set([...keys.extended, `${parallelPos}${other}`]);
  keys.full     = new Set([...keys.parallel, `${parPrev}${other}`, `${parNext}${other}`]);
  const baseSet = keys[mode] || new Set([id]);
  if (dir === 'sym' || !dir) return baseSet;
  const dropPrev = dir === 'up';
  const dropNext = dir === 'down';
  const out = new Set();
  baseSet.forEach(k => {
    const kp = parseInt(k);
    if (dropPrev && (kp === prev || kp === parPrev)) return;
    if (dropNext && (kp === next || kp === parNext)) return;
    out.add(k);
  });
  return out;
}
// pilot 11035
let filterFade = 0;
// pilot 11040
function ghostsInteractive() {
  // Two ways there are no ghosts to click: the fade is 0 (the default — filtered means
  // GONE), or pathway SOLO is isolating the route, where off-route is likewise gone.
  return filterFade > 0.005 && !(typeof playlistTrailMode !== 'undefined'
    && playlistTrailMode === TRAIL_SOLO
    && typeof _trailIdSet !== 'undefined' && _trailIdSet && _trailIdSet.size > 0);
}
// pilot 11047
try {
  const v = parseFloat(localStorage.getItem('filter-fade'));
  if (v >= 0 && v <= 0.6) filterFade = v;
} catch (_) {}
// pilot 11061
(function syncFilterFadeAtBoot() {
  const apply = () => {
    const s = document.getElementById('filter-fade');
    if (s) s.value = Math.round(filterFade * 100);
    const out = document.getElementById('filter-fade-val');
    if (out) out.textContent = filterFade < 0.005 ? 'Hidden' : Math.round(filterFade * 100) + '%';
    document.body.style.setProperty('--filter-fade-pct', Math.round(filterFade / 0.6 * 100) + '%');
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 11078
let keyFanPreview = false;
// pilot 11079
try { keyFanPreview = localStorage.getItem('key-fan-preview') === '1'; } catch (_) {}
// pilot 11080
function _keyFanHubIdx() {
  if (keyFanPreview && typeof neuralPlayingIdx !== 'undefined' &&
      neuralPlayingIdx >= 0 && neuralMeshes[neuralPlayingIdx]?.visible) return neuralPlayingIdx;
  return (typeof neuralRingIdx !== 'undefined' && neuralRingIdx >= 0 &&
          neuralMeshes[neuralRingIdx]?.visible) ? neuralRingIdx : -1;
}
// pilot 11087
(function syncFanPreviewAtBoot() {
  const apply = () => document.getElementById('cw-fan-preview')?.classList.toggle('active', keyFanPreview);
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 11092
function toggleKeyFanPreview() {
  keyFanPreview = !keyFanPreview;
  try { localStorage.setItem('key-fan-preview', keyFanPreview ? '1' : '0'); } catch (_) {}
  document.getElementById('cw-fan-preview')?.classList.toggle('active', keyFanPreview);
  if (typeof refreshNeuralEdgeHighlight === 'function') refreshNeuralEdgeHighlight();
  if (typeof showToast === 'function')
    showToast(keyFanPreview ? 'Key lines follow the PREVIEW track (V to toggle)'
                            : 'Key lines follow your selected track', { subtle: true });
}
// pilot 11342
let audioCurrentId = null;
// pilot 11343
const globalAudio  = document.getElementById('global-audio');
// pilot 11353
const PREVIEW_FADE_MS = 80;
// pilot 11354
let _fadeTimer = null, _fadingOut = false;
// pilot 11355
function audioFade(target, ms) {
  if (_fadeTimer) { clearInterval(_fadeTimer); _fadeTimer = null; }
  target = Math.max(0, Math.min(1, target));
  const from = globalAudio.volume;
  const dur = Math.max(20, ms || PREVIEW_FADE_MS);
  const t0 = performance.now();
  _fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    globalAudio.volume = from + (target - from) * k;
    if (k >= 1) { globalAudio.volume = target; clearInterval(_fadeTimer); _fadeTimer = null; }
  }, 16);
}
// pilot 11376
let tfVolume = (() => { const v = parseFloat(localStorage.getItem('tf-volume')); return (v >= 0 && v <= 1) ? v : 1; })();
// pilot 11377
let tfMuted  = localStorage.getItem('tf-muted') === '1';
// pilot 11378
function volTarget() { return tfMuted ? 0 : tfVolume; }
// pilot 11470
function anchorTrackId() { return activePlaylist?.anchor_track_id || null; }
// pilot 11476
function tfSeekTo(seconds) {
  if (!globalAudio.duration) return;
  const t = Math.max(0, Math.min(globalAudio.duration, seconds));
  _pbLastPct = t / globalAudio.duration * 100;
  globalAudio.currentTime = t;
  // A deliberate seek cancels the pre-end fade-out — otherwise seeking back from the
  // window edge left playback quiet (or silent) with the flag still armed, and the flag
  // then also blocked the volume dial (review, 2026-08-28).
  if (_fadingOut) { _fadingOut = false; audioFade(volTarget()); }
}
// pilot 11694
function isTypingContext(t) {
  const tag = (t?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t?.isContentEditable;
}
// pilot 11801
function enterNeuralScrub(idx) {
  if (idx < 0 || !neuralMeshes[idx]) return;
  const nd = neuralNodeData[idx];
  if (nd?.catalogId && audioCurrentId !== nd.catalogId) {
    // Hold-and-scrub on a non-playing node behaves like a preview: switch audio,
    // but leave the committed anchor exactly where it is. DJs reach for scrub
    // to jump to a midpoint while auditioning — they don't want that to silently
    // promote the previewed track to anchor.
    audioPlayById(nd.catalogId, { keepAnchor: true });
  }
  neuralScrubStartT = globalAudio.currentTime || 0;
  neuralScrubDur   = globalAudio.duration   || 0;
  // Cold-audio scrub: the freshly-switched track has no metadata yet, so duration is 0
  // and the whole scrub gesture would be inert. Refresh the snapshot when metadata lands.
  if (!neuralScrubDur) {
    const onMeta = () => {
      globalAudio.removeEventListener('loadedmetadata', onMeta);
      if (neuralScrubMode) neuralScrubDur = globalAudio.duration || 0;
    };
    globalAudio.addEventListener('loadedmetadata', onMeta);
  }
  neuralScrubMode  = true;
  neuralControls.enabled = false;
  const cv = document.getElementById('neural-canvas');
  if (cv) cv.style.cursor = 'ns-resize';
}
// pilot 11882
const RELEASED_MIN_YEAR = 1900;
// pilot 11883
const _releasedMaxYear = () => new Date().getFullYear() + 1;
// pilot 11884
function _plausibleYear(yr) {
  return Number.isFinite(yr) && yr >= RELEASED_MIN_YEAR && yr <= _releasedMaxYear();
}
// pilot 11887
function releasedValue(d, e) {
  const y = (d?.metadata?.year ?? '').toString().trim();
  if (y) {
    const m = /^(\d{4})/.exec(y);
    const yr = m ? parseInt(m[1], 10) : NaN;
    // Validate the YEAR before trusting any parse — Date.parse('2050-01-01') is
    // perfectly valid and perfectly wrong.
    if (_plausibleYear(yr)) {
      // Bare year → pin to mid-year so it sorts sensibly between dated releases
      const t = Date.parse(/^\d{4}$/.test(y) ? y + '-07-01' : y);
      if (isFinite(t)) return t;
      return Date.UTC(yr, 6, 1);
    }
  }
  const fc = Date.parse(e?.file_created || '');
  if (isFinite(fc)) return fc;
  const aa = Date.parse(e?.analyzed_at || '');
  // NaN, not 0: 0 is 1970, a real-looking year that would drag the low end of every
  // Released scale down to a date none of these tracks actually has. Callers below
  // substitute the median for non-finite values, the same way Size already does.
  return isFinite(aa) ? aa : NaN;
}
// pilot 11909
const MOOD_AXIS_ORDER = ['melancholic', 'intense', 'upbeat', 'euphoric'];
// pilot 11910
const NEURAL_METRICS = [
  { key:'bpm',        label:'BPM',            get: (d,e) => d?.rhythm?.bpm || 0,                   log:true  },
  { key:'energy',     label:'Loudness',       get: (d,e) => d?.energy?.level || 0 },
  // 'loudness' removed as an AXIS 2026-08-05: energy is now a logistic on LUFS, so the
  // two order every track identically (Spearman 1.000) — plotting one is plotting the
  // other. LUFS survives as a COLUMN, because an absolute unit is what you need for gain
  // staging; that is a readout, not a dimension.
  { key:'dance',      label:'Danceability',   get: (d,e) => d?.scores?.danceability || 0 },
  // 'valence' removed as an AXIS 2026-08-05: 85% reconstructable from mode, brightness,
  // tempo and energy, all of which are axes already. It survives only as the input to
  // the mood label.
  { key:'brightness', label:'Brightness',     get: (d,e) => d?.timbre?.brightness || 0 },
  // Key as a POSITION metric (Mark, 2026-08-03): Camelot number 1–12, +0.5 for major —
  // same mapping as the formula `key` variable, so x=key and X=Key agree. Unknown → 0.
  { key:'camelot',    label:'Key (Camelot)',
    get: (d,e) => { const c = noteToCamelot(d?.harmony?.root, d?.harmony?.mode); return c ? parseInt(c) + (c.endsWith('B') ? 0.5 : 0) : 0; },
    fmt: (v) => v ? `${Math.floor(v)}${v % 1 ? 'B' : 'A'}` : '—' },
  { key:'vocals',     label:'Vocals',         get: (d,e) => d?.content?.voice_presence || 0 },
  // Mood as a POSITION axis (Mark, 2026-08-06). It is deliberately coarse — four values,
  // so tracks land in four slabs rather than a cloud — and that is the point: it reads as
  // a grouping, which a continuous axis cannot do.
  //
  // A line needs an ORDER, and the four moods are quadrants of energy x valence, which do
  // not naturally sit on one. Ordered here by VALENCE first, then loudness within it:
  //   0 melancholic (dark, gentle) → 1 intense (dark, loud)
  //   2 upbeat      (bright, gentle) → 3 euphoric (bright, loud)
  // so the axis reads dark → bright left to right, with the quiet member of each pair
  // before the loud one. Anything unrecognised sorts to -1, off the end, rather than
  // silently joining melancholic.
  { key:'mood',       label:'Mood',
    get: (d,e) => { const i = MOOD_AXIS_ORDER.indexOf(d?.scores?.mood); return i < 0 ? -1 : i; },
    fmt: (v) => MOOD_AXIS_ORDER[Math.round(v)] || '—' },
  { key:'rating',     label:'Rating',         get: (d,e) => getRating(e.id) },
  { key:'released',   label:'Released',       get: (d,e) => releasedValue(d,e),
    fmt: (v) => { const dt = new Date(v); return isFinite(dt) ? String(dt.getFullYear()) : '—'; } },
];
// pilot 11954
const FORMULA_VARS = [
  // [name, legend label, getter]
  ['bpm',   'BPM',                (d,e)=>d?.rhythm?.bpm||0],
  ['ene',   'Loudness 0–1',       (d,e)=>d?.energy?.level||0],
  ['dnc',   'Danceability 0–1',   (d,e)=>d?.scores?.danceability||0],
  ['bri',   'Brightness 0–1',     (d,e)=>d?.timbre?.brightness||0],
  ['voc',   'Vocals 0–1',         (d,e)=>d?.content?.voice_presence||0],
  ['rat',   'Rating 0–5',         (d,e)=>getRating(e.id)],
  ['rel',   'Release year',       (d,e)=>{const t=releasedValue(d,e); return 1970+t/31557600000;}],
  ['dur',   'Duration s',         (d,e)=>d?.metadata?.duration_sec||0],
  ['key',   'Camelot 1–12 (+.5 maj)', (d,e)=>{const c=noteToCamelot(d?.harmony?.root,d?.harmony?.mode); return c?parseInt(c)+(c.endsWith('B')?0.5:0):0;}],
  ['mod',   'Minor=1 Major=0',    (d,e)=>d?.harmony?.mode==='minor'?1:0],
  ['grp',   'Genre group idx',    (d,e)=>{const i=genreIndex(e.genre); return i<0?0:i+1;}],
  ['rough', 'Roughness 0–1',      (d,e)=>d?.timbre?.roughness||0],
  ['perc',  'Percussive 0–1',     (d,e)=>d?.timbre?.percussive_ratio||0],
  ['onsd',  'Onsets per second',  (d,e)=>d?.rhythm?.onset_density||0],
  ['puls',  'Pulse clarity 0–1',  (d,e)=>d?.rhythm?.pulse_clarity||0],
  ['chfx',  'Harmonic movement',  (d,e)=>d?.harmony?.chroma_flux||0],
  ['dyn',   'Dynamic range 0–1',  (d,e)=>d?.energy?.dynamic_range||0],
  // 0 on tracks analysed before features_version 3 — they have no confidence stored,
  // and `|| 0` reads that as "not confident", which is the honest answer for an
  // unmeasured track rather than a fabricated one.
  ['keyc',  'Key confidence 0–1', (d,e)=>d?.harmony?.key_confidence||0],
  ['tune',  'Tuning offset cents',(d,e)=>d?.harmony?.tuning_valid?(d?.harmony?.tuning_cents||0):0],
  // val / lud / harm / reg were removed here on 2026-08-05 — respectively arithmetic on
  // four other variables, identical in order to ene, the exact complement of perc, and a
  // near-constant that measured the beat tracker. Anything they could express is still
  // expressible: lud via ene, harm via (1 - perc).
];
// pilot 11984
const FORMULA_ALIASES = { energy:'ene', dance:'dnc', dynamics:'dyn',
  brightness:'bri', vocals:'voc', rating:'rat', released:'rel', year:'rel', duration:'dur',
  group:'grp', genre:'grp', mode:'mod', tempo:'bpm' };
// pilot 11987
const FORMULA_FUNCS = { sin:Math.sin, cos:Math.cos, tan:Math.tan, sqrt:Math.sqrt, abs:Math.abs,
  log:Math.log10, ln:Math.log, exp:Math.exp, min:Math.min, max:Math.max, pow:Math.pow,
  floor:Math.floor, round:Math.round, sign:Math.sign };
// pilot 11990
const FORMULA_CONSTS = { pi: Math.PI, e: Math.E };
// pilot 11995
function compileFormula(src) {
  const varNames = new Set(FORMULA_VARS.map(v=>v[0]));
  let s = String(src).trim().toLowerCase();
  if (!s) throw new Error('empty formula');
  // tokenize numbers (incl. scientific notation)/identifiers/operators; validate every
  // identifier. Number alternative comes FIRST and consumes an exponent so "1e3" is one
  // token — previously it split into 1·e·3 (Euler!) and silently computed garbage.
  const tokens = s.match(/[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?|[a-z_]+|\*\*|[-+*/^(),]|\s+/g) || [];
  if (tokens.join('') !== s) throw new Error('unexpected character in formula');
  const out = [];
  for (let t of tokens) {
    if (/^\s+$/.test(t)) continue;
    if (/^[a-z_]+$/.test(t)) {
      t = FORMULA_ALIASES[t] || t;
      if (varNames.has(t)) out.push({t:'var', v:t});
      else if (FORMULA_FUNCS[t]) out.push({t:'fn', v:t});
      else if (t in FORMULA_CONSTS) out.push({t:'num', v:String(FORMULA_CONSTS[t])});
      else throw new Error(`unknown name “${t}” — see the variables list`);
    } else if (/^[0-9.]/.test(t)) out.push({t:'num', v:t});
    else out.push({t:'op', v:t === '^' ? '**' : t});
  }
  // Commas are only valid as argument separators inside a FUNCTION call — a bare one
  // (decimal-comma habit: "0,5") would otherwise reach JS as the comma operator and
  // silently discard the left operand. Track which open-parens belong to functions.
  {
    const fnParen = [];
    for (let i = 0; i < out.length; i++) {
      const k = out[i];
      if (k.t === 'op' && k.v === '(') fnParen.push(out[i-1]?.t === 'fn');
      else if (k.t === 'op' && k.v === ')') fnParen.pop();
      else if (k.t === 'op' && k.v === ',' && !(fnParen.length && fnParen[fnParen.length-1]))
        throw new Error('unexpected “,” — use “.” for decimals (0.5, not 0,5)');
    }
  }
  // Unary minus/plus → "0-"/"0+" so "-ene^2" means -(ene²) instead of a JS syntax error
  // (JS refuses bare -x**2), and precedence stays mathematically conventional.
  const unfixed = out, out2 = [];
  for (let i = 0; i < unfixed.length; i++) {
    const k = unfixed[i];
    if (k.t === 'op' && (k.v === '-' || k.v === '+')) {
      const prev = out2[out2.length - 1];
      const unary = !prev || (prev.t === 'op' && prev.v !== ')');
      if (unary) out2.push({t:'num', v:'0'});
    }
    out2.push(k);
  }
  // implicit multiplication: value-ish followed by '(', var, fn or number → insert '*'.
  // Number directly followed by another number ("1.2.3" → "1.2" ".3") is a typo, not
  // an implicit product — reject it loudly instead of computing 1.2·0.3.
  const isValueEnd = k => k && (k.t==='var'||k.t==='num'||(k.t==='op'&&k.v===')'));
  const isValueStart = k => k && (k.t==='var'||k.t==='num'||k.t==='fn'||(k.t==='op'&&k.v==='('));
  const withMult = [];
  for (let i=0;i<out2.length;i++) {
    if (i>0 && out2[i-1].t==='num' && out2[i].t==='num')
      throw new Error(`malformed number near “${out2[i-1].v}${out2[i].v}”`);
    if (i>0 && isValueEnd(out2[i-1]) && isValueStart(out2[i])) withMult.push({t:'op',v:'*'});
    withMult.push(out2[i]);
  }
  const expr = withMult.map(k => k.t==='var' ? `V.${k.v}` : k.t==='fn' ? `F.${k.v}` : k.v).join(' ');
  let fn;
  try { fn = new Function('V','F', `"use strict"; return (${expr});`); }
  catch (err) { throw new Error('malformed expression'); }
  return (d,e) => {
    const V = {};
    for (const [name,,get] of FORMULA_VARS) V[name] = get(d,e);
    const r = fn(V, FORMULA_FUNCS);
    return typeof r === 'number' ? r : NaN;
  };
}
// pilot 12066
function parseFormulaPatch(text) {
  const res = {};
  // Lookbehind: the axis letter must not be the tail of a longer word — otherwise
  // "x=bpm energy=2" split at the 'y' of "energy" and errored miles from the mistake.
  // `size=` (alias `s=`) joins x/y/z as a formula target 2026-08-04 (Mark) — the 4th
  // visual channel becomes programmable too. Longest alternative first so "size" wins
  // over the bare "s".
  const re = /(?<![a-z_0-9])(size|[xyzs])\s*=\s*/gi;
  const marks = [];
  let m; while ((m = re.exec(text))) {
    const a = m[1].toLowerCase();
    marks.push({axis: a === 's' ? 'size' : a, start: re.lastIndex, at: m.index});
  }
  if (!marks.length) throw new Error('no x= / y= / z= / size= assignment found');
  const lead = text.slice(0, marks[0].at).trim();
  if (lead) throw new Error(`unexpected “${lead.slice(0, 20)}” before the first x=/y=/z=/size=`);
  for (let i=0;i<marks.length;i++) {
    const end = i+1 < marks.length ? marks[i+1].at : text.length;
    const src = text.slice(marks[i].start, end).trim().replace(/[;,]\s*$/,'');
    res[marks[i].axis] = { src, fn: compileFormula(src) };
  }
  return res;
}
// pilot 12089
let formulaAxes = null;          // {x:{src,fn}, y:…, z:…} or null when dropdowns rule
// pilot 12096
let focusFrameOn = (localStorage.getItem('neural-focus-frame') ?? '0') === '1';
// pilot 12097
function neuralFocusJump(idx) {
  if (idx < 0 || !neuralMeshes[idx] || !neuralCamera || !neuralControls) return;
  const p = neuralMeshes[idx].position;
  const d = Math.max(20, (typeof neuralFieldSpread === 'function' ? neuralFieldSpread() : 180) * 0.12);
  const dir = neuralCamera.position.clone().sub(p);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0.25, 1);
  dir.normalize().multiplyScalar(d);
  neuralLerpFX = neuralControls.target.x; neuralLerpFY = neuralControls.target.y; neuralLerpFZ = neuralControls.target.z;
  neuralLerpTX = p.x; neuralLerpTY = p.y; neuralLerpTZ = p.z;
  neuralLerpCFX = neuralCamera.position.x; neuralLerpCFY = neuralCamera.position.y; neuralLerpCFZ = neuralCamera.position.z;
  neuralLerpCTX = p.x + dir.x; neuralLerpCTY = p.y + dir.y; neuralLerpCTZ = p.z + dir.z;
  neuralLerpCam = true;
  neuralLerpT = 0;
}
// pilot 12113
function disarmFocusFrame() {
  if (!focusFrameOn) return;
  focusFrameOn = false;
  try { localStorage.setItem('neural-focus-frame', '0'); } catch(_){}
  document.body.classList.remove('neural-focus-on');
  const b = document.getElementById('matrix-focus-btn');
  if (b) b.classList.remove('on');
  if (typeof showToast === 'function') showToast('Focus released', { subtle: true });
}
// pilot 12122
function toggleFocusFrame() {
  focusFrameOn = !focusFrameOn;
  try { localStorage.setItem('neural-focus-frame', focusFrameOn ? '1' : '0'); } catch(_){}
  document.body.classList.toggle('neural-focus-on', focusFrameOn);
  const b = document.getElementById('matrix-focus-btn');
  if (b) b.classList.toggle('on', focusFrameOn);
  if (focusFrameOn) {
    const inExplore = typeof currentMode !== 'undefined' && currentMode === 'explore';
    if (inExplore) {
      // Explore: Focus engages the Fly camera (pbCameraTick picks it up next frame). Two
      // drivers on one camera is the FPS problem setFly() already solves — same hand-over.
      if (typeof fpsActive !== 'undefined' && fpsActive && typeof exitFPS === 'function') exitFPS();
      const playing = typeof neuralPlayingIdx !== 'undefined' && neuralPlayingIdx >= 0;
      const anchored = typeof neuralRingIdx !== 'undefined' && neuralRingIdx >= 0;
      const live = typeof audioCurrentId !== 'undefined' && !!audioCurrentId;
      if (typeof showToast === 'function')
        showToast(live && (playing || anchored) ? 'Focus — the camera follows what\u2019s playing. Grab the view to take over.'
                                      : 'Focus armed — play a track and the camera follows it', { subtle: true });
    } else if (typeof neuralRingIdx !== 'undefined' && neuralRingIdx >= 0) {
      // Jump to the current selection right away if there is one.
      neuralFocusJump(neuralRingIdx);
    } else if (typeof showToast === 'function') {
      showToast('Focus armed — selecting a track now jumps the view in close');
    }
  }
}
// pilot 12168
const lensOn = true;
// pilot 12169
let _lensWasActive = false, _lensFrameActive = false, _lensOffArr = null;
// pilot 12170
let _lensW = 1;   // 0..1 lens strength — eased, so the pilot taking the camera never pops the field
// pilot 12173
function lensShift(v, i) {
  if (_lensFrameActive && _lensOffArr && i >= 0 && (i * 3 + 2) < _lensOffArr.length) {
    v.x += _lensOffArr[i * 3]; v.y += _lensOffArr[i * 3 + 1]; v.z += _lensOffArr[i * 3 + 2];
  }
  return v;
}
// pilot 12181
function _lensSyncEdgeLines() {
  const eh = neuralEdgeHighlight, segs = eh?.userData?.segIdx;
  if (!eh || !segs || !segs.length) return;
  const at = eh.geometry.getAttribute('position');
  const v = (window.__lensLV ||= new neuralThree.Vector3());
  for (let s = 0; s < segs.length; s++) {
    const ia = segs[s][0], ib = segs[s][1];
    if (!neuralMeshes[ia] || !neuralMeshes[ib]) continue;
    v.copy(neuralMeshes[ia].position); lensShift(v, ia); at.setXYZ(s * 2, v.x, v.y, v.z);
    v.copy(neuralMeshes[ib].position); lensShift(v, ib); at.setXYZ(s * 2 + 1, v.x, v.y, v.z);
  }
  at.needsUpdate = true;
}
// pilot 12200
function neuralAxisPositions(tracks, ctx) {
  const {mm, mg} = ctx;
  const axes = ['x','y','z'].map((ax, i) => {
    const K = ctx[['xK','yK','zK'][i]];
    const f = formulaAxes && formulaAxes[ax];
    const get = f ? f.fn : mg(K);
    const useLog = f ? false : mm(K)?.log;
    let vals = tracks.map(t => { try { return get(t.data, t); } catch(_) { return NaN; } });
    if (useLog) vals = vals.map(v => Math.log1p(Math.max(0, v)));
    return vals;
  });
  // Undefined results (div-by-zero etc.) → the finite median, so junk can't fling nodes.
  let badCount = 0;
  for (const vals of axes) {
    const finite = vals.filter(Number.isFinite).sort((a,b)=>a-b);
    const med = finite.length ? finite[finite.length>>1] : 0;
    for (let i=0;i<vals.length;i++) if (!Number.isFinite(vals[i])) { vals[i]=med; badCount++; }
  }
  if (badCount && formulaAxes) window._formulaBadCount = badCount; else window._formulaBadCount = 0;
  // (The old Focus-Frame anchor-centred re-mapping was removed 2026-08-03 — ◎ Focus is a
  // camera behaviour now and never re-distributes the field.)
  // Winsorised so a handful of outliers can't squash the distribution.
  return axes.map(vals => neuralNormFold(vals));
}
// pilot 12229
function toggleFormulaPanel() {
  const p = document.getElementById('formula-popup');
  if (!p) return;
  const open = p.style.display !== 'flex';
  p.style.display = open ? 'flex' : 'none';
  if (open) document.getElementById('formula-input')?.focus();
}
// pilot 12236
function applyFormula() {
  const inp = document.getElementById('formula-input');
  const err = document.getElementById('formula-error');
  err.textContent = '';
  const text = inp.value.trim();
  if (!text) { clearFormula(); return; }
  try {
    formulaAxes = parseFormulaPatch(text);
    document.body.classList.add('neural-formula-on');
    document.getElementById('formula-btn')?.classList.add('on');
    _syncAxisDropdownsToFormula();
    rebuildGraph();
    const bad = window._formulaBadCount || 0;
    showToast(`Formula applied — ${Object.keys(formulaAxes).join(', ')} rewired` +
              (bad ? ` (${bad} undefined values pinned to median)` : ''));
  } catch (e2) { err.textContent = '✗ ' + e2.message; }
}
// pilot 12253
function clearFormula() {
  formulaAxes = null;
  document.body.classList.remove('neural-formula-on');
  document.getElementById('formula-btn')?.classList.remove('on');
  const err = document.getElementById('formula-error'); if (err) err.textContent = '';
  _syncAxisDropdownsToFormula();
  rebuildGraph();
}
// pilot 12263
function _syncAxisDropdownsToFormula() {
  for (const [ax, id] of [['x','nx-axis'], ['y','ny-axis'], ['z','nz-axis'], ['size','n-size']]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const owned = !!(formulaAxes && formulaAxes[ax]);
    sel.disabled = owned;
    sel.title = owned ? `This axis is driven by the ƒx formula (${formulaAxes[ax].src.slice(0, 40)}) — pick “— clear formula —” in the Formulas picker to use the dropdown` : '';
    sel.style.opacity = owned ? '.45' : '';
  }
}
// pilot 12274
function _formulaPatches() { try { const v = JSON.parse(localStorage.getItem('formula-patches')||'[]'); return Array.isArray(v) ? v : []; } catch(_){ return []; } }
// pilot 12278
const FORMULA_FACTORY = [
  // Every preset now sets SIZE as well as x/y/z (Mark, 2026-08-04). Size is a genuine
  // fourth channel, so each one encodes something the three axes DON'T already show —
  // e.g. 'Half-time twins' folds tempo onto X, so size carries the real BPM and you can
  // tell a 70 from a 140 inside the same stack. Size is normalised like any other axis,
  // so only the ordering matters, not the units.
  ['Harmonic geometry', [
    ['Camelot ring',        'x=sin(key/12*2*pi)  y=cos(key/12*2*pi)  z=log(bpm)  size=ene'],
    ['Key helix (by year)', 'x=sin(key/12*2*pi)  y=cos(key/12*2*pi)  z=rel  size=rat'],
    ['Major / minor rings', 'x=sin(key/12*2*pi)  y=cos(key/12*2*pi)  z=mod  size=ene'],
  ]],
  ['DJ set-craft', [
    ['Dancefloor cube',     'x=log(bpm)  y=ene*dnc  z=key  size=ene'],
    ['Distance from 124',   'x=abs(log(bpm)-log(124))  y=ene  z=key  size=dnc'],
    ['Peak-time finder',    'x=ene^2*dnc  y=dyn  z=voc  size=bri'],
    ['Half-time twins',     'x=bpm-32floor(bpm/32)  y=ene  z=dnc  size=log(bpm)'],
    ['Warm-up shelf',       'x=dnc-ene  y=1-bri  z=log(bpm)  size=dur'],
  ]],
  ['Mood', [
    ['Tension axis',        'x=rough/(1-perc+0.1)  y=chfx  z=ene  size=dyn'],
    ['Euphoria index',      'x=ene*dnc*bri  y=log(bpm)  z=voc  size=rat'],
    ['Melancholia',         'x=mod*(1-bri)*(1-ene)  y=rel  z=dur  size=dyn'],
    ['Aggro vector',        'x=ene  y=rough*onsd  z=log(bpm)  size=perc'],
  ]],
  ['Library archaeology', [
    ['The loudness war',    'x=rel  y=ene  z=grp  size=dur'],
    ['Tempo by decade',     'x=rel  y=log(bpm)  z=ene  size=rat'],
    ['Genre galaxies',      'x=grp*cos(grp)  y=grp*sin(grp)  z=ene  size=dnc'],
    ['Vintage detector',    'x=(2027-rel)(1-ene)  y=1-perc  z=voc  size=rat'],
  ]],
  ['Sonic character', [
    ['Texture cube',        'x=bri  y=rough  z=perc  size=dyn'],
    ['Organic ↔ mechanical','x=perc/(1-perc+0.1)  y=puls  z=onsd  size=ene'],
    ['Acapella corner',     'x=voc  y=perc  z=puls  size=dur'],
  ]],
  ['Wild cards', [
    ['Interference pattern','x=sin(bpm/17)  y=cos(ene*2*pi)  z=sin(key/12*2*pi)  size=ene'],
    ['You vs the machine',  'x=rat  y=ene*dnc  z=rel  size=dur'],
    ['Duration spiral',     'x=sqrt(dur)cos(dur/60)  y=sqrt(dur)sin(dur/60)  z=ene  size=rat'],
  ]],
];
// pilot 12319
const _factoryFlat = () => FORMULA_FACTORY.flatMap(([g, list]) => list.map(([name, text]) => ({ name, text, group: g })));
// pilot 12320
function renderFormulaPatches() {
  const sel = document.getElementById('formula-patch-sel');
  if (!sel) return;
  const ps = _formulaPatches();
  // The clear row must live IN the picker (2026-08-29 review): presets are free but the
  // ƒx editor's Clear is Pro-gated, so without this a locked install could apply a
  // preset and never get back to dropdown axes.
  let html = '<option value="">— presets &amp; patches —</option>' +
             '<option value="clear">— clear formula (dropdown axes) —</option>';
  let fi = 0;
  for (const [group, list] of FORMULA_FACTORY) {
    html += `<optgroup label="${group}">` +
      list.map(([name]) => `<option value="f${fi++}">${name.replace(/</g,'&lt;')}</option>`).join('') +
      '</optgroup>';
  }
  if (ps.length) html += '<optgroup label="Your patches">' +
    ps.map((p,i)=>`<option value="u${i}">${p.name.replace(/</g,'&lt;')}</option>`).join('') + '</optgroup>';
  sel.innerHTML = html;
}
// pilot 12339
function _patchByValue(v) {
  v = String(v ?? '');
  if (v.startsWith('f')) return _factoryFlat()[+v.slice(1)] || null;
  if (v.startsWith('u')) return _formulaPatches()[+v.slice(1)] || null;
  return _formulaPatches()[+v] || null;   // legacy bare-index values
}
// pilot 12345
function loadFormulaPatch(v) {
  // Presets & patches are FREE (Mark, 2026-08-29) — the Pro gate covers only the
  // ƒx editor (writing/saving your own). No gate here.
  if (v === 'clear') {
    clearFormula();
    const s = document.getElementById('formula-patch-sel'); if (s) s.value = '';
    return;
  }
  const p = _patchByValue(v);
  if (!p) return;
  document.getElementById('formula-input').value = p.text;
  applyFormula();
}
// pilot 12370
function deleteFormulaPatch() {
  const sel = document.getElementById('formula-patch-sel');
  if (String(sel.value).startsWith('f')) return showToast('Built-in presets can’t be deleted — Save makes your own copy');
  const p = _patchByValue(sel.value);
  if (!p) return showToast('Pick one of your own patches first');
  localStorage.setItem('formula-patches', JSON.stringify(_formulaPatches().filter(q=>q.name!==p.name)));
  renderFormulaPatches();
  showToast(`Deleted “${p.name}”`);
}
// pilot 12381
let _gizmoCtx = null, _gizmoFrame = 0, _gizmoQ = null, _gizmoV = null;
// pilot 12382
function drawAxisGizmo() {
  if ((++_gizmoFrame % 2) !== 0 || !neuralCamera || !neuralThree) return;   // 30 Hz is plenty
  const cv = document.getElementById('nt-gizmo');
  if (!cv) return;
  if (!_gizmoCtx) {
    // Retina: back the 110-CSS-px canvas with dpr× pixels once, then draw in logical
    // units via ctx.scale. (Setting cv.width resets the transform, so scale AFTER.)
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = cv.height = 110 * dpr;
    _gizmoCtx = cv.getContext('2d');
    _gizmoCtx.scale(dpr, dpr);
  }
  const T = neuralThree;
  if (!_gizmoQ) { _gizmoQ = new T.Quaternion(); _gizmoV = new T.Vector3(); }
  const ctx = _gizmoCtx, Wp = 110, Hp = 110, cx = Wp/2, cy = Hp/2, R = Wp/2 - 14;
  ctx.clearRect(0,0,Wp,Hp);
  neuralCamera.getWorldQuaternion(_gizmoQ);
  const qi = _gizmoQ.clone().invert();
  // labels: short names of the live axis sources ('ƒx' when a formula owns the axis)
  const shortOf = (selId, ax) => {
    if (formulaAxes && formulaAxes[ax]) return 'ƒ' + ax;
    const k = document.getElementById(selId)?.value || '';
    const mapping = {bpm:'bpm', energy:'ene', dance:'dnc',
                     brightness:'bri', vocals:'voc', rating:'rat', released:'rel', genre_idx:'grp'};
    // Tag axes show the actual tag name (#hous, #dark…), not an identical 'tag' ×3.
    const tg = k.startsWith('tag_') ? allTags.find(t => 'tag_' + t.id === k) : null;
    return mapping[k] || (tg ? '#' + String(tg.name).slice(0, 4) : k.slice(0,3));
  };
  const axesDef = [
    {v:[1,0,0], c:'#ff5555', l: shortOf('nx-axis','x')},
    {v:[0,1,0], c:'#44dd88', l: shortOf('ny-axis','y')},
    {v:[0,0,1], c:'#5599ff', l: shortOf('nz-axis','z')},
  ];
  // project each ± end into gizmo space; z (depth toward viewer) sorts draw order
  const ends = [];
  for (const a of axesDef) {
    for (const sgn of [1,-1]) {
      _gizmoV.set(a.v[0]*sgn, a.v[1]*sgn, a.v[2]*sgn).applyQuaternion(qi);
      ends.push({x: cx + _gizmoV.x*R, y: cy - _gizmoV.y*R, z: _gizmoV.z, c: a.c, pos: sgn>0, l: a.l});
    }
  }
  ends.sort((p,q) => p.z - q.z);            // far first
  ctx.lineCap = 'round';
  for (const p2 of ends) {
    const depth = 0.55 + 0.45 * (p2.z*0.5 + 0.5);
    ctx.globalAlpha = (p2.pos ? 0.95 : 0.4) * depth;
    ctx.strokeStyle = p2.c; ctx.lineWidth = p2.pos ? 2 : 1.2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    if (p2.pos) {
      ctx.globalAlpha = depth;
      ctx.fillStyle = p2.c; ctx.font = 'bold 9px -apple-system,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lx = cx + (p2.x-cx)*1.16, ly = cy + (p2.y-cy)*1.16;
      ctx.fillText(p2.l, lx, ly);
    }
  }
  ctx.globalAlpha = 0.9; ctx.fillStyle = '#9aa8ff';
  ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
}
// pilot 12446
(function initFormulaFocusUI() {
  const apply = () => {
    document.body.classList.toggle('neural-focus-on', focusFrameOn);
    const b = document.getElementById('matrix-focus-btn');
    if (b) b.classList.toggle('on', focusFrameOn);
    const list = document.getElementById('formula-vars-list');
    if (list) list.innerHTML = FORMULA_VARS.map(([n, label]) =>
      `<div><code>${n}</code> ${label}</div>`).join('');
    renderFormulaPatches();
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, {once:true});
  else apply();
})();
// pilot 12475
const VEC_GROUPS = ['tempo', 'harmony', 'energy', 'timbre', 'vocal'];
// pilot 12481
const VEC_DIMS = [
  { name:'logbpm', group:'tempo',   get:d => { const b = d?.rhythm?.bpm; return b ? Math.log(Math.max(40, b)) : NaN; } },
  // 'beat' (beat_strength) removed 2026-08-05: it was percentile(onset,75) divided by
  // the track's OWN peak, so it was a within-track shape statistic that could not be
  // compared between tracks, and it never approached 1 (median 0.127, p95 0.228).
  // Replaced by two absolute measurements of the audio itself. Every dimension below was
  // kept only after measuring its adjusted R^2 against the existing ones on a 180-track
  // sample — spectral flatness (0.897) and MFCC 2 (0.850) were rejected as already
  // predicted; these scored 0.370, 0.273, 0.462, 0.461 and 0.152.
  { name:'onsden', group:'tempo',   get:d => d?.rhythm?.onset_density ?? NaN },
  { name:'pulse',  group:'tempo',   get:d => d?.rhythm?.pulse_clarity ?? NaN },
  // 'reg' (rhythm_regularity) removed 2026-08-05. It is 1 - CV(inter-beat intervals)
  // over librosa's beat track, and that tracker fits a tempo prior, so it emits near-
  // uniform beats for a drum machine and a rubato piano alike. Measured across 24,259
  // tracks it sat between 0.93 and 0.98 with normalised entropy 0.42 — it was reporting
  // the beat tracker's confidence in its own grid, not anything about the music.
  { name:'keysin', group:'harmony', get:d => { const c = _vecCamPos(d); return c ? Math.sin(c / 12 * 2 * Math.PI) : NaN; } },
  { name:'keycos', group:'harmony', get:d => { const c = _vecCamPos(d); return c ? Math.cos(c / 12 * 2 * Math.PI) : NaN; } },
  { name:'mode',   group:'harmony', get:d => d?.harmony?.mode === 'minor' ? 1 : d?.harmony?.mode === 'major' ? 0 : NaN },
  { name:'chflux', group:'harmony', get:d => d?.harmony?.chroma_flux ?? NaN },
  // 'harm' (harmonic_ratio) removed 2026-08-05. harmonic_ratio + percussive_ratio =
  // 1.000000 exactly, for all 24,259 tracks — one measurement stored twice, negated,
  // which is also what made this matrix numerically singular (condition number 3.5e12).
  // 'perc' below is the survivor. It was ALSO mis-grouped: it read timbre.harmonic_ratio
  // while sitting in the harmony group, so the harmony weight was secretly a timbre
  // control and the two groups moved together.
  { name:'ene',    group:'energy',  get:d => d?.energy?.level ?? NaN },
  // 'lud' (raw LUFS) was removed here on 2026-08-05. energy.level is now a logistic on
  // LUFS, so the two are the SAME variable: Spearman 1.000, and 0.984 Pearson once
  // z-scored — up from 0.955 when the old clipped formula was accidentally keeping them
  // apart. Two copies in one weight group meant loudness quietly counted double in every
  // similarity, route and cluster. Loudness is still a first-class FORMULA variable
  // (see the 'lud' entry in the formula list above) — this only drops the duplicate from
  // the distance metric.
  { name:'dnc',    group:'energy',  get:d => d?.scores?.danceability ?? NaN },
  // 'val' (valence) removed 2026-08-05. It is not a measurement: R^2 = 0.85 reconstructing
  // it from mode, brightness, tempo and energy, because that IS its formula
  // (0.45*mode + 0.25*brightness + 0.20*tempo_band + 0.10*energy) and all four are
  // already dimensions here. It added weight to things already counted — hence its
  // -0.798 correlation with mode. It still exists as the input to the mood label.
  { name:'dyn',    group:'energy',  get:d => d?.energy?.dynamic_range ?? NaN },
  { name:'bri',    group:'timbre',  get:d => d?.timbre?.brightness ?? NaN },
  { name:'rough',  group:'timbre',  get:d => d?.timbre?.roughness ?? NaN },
  { name:'perc',   group:'timbre',  get:d => d?.timbre?.percussive_ratio ?? NaN },
  { name:'mfcc3',  group:'timbre',  get:d => d?.timbre?.mfcc?.[0] ?? NaN },
  { name:'mfcc4',  group:'timbre',  get:d => d?.timbre?.mfcc?.[1] ?? NaN },
  { name:'voc',    group:'vocal',   get:d => d?.content?.voice_presence ?? NaN },
];
// pilot 12529
function _vecCamPos(d) {
  const c = noteToCamelot(d?.harmony?.root, d?.harmony?.mode);
  return c ? parseInt(c, 10) : 0;
}
// pilot 12534
let vecWeights = (() => {
  const def = { tempo:1, harmony:1, energy:1, timbre:1, vocal:1 };
  try { return Object.assign(def, JSON.parse(localStorage.getItem('vec-weights') || '{}')); }
  catch { return def; }
})();
// pilot 12549
let _vecCache = null;   // { ids:[], idx:Map(id→row), mat:Float32Array, n, d }
// pilot 12550
const _VEC_GROUP_N = {};
// pilot 12557
const VIEW_SCHEMA = 'tunefield-view/0.1';
// pilot 12558
function _viewsLoad() {
  try { return JSON.parse(localStorage.getItem('field-views') || '[]'); }
  catch { return []; }
}
// pilot 12562
function _viewsStore(v) {
  try { localStorage.setItem('field-views', JSON.stringify(v)); } catch (_) {}
  if (typeof annoPush === 'function') annoPush('views');   // views are annotations too
}
// pilot 12566
function captureFieldView(name) {
  const g = id => document.getElementById(id)?.value;
  return {
    schema: VIEW_SCHEMA,
    name,
    saved: new Date().toISOString().slice(0, 19),
    axes: { x: g('nx-axis'), y: g('ny-axis'), z: g('nz-axis'),
            color: g('n-color'), size: g('n-size') },
    weights: { ...vecWeights },
    formula: (document.getElementById('formula-input')?.value || '').trim() || null,
    spread: neuralSpread,
  };
}
// pilot 12579
let _viewWeightsSkipped = false;
// pilot 12580
function applyFieldView(v) {
  if (!v || v.schema !== VIEW_SCHEMA) { showToast('Not a Tunefield view file.'); return; }
  _viewWeightsSkipped = false;
  for (const [id, val] of [['nx-axis', v.axes?.x], ['ny-axis', v.axes?.y], ['nz-axis', v.axes?.z],
                           ['n-color', v.axes?.color], ['n-size', v.axes?.size]]) {
    const el = document.getElementById(id);
    // A view can name a metric this install doesn't have (older build, renamed metric).
    // Skip those quietly rather than blanking the select.
    if (el && val && [...el.options].some(o => o.value === val)) el.value = val;
  }
  // Similarity weights are Pro (they live in the ⋈ panel), but a saved view carries them
  // and Import/apply is free — so a free install could take on weights it has no control
  // to see or undo, permanently, via localStorage. They also feed vecMatrix(), which FLOW
  // uses, so the leak changed free behaviour invisibly (audit, 2026-09-20).
  if (v.weights) {
    for (const k of Object.keys(vecWeights)) {
      if (typeof v.weights[k] === 'number') vecWeights[k] = Math.max(0, Math.min(2, v.weights[k]));
    }
    try { localStorage.setItem('vec-weights', JSON.stringify(vecWeights)); } catch (_) {}
  } else if (v.weights) {
    // Flagged on the SUCCESS toast below rather than its own: a separate toast is replaced
    // by "View … loaded." a moment later and the user never sees it.
    _viewWeightsSkipped = true;
  }
  const fi = document.getElementById('formula-input');
  if (fi) fi.value = v.formula || '';
  if (v.formula && typeof applyFormula === 'function') { try { applyFormula(); } catch (_) {} }
  else if (!v.formula && typeof clearFormula === 'function') { try { clearFormula(); } catch (_) {} }
  if (typeof v.spread === 'number' && typeof setNeuralSpread === 'function') {
    setNeuralSpread(Math.round(Math.max(0.5, Math.min(3, v.spread)) * 100));
    if (typeof commitNeuralSpread === 'function') commitNeuralSpread();
  }
  _vecCache = null; _vecAdjCache = null;
  rebuildGraph();
  renderFieldViews();
  fieldEvent('config_loaded', { name: (v.name || '').slice(0, 60) });
  showToast(`View "${v.name}" loaded.` + (_viewWeightsSkipped
    ? ' Its similarity weights need an unlock key \u2014 kept your own.' : ''), { subtle: true });
}
// pilot 12619
function saveFieldView() {
  const name = prompt('Name this view — what way of hearing is it?', '');
  if (!name || !name.trim()) return;
  const views = _viewsLoad().filter(v => v.name !== name.trim());
  views.unshift(captureFieldView(name.trim()));
  _viewsStore(views.slice(0, 30));
  renderFieldViews();
  fieldEvent('config_saved', { name: name.trim().slice(0, 60) });
  showToast(`View "${name.trim()}" saved.`, { subtle: true });
}
// pilot 12643
function importFieldView() {
  const inp = document.getElementById('view-import-file');
  if (!inp) return;
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) return;
    f.text().then(t => {
      let v; try { v = JSON.parse(t); } catch { showToast('That file is not valid JSON.'); return; }
      if (v.schema !== VIEW_SCHEMA) { showToast('Not a Tunefield view file.'); return; }
      const views = _viewsLoad().filter(x => x.name !== v.name);
      views.unshift(v);
      _viewsStore(views.slice(0, 30));
      applyFieldView(v);
    });
    inp.value = '';
  };
  inp.click();
}
// pilot 12661
function renderFieldViews() {
  const list = document.getElementById('views-list');
  if (!list) return;
  const views = _viewsLoad();
  list.innerHTML = views.length ? views.map(v => `
    <div class="view-row">
      <span class="vr-name" onclick="applyFieldView(_viewsLoad().find(x=>x.name===${JSON.stringify(v.name)}))" title="Load this view — saved ${esc(v.saved || '')}">${esc(v.name)}</span>
      <button onclick="exportFieldView(${JSON.stringify(v.name)})" title="Export as a file you can send to someone">⤓</button>
      <button onclick="deleteFieldView(${JSON.stringify(v.name)})" title="Delete this view">✕</button>
    </div>`).join('')
    : '<div class="views-empty">No saved views yet — set up the Field, then + Save.</div>';
}
// pilot 12675
const _fieldEvQ = [];
// pilot 12676
let _fieldEvTimer = null;
// pilot 12677
function fieldEvent(e, fields) {
  _fieldEvQ.push({ e, ...(fields || {}) });
  if (_fieldEvQ.length >= 20) _fieldEvFlush();
  else if (!_fieldEvTimer) _fieldEvTimer = setTimeout(_fieldEvFlush, 15000);
}
// pilot 12682
function _fieldEvFlush() {
  clearTimeout(_fieldEvTimer); _fieldEvTimer = null;
  if (!_fieldEvQ.length) return;
  const batch = _fieldEvQ.splice(0, 50);
  const body = JSON.stringify({ events: batch });
  // sendBeacon survives tab close — exactly when field_session fires.
  if (!(navigator.sendBeacon && navigator.sendBeacon('/usage/events',
        new Blob([body], { type: 'application/json' })))) {
    fetch('/usage/events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                             body, keepalive: true }).catch(() => {});
  }
}
// pilot 12694
let _fieldEnterT = null;
// pilot 12695
function _fieldSessionTick(entering) {
  if (entering && _fieldEnterT === null) _fieldEnterT = performance.now();
  else if (!entering && _fieldEnterT !== null) {
    const sec = Math.round((performance.now() - _fieldEnterT) / 1000);
    _fieldEnterT = null;
    if (sec >= 3) fieldEvent('field_session', { sec });
  }
}
// pilot 12703
window.addEventListener('beforeunload', () => { _fieldSessionTick(false); _fieldEvFlush(); });
// pilot 12705
window.addEventListener('pagehide', () => { _fieldSessionTick(false); _fieldEvFlush(); });
// pilot 12706
(function wireFieldTelemetry() {
  const wire = () => {
    for (const id of ['nx-axis', 'ny-axis', 'nz-axis', 'n-color', 'n-size']) {
      document.getElementById(id)?.addEventListener('change',
        ev => fieldEvent('axis_change', { axis: id, to: ev.target.value }));
    }
    renderFieldViews();
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
// pilot 12799
function _vecGroupSize(g) {
  if (!_VEC_GROUP_N[g]) _VEC_GROUP_N[g] = VEC_DIMS.filter(x => x.group === g).length || 1;
  return _VEC_GROUP_N[g];
}
// pilot 12803
function vecMatrix() {
  const src = (typeof getFilteredCatalog === 'function' ? getFilteredCatalog() : catalog) || [];
  // Length + first + last id collided: any filter change that preserved all three (and
  // the always-kept anchor/playing track means the ends often ARE preserved) served a
  // stale matrix. Fold in the weights and a cheap interior sample so a different set of
  // the same size can't pass for the same one.
  // Hash EVERY id: sampled signatures (ends + two interior picks) could collide for
  // two different filter sets of the same size and serve stale geometry (Aug 15
  // review). djb2 over N short ids costs microseconds next to the NxD build below.
  let _h = 5381;
  for (const t of src) { const id = t.id || ''; for (let k = 0; k < id.length; k++) _h = ((_h << 5) + _h + id.charCodeAt(k)) | 0; }
  // _vecGen: bumped by markFieldStale({vec:true}). Without it, an ASYNC producer
  // (vecAdjacency's sliced build, the multi-second t-SNE) that started BEFORE an
  // override could finish AFTER it and re-store results computed from the old
  // features under a signature the fresh matrix still matches — permanently
  // poisoning Set builder / routes / sim edges until membership or weights change
  // (review, 2026-08-25). A generation in the sig makes stale stores unmatchable.
  const sig = src.length + ':' + _h + ':' + VEC_DIMS.length + ':' + JSON.stringify(vecWeights) + ':' + _vecGen;
  if (_vecCache && _vecCache.sig === sig) return _vecCache;
  const n = src.length, d = VEC_DIMS.length;
  if (!n) return (_vecCache = { ids:[], idx:new Map(), mat:new Float32Array(0), n:0, d, sig });
  const mat = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    const data = src[i].data || {};
    for (let j = 0; j < d; j++) { const v = VEC_DIMS[j].get(data); mat[i * d + j] = Number.isFinite(v) ? v : NaN; }
  }
  // z-score each column, then apply the group weight
  for (let j = 0; j < d; j++) {
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) { const v = mat[i * d + j]; if (!Number.isNaN(v)) { sum += v; cnt++; } }
    const mean = cnt ? sum / cnt : 0;
    let ss = 0;
    for (let i = 0; i < n; i++) { const v = mat[i * d + j]; if (!Number.isNaN(v)) { const dv = v - mean; ss += dv * dv; } }
    const sd = (cnt ? Math.sqrt(ss / cnt) : 0) || 1;
    // Divide the group weight by sqrt(how many dimensions are in that group. Without
    // this a group's real influence scaled with its dimension COUNT, not its slider:
    // measured at equal weights, harmony (4 dims) took 28.5% of a typical distance while
    // vocal (1 dim) took 7.2%, so vocal at 2.0 still counted for less than harmony at
    // 1.0. Now each group contributes equally at equal weight, and the slider is the
    // only thing that changes that.
    const w = (vecWeights[VEC_DIMS[j].group] ?? 1) / Math.sqrt(_vecGroupSize(VEC_DIMS[j].group));
    // missing → 0 AFTER standardisation: the column mean, i.e. "no evidence",
    // instead of a fake extreme z-score.
    for (let i = 0; i < n; i++) { const v = mat[i * d + j]; mat[i * d + j] = Number.isNaN(v) ? 0 : ((v - mean) / sd) * w; }
  }
  const ids = src.map(t => t.id);
  const idx = new Map(); ids.forEach((id, i) => idx.set(id, i));
  return (_vecCache = { ids, idx, mat, n, d, sig });
}
// pilot 12871
function vecPCA() {
  const M = vecMatrix();
  if (M.n < 4) return null;
  const d = M.d, comps = [], vals = [];
  // Covariance (d×d — tiny, 15×15)
  const cov = new Float64Array(d * d);
  for (let i = 0; i < M.n; i++)
    for (let j = 0; j < d; j++) {
      const vj = M.mat[i * d + j];
      for (let k2 = j; k2 < d; k2++) cov[j * d + k2] += vj * M.mat[i * d + k2];
    }
  for (let j = 0; j < d; j++) for (let k2 = j; k2 < d; k2++) {
    const v = cov[j * d + k2] / M.n; cov[j * d + k2] = v; cov[k2 * d + j] = v;
  }
  const work = Float64Array.from(cov);
  for (let c = 0; c < 3; c++) {
    let v = new Float64Array(d).map((_, i) => Math.sin((i + 1) * (c + 1) * 1.7) + 0.1);  // deterministic seed
    let lambda = 0;
    for (let it = 0; it < 220; it++) {
      const nv = new Float64Array(d);
      for (let j = 0; j < d; j++) { let s = 0; for (let k2 = 0; k2 < d; k2++) s += work[j * d + k2] * v[k2]; nv[j] = s; }
      let norm = Math.hypot(...nv) || 1;
      for (let j = 0; j < d; j++) nv[j] /= norm;
      lambda = norm; v = nv;
    }
    comps.push(v); vals.push(lambda);
    for (let j = 0; j < d; j++) for (let k2 = 0; k2 < d; k2++) work[j * d + k2] -= lambda * v[j] * v[k2];  // deflate
  }
  // Project every track onto the three components
  const proj = [new Float32Array(M.n), new Float32Array(M.n), new Float32Array(M.n)];
  for (let i = 0; i < M.n; i++)
    for (let c = 0; c < 3; c++) {
      let s = 0; for (let j = 0; j < d; j++) s += M.mat[i * d + j] * comps[c][j];
      proj[c][i] = s;
    }
  // % of TOTAL variance (the covariance trace), not just of the top three — saying
  // "45%" when it's 45%-of-the-three would overstate what the component explains.
  let total = 0;
  for (let j = 0; j < d; j++) total += cov[j * d + j];
  total = total || 1;
  // What each component is "made of" — the dims with the biggest loadings.
  // Array.from FIRST: comps[c] is a Float64Array and typed-array .map() returns a
  // typed array, so mapping to objects silently produced NaN.
  const describe = c => Array.from(comps[c]).map((w, j) => ({ n: VEC_DIMS[j].name, w }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 3)
    .map(o => `${o.w < 0 ? '−' : '+'}${o.n}`).join(' ');
  return { ids: M.ids, proj, varPct: vals.map(v => v / total * 100), describe: [0,1,2].map(describe) };
}
// pilot 13000
let _vecAdjCache = null;
// pilot 13112
function vecArith(baseId, terms, k = 8) {
  const M = vecMatrix();
  const a = M.idx.get(baseId);
  if (a === undefined) return { hits: [], applied: [] };
  const d = M.d;
  const q = new Float64Array(d);
  for (let j = 0; j < d; j++) q[j] = M.mat[a * d + j];
  const applied = [];
  for (const { sign, name, amount } of terms) {
    // Accept both dimension names and the friendly formula aliases.
    const alias = { energy:'ene', dance:'dnc', dynamics:'dyn',
                    brightness:'bri', vocals:'voc', tempo:'logbpm', bpm:'logbpm',
                    roughness:'rough', percussive:'perc' };
    const nm = alias[name] || name;
    const j = VEC_DIMS.findIndex(v => v.name === nm);
    if (j < 0) continue;
    q[j] += sign * amount;          // amount is in standard deviations
    applied.push(`${sign > 0 ? '+' : '−'}${amount}σ ${nm}`);
  }
  const out = [];
  for (let i = 0; i < M.n; i++) {
    if (i === a) continue;
    let s = 0; for (let j = 0; j < d; j++) { const dv = q[j] - M.mat[i * d + j]; s += dv * dv; }
    out.push({ id: M.ids[i], dist: Math.sqrt(s) });
  }
  out.sort((x, y) => x.dist - y.dist);
  return { hits: out.slice(0, k), applied };
}
// pilot 13141
function vecParseArith(src) {
  const terms = [];
  const re = /([+-])\s*([0-9]*\.?[0-9]+)?\s*([a-z]+)/gi;
  let m;
  while ((m = re.exec(String(src || '').toLowerCase()))) {
    terms.push({ sign: m[1] === '-' ? -1 : 1, amount: m[2] ? parseFloat(m[2]) : 1, name: m[3] });
  }
  return terms;
}
// pilot 13154
const VEC_TSNE_CAP = 2500;
// pilot 13155
let _vecTsneWorker = null;
// pilot 13156
const _VEC_TSNE_SRC = `
self.onmessage = e => {
  const { mat, n, d, perp, iters } = e.data;
  const M = new Float64Array(mat);
  // pairwise squared distances
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let s = 0; for (let k = 0; k < d; k++) { const dv = M[i*d+k] - M[j*d+k]; s += dv*dv; }
    D[i*n+j] = s; D[j*n+i] = s;
  }
  // P with per-point sigma found by binary search on perplexity
  const P = new Float64Array(n * n);
  const logU = Math.log(perp);
  for (let i = 0; i < n; i++) {
    let lo = -Infinity, hi = Infinity, beta = 1, row = new Float64Array(n);
    for (let tries = 0; tries < 50; tries++) {
      let sum = 0;
      for (let j = 0; j < n; j++) { row[j] = i === j ? 0 : Math.exp(-D[i*n+j] * beta); sum += row[j]; }
      sum = sum || 1e-12;
      let H = 0;
      for (let j = 0; j < n; j++) { const p = row[j] / sum; if (p > 1e-12) H -= p * Math.log(p); }
      const diff = H - logU;
      if (Math.abs(diff) < 1e-4) break;
      if (diff > 0) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; }
      else          { hi = beta; beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2; }
    }
    let sum = 0; for (let j = 0; j < n; j++) sum += row[j];
    sum = sum || 1e-12;
    for (let j = 0; j < n; j++) P[i*n+j] = row[j] / sum;
  }
  // symmetrise + early exaggeration
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const v = (P[i*n+j] + P[j*n+i]) / (2 * n); P[i*n+j] = v; P[j*n+i] = v;
  }
  // deterministic init (no Math.random — same library, same picture)
  const Y = new Float64Array(n * 2), dY = new Float64Array(n * 2), gains = new Float64Array(n * 2).fill(1);
  for (let i = 0; i < n; i++) { Y[i*2] = Math.sin(i * 12.9898) * 1e-2; Y[i*2+1] = Math.cos(i * 78.233) * 1e-2; }
  const Q = new Float64Array(n * n);
  for (let it = 0; it < iters; it++) {
    const exag = it < 100 ? 12 : 1;
    let qsum = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = Y[i*2]-Y[j*2], dy = Y[i*2+1]-Y[j*2+1];
      const q = 1 / (1 + dx*dx + dy*dy); Q[i*n+j] = q; Q[j*n+i] = q; qsum += 2*q;
    }
    qsum = qsum || 1e-12;
    const grad = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const mult = (P[i*n+j] * exag - Q[i*n+j] / qsum) * Q[i*n+j];
      grad[i*2]   += 4 * mult * (Y[i*2]   - Y[j*2]);
      grad[i*2+1] += 4 * mult * (Y[i*2+1] - Y[j*2+1]);
    }
    const mom = it < 250 ? 0.5 : 0.8, eta = 200;
    for (let i = 0; i < n * 2; i++) {
      gains[i] = Math.max(0.01, Math.sign(grad[i]) === Math.sign(dY[i]) ? gains[i] * 0.8 : gains[i] + 0.2);
      dY[i] = mom * dY[i] - eta * gains[i] * grad[i];
      Y[i] += dY[i];
    }
    if ((it & 7) === 0) self.postMessage({ progress: (it + 1) / iters });
  }
  self.postMessage({ done: true, Y: Y.buffer }, [Y.buffer]);
};
`;
// pilot 13220
function vecTSNE(onProgress) {
  return new Promise((resolve, reject) => {
    const M = vecMatrix();
    if (M.n < 10) return reject(new Error('Need at least 10 tracks'));
    // Sample down if the library is over the cap — reported to the user, never silent.
    let ids = M.ids, rows = M.n, mat;
    if (M.n > VEC_TSNE_CAP) {
      const stride = M.n / VEC_TSNE_CAP;
      const pick = [];
      for (let i = 0; i < VEC_TSNE_CAP; i++) pick.push(Math.floor(i * stride));
      ids = pick.map(i => M.ids[i]);
      rows = pick.length;
      mat = new Float64Array(rows * M.d);
      pick.forEach((src, i) => { for (let j = 0; j < M.d; j++) mat[i * M.d + j] = M.mat[src * M.d + j]; });
    } else {
      mat = Float64Array.from(M.mat);
    }
    try { _vecTsneWorker?.terminate(); } catch (_) {}
    const url = URL.createObjectURL(new Blob([_VEC_TSNE_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    _vecTsneWorker = w;
    w.onmessage = ev => {
      if (ev.data.progress !== undefined) { onProgress?.(ev.data.progress); return; }
      if (ev.data.done) {
        const Y = new Float64Array(ev.data.Y);
        const x = new Float32Array(rows), y = new Float32Array(rows);
        for (let i = 0; i < rows; i++) { x[i] = Y[i*2]; y[i] = Y[i*2+1]; }
        w.terminate(); URL.revokeObjectURL(url); _vecTsneWorker = null;
        resolve({ ids, proj: [x, y], sampled: rows < M.n ? rows : 0, total: M.n });
      }
    };
    w.onerror = err => { try { w.terminate(); } catch (_) {} URL.revokeObjectURL(url); _vecTsneWorker = null; reject(err); };
    w.postMessage({ mat: mat.buffer, n: rows, d: M.d, perp: Math.min(30, Math.max(5, rows / 40)), iters: 400 }, [mat.buffer]);
  });
}
// pilot 13255
function vecTSNECancel() {
  try { _vecTsneWorker?.terminate(); } catch (_) {}
  _vecTsneWorker = null;
}
// pilot 13262
let _vecComputed = { pca:null, tsne:null, clusters:null, sim:null };
// pilot 13271
let _vecGen = 0;   // feature-value generation — see the sig comment in vecMatrix
// pilot 13300
function _vecMapMetric(key, label, map, fmt) {
  return { key, label, get: (d, e) => map.get(e.id) ?? 0, fmt };
}
// pilot 13303
function vecComputedMetrics() {
  const out = [];
  const C = _vecComputed;
  if (C.pca) {
    for (let c = 0; c < 3; c++) {
      const m = new Map(); C.pca.ids.forEach((id, i) => m.set(id, C.pca.proj[c][i]));
      out.push(_vecMapMetric(`pca${c+1}`, `PCA ${c+1} (${C.pca.varPct[c].toFixed(0)}% · ${C.pca.describe[c]})`, m));
    }
  }
  if (C.tsne) {
    for (let c = 0; c < 2; c++) {
      const m = new Map(); C.tsne.ids.forEach((id, i) => m.set(id, C.tsne.proj[c][i]));
      out.push(_vecMapMetric(`tsne${c+1}`, `t-SNE ${c === 0 ? 'X' : 'Y'}`, m));
    }
  }
  if (C.clusters) {
    const m = new Map(); C.clusters.ids.forEach((id, i) => m.set(id, C.clusters.assign[i] + 1));
    out.push(_vecMapMetric('cluster', `Cluster (${C.clusters.k} groups)`, m,
      v => v ? `#${Math.round(v)} ${C.clusters.labels[Math.round(v)-1]?.genre || ''}` : '—'));
  }
  if (C.sim) {
    const m = new Map(); C.sim.map.forEach((v, id) => m.set(id, v));
    out.push(_vecMapMetric('simdist', `Distance from “${C.sim.name}”`, m));
  }
  return out;
}
// pilot 13333
let vecEnabled = (localStorage.getItem('vec-enabled') ?? '1') === '1';
// pilot 13334
function setVecEnabled(on) {
  vecEnabled = !!on;
  try { localStorage.setItem('vec-enabled', vecEnabled ? '1' : '0'); } catch (_) {}
  document.body.classList.toggle('vec-off', !vecEnabled);
  const sw = document.getElementById('vec-enable-switch');
  if (sw) sw.dataset.on = vecEnabled ? '1' : '0';
  if (!vecEnabled) {
    vmResetView({ quiet: true });
    const p = document.getElementById('vecmath-panel');
    if (p) p.style.display = 'none';
    document.getElementById('vecmath-btn')?.classList.remove('on');
  }
}
// pilot 13350
function toggleVecPanel() {
  const p = document.getElementById('vecmath-panel');
  if (!p || !vecEnabled) return;
  const open = p.style.display !== 'block';
  p.style.display = open ? 'block' : 'none';
  document.getElementById('vecmath-btn')?.classList.toggle('on', open);
  if (open) vmRenderWeights();
}
// pilot 13384
let _vecAxisSnapshot = null;
// pilot 13390
function vmResetView(opts) {
  opts = opts || {};
  const hadComputed = !!(_vecComputed.pca || _vecComputed.tsne || _vecComputed.clusters || _vecComputed.sim);
  const hadFormula  = !!formulaAxes;
  _vecComputed = { pca:null, tsne:null, clusters:null, sim:null };
  _vmRouteFrom = null; _vmLastHits = [];
  vecTSNECancel();
  if (hadFormula && typeof clearFormula === 'function') clearFormula();   // clearFormula rebuilds
  // Restore the pre-vector dropdowns; fall back to the defaults for anything that
  // still points at a computed metric that no longer exists.
  const DEF = { x:'bpm', y:'energy', z:'dance', c:'key', s:'vocals' };   // valence/loudness axes are gone
  const snap = _vecAxisSnapshot || {};
  const COMPUTED = /^(pca[123]|tsne[12]|cluster|simdist)$/;
  for (const [id, k] of [['nx-axis','x'],['ny-axis','y'],['nz-axis','z'],['n-color','c'],['n-size','s']]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    if (COMPUTED.test(sel.value)) sel.value = (snap[k] && !COMPUTED.test(snap[k])) ? snap[k] : DEF[k];
  }
  _vecAxisSnapshot = null;
  refreshNeuralAxisSelects();
  // Blank the panel's result areas so nothing stale is left on screen.
  for (const id of ['vm-sim-out','vm-axes-out','vm-clusters-out','vm-path-out','vm-arith-out']) {
    const el = document.getElementById(id); if (el) el.innerHTML = '';
  }
  if (typeof rebuildGraph === 'function') rebuildGraph();
  if (!opts.quiet && (hadComputed || hadFormula)) showToast('View reset to ordinary axes');
}
// pilot 13417
function vmRenderWeights() {
  const host = document.getElementById('vm-weight-rows');
  if (!host || host.dataset.built === '1') return;
  const WHAT = {
    tempo:   'Tempo, onset density and pulse clarity',
    harmony: 'Key (compared by wheel position), major/minor, and how harmonic the sound is',
    energy:  'Loudness, danceability and dynamic range',
    timbre:  'Brightness, sensory roughness (beating/grind, not noisiness), how percussive the sound is, and two timbre fingerprints',
    vocal:   'How much voice is present',
  };
  host.innerHTML = VEC_GROUPS.map(g => `
    <div class="vm-wrow">
      <span class="vm-wname" title="${WHAT[g]}">${g}</span>
      <input type="range" min="0" max="2" step="0.05" value="${vecWeights[g]}" oninput="setVecWeight('${g}', this.value)"
             title="${WHAT[g]} — 0 ignores it when judging similarity, 1 is neutral, 2 makes it count double">
      <span class="vm-wval" id="vw-${g}-val">${String(vecWeights[g]).replace(/0$/, '')}</span>
    </div>`).join('');
  host.dataset.built = '1';
}
// pilot 13437
function vmCurrentTrack() {
  let id = null;
  if (typeof neuralRingIdx !== 'undefined' && neuralRingIdx >= 0) id = neuralNodeData[neuralRingIdx]?.catalogId;
  if (!id && typeof audioCurrentId !== 'undefined') id = audioCurrentId;
  if (!id && typeof anchorTrackId === 'function') id = anchorTrackId();
  return id ? (catalog.find(t => t.id === id) || null) : null;
}
// pilot 13444
function vmName(id) {
  const t = catalog.find(x => x.id === id);
  if (!t) return '(unknown)';
  const p = trackArtistTitle(t);
  return (p.artist && p.title) ? `${p.artist} — ${p.title}` : (p.title || t.filename);
}
// pilot 13450
function vmHitList(hits, extra) {
  if (!hits.length) return '<div class="vm-empty">Nothing found.</div>';
  return hits.map((h, i) => `
    <div class="vm-hit" onclick="vmPreview('${h.id}')" title="Click to preview">
      <span class="vm-rank">${i + 1}</span>
      <span class="vm-title">${esc(vmName(h.id))}</span>
      <span class="vm-dist">${h.dist.toFixed(2)}</span>
    </div>`).join('') + (extra || '');
}
// pilot 13463
let _vmLastHits = [];
// pilot 13490
function vmRunPCA() {
  const out = document.getElementById('vm-axes-out');
  const r = vecPCA();
  if (!r) { out.innerHTML = '<div class="vm-empty">Need at least 4 tracks.</div>'; return; }
  _vecComputed.pca = r;
  refreshNeuralAxisSelects();
  out.innerHTML = `<div class="vm-note">Added <b>PCA 1–3</b> to the axis dropdowns.</div>`
    + r.varPct.map((v, i) => `<div class="vm-stat"><span>PCA ${i+1}</span><span>${v.toFixed(0)}% of variance · ${esc(r.describe[i])}</span></div>`).join('')
    + `<button class="btn-sm vm-add" onclick="vmApplyPCAAxes()">Put PCA 1/2/3 on X/Y/Z</button>`;
}
// pilot 13510
async function vmRunTSNE() {
  const out = document.getElementById('vm-axes-out');
  const btn = document.getElementById('vm-tsne-btn');
  if (_vecTsneWorker) { vecTSNECancel(); btn.textContent = 't-SNE'; out.innerHTML = '<div class="vm-note">Cancelled.</div>'; return; }
  btn.textContent = 'Cancel';
  out.innerHTML = `<div class="vm-note">Embedding… <span id="vm-tsne-pct">0%</span></div>
    <div class="vm-bar"><div class="vm-bar-fill" id="vm-tsne-bar"></div></div>`;
  const t0 = Date.now();
  const gen0 = _vecGen;   // features as of when this run STARTED
  try {
    const r = await vecTSNE(p => {
      const pct = Math.round(p * 100);
      const el = document.getElementById('vm-tsne-pct'), bar = document.getElementById('vm-tsne-bar');
      const secs = Math.round((Date.now() - t0) / 1000);
      if (el) el.textContent = `${pct}% · ${secs}s`;
      if (bar) bar.style.width = pct + '%';
    });
    // A BPM/key override or rescan mid-embedding invalidated the features this run
    // was computed from — storing it would poison the axis layer until Reset view.
    if (gen0 !== _vecGen) {
      out.innerHTML = '<div class="vm-note">The library\'s numbers changed while embedding — run t-SNE again.</div>';
      btn.textContent = 't-SNE';
      return;
    }
    _vecComputed.tsne = r;
    refreshNeuralAxisSelects();
    out.innerHTML = `<div class="vm-note">Added <b>t-SNE X/Y</b> to the axis dropdowns.`
      + (r.sampled ? ` <b>Sampled ${r.sampled} of ${r.total}</b> tracks (cap ${VEC_TSNE_CAP}).` : '')
      + `</div><button class="btn-sm vm-add" onclick="vmApplyTSNEAxes()">Put t-SNE on X/Y</button>`;
  } catch (e) {
    out.innerHTML = `<div class="vm-empty">t-SNE failed: ${esc(String(e.message || e))}</div>`;
  }
  btn.textContent = 't-SNE';
}
// pilot 13573
let _vmRouteFrom = null;
// pilot 14372
function vmRunArith() {
  const out = document.getElementById('vm-arith-out');
  const t = vmCurrentTrack();
  if (!t) { out.innerHTML = '<div class="vm-empty">Select a track first.</div>'; return; }
  const terms = vecParseArith(document.getElementById('vm-arith').value);
  if (!terms.length) { out.innerHTML = '<div class="vm-empty">Write something like <code>-voc +2rough</code>.</div>'; return; }
  const r = vecArith(t.id, terms);
  if (!r.applied.length) { out.innerHTML = '<div class="vm-empty">No known dimension in that expression.</div>'; return; }
  _vmLastHits = r.hits;
  out.innerHTML = `<div class="vm-note"><b>${esc(vmName(t.id))}</b> ${esc(r.applied.join(' '))}</div>`
    + vmHitList(r.hits, `<button class="btn-sm vm-add" onclick="vmAddHitsToPlaylist()">＋ Add all to playlist</button>`);
}
// pilot 14385
function neuralTagMetrics() {
  return allTags.map(t => ({
    key:   `tag_${t.id}`,
    label: `Tag: ${t.name}`,
    get:   (d,e) => getTrackTags(e.id).has(t.id) ? 1 : 0,
  }));
}
// pilot 14392
function allNeuralMetrics() {
  const genreMetric = {
    key:   'genre_idx',
    label: 'Genre (group)',
    get:   (d,e) => {
      const i = genreIndex(e.genre);
      return i < 0 ? 0 : i + 1;
    },
  };
  // Computed metrics from the ⋈ Vector maths panel (PCA components, t-SNE embedding,
  // cluster id, distance-from-a-track) become first-class axis/colour/size choices the
  // moment they exist — see vecComputedMetrics().
  return [...NEURAL_METRICS, genreMetric, ...neuralTagMetrics(), ...vecComputedMetrics()];
}
// pilot 14408
function legendHTML(titleHtml, bodyHtml) {
  const collapsed = localStorage.getItem('neural-legend-collapsed') === '1';
  const el = document.getElementById('neural-legend');
  if (el) el.classList.toggle('collapsed', collapsed);
  return `<div class="neural-legend-title nl-fold" onclick="toggleNeuralLegendFold(event)">${titleHtml}<span class="nl-caret">${collapsed ? '▸' : '▾'}</span></div><div class="nl-body">${bodyHtml}</div>`;
}
// pilot 14427
function updateNeuralLegend(cK) {
  const el = document.getElementById('neural-legend');
  if (!el) return;
  if (cK === 'key') {
    // No legend for Key (Mark, 2026-08-03): the Camelot wheel on screen IS the legend —
    // its sector colours match the node hues, so a swatch table is pure duplication.
    el.style.display = 'none';
    return;
  }
  if (cK === 'cluster' && _vecComputed.clusters) {
    // Categorical legend — one swatch per discovered cluster, labelled with the genre
    // most of its members carry (and how dominant that is).
    el.style.display = 'block';
    const rows = _vecComputed.clusters.labels.map((l, i) =>
      `<div class="neural-legend-row">
         <span class="neural-legend-sq" style="background:hsl(${(i * 137.508) % 360},${FS().clS}%,${FS().clL}%)"></span>
         <span>#${i + 1} · ${esc(l.genre)} ${Math.round(l.purity * 100)}% · ${l.size}</span>
       </div>`).join('');
    el.innerHTML = legendHTML(`Clusters (${_vecComputed.clusters.k})`, rows);
    return;
  }
  if (cK === 'genre') {
    const genres = listGenres();
    if (!genres.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    // Groups header — clickable chips toggle a whole bundle of genres at once.
    const groups = loadGenreGroups();
    const userDefined = (() => { try { return JSON.parse(localStorage.getItem('genre-groups') || 'null')?.length > 0; } catch { return false; } })();
    const groupChips = groups.map(grp => {
      const members = genreGroupMembers(grp);
      if (!members.length) return ''; // skip groups that match no current-catalog genre
      const lowMembers = members.map(m => m.toLowerCase());
      const allOn = lowMembers.every(m => activeFilters.genres.has(m));
      const someOn = !allOn && lowMembers.some(m => activeFilters.genres.has(m));
      const cls = allOn ? 'gg-chip on' : someOn ? 'gg-chip partial' : 'gg-chip';
      // Right-click on a user-added group to remove it. escJs on the JS-string args.
      const removeAttr = userDefined ? ` oncontextmenu="event.preventDefault();removeGenreGroupPrompt('${escJs(grp.name)}')"` : '';
      return `<button class="${cls}" onclick="toggleGenreGroup('${escJs(grp.name)}')"${removeAttr} title="${esc(grp.name)} — ${members.length} genre${members.length===1?'':'s'} in scope${userDefined ? ' · right-click to remove' : ''}">${esc(grp.name)} <span class="gg-n">${members.length}</span></button>`;
    }).filter(Boolean).join('');
    const groupsBlock = `
      <div class="ng-groups">
        <div class="ng-groups-row">${groupChips}<button class="gg-add" onclick="addGenreGroupPrompt()" title="Define a new genre group (name + comma-separated keywords)">+ Group</button></div>
      </div>`;
    const rows = genres.map(g => {
      const gl = g.toLowerCase();
      const on = activeFilters.genres.has(gl);
      return `<div class="neural-legend-row ng-checkbox ${on?'on':''}" onclick="toggleGenreFilter('${escJs(g)}')" title="Filter to tracks whose genre is &quot;${esc(g)}&quot;">
        <span class="ng-check ${on?'on':''}">${on ? '✓' : ''}</span>
        <span class="neural-legend-sq" style="background:${genreColor(g)}"></span>
        <span class="ng-name">${esc(g)}</span>
      </div>`;
    }).join('');
    const clearLink = activeFilters.genres.size
      ? `<button class="ng-clear" onclick="activeFilters.genres.clear();updateNeuralLegend('genre');applyFilters()" title="Clear all genre filters">clear (${activeFilters.genres.size})</button>`
      : '';
    el.innerHTML = legendHTML(`Genre ${clearLink}`, `${groupsBlock}${rows}`);
    return;
  }
  if (cK === 'mood') {
    // Mood — name + colour swatch only. The "high energy + low valence" descriptors moved
    // into row tooltips so the legend stays scannable at a glance.
    el.style.display = 'block';
    const moods = [
      { name:'euphoric',    desc:'Loud and bright' },
      { name:'intense',     desc:'Loud and dark' },
      { name:'upbeat',      desc:'Gentle and bright' },
      { name:'melancholic', desc:'Gentle and dark' },
    ];
    const rows = moods.map(m => `<div class="neural-legend-row" title="${m.desc}">
      <span class="neural-legend-sq" style="background:${MOOD_COLOR[m.name]}"></span>
      <span style="text-transform:capitalize">${m.name}</span>
    </div>`).join('');
    el.innerHTML = legendHTML('Mood', rows);
    return;
  }
  // Numeric metric: bigger gradient strip + larger low / high labels.
  const metric = allNeuralMetrics().find(m => m.key === cK);
  if (!metric) { el.style.display = 'none'; return; }
  const tracks = catalog.filter(e => e.data);
  if (!tracks.length) { el.style.display = 'none'; return; }
  let vals = tracks.map(t => metric.get(t.data, t));
  if (metric.log) vals = vals.map(v => Math.log1p(Math.max(0,v)));
  // Loop, not spread — engines cap spread argument counts (~65k) on huge catalogs
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (!Number.isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { el.style.display = 'none'; return; }
  // Gradient matches the node-colorization (hue 240→0 as value rises)
  const stops = [0, 0.25, 0.5, 0.75, 1].map(t => `hsl(${Math.round((1-t)*240)},${FS().numS}%,${FS().numL}%) ${t*100}%`).join(', ');
  const fmt = v => {
    if (metric.log) v = Math.expm1(v);
    if (metric.fmt) return metric.fmt(v);   // metric-specific formatting (e.g. Released → year)
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10)  return v.toFixed(1);
    return v.toFixed(2);
  };
  el.style.display = 'block';
  el.innerHTML = legendHTML(esc(metric.label), `
    <div style="width:100%;height:12px;border-radius:0;background:linear-gradient(90deg,${stops});margin:4px 0 5px"></div>
    <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:var(--text)">
      <span>${fmt(lo)}</span><span style="opacity:.6">low → high</span><span>${fmt(hi)}</span>
    </div>`);
}
// pilot 14530
function refreshNeuralAxisSelects() {
  if (!neuralInited) return;
  ['nx-axis','ny-axis','nz-axis','n-size'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = nmOpts(cur);
  });
  const cSel = document.getElementById('n-color');
  if (cSel) {
    const cur = cSel.value;
    // The colour select has its own dedicated 'key' option (Camelot wheel hues) — exclude
    // the numeric camelot POSITION metric here so "Key (Camelot)" doesn't appear twice.
    cSel.innerHTML = `<option value="mood"${cur==='mood'?' selected':''}>Mood</option><option value="key"${cur==='key'?' selected':''}>Key (Camelot)</option><option value="genre"${cur==='genre'?' selected':''}>Genre</option>` + nmOpts(cur, 'camelot');
  }
  // Keep the Spikes dropdown in sync too — tag metrics created/renamed/deleted after boot
  // must appear here like on every other axis select. If the persisted spike metric no
  // longer resolves (its tag was deleted), fall back to Off and persist that.
  const spSel = document.getElementById('n-spike');
  if (spSel) {
    let cur = (typeof neuralSpikeMetric !== 'undefined') ? neuralSpikeMetric : 'off';
    if (cur !== 'off' && !allNeuralMetrics().some(m => m.key === cur)) {
      cur = 'off';
      if (typeof setNeuralSpikeMetric === 'function') setNeuralSpikeMetric('off');
    }
    spSel.innerHTML = `<option value="off"${cur==='off'?' selected':''}>Off</option>` + nmOpts(cur==='off'?null:cur);
  }
}
// pilot 14559
let neuralScene=null, neuralCamera=null, neuralRenderer=null, neuralControls=null;
// pilot 14560
let neuralMeshes=[], neuralEdgeObj=null, neuralEdgeHighlight=null, neuralNodeData=[], neuralAxisObjs=[], neuralCoverSprites=[], neuralTexLoader=null;
// pilot 14565
let neuralInstLayers=[], neuralNodeMat=null, neuralGhostMat=null, _neuralPickRay=null;
// pilot 14568
let neuralRebuildToken = 0;
// pilot 14569
let neuralRing=null, neuralProgressRing=null, neuralRingIdx=-1;
// pilot 14572
let neuralPreviewRing=null;
// pilot 14577
let neuralCompatRings = [];
// pilot 14580
let neuralEdgeStyle = localStorage.getItem('neural-edge-style') || 'both';
// pilot 14612
let playlistTrailObj=null, playlistTrailMarker=null, playlistTrailHalos=[];
// pilot 14616
let _trailIdSet = new Set();
// pilot 14635
const TRAIL_ALL = 1, TRAIL_SOLO = 2;
// pilot 14637
const TRAIL_CYCLE = [TRAIL_SOLO, TRAIL_ALL];
// pilot 14642
let playlistTrailMode = (() => {
  const m = localStorage.getItem('playlist-trail-mode');
  if (m !== null) { const n = parseInt(m, 10); return (n === 2 || n === 3) ? n : 1; }
  return 1;
})();
// pilot 14647
let playlistTrailVisible = playlistTrailMode > 0;
// pilot 14648
function setPlaylistTrailMode(m, persist = true) {
  playlistTrailMode = (m === TRAIL_SOLO) ? TRAIL_SOLO : TRAIL_ALL;
  playlistTrailVisible = true;      // the trail is drawn in every state
  if (persist) { try { localStorage.setItem('playlist-trail-mode', String(playlistTrailMode)); } catch (_) {} }
  document.body.classList.toggle('neural-trail-on',   playlistTrailVisible);
  document.body.classList.toggle('neural-trail-solo', playlistTrailMode === TRAIL_SOLO);
  // SOLO changes WHAT IS VISIBLE and DIM changes only alpha — re-derive both here rather
  // than relying on callers. togglePlaylistTrail already did, but the boot-time restore
  // and any programmatic set did not, so a saved SOLO came back looking like ALL.
  if (typeof neuralInited !== 'undefined' && neuralInited) {
    // Trail first (it rewrites _trailIdSet), then visibility, then alpha — each step
    // reads what the previous one wrote.
    if (typeof rebuildPlaylistTrail === 'function') rebuildPlaylistTrail();
    if (typeof updateMatrixVisibility === 'function') updateMatrixVisibility();
  }
  if (typeof neuralSyncAlpha === 'function' && typeof neuralInstLayers !== 'undefined'
      && neuralInstLayers.length) neuralSyncAlpha();
  // SOLO also changes instance SCALES (ghosts collapse to 0) — repaint the matrices too.
  if (typeof neuralSyncMatrices === 'function' && typeof neuralInstLayers !== 'undefined'
      && neuralInstLayers.length) neuralSyncMatrices();
  // Nudge the cover orbs' easing so a state change reaches them on a still camera too.
  if (typeof neuralCoverPool !== 'undefined') for (const c of neuralCoverPool) c.userData._op ??= 0;
  const b = document.getElementById('matrix-trail-btn');
  if (b) {
    // The trail is always drawn — the button is purely the ISOLATION switch
    // (2026-08-26 pm, Mark): unlit = route over the full field, lit = playlist
    // tracks only. (Mode 0 is unreachable from the UI; title kept for safety.)
    // Three weights for three states: lit = solo, half = dim, plain = all.
    b.classList.toggle('on',    playlistTrailMode === TRAIL_SOLO);
    b.classList.remove('solo');
    // Keep the [5] hint: this rewrite replaces the markup's title wholesale, so without it
    // the one ring button whose tooltip is dynamic was also the only one with no key hint.
    b.title = { [TRAIL_ALL]:  'Pathway — the route is drawn over the whole field. Click to show ONLY the tracks on the route.',
                [TRAIL_SOLO]: 'Pathway SOLO — only the tracks on the route are visible. Click to bring the whole field back.' }[playlistTrailMode]
              + '  [5]';
  }
}
// pilot 14688
let neuralPlayingIdx = -1;
// pilot 14689
let neuralScrubMode=false, neuralScrubArmed=false, neuralScrubArmIdx=-1;
// pilot 14690
let neuralScrubArmY=0, neuralScrubArmX=0, neuralScrubStartT=0, neuralScrubDur=0;
// pilot 14691
let neuralScrubTimer=null, neuralSuppressClick=false;
// pilot 14692
let neuralInited=false, neuralThree=null;
// pilot 14696
let neuralActive=false;
// pilot 14703
const _kbHeld = new Set();                 // physical codes currently down (KeyW, ShiftLeft…)
// pilot 14704
const _kbVel  = {x:0, y:0, z:0};           // camera-space velocity, damped toward the want-vector
// pilot 14705
let kbFocusIdx = -1;                       // keyboard focus node index (-1 = none)
// pilot 14706
let _kbFocusRing = null;                   // teal billboarded ring marking the focused node
// pilot 14707
let _kbLastEnter = {idx:-1, t:0};          // double-tap Enter detection
// pilot 14709
let _kbVecF = null, _kbVecR = null, _kbVecD = null, _kbVecUp = null, _kbProj = null;
// pilot 14710
let neuralLerpT=1, neuralLerpFX=0,neuralLerpFY=0,neuralLerpFZ=0, neuralLerpTX=0,neuralLerpTY=0,neuralLerpTZ=0;
// pilot 14713
let neuralLerpCam=false, neuralLerpCFX=0,neuralLerpCFY=0,neuralLerpCFZ=0, neuralLerpCTX=0,neuralLerpCTY=0,neuralLerpCTZ=0;
// pilot 14715
let pbCamActive=false, pbCamNodeIdx=-1;
// pilot 14716
let pbCam={t:1,dur:120,fromPos:null,toPos:null,fromTgt:null,toTgt:null};
// pilot 14717
let flyActive = (localStorage.getItem('pb-fly-on') ?? '1') === '1';  // cinematic auto-camera engaged
// pilot 14718
let pbProximity = 1;              // Playback: spread slider → camera zoom factor (0.5×–3×)
// pilot 14719
let _pbPrevOrbStyle = null;       // restore the cover-orb setting when leaving Playback
// pilot 14720
let _pbPrevTrail    = null;       // restore the Pathway toggle when leaving Playback
// pilot 14721
let _pbTrailHueByTrack = new Map();  // trackId → hue 0–1 along the pathway (drives the dial colour)
// pilot 14723
function nmOpts(sel, excludeKey) {
  // esc() the label — tag metrics carry free user text ("Tag: <name>") and this string
  // feeds six selects' innerHTML; unescaped, a tag named "</option><option>x" fabricates
  // bogus options (markup injection, matches updateNeuralLegend's escaping convention).
  return allNeuralMetrics().filter(m => m.key !== excludeKey)
    .map(m=>`<option value="${esc(m.key)}"${m.key===sel?' selected':''}>${esc(m.label)}</option>`).join('');
}
// pilot 14731
async function initNeural() {
  const canvas = document.getElementById('neural-canvas');
  const wrap   = canvas.parentElement;

  // Re-entry race guard: neuralInited only flips true AFTER the two dynamic imports —
  // a second call landing inside that await window would build a second renderer +
  // render loop + duplicated listeners. One in-flight init at a time.
  if (window._neuralIniting) return;

  if (!neuralInited) {
    window._neuralIniting = true;
    try {   // guard released in the finally at the end of this block — a throw mid-init
            // (e.g. the Three.js import failing) must never wedge _neuralIniting true,
            // or the tab would be dead for the rest of the session with no retry.
    // Default axis layout: X=BPM, Y=Energy, Z=Valence, Colour=Key, Size=Loudness (LUFS).
    // (The old 'mood' X-default wasn't a valid axis metric, so X silently fell back to
    // the first option — the defaults below are all real keys in NEURAL_METRICS.)
    document.getElementById('nx-axis').innerHTML = nmOpts('bpm');
    document.getElementById('ny-axis').innerHTML = nmOpts('energy');
    document.getElementById('nz-axis').innerHTML = nmOpts('dance');
    document.getElementById('n-color').innerHTML = `<option value="mood">Mood</option><option value="key" selected>Key (Camelot)</option><option value="genre">Genre</option>` + nmOpts(null, 'camelot');
    // 'energy' is the internal key for the metric LABELLED Loudness (the 2026-08-12
    // rename kept the key). 'loudness' matches nothing, which silently made Size=BPM
    // on every fresh install while the comment above promised Loudness.
    document.getElementById('n-size').innerHTML  = nmOpts('energy');
    // Spike-morph dropdown: "Off" + every metric. Restore the persisted choice.
    const spikeSel = document.getElementById('n-spike');
    if (spikeSel) {
      const spikeVal = (typeof neuralSpikeMetric !== 'undefined') ? neuralSpikeMetric : 'off';
      spikeSel.innerHTML = `<option value="off"${spikeVal==='off'?' selected':''}>Off</option>` + nmOpts(spikeVal==='off'?null:spikeVal);
    }

    const T = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    neuralThree = T;

    neuralScene = new T.Scene();
    // Background-image upload feature was removed; always fall back to the colour.
    neuralScene.background = new T.Color(getNeuralBackground());
    neuralScene.fog = fogEnabled ? new T.Fog(FS().fog, FS().fogNear * _fogK(), FS().fogFar * _fogK()) : null;   // fades INTO the field's own ground

    // Never initialise the camera with a 0/NaN aspect — if the container is mid-layout
    // (0-wide) at init time, fall back to a sane aspect; the resize sync corrects it
    // as soon as the wrap gets its real size.
    const initW = wrap.clientWidth || 1280, initH = wrap.clientHeight || 720;
    neuralCamera = new T.PerspectiveCamera(60, initW/initH, 0.1, 1000);
    neuralCamera.position.set(0, 50, 180);

    neuralRenderer = new T.WebGLRenderer({ canvas, antialias:true });
    neuralRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // updateStyle=false: never write an inline px width/height on the canvas. The CSS
    // (#neural-canvas { width:100%; height:100% }) governs DISPLAY size; setSize only
    // sets the drawing buffer. Writing inline px would pin the canvas's own grid track,
    // stopping the wrap from ever growing on window resize (the wide-screen bug).
    neuralRenderer.setSize(initW, initH, false);

    neuralScene.add(new T.AmbientLight(0xffffff, 0.7));
    const dir = new T.DirectionalLight(0xffffff, 1.2);
    dir.position.set(60,100,80); neuralScene.add(dir);

    // (Starfield removed 2026-09-02: 1,200 navy GL points drawn as hard squares — designed
    // for a near-black background, visible as dark specks on the light one. Mark.)

    neuralControls = new OrbitControls(neuralCamera, neuralRenderer.domElement);
    neuralControls.enableDamping = true;
    neuralControls.dampingFactor = 0.08;
    neuralControls.minDistance = 10;
    neuralControls.maxDistance = 500;
    applyViewRange();     // widen everything if this Field opens spread out
    // Both LEFT and RIGHT drag rotate — RIGHT is the unambiguous "rotate, never preview" gesture.
    // Left-drag still rotates (familiar default), but a distance threshold below suppresses the
    // accidental click-on-mouseup that produces unwanted previews when the user meant to orbit.
    neuralControls.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
    // (Fly takeover is handled by the drag classifier below, which excludes scrub gestures —
    // OrbitControls' 'start' fires on pointerdown before we can tell an orbit from a scrub.)
    const raycaster = new T.Raycaster();
    const mouse = new T.Vector2(-9999,-9999);
    let hovIdx = -1;

    canvas.addEventListener('mousemove', ev => {
      if (fpsActive && !_fpsNoLock) return;    // locked: crosshair owns the raycast (pinned to centre); no-lock: the live cursor does
      const r=canvas.getBoundingClientRect();
      mouse.set((ev.clientX-r.left)/r.width*2-1, -(ev.clientY-r.top)/r.height*2+1);
    });
    canvas.addEventListener('mouseleave', () => {
      if (fpsActive && !_fpsNoLock) return;
      mouse.set(-9999,-9999); neuralHideTooltip(); hovIdx=-1;
    });
    // Lets the FPS-mode helpers (outside this closure) pin the hover raycast to the
    // crosshair at screen centre, and park it off-screen again on exit.
    window.__neuralSetMouseNDC = (x, y) => { mouse.set(x, y); _lastRayMX = 9e9; };
    // Hit-test helper shared by click / dblclick.
    // Only raycast VISIBLE meshes — Three's Mesh.raycast ignores object.visible, so
    // filtered-out nodes would otherwise stay clickable and occlude visible ones.
    const matrixHitIdx = (ev) => {
      const r = canvas.getBoundingClientRect();
      // FPS mode: the pointer is locked, so clientX/Y are frozen and meaningless — the
      // crosshair at screen centre IS the cursor.
      // No-lock fallback: the cursor is REAL (clientX/Y live), so pick under it — pinning
      // to centre while showing a free cursor meant clicking a different node than the
      // one under the mouse (review, 2026-08-28).
      const m = (fpsActive && !_fpsNoLock)
        ? new T.Vector2(0, 0)
        : new T.Vector2((ev.clientX-r.left)/r.width*2-1, -(ev.clientY-r.top)/r.height*2+1);
      return neuralPickNode(m.x, m.y);
    };
    canvas.addEventListener('click', ev => {
      if (neuralSuppressClick) { neuralSuppressClick = false; return; }
      if (!neuralMeshes.length) return;
      // FPS: a press-look-release generates a click at frozen coordinates — if the mouse
      // travelled meaningfully while down it was a LOOK, not a click.
      if (typeof fpsActive !== 'undefined' && fpsActive && _fpsTravel > 20) return;
      const idx = matrixHitIdx(ev);
      if (idx < 0) {
        // Empty space — if previewing, snap back to anchor; otherwise do nothing.
        // In FPS a crosshair MISS stays a no-op: yanking the audio back to the anchor on
        // every slightly-off click while flying would be brutal.
        if (typeof fpsActive !== 'undefined' && fpsActive) return;
        if (audioCurrentId && anchorTrackId() && audioCurrentId !== anchorTrackId()) returnToAnchor();
        return;
      }
      // A manual click on a field node overrides any running playlist auto-sequence — the user
      // is steering by hand now. (Auto-advance calls matrixCommitIdx directly, not via this
      // handler, so it is unaffected.)
      _pbSequencing = false; _pbSeqIdx = -1;
      // Shift+click in any mode = quick re-anchor (power-user traversal)
      if (ev.shiftKey) { matrixCommitIdx(idx); return; }
      // Otherwise: single click = preview (anchor preserved)
      matrixPreviewIdx(idx);
    });
    canvas.addEventListener('dblclick', ev => {
      if (!neuralMeshes.length) return;
      const idx = matrixHitIdx(ev);
      if (idx < 0) return;
      _pbSequencing = false; _pbSeqIdx = -1;   // manual commit overrides the auto-sequence
      matrixCommitIdx(idx);
    });

    // ── Click vs drag disambiguation: any left-click whose pointer moved >CLICK_DRAG_PX
    //    between mousedown and mouseup is treated as a drag (orbit) — its trailing click
    //    event gets suppressed so it doesn't fire a preview.
    const CLICK_DRAG_PX = 5;
    let neuralDownX = 0, neuralDownY = 0;
    canvas.addEventListener('mousedown', ev => {
      if (ev.button === 0) { neuralDownX = ev.clientX; neuralDownY = ev.clientY; }
    });
    canvas.addEventListener('mouseup', ev => {
      if (ev.button !== 0) return;
      if (Math.hypot(ev.clientX - neuralDownX, ev.clientY - neuralDownY) > CLICK_DRAG_PX) {
        neuralSuppressClick = true;
      }
    });
    // Right-click drag is now an orbit gesture too — block the system context menu over the canvas
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());

    // ── Fly auto-off: a CAMERA-NAVIGATION drag (orbit / pan / right-drag / touch) hands control
    //    back to the user. A pure click is left alone (it previews), and — crucially — a SCRUB
    //    gesture (hold or vertical drag on a node) does NOT drop Fly: scrubbing the track is not
    //    camera navigation. Scrub is armed on a node-press and reads as vertical-dominant. ──
    let _flyDownX = 0, _flyDownY = 0, _flyDragArmed = false;
    const _flyDropOnDrag = (cx, cy) => {
      if (!_flyDragArmed) return;
      const dx = Math.abs(cx - _flyDownX), dy = Math.abs(cy - _flyDownY);
      if (Math.hypot(dx, dy) <= CLICK_DRAG_PX) return;                 // still a click, not a drag yet
      _flyDragArmed = false;                                           // gesture has resolved
      const isScrub = neuralScrubMode || (neuralScrubArmed && dy >= dx);
      if (!isScrub && typeof currentMode !== 'undefined' && currentMode === 'playback' && flyActive && typeof setFly === 'function') setFly(false);
      // Same gesture reads as leaving a FOCUS position: manually orbiting away means the
      // user is done with the close-up mode — the button un-lights with it.
      if (!isScrub && typeof focusFrameOn !== 'undefined' && focusFrameOn
          && typeof disarmFocusFrame === 'function') disarmFocusFrame();
    };
    canvas.addEventListener('mousedown', ev => { _flyDownX = ev.clientX; _flyDownY = ev.clientY; _flyDragArmed = true; });
    // Explore's Focus-fly disables scroll-zoom while the pilot drives; a dead wheel is a trap,
    // so scrolling reads as "let me look for myself" and releases Focus like a grab does.
    canvas.addEventListener('wheel', ev => {
      if (!ev.deltaY || Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return;   // sideways swipes never zoom
      if (typeof exploreFlyOn === 'function' && exploreFlyOn() && pbCamActive
          && typeof disarmFocusFrame === 'function') disarmFocusFrame();
    }, { passive: true });
    window.addEventListener('mousemove', ev => _flyDropOnDrag(ev.clientX, ev.clientY));
    window.addEventListener('mouseup', () => { _flyDragArmed = false; });
    canvas.addEventListener('touchstart', ev => { const t = ev.touches[0]; if (t) { _flyDownX = t.clientX; _flyDownY = t.clientY; _flyDragArmed = true; } }, { passive: true });
    window.addEventListener('touchmove', ev => { const t = ev.touches[0]; if (t) _flyDropOnDrag(t.clientX, t.clientY); }, { passive: true });
    window.addEventListener('touchend', () => { _flyDragArmed = false; });

    // ── Scrub-on-hold: press + hold (or vertical drag) on a node to scrub the track ──
    const SCRUB_HOLD_MS = 220, SCRUB_MOVE_PX = 6;
    canvas.addEventListener('mousedown', ev => {
      if (ev.button !== 0 || !neuralMeshes.length) return;
      if (fpsActive) return;   // pointer locked: hold-to-scrub can't read a cursor position
      const r=canvas.getBoundingClientRect();
      const m=new T.Vector2((ev.clientX-r.left)/r.width*2-1, -(ev.clientY-r.top)/r.height*2+1);
      const _scrubHit = neuralPickNode(m.x, m.y);
      if (_scrubHit < 0) return;
      neuralScrubArmIdx = _scrubHit;
      neuralScrubArmY = ev.clientY;
      neuralScrubArmX = ev.clientX;
      neuralScrubArmed = true;
      clearTimeout(neuralScrubTimer);
      neuralScrubTimer = setTimeout(() => {
        if (neuralScrubArmed && !neuralScrubMode) enterNeuralScrub(neuralScrubArmIdx);
      }, SCRUB_HOLD_MS);
    });
    document.addEventListener('mousemove', ev => {
      if (neuralScrubArmed && !neuralScrubMode) {
        const dx = Math.abs(ev.clientX - neuralScrubArmX);
        const dy = Math.abs(ev.clientY - neuralScrubArmY);
        if (dy > SCRUB_MOVE_PX && dy > dx) {
          clearTimeout(neuralScrubTimer);
          enterNeuralScrub(neuralScrubArmIdx);
        } else if (dx > SCRUB_MOVE_PX * 1.5 && dx > dy) {
          clearTimeout(neuralScrubTimer);
          neuralScrubArmed = false;
        }
      }
      if (neuralScrubMode && neuralScrubDur > 0) {
        const dy = neuralScrubArmY - ev.clientY;
        const pxPerSec = Math.max(2, canvas.clientHeight / neuralScrubDur);
        const newT = Math.max(0, Math.min(neuralScrubDur, neuralScrubStartT + dy / pxPerSec));
        tfSeekTo(newT);   // scrub is a seek — must not count as crossing the window end
        _pbCurrentFull = false;   // manual scrub overrides full-play → windowed again
      }
    });
    document.addEventListener('mouseup', () => {
      clearTimeout(neuralScrubTimer);
      if (neuralScrubMode) {
        neuralScrubMode = false;
        // In FPS the controls stay suspended — re-enabling them here would hand the camera
        // to OrbitControls while the pointer is locked (exitFPS restores them properly).
        neuralControls.enabled = (typeof fpsActive === 'undefined') || !fpsActive;
        canvas.style.cursor = '';
        neuralSuppressClick = true;
      }
      neuralScrubArmed = false;
    });

    // Sync renderer + camera to the wrap's CURRENT size. Guarded against 0×0 — a
    // resize event while the container is collapsed (tab switch mid-layout, tiny
    // window, dock reflow) must never poison camera.aspect with 0/NaN; we just wait
    // for the next real size.
    function syncNeuralSize() {
      if (!neuralRenderer) return;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      // devicePixelRatio changes when the window moves between displays (Retina ↔
      // external) — refresh it here or the canvas goes blurry / over-renders after a move.
      const pr = Math.min(devicePixelRatio || 1, 2);
      const prStale = neuralRenderer.getPixelRatio() !== pr;
      const cur = neuralRenderer.getSize(new T.Vector2());
      if (!prStale && cur.x === w && cur.y === h && neuralCamera.aspect === w / h) return;
      if (prStale) neuralRenderer.setPixelRatio(pr);
      neuralCamera.aspect = w / h;
      neuralCamera.updateProjectionMatrix();
      neuralRenderer.setSize(w, h, false);   // false: don't pin the canvas with inline px — CSS owns display size
      if (window.__neuralRayDirty) window.__neuralRayDirty();
    }
    window.__syncNeuralSize = () => { syncNeuralSize(); if (typeof sizeAxisLabels === 'function') sizeAxisLabels(); if (typeof syncTransportPos === 'function') syncTransportPos(); };
    window.__syncNeuralSizeRaw = syncNeuralSize;
    new ResizeObserver(() => { syncNeuralSize(); if (typeof sizeAxisLabels === 'function') sizeAxisLabels(); if (typeof syncTransportPos === 'function') syncTransportPos(); }).observe(wrap);
    // RAF (and possibly observer delivery) is suspended while the browser tab is
    // hidden — a window resize made from another tab/Space would otherwise leave the
    // canvas mis-sized until the next RAF tick. Sync explicitly on the moments that
    // matter: window resizes and the tab becoming visible again.
    window.addEventListener('resize', () => { syncNeuralSize(); if (typeof sizeAxisLabels === 'function') sizeAxisLabels(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncNeuralSize(); if (typeof sizeAxisLabels === 'function') sizeAxisLabels(); if (typeof syncTransportPos === 'function') syncTransportPos(); } });

    // Hover raycast gate: with spikes on, each bounding-sphere-hit mesh costs a full
    // triangle test (~6k tris at the reduced spike resolution). Raycasting every RAF
    // frame while the mouse and camera are idle is pure waste — only re-test when the
    // pointer or the view actually changed.
    let _lastRayMX = 9e9, _lastRayMY = 9e9;
    const _lastCamPos = new T.Vector3(9e9, 9e9, 9e9), _lastCamQ = new T.Quaternion();
    // rebuildGraph calls this so a graph swap under a stationary cursor re-raycasts
    window.__neuralRayDirty = () => { _lastRayMX = 9e9; };
    let _sizeCheckFrame = 0;
    (function loop() {
      requestAnimationFrame(loop);
      if (!neuralActive) return;   // Neural tab not visible — keep the loop alive but do no work
      // Self-heal sizing every ~30 frames: ResizeObserver empirically misses some layout
      // paths (filter-bar dock moves, recovery from a collapsed container), which left
      // the canvas squashed or the aspect stale until reload. Cheap: two clientWidth
      // reads, no-ops when nothing changed.
      if ((++_sizeCheckFrame % 30) === 0) syncNeuralSize();
      // OrbitControls.update() repositions the camera from its spherical-around-target state
      // every frame regardless of `enabled`, so in FPS mode it must be skipped outright or it
      // fights the mouse-look rotation.
      if (!fpsActive) neuralControls.update();
      // Keyboard flight — integrated per frame (after controls.update so our pan is the
      // final word), so held keys ease in / glide out instead of stepping at the OS repeat rate.
      applyKeyNav();
      const camMoved = !neuralCamera.position.equals(_lastCamPos) || !neuralCamera.quaternion.equals(_lastCamQ);
      const mouseMoved = mouse.x !== _lastRayMX || mouse.y !== _lastRayMY;
      // Camera-move-only re-tests must not clobber a fresh keyboard-hop tooltip (the mouse
      // is just RESTING over some node); actual mouse movement always takes over.
      const kbHold = !mouseMoved && window._kbTooltipHold > Date.now();
      // Camera-move retests are skipped while the cinematic flyby drives (pbCamActive):
      // the camera moves EVERY frame there, which made this full raycast run at 60 Hz
      // for the whole of Playback with the mouse sitting still.
      if ((((camMoved && !pbCamActive)) || mouseMoved) && !kbHold) {
        _lastRayMX = mouse.x; _lastRayMY = mouse.y;
        _lastCamPos.copy(neuralCamera.position); _lastCamQ.copy(neuralCamera.quaternion);
        // Instanced pick — nearest visible node (filtered-out nodes are zero-scaled → unhittable).
        const hi = neuralPickNode(mouse.x, mouse.y);
        if (hi !== hovIdx) {
          hovIdx = hi;
          if (hi>=0) neuralShowTooltip(hi, lensShift(neuralMeshes[hi].position.clone(), hi));
          else       neuralHideTooltip();
        }
      }
      if (!pbCamActive && neuralLerpT < 1) {
        neuralLerpT = Math.min(1, neuralLerpT + 0.03);
        const t = 1 - Math.pow(1-neuralLerpT, 3);
        neuralControls.target.set(
          neuralLerpFX+(neuralLerpTX-neuralLerpFX)*t,
          neuralLerpFY+(neuralLerpTY-neuralLerpFY)*t,
          neuralLerpFZ+(neuralLerpTZ-neuralLerpFZ)*t
        );
        // ◎ Focus jump-close: the camera rides the same eased flight to its close-up spot.
        if (neuralLerpCam) {
          neuralCamera.position.set(
            neuralLerpCFX+(neuralLerpCTX-neuralLerpCFX)*t,
            neuralLerpCFY+(neuralLerpCTY-neuralLerpCFY)*t,
            neuralLerpCFZ+(neuralLerpCTZ-neuralLerpCFZ)*t
          );
          if (neuralLerpT >= 1) neuralLerpCam = false;
        }
      }
      // Cinematic playback auto-camera (owns the camera while in Playback mode).
      pbCameraTick();
      // Anchor halo — sticky purple ring, follows neuralRingIdx. Hidden in Playback so it can't
      // flicker against the stable-orange progress dial on the same node (the two are coplanar).
      if (neuralRing && neuralRingIdx >= 0 && neuralMeshes[neuralRingIdx]) {
        neuralRing.visible = (currentMode !== 'playback') && neuralMeshes[neuralRingIdx].visible;
        if (neuralRing.visible) {
          const nodePos = neuralMeshes[neuralRingIdx].position;
          const nodeScale = neuralMeshes[neuralRingIdx].scale.x;
          const pulse = 1 + 0.035 * Math.sin(Date.now() * 0.0024);
          const rs = nodeScale * 2.8 * pulse;
          neuralRing.position.copy(nodePos);
          lensShift(neuralRing.position, neuralRingIdx);
          neuralRing.quaternion.copy(neuralCamera.quaternion);
          neuralRing.scale.setScalar(rs);
        }
      }
      // Keyboard focus ring — billboarded teal outline on the arrow-key focused node.
      kbUpdateFocusRing();
      // Compat rings — thin teal halos around every track identified as key-compatible
      // with the anchor. Billboarded to camera; scaled to each node's radius; hidden when
      // the underlying mesh is filtered out.
      if (neuralCompatRings.length) {
        for (const ring of neuralCompatRings) {
          const j = ring.userData.nodeIdx;
          const node = neuralMeshes[j];
          if (!node) { ring.visible = false; continue; }
          ring.visible = node.visible;
          if (!node.visible) continue;
          ring.position.copy(node.position);
          lensShift(ring.position, j);
          ring.quaternion.copy(neuralCamera.quaternion);
          ring.scale.setScalar(node.scale.x * 1.12);
        }
      }
      // Preview ring — visible only when the previewing node differs from the anchor.
      // Drawn as two thin concentric outline strokes, in brand teal, so it reads as "outline of
      // the anchor ring" without competing with the solid purple. Built from a Group containing
      // an inner-edge stroke and an outer-edge stroke at the same radii as the anchor band.
      const isPreviewing = neuralPlayingIdx >= 0 && neuralPlayingIdx !== neuralRingIdx && neuralMeshes[neuralPlayingIdx];
      if (!isPreviewing && neuralPreviewRing) {
        neuralScene.remove(neuralPreviewRing);
        neuralPreviewRing.children.forEach(c => c.geometry?.dispose?.());
        neuralPreviewRing.children[0]?.material?.dispose?.();   // both strokes share one material
        neuralPreviewRing = null;
      } else if (isPreviewing) {
        if (!neuralPreviewRing) {
          const TT = neuralThree;
          const grp = new TT.Group();
          const mat = new TT.MeshBasicMaterial({color:0x1B7A85, side:TT.DoubleSide, transparent:true, opacity:0.9, depthTest:false});
          // Two thin annuli straddling the anchor band edges (anchor is 1.0–1.45)
          [[0.95, 1.0], [1.45, 1.5]].forEach(([ri, ro]) => {
            const g = new TT.RingGeometry(ri, ro, 64);
            grp.add(new TT.Mesh(g, mat));
          });
          neuralPreviewRing = grp;
          neuralScene.add(neuralPreviewRing);
        }
        const pnode = neuralMeshes[neuralPlayingIdx];
        const ps = pnode.scale.x;
        // No pulse on an indicator ring (Mark, 2026-09-02): the glow may breathe, the
        // rings hold still — a ring that changes size reads as flicker, not life.
        neuralPreviewRing.position.copy(pnode.position);
        lensShift(neuralPreviewRing.position, neuralPlayingIdx);
        neuralPreviewRing.quaternion.copy(neuralCamera.quaternion);
        neuralPreviewRing.scale.setScalar(ps * 2.8);
      }
      // Progress dial — follows neuralPlayingIdx (the node currently producing audio), which may
      // be a previewed candidate while the anchor stays put. A dim full-circle base keeps the dial
      // ON the playing node even at 0 progress / while the next track loads, so hopping preview →
      // preview → selected never blinks the indicator out; the coloured arc overlays it as it plays.
      // 2026-09-02 (Mark: "the rings flicker"): the group used to be disposed and rebuilt every
      // time progress ticked 1/512 of the track (~every 0.35 s), and the breathing pulse scaled
      // the whole group, rings included. Now the group is built once per node/mode/colour; the
      // arc is ONE full-circle geometry whose draw range grows with playback (no rebuild, no
      // quantisation); only the aura breathes; base ring and arc hold still.
      if (neuralPlayingIdx >= 0 && neuralMeshes[neuralPlayingIdx]) {
        const TT = neuralThree;
        const playbackDial = (typeof currentMode !== 'undefined' && currentMode === 'playback');
        const dur = globalAudio.duration   || 0;
        const cur = globalAudio.currentTime || 0;
        const prog = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
        let dialColor = 0xffa11f;
        if (playbackDial) {
          const curId = neuralNodeData[neuralPlayingIdx] && neuralNodeData[neuralPlayingIdx].catalogId;
          const hue = curId != null ? _pbTrailHueByTrack.get(curId) : undefined;
          if (typeof hue === 'number') dialColor = new TT.Color().setHSL(hue, 0.75, 0.6).getHex();
        }
        const sig = neuralPlayingIdx + '|' + (playbackDial ? 1 : 0) + '|' + dialColor;
        if (window._dialSig !== sig || !neuralProgressRing) {
          window._dialSig = sig;
          if (neuralProgressRing) {
            neuralScene.remove(neuralProgressRing);
            neuralProgressRing.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
            neuralProgressRing = null;
          }
          const grp = new TT.Group();
          // In Playback the ring + arc adopt the pathway's colour AT the current track (graded
          // spectrum), matching where you are on the unicorn trail; falls back to orange. The centre
          // glow (aura) is deliberately NOT tinted — it stays a light, very subtle neutral.
          const ringColor = playbackDial ? dialColor : 0xffffff;
          // Centre glow — faint, light, neutral (soft white); much subtler than the ring, never tinted.
          const auraGeo = new TT.RingGeometry(0.82, 2.05, 64);
          const auraMat = new TT.MeshBasicMaterial({color: playbackDial ? 0xffffff : 0x9aa8ff, side:TT.DoubleSide, transparent:true, opacity: playbackDial ? 0.05 : 0.09, depthTest:false, blending:TT.AdditiveBlending});
          const aura = new TT.Mesh(auraGeo, auraMat); aura.name = 'aura'; grp.add(aura);
          // Thin base track — a slim full ring.
          const baseGeo = new TT.RingGeometry(1.26, 1.44, 96);
          const baseMat = new TT.MeshBasicMaterial({color: ringColor, side:TT.DoubleSide, transparent:true, opacity: playbackDial ? 0.4 : 0.16, depthTest:false});
          grp.add(new TT.Mesh(baseGeo, baseMat));
          // Progress arc — a full ring built from 12 o'clock, drawn only as far as playback has
          // reached (setDrawRange below). RingGeometry indexes 6 vertices per theta segment in
          // theta order, so the first k segments ARE the arc. Mirrored in x so it grows clockwise.
          const ARC_SEGS = 192;
          const arcGeo = new TT.RingGeometry(1.26, 1.44, ARC_SEGS, 1, Math.PI / 2, Math.PI * 2);
          const arcMat = new TT.MeshBasicMaterial({color: 0x3F7D5A, side:TT.DoubleSide, transparent:true, opacity:0.97, depthTest:false});
          const arc = new TT.Mesh(arcGeo, arcMat); arc.name = 'arc'; arc.scale.x = -1;
          arc.userData.segs = ARC_SEGS;
          grp.add(arc);
          neuralProgressRing = grp;
          neuralScene.add(neuralProgressRing);
        }
        // Per-frame: arc length + colour (cheap attribute writes, no geometry churn).
        const arc = neuralProgressRing.getObjectByName('arc');
        if (arc) {
          arc.geometry.setDrawRange(0, 6 * Math.round(prog * arc.userData.segs));
          arc.visible = prog > 0;
          const arcColor = playbackDial ? dialColor : (prog < 0.33 ? 0x3F7D5A : prog < 0.66 ? 0xD99A16 : 0xD6451B);
          if (arc.material.color.getHex() !== arcColor) arc.material.color.setHex(arcColor);
        }
        // Per-frame transform. The pulse lives on the AURA alone (Mark, 2026-09-02): the glow
        // breathes, the rings and the arc hold their size.
        const playingScale = neuralMeshes[neuralPlayingIdx].scale.x;
        const aura = neuralProgressRing.getObjectByName('aura');
        if (aura) aura.scale.setScalar(1 + 0.035 * Math.sin(Date.now() * 0.0024));
        neuralProgressRing.position.copy(neuralMeshes[neuralPlayingIdx].position);
        lensShift(neuralProgressRing.position, neuralPlayingIdx);
        neuralProgressRing.quaternion.copy(neuralCamera.quaternion);
        neuralProgressRing.scale.setScalar(playingScale * (playbackDial ? 1.4 : 2.8));   // #26: Playback dial ~50% smaller
      } else if (neuralProgressRing) {
        neuralScene.remove(neuralProgressRing);
        neuralProgressRing.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        neuralProgressRing = null;
        window._dialSig = null;
      }
      // ◐ Lens — render-time near-field displacement (no-op unless toggled on).
      applyLens();
      // Playlist trail — pulse opacity + move marker. Tube geometry isn't rebuilt here;
      // that only happens in rebuildPlaylistTrail() on real data changes.
      updatePlaylistTrailAnimation();
      // HUD orientation gizmo (bottom-right) tracks the camera.
      drawAxisGizmo();
      // On-demand cover art — texture only the nearest N visible nodes to the camera.
      neuralUpdateCovers();
      neuralRenderer.render(neuralScene, neuralCamera);
    })();

    neuralInited = true;
    } finally {
      // ALWAYS release the re-entry guard — success or throw. neuralInited stays false
      // on failure, so the next tab visit retries the whole init cleanly.
      window._neuralIniting = false;
    }
  }

  // Tab re-entry PERF (2026-07-24): a full teardown + rebuild (and cover-texture refetch)
  // only when the catalog actually changed underneath us (loadCatalog sets the dirty flag).
  // Otherwise a visibility/fade/trail refresh covers filters or playlist edits made on
  // other tabs at a fraction of the cost.
  if (!neuralMeshes.length || window._neuralGraphDirty) {
    rebuildGraph();
  } else {
    updateMatrixVisibility();
    if (typeof rebuildPlaylistTrail === 'function') rebuildPlaylistTrail();
    if (window.__neuralRayDirty) window.__neuralRayDirty();
  }
  // First visit to the Field tab — surface the keyboard controls once.
  kbMaybeShowHint();
}
// pilot 15269
function pbEaseInOut(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }
// pilot 15272
function pbEffectiveZoom() {
  // FLY's closest approach backed off 2026-08-28 (Mark): at the old peak (3.3×) the node
  // filled the view — the near end of the breath is capped at 2.31× so the minimum
  // camera distance grows ~1.43× and the node reads ~30% smaller at its biggest.
  // The far end of the sweep (0.3×) is untouched, as is the manual slider (pbProximity).
  if (flyActive || (typeof exploreFlyOn === 'function' && exploreFlyOn()))
    return 1.305 + 1.005 * Math.sin(Date.now() * 0.00007);   // 0.3…2.31
  return pbProximity;
}
// pilot 15281
function pbCurrentNodeIdx() {
  if (typeof neuralPlayingIdx !== 'undefined' && neuralPlayingIdx >= 0 && neuralMeshes[neuralPlayingIdx]) return neuralPlayingIdx;
  if (typeof neuralRingIdx   !== 'undefined' && neuralRingIdx   >= 0 && neuralMeshes[neuralRingIdx])   return neuralRingIdx;
  return neuralMeshes.findIndex(m => m.visible);
}
// pilot 15286
function pbCameraStart() {
  if (!neuralControls || !neuralCamera) return;
  pbCamActive = true;
  pbCamNodeIdx = -1;
  neuralLerpT = 1; neuralLerpCam = false;   // a half-finished focus jump must not resume later
  // Hover retests are suspended during the flyby — clear any lingering tooltip now.
  if (typeof neuralHideTooltip === 'function') neuralHideTooltip();
  // Fly mode: the auto-pilot drives, but the user can still GRAB the camera to take over — an
  // orbit/pan drag fires OrbitControls' 'start', which flips Fly off (see the listener). Zoom is
  // owned by the spread slider in Playback, so scroll-zoom is disabled here.
  neuralControls.enableRotate = true;
  neuralControls.enablePan    = true;
  neuralControls.enableZoom   = false;
  neuralControls.autoRotate   = true;
  neuralControls.autoRotateSpeed = 0.6;
  neuralControls.minDistance  = 1.5;   // allow the close cover-art orbit
}
// pilot 15303
function pbCameraStop() {
  pbCamActive = false;
  pbCamNodeIdx = -1;
  pbCam.t = 1;
  neuralLerpT = 1; neuralLerpCam = false;
  if (!neuralControls) return;
  neuralControls.enableRotate = true;
  neuralControls.enablePan    = true;
  neuralControls.enableZoom   = true;
  neuralControls.autoRotate   = false;
  // The pilot orbits at ~3–10 units; restoring the floor to 10 at once made OrbitControls
  // clamp on its next update and the view jumped outward the instant you took over.
  // Hold the floor at the current distance; pbCameraTick relaxes it as you dolly out.
  const dist = neuralCamera ? neuralCamera.position.distanceTo(neuralControls.target) : PB_MIN_DIST;
  neuralControls.minDistance  = Math.min(PB_MIN_DIST, Math.max(1.5, dist));
}
// pilot 15319
function pbCameraFlyToNode(idx, immediate) {
  if (!neuralControls || !neuralCamera || idx < 0 || !neuralMeshes[idx]) return;
  const T = neuralThree;
  const node = neuralMeshes[idx];
  const P = node.position;
  const nodeScale = node.scale.x || 1;
  // Orbit distance: 1× zoom = the original wide distance (nodeScale × 9); the Playback zoom slider
  // (pbProximity) divides it to fly closer. The floor keeps us just outside the node surface.
  const radius = Math.max(nodeScale * 1.2, (nodeScale * 9) / Math.max(0.25, pbEffectiveZoom()));
  // Approach along the travel direction from the previous node so it reads as "following the path".
  const prevIdx = pbCamNodeIdx;
  const dir = new T.Vector3();
  if (prevIdx >= 0 && neuralMeshes[prevIdx]) dir.copy(P).sub(neuralMeshes[prevIdx].position);
  if (dir.lengthSq() < 1e-4) dir.copy(P).sub(neuralCamera.position);   // travel = camera → node, so we stop on OUR side
  dir.y = 0;
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
  dir.normalize();
  const toPos = P.clone().addScaledVector(dir, -radius);   // sit behind, along travel
  toPos.y += radius * 0.45;                                // …and slightly raised → descending look
  pbCam.fromPos = neuralCamera.position.clone();
  pbCam.toPos   = toPos;
  pbCam.fromTgt = neuralControls.target.clone();
  pbCam.toTgt   = P.clone();
  const dist = (prevIdx >= 0 && neuralMeshes[prevIdx]) ? P.distanceTo(neuralMeshes[prevIdx].position) : 0;
  pbCam.dur = immediate ? 40 : Math.max(70, Math.min(260, Math.round(dist * 3.2)));  // speed ∝ spacing
  pbCam.t = 0;
  pbCamNodeIdx = idx;
}
// pilot 15353
const PB_MIN_DIST = 10;   // OrbitControls' normal closest approach outside the pilot
// pilot 15356
function resetNeuralUser() {
  if (typeof exploreFlyOn === 'function' && exploreFlyOn()) {
    if (typeof disarmFocusFrame === 'function') disarmFocusFrame();
    if (pbCamActive) pbCameraStop();
  }
  resetNeural();
}
// pilot 15363
function exploreFlyOn() {
  return typeof currentMode !== 'undefined' && currentMode === 'explore'
      && typeof focusFrameOn !== 'undefined' && focusFrameOn
      && !(typeof fpsActive !== 'undefined' && fpsActive);
}
// pilot 15369
function pbCameraTick() {
  if (!neuralControls || !neuralCamera) return;
  const hasNode = (typeof neuralPlayingIdx !== 'undefined' && neuralPlayingIdx >= 0 && neuralMeshes[neuralPlayingIdx])
               || (typeof neuralRingIdx   !== 'undefined' && neuralRingIdx   >= 0 && neuralMeshes[neuralRingIdx]);
  // Explore needs REAL audio (audioCurrentId), not merely a ring: rebuildGraph restores the
  // playlist's anchor ring on boot and on every axis change, and a ring alone would send the
  // camera diving into a silent field (review, 2026-09-17). Pause keeps the id; Stop clears it.
  const live = typeof audioCurrentId !== 'undefined' && !!audioCurrentId;
  const want = ((typeof currentMode !== 'undefined' && currentMode === 'playback') && flyActive)
            || (exploreFlyOn() && live && !!hasNode);
  // Release leaves minDistance low so the camera is not snapped outward (see pbCameraStop);
  // the floor follows the user back out to its normal value and never pushes the view.
  if (!pbCamActive && neuralControls.minDistance < PB_MIN_DIST) {
    const d = neuralCamera.position.distanceTo(neuralControls.target);
    neuralControls.minDistance = Math.min(PB_MIN_DIST, Math.max(neuralControls.minDistance, d));
  }
  if (want && !pbCamActive) pbCameraStart();
  else if (!want && pbCamActive) pbCameraStop();
  if (!pbCamActive) return;
  const pIdx = pbCurrentNodeIdx();
  if (pIdx >= 0 && pIdx !== pbCamNodeIdx) pbCameraFlyToNode(pIdx, pbCamNodeIdx < 0);
  if (pbCam.t < 1 && pbCam.toPos) {
    pbCam.t = Math.min(1, pbCam.t + 1 / pbCam.dur);
    const e = pbEaseInOut(pbCam.t);
    neuralCamera.position.lerpVectors(pbCam.fromPos, pbCam.toPos, e);
    neuralControls.target.lerpVectors(pbCam.fromTgt, pbCam.toTgt, e);
    neuralControls.autoRotate = false;               // our tween owns the camera during the fly
  } else {
    neuralControls.autoRotate = true;                // arrived → slow low orbit
    const node = neuralMeshes[pbCamNodeIdx];
    if (node) {
      neuralControls.target.lerp(node.position, 0.08);   // stay centred if the node drifts (spread etc.)
      // Slow zoom breathing: ease the camera's distance toward the (modulating) target radius so
      // it glides in and out between 0.3× and 3.3× while autoRotate handles the angular orbit.
      const nodeScale = node.scale.x || 1;
      const desired = Math.max(nodeScale * 1.2, (nodeScale * 9) / Math.max(0.25, pbEffectiveZoom()));
      const off = neuralCamera.position.clone().sub(neuralControls.target);
      const len = off.length();
      if (len > 1e-4) { off.setLength(len + (desired - len) * 0.08); neuralCamera.position.copy(neuralControls.target).add(off); }
    }
  }
}
// pilot 15413
function setFly(on, opts) {
  // Engaging the cinematic flyby while first-person is active would put TWO drivers on the
  // camera (pbCameraTick tweening vs mouse-look writing rotation) — hand over cleanly first.
  if (on && typeof fpsActive !== 'undefined' && fpsActive) exitFPS();
  flyActive = !!on;
  // Playback ENTRY force-engages the flyby with {persist:false} — the user's own saved
  // preference must survive the auto-engage (it was being clobbered on every entry).
  if (!opts || opts.persist !== false) {
    try { localStorage.setItem('pb-fly-on', flyActive ? '1' : '0'); } catch (_) {}
  }
  const btn = document.getElementById('fly-toggle');
  if (btn) { btn.classList.toggle('on', flyActive); btn.setAttribute('aria-pressed', flyActive ? 'true' : 'false'); }
  // Reflect the zoom mode in the spread label while in Playback (auto-breathing vs manual).
  if (typeof currentMode !== 'undefined' && currentMode === 'playback') {
    const lbl = document.getElementById('nt-spread-label');
    if (lbl) lbl.textContent = flyActive ? 'Zoom · auto' : 'Zoom';
  }
  // release the camera immediately on takeover — but not Explore's Focus pilot, which the
  // Fly switch does not own (Y there used to stop it for one frame and re-approach with a lurch)
  if (!flyActive && pbCamActive && !(typeof exploreFlyOn === 'function' && exploreFlyOn())) pbCameraStop();
  // pbCameraTick re-starts the flyby on the next frame whenever flyActive && Playback.
}
// pilot 15435
function toggleFly() { setFly(!flyActive); }
// pilot 15442
let fpsActive = false;
// pilot 15443
let _fpsYaw = 0, _fpsPitch = 0, _fpsOrbitDist = 120;
// pilot 15449
let _fpsNoLock = false, _fpsDragging = false, _fpsLockTimer = null;
// pilot 15455
let _fpsDeadMoves = 0;
// pilot 15456
const FPS_DEAD_MOVES = 6;
// pilot 15463
let _fpsNoLockReason = '';
// pilot 15465
function _fpsDragLookFallback(why, reason) {
  if (!fpsActive || _fpsNoLock) return;
  _fpsNoLock = true;
  _fpsNoLockReason = reason || 'timeout';
  clearTimeout(_fpsLockTimer);
  // Release the lock, or the cursor stays hidden and frozen while we ask the user to drag it.
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  document.body.classList.add('fps-nolock');
  // The centre pin belongs to the locked mode — hand the raycast back to the real cursor.
  if (window.__neuralSetMouseNDC) window.__neuralSetMouseNDC(-9999, -9999);
  if (typeof showToast === 'function')
    showToast(why + ' — hold the mouse button and drag to look; WASD still flies', { subtle: true });
}
// pilot 15478
let _fpsTravel = 0;               // px of locked mouse motion since last press — look-drags aren't clicks
// pilot 15479
let _kbNearestDist = 60;          // sampled distance to the nearest node (FPS speed basis)
// pilot 15480
let _kbNearFrame = 0, _kbLastT = 0;
// pilot 15481
const FPS_SENS = 0.0022;                 // radians per pixel of mouse movement
// pilot 15482
const FPS_PITCH_LIMIT = Math.PI/2 - 0.02;
// pilot 15483
function enterFPS() {
  if (fpsActive || !neuralInited || !neuralCamera || !neuralControls) return;
  // Only meaningful on the Field tab — the transport (and its FPS pill) is visible on
  // every tab, and locking the pointer to a hidden canvas just thrashes pointerlockerror.
  if (typeof neuralActive !== 'undefined' && !neuralActive) return;
  // No pointer-lock support (some embedded webviews) → a zombie half-mode; refuse cleanly.
  const cvEl = document.getElementById('neural-canvas');
  if (!cvEl || typeof cvEl.requestPointerLock !== 'function') {
    if (typeof showToast === 'function') showToast('First-person mode needs pointer-lock support');
    return;
  }
  // A scrub armed / in progress at this instant would re-enable OrbitControls from its
  // mouseup and leave a stale hold-timer — clear the whole scrub state machine first.
  neuralScrubArmed = false; neuralScrubMode = false;
  clearTimeout(neuralScrubTimer);
  cvEl.style.cursor = '';
  // Cancel any in-flight commit target-tween: it would keep lerping the (now inert) orbit
  // target during FPS and snap the pivot after exit rebuilds it.
  neuralLerpT = 1;
  const T = neuralThree;
  // Seed yaw/pitch from the CURRENT view so engaging never snaps the camera.
  const dir = new T.Vector3();
  neuralCamera.getWorldDirection(dir);
  _fpsYaw   = Math.atan2(-dir.x, -dir.z);
  // Clamp the SEED too — an orbit view pitched past the FPS limit would otherwise snap on
  // the first locked mouse move when the per-move clamp kicks in.
  _fpsPitch = Math.max(-FPS_PITCH_LIMIT, Math.min(FPS_PITCH_LIMIT,
                Math.asin(Math.max(-1, Math.min(1, dir.y)))));
  // Raw distance here; clamped against the CURRENT controls limits at exit time (Playback
  // entry temporarily changes minDistance, so clamping now could pin the exit pivot wrong).
  _fpsOrbitDist = neuralCamera.position.distanceTo(neuralControls.target);
  fpsActive = true;
  if (typeof featUse === 'function') featUse('fps_mode');
  neuralControls.enabled = false;          // and the loop skips controls.update() while active
  neuralCamera.rotation.order = 'YXZ';
  document.body.classList.add('fps-on');
  const btn = document.getElementById('fps-toggle');
  if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed','true'); }
  // Crosshair is the cursor now — point the hover raycast at screen centre.
  if (window.__neuralSetMouseNDC) window.__neuralSetMouseNDC(0, 0);
  // Cinematic camera hands over, exactly like grabbing the view with the mouse.
  if (typeof currentMode !== 'undefined' && currentMode === 'playback' && flyActive && typeof setFly === 'function') setFly(false);
  // Same hand-over for Explore's Focus pilot — otherwise Focus stays armed through the flight
  // and leaving FPS yanks the camera straight back to the playing node.
  // (Raw condition, not exploreFlyOn(): that is false by definition once fpsActive is set above.)
  if (typeof currentMode !== 'undefined' && currentMode === 'explore' && typeof focusFrameOn !== 'undefined'
      && focusFrameOn && typeof disarmFocusFrame === 'function') disarmFocusFrame();
  const cv = document.getElementById('neural-canvas');
  // Chrome returns a Promise and enforces a ~1s cooldown after a lock exit — swallow the
  // async rejection too (pointerlockerror already exits FPS cleanly; no console spray).
  if (cv && cv.requestPointerLock) { try { const p = cv.requestPointerLock(); p?.catch?.(() => {}); } catch (_) {} }
  // If the environment quietly refuses the lock, switch to drag-look rather than dying.
  _fpsNoLock = false; _fpsNoLockReason = ''; _fpsDragging = false;
  clearTimeout(_fpsLockTimer);
  _fpsDeadMoves = 0;
  _fpsLockTimer = setTimeout(() => {
    if (!fpsActive || document.pointerLockElement) return;
    _fpsDragLookFallback('No pointer lock here', 'timeout');
  }, 400);
}
// pilot 15543
function exitFPS() {
  if (!fpsActive) return;
  fpsActive = false;
  clearTimeout(_fpsLockTimer);
  _fpsNoLock = false; _fpsNoLockReason = ''; _fpsDragging = false;
  document.body.classList.remove('fps-on', 'fps-nolock');
  const btn = document.getElementById('fps-toggle');
  if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-pressed','false'); }
  _kbHeld.clear(); _kbVel.x = _kbVel.y = _kbVel.z = 0;
  if (document.pointerLockElement && document.exitPointerLock) { try { document.exitPointerLock(); } catch (_) {} }
  if (neuralCamera && neuralControls && neuralThree) {
    // Put the orbit target back in front of the camera at the distance we came in with, so
    // resuming mouse-orbit pivots around what the user is looking at instead of the old point.
    const T = neuralThree;
    const dir = new T.Vector3();
    neuralCamera.getWorldDirection(dir);
    const d = Math.max(neuralControls.minDistance, Math.min(neuralControls.maxDistance, _fpsOrbitDist || 60));
    neuralControls.target.copy(neuralCamera.position).addScaledVector(dir, d);
    // A commit tween begun during FPS must not keep dragging the freshly-placed pivot.
    neuralLerpT = 1;
    neuralControls.enabled = true;
    neuralControls.update();
  }
  if (window.__neuralSetMouseNDC) window.__neuralSetMouseNDC(-9999, -9999);
  if (typeof neuralHideTooltip === 'function') neuralHideTooltip();
}
// pilot 15569
function toggleFPS() {
  if (!fpvUnlocked()) return;      // locked: F, digit 6 and a stray click all no-op
  fpsActive ? exitFPS() : enterFPS();
}
// pilot 15577
const _KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown',
                 'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'];
// pilot 15579
let _konamiAt = 0;
// pilot 15580
function fpvUnlocked() {
  try { return localStorage.getItem('fpv-unlocked') === '1'; } catch (_) { return false; }
}
// pilot 15583
function _fpvApplyLock() {
  const on = fpvUnlocked();
  const btn = document.getElementById('fps-toggle');
  if (btn) btn.style.display = on ? '' : 'none';
  // The ? keyboard-help rows for FPS follow the lock too — documenting a hidden mode
  // both spoils the egg and describes keys that do nothing (review, 2026-08-28).
  document.querySelectorAll('.kb-fps-row').forEach(r => { r.style.display = on ? '' : 'none'; });
}
// pilot 15591
function _fpvUnlock() {
  if (fpvUnlocked()) return;
  try { localStorage.setItem('fpv-unlocked', '1'); } catch (_) {}
  _fpvApplyLock();
  if (typeof showToast === 'function')
    showToast('FPV unlocked — press F to fly it yourself', { subtle: false });
}
// pilot 15601
document.addEventListener('keydown', e => {
  if (fpvUnlocked()) return;
  if (typeof isTypingContext === 'function' && isTypingContext(e.target)) { _konamiAt = 0; return; }
  if (typeof neuralActive === 'undefined' || !neuralActive) { _konamiAt = 0; return; }
  if (e.code === _KONAMI[_konamiAt]) {
    _konamiAt++;
    if (_konamiAt === _KONAMI.length) { _konamiAt = 0; _fpvUnlock(); }
  } else {
    // A wrong key restarts — but a stray ↑ is itself a valid prefix. Keep the LONGEST
    // one: after ↑↑ a third ↑ still leaves two good ↑s on the table, so credit 2, not 1
    // — with only 1, the comment's own "↑↑↑↓↓…" case still failed (review, 2026-08-28).
    _konamiAt = (e.code === _KONAMI[0]) ? (_konamiAt >= 2 ? 2 : 1) : 0;
  }
});
// pilot 15615
if (true /* module: runs before DOMContentLoaded */)
  document.addEventListener('DOMContentLoaded', _fpvApplyLock, { once: true });
else _fpvApplyLock();
// pilot 15619
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {          // lock granted (possibly late) → real mouse-look
    if (fpsActive) {
      // A lock that arrives LATE cancels the fallback — unless we gave up on a DUD one,
      // or we would bounce straight back into the dead-mouse state.
      if (!_fpsNoLock) { _fpsDragging = false; document.body.classList.remove('fps-nolock'); _fpsDeadMoves = 0; }
      else if (_fpsNoLockReason === 'timeout') {
        // The lock was only slow, not broken. Take it and restore real mouse-look, or we sit
        // locked-but-flagged-unlocked: cursor hidden and frozen, crosshair off, clicks
        // raycasting from wherever the cursor stopped.
        _fpsNoLock = false; _fpsNoLockReason = ''; _fpsDragging = false; _fpsDeadMoves = 0;
        document.body.classList.remove('fps-nolock');
        if (window.__neuralSetMouseNDC) window.__neuralSetMouseNDC(0, 0);   // crosshair owns the raycast again
      } else {
        // Dud lock re-granted (WKWebView does this). Refuse it rather than hide the cursor.
        try { document.exitPointerLock(); } catch (_) {}
      }
    }
    return;
  }
  // Lock lost. In the no-lock fallback there was never a lock to lose — stay in FPS.
  if (fpsActive && !_fpsNoLock) exitFPS();
});
// pilot 15642
document.addEventListener('pointerlockerror',  () => { if (fpsActive) exitFPS(); });
// pilot 15645
document.addEventListener('mousemove', ev => {
  if (!fpsActive || !neuralCamera) return;
  // A mouseup delivered outside the window never reaches us — if the buttons bitmask
  // says nothing is held, the drag is over, whatever we think (review, 2026-08-28).
  if (_fpsDragging && ev.buttons === 0) _fpsDragging = false;
  // Locked: every move steers. No-lock fallback: only a held drag steers, so the (still
  // visible) cursor can cross the UI without spinning the view.
  if (!document.pointerLockElement && !(_fpsNoLock && _fpsDragging)) return;
  // Dud lock (see _fpsDeadMoves): the pointer is locked and the mouse is demonstrably
  // moving — the event fired — yet the deltas are 0. A few of those in a row and we stop
  // waiting for a lock that will never steer anything.
  if (document.pointerLockElement && !_fpsNoLock) {
    if (!(ev.movementX || 0) && !(ev.movementY || 0)) {
      if (++_fpsDeadMoves >= FPS_DEAD_MOVES) { _fpsDragLookFallback('This window never reports mouse movement', 'dead'); return; }
    } else { _fpsDeadMoves = 0; }
  }
  _fpsYaw   -= (ev.movementX || 0) * FPS_SENS;
  _fpsPitch -= (ev.movementY || 0) * FPS_SENS;   // natural (non-inverted) look
  _fpsPitch = Math.max(-FPS_PITCH_LIMIT, Math.min(FPS_PITCH_LIMIT, _fpsPitch));
  // Look-drag detection: clientX/Y are frozen under a lock, so the click handler can't use
  // its distance test — accumulate relative travel instead (reset on mousedown).
  _fpsTravel += Math.abs(ev.movementX || 0) + Math.abs(ev.movementY || 0);
  neuralCamera.rotation.order = 'YXZ';
  neuralCamera.rotation.set(_fpsPitch, _fpsYaw, 0);
});
// pilot 15670
document.addEventListener('mousedown', ev => {
  if (!fpsActive) return;
  _fpsTravel = 0;
  // Drag-look only starts ON the canvas — a click on a drawer or the transport is UI.
  if (_fpsNoLock && ev.button === 0 && ev.target && ev.target.id === 'neural-canvas') _fpsDragging = true;
});
// pilot 15676
document.addEventListener('mouseup', () => { _fpsDragging = false; });
// pilot 15684
function _kbModalOpen() {
  const ids = ['kbnav-help-modal','rb-setup-modal','rb-coll-modal','feedback-modal',
               'repair-config-modal','repair-suggest-modal','confirm-modal',
               'import-modal','fpcalc-help-modal','settings-modal',
               'formula-popup','sb-draw','sb-preview','ci-review-modal','settools-box','arc-report'];
  return ids.some(id => {
    const el = document.getElementById(id);
    return el && getComputedStyle(el).display !== 'none';
  });
}
// pilot 15695
function _kbBlocked(e) {
  return !neuralActive || !neuralInited || isTypingContext(e.target)
         || e.metaKey || e.ctrlKey || e.altKey || _kbModalOpen();
}
// pilot 15701
const KB_ACCEL = 0.18;      // ease-in toward the wanted velocity
// pilot 15702
const KB_DAMP  = 0.82;      // glide-out when keys release
// pilot 15703
const KB_SPRINT = 3;        // Shift multiplier
// pilot 15706
let kbSpeedMult = (() => {
  const v = parseFloat(localStorage.getItem('kb-speed-mult'));
  return Number.isFinite(v) ? Math.max(0.25, Math.min(2.5, v)) : 1;
})();
// pilot 15710
function setKbSpeed(pct) {
  kbSpeedMult = Math.max(0.25, Math.min(2.5, (parseInt(pct, 10) || 100) / 100));
  try { localStorage.setItem('kb-speed-mult', String(kbSpeedMult)); } catch (_) {}
  const s = document.getElementById('kb-speed');
  if (s && Math.round(kbSpeedMult * 100) !== +s.value) s.value = Math.round(kbSpeedMult * 100);
  const v = document.getElementById('kb-speed-val');
  if (v) v.textContent = Math.round(kbSpeedMult * 100) + '%';
}
// pilot 15718
(function syncKbSpeedAtBoot() {
  const apply = () => setKbSpeed(Math.round(kbSpeedMult * 100));
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 15723
function applyKeyNav() {
  if (!neuralCamera || !neuralControls || !neuralThree) return;
  const T = neuralThree;
  if (!_kbVecF) { _kbVecF = new T.Vector3(); _kbVecR = new T.Vector3(); _kbVecD = new T.Vector3(); _kbVecUp = new T.Vector3(0,1,0); }
  // Frame-time compensation: the velocity model was tuned at 60 Hz — scale accel/damp/travel
  // by dt so 120/144 Hz displays fly the same real-world speed, not 2×.
  const now = performance.now();
  const dt = _kbLastT ? Math.min(50, now - _kbLastT) : 16.7;
  _kbLastT = now;
  const k = Math.min(3, Math.max(0.5, dt / 16.667));
  // The entry guards gate only NEW keydowns — a key already held when a modal opens or
  // focus lands in an input would keep flying behind it. Clear held state on transition.
  if (_kbHeld.size && (_kbModalOpen() || isTypingContext(document.activeElement))) _kbHeld.clear();
  const sprint = (_kbHeld.has('ShiftLeft') || _kbHeld.has('ShiftRight')) ? KB_SPRINT : 1;
  const wx = (_kbHeld.has('KeyD') ? 1 : 0) - (_kbHeld.has('KeyA') ? 1 : 0);
  const wy = (_kbHeld.has('KeyQ') ? 1 : 0) - (_kbHeld.has('KeyE') ? 1 : 0);
  const wz = (_kbHeld.has('KeyW') ? 1 : 0) - (_kbHeld.has('KeyS') ? 1 : 0);
  // Movement input always claims the camera — covers the flyby being RE-engaged while a
  // key was already held (the keydown-time takeover only fires on fresh presses).
  if ((wx || wy || wz) && typeof currentMode !== 'undefined' && currentMode === 'playback'
      && flyActive && typeof setFly === 'function') setFly(false);
  if ((wx || wy || wz) && pbCamActive && typeof exploreFlyOn === 'function' && exploreFlyOn()
      && typeof disarmFocusFrame === 'function') disarmFocusFrame();
  // Adaptive speed. Orbit mode: distance to the orbit target (surgical near, fast far).
  // FPS: the target is INERT — keying speed off it explodes exponentially flying away and
  // crawls flying near it. Use the distance to the nearest visible node instead (sampled
  // every 15th frame; 1.6k distance checks at ~4 Hz is negligible).
  let dist;
  if (typeof fpsActive !== 'undefined' && fpsActive) {
    if ((_kbNearFrame++ % 15) === 0 && neuralMeshes.length) {
      let best = Infinity;
      for (const m of neuralMeshes) {
        if (!m.visible) continue;
        const d2 = m.position.distanceToSquared(neuralCamera.position);
        if (d2 < best) best = d2;
      }
      _kbNearestDist = Number.isFinite(best) && best < Infinity ? Math.sqrt(best) : 60;
    }
    dist = Math.min(300, _kbNearestDist);
  } else {
    dist = neuralCamera.position.distanceTo(neuralControls.target);
  }
  const speed = Math.max(0.25, dist * 0.01) * sprint * kbSpeedMult;   // halved 2026-07-25; user multiplier 2026-08-03
  const accel = 1 - Math.pow(1 - KB_ACCEL, k);
  _kbVel.x += (wx * speed - _kbVel.x) * accel;
  _kbVel.y += (wy * speed - _kbVel.y) * accel;
  _kbVel.z += (wz * speed - _kbVel.z) * accel;
  if (!wx && !wy && !wz) {
    const damp = Math.pow(KB_DAMP, k);
    _kbVel.x *= damp; _kbVel.y *= damp; _kbVel.z *= damp;
  }
  if (Math.abs(_kbVel.x) + Math.abs(_kbVel.y) + Math.abs(_kbVel.z) < 0.001) return;
  // Camera-relative basis. Up stays WORLD up so Q/E always mean up/down (never roll).
  // Right comes from the camera's own world matrix (column 0) rather than cross(fwd, up):
  // the cross product degenerates to ~zero when looking straight up or down (the orbit
  // poles), and normalising it would NaN the velocity — and then the camera position.
  neuralCamera.getWorldDirection(_kbVecF);
  _kbVecR.setFromMatrixColumn(neuralCamera.matrixWorld, 0).normalize();
  _kbVecD.set(0,0,0)
    .addScaledVector(_kbVecF, _kbVel.z)
    .addScaledVector(_kbVecR, _kbVel.x)
    .addScaledVector(_kbVecUp, _kbVel.y)
    .multiplyScalar(k);              // dt-scaled travel — same real speed at any refresh rate
  // Move camera AND target together (a pan) so orbiting afterwards stays coherent. In FPS
  // mode the target is inert (controls suspended) and is recomputed on exit, so leave it.
  neuralCamera.position.add(_kbVecD);
  if (!fpsActive) neuralControls.target.add(_kbVecD);
}
// pilot 15793
function kbClearFocus() {
  kbFocusIdx = -1;
  if (_kbFocusRing) _kbFocusRing.visible = false;
  if (typeof neuralHideTooltip === 'function') neuralHideTooltip();
}
// pilot 15798
function kbSetFocus(idx) {
  if (idx < 0 || !neuralMeshes[idx]) return kbClearFocus();
  kbFocusIdx = idx;
  // Hold the hop tooltip against the hover raycast for a moment: flying/hopping moves the
  // camera, which re-fires the hover test at the RESTING mouse position and would clobber
  // this tooltip with a different node's. Real mouse movement still wins immediately.
  window._kbTooltipHold = Date.now() + 1500;
  if (typeof neuralShowTooltip === 'function') neuralShowTooltip(idx, lensShift(neuralMeshes[idx].position.clone(), idx));
}
// pilot 15808
function kbUpdateFocusRing() {
  if (!neuralThree || !neuralCamera) return;
  const T = neuralThree;
  const show = kbFocusIdx >= 0 && neuralMeshes[kbFocusIdx] && neuralMeshes[kbFocusIdx].visible
               && !(typeof currentMode !== 'undefined' && currentMode === 'playback');
  if (!show) { if (_kbFocusRing) _kbFocusRing.visible = false; return; }
  if (!_kbFocusRing) {
    const geo = new T.RingGeometry(1, 1.18, 48);
    const mat = new T.MeshBasicMaterial({color:0x1B7A85, side:T.DoubleSide, transparent:true, opacity:0.95, depthTest:false});
    _kbFocusRing = new T.Mesh(geo, mat);
    _kbFocusRing.renderOrder = 3;
    neuralScene.add(_kbFocusRing);
  }
  const node = neuralMeshes[kbFocusIdx];
  const pulse = 1 + 0.05 * Math.sin(Date.now() * 0.005);
  _kbFocusRing.visible = true;
  _kbFocusRing.position.copy(node.position);
  lensShift(_kbFocusRing.position, kbFocusIdx);
  _kbFocusRing.quaternion.copy(neuralCamera.quaternion);
  _kbFocusRing.scale.setScalar(node.scale.x * 3.2 * pulse);
}
// pilot 15832
function kbHopFocus(dirX, dirY) {
  if (!neuralCamera || !neuralThree || !neuralMeshes.length) return;
  const T = neuralThree;
  if (!_kbProj) _kbProj = new T.Vector3();
  const aspect = neuralCamera.aspect || 1;
  const project = (i) => {
    _kbProj.copy(neuralMeshes[i].position).project(neuralCamera);
    return {x: _kbProj.x * aspect, y: _kbProj.y, z: _kbProj.z};
  };
  // Seed: current focus → anchor → playing → visible node nearest screen centre.
  // A focus BEHIND the camera projects to mirrored screen coords, which would send every
  // hop the wrong way — treat it as no-focus and re-seed instead.
  if (kbFocusIdx >= 0 && neuralMeshes[kbFocusIdx]?.visible && project(kbFocusIdx).z >= 1) kbFocusIdx = -1;
  if (kbFocusIdx < 0 || !neuralMeshes[kbFocusIdx]?.visible) {
    let seed = -1;
    if (neuralRingIdx >= 0 && neuralMeshes[neuralRingIdx]?.visible) seed = neuralRingIdx;
    else if (neuralPlayingIdx >= 0 && neuralMeshes[neuralPlayingIdx]?.visible) seed = neuralPlayingIdx;
    else {
      let best = Infinity;
      for (let i = 0; i < neuralMeshes.length; i++) {
        if (!neuralMeshes[i].visible) continue;
        const p = project(i);
        if (p.z >= 1) continue;
        const d = p.x*p.x + p.y*p.y;
        if (d < best) { best = d; seed = i; }
      }
    }
    if (seed >= 0) kbSetFocus(seed);
    return;   // first arrow press just establishes focus
  }
  const from = project(kbFocusIdx);
  const dl = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / dl, uy = dirY / dl;
  let bestIdx = -1, bestScore = Infinity;
  for (let i = 0; i < neuralMeshes.length; i++) {
    // Filter-fade ghosts are hoppable, matching mouse clickability; only fully-hidden
    // nodes (fade at 0) are skipped.
    if (i === kbFocusIdx || (!neuralMeshes[i].visible && !ghostsInteractive())) continue;
    const p = project(i);
    if (p.z >= 1) continue;                       // behind the camera
    const ox = p.x - from.x, oy = p.y - from.y;
    const dist = Math.hypot(ox, oy);
    if (dist < 1e-6) continue;
    const along = (ox * ux + oy * uy);            // projection onto the direction
    if (along / dist <= 0.5) continue;            // outside the cone
    const perp = Math.abs(ox * uy - oy * ux);     // perpendicular offset
    const score = dist + 1.5 * perp;              // prefer straight-ahead, then near
    if (score < bestScore) { bestScore = score; bestIdx = i; }
  }
  if (bestIdx >= 0) kbSetFocus(bestIdx);
}
// pilot 15884
function kbActivateFocus(commit) {
  if (kbFocusIdx < 0 || !neuralMeshes[kbFocusIdx]) return;
  // A filter change since the last hop may have hidden the focused node — never act on
  // something the user can no longer see (ghosts at fade > 0 remain actionable).
  if (!neuralMeshes[kbFocusIdx].visible && !ghostsInteractive()) { kbClearFocus(); return; }
  if (commit) { matrixCommitIdx(kbFocusIdx); return; }
  matrixPreviewIdx(kbFocusIdx);
}
// pilot 15894
const _KB_MOVE_CODES = new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight']);
// pilot 15913
const _SC_DOCK = ['matrix-reset-btn', 'matrix-focus-btn', 'vecmath-btn',
                  'matrix-coverorb-btn', 'matrix-trail-btn', 'fps-toggle'];
// pilot 15917
const _SC_DRAWER = { KeyZ: 'axes-drawer', KeyX: 'filters-drawer', KeyC: 'key-drawer' };
// pilot 15918
const _SC_MODES = ['explore', 'learn', 'playback'];
// pilot 15919
document.addEventListener('keydown', e => {
  // ⌘/Ctrl/Alt chords belong to the browser and to ⌘, — never shadow them.
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (typeof isTypingContext === 'function' && isTypingContext(e.target)) return;
  if (typeof _kbModalOpen === 'function' && _kbModalOpen()) return;
  // Everything here belongs to the Field tab; elsewhere the keys stay free.
  if (typeof neuralActive === 'undefined' || !neuralActive) return;

  const digit = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
  if (digit) {
    const btn = document.getElementById(_SC_DOCK[+digit[1] - 1]);
    // offsetParent===null → the button is hidden (⋈ with Vector maths switched off, or
    // the dock itself in Playback). A shortcut must never fire an invisible control.
    if (btn && btn.offsetParent !== null) { e.preventDefault(); btn.click(); }
    return;
  }
  if (_SC_DRAWER[e.code]) {
    e.preventDefault();
    if (typeof toggleDrawer === 'function') toggleDrawer(_SC_DRAWER[e.code]);
    return;
  }
  if (e.code === 'KeyM') {
    e.preventDefault();
    if (typeof setMode === 'function' && typeof currentMode !== 'undefined') {
      const i = _SC_MODES.indexOf(currentMode);
      setMode(_SC_MODES[(i + 1) % _SC_MODES.length]);
    }
    return;
  }
  if (e.code === 'KeyY') {
    e.preventDefault();
    if (typeof toggleFly === 'function') toggleFly();
    return;
  }
});
// pilot 15954
document.addEventListener('keydown', e => {
  // The help overlay must close from the keyboard even though _kbModalOpen() blocks every
  // other route while it's up — '?' toggles it shut, Esc dismisses it. Checked BEFORE the
  // blanket guard, which would otherwise block the very key that opened it.
  {
    const help = document.getElementById('kbnav-help-modal');
    if (help && getComputedStyle(help).display !== 'none'
        && !isTypingContext(e.target) && ((e.key === '?' && !e.repeat) || e.key === 'Escape')) {
      e.preventDefault(); closeKbHelp(); return;
    }
  }
  // macOS quirk: keyUP events are not delivered for regular keys while ⌘ is held — a key
  // released during a ⌘-chord would stay stuck in _kbHeld until blur. Clear on ⌘ press.
  if (e.key === 'Meta') { _kbHeld.clear(); return; }
  if (_kbBlocked(e)) return;
  const code = e.code;
  if (_KB_MOVE_CODES.has(code)) {
    if (!e.repeat) {
      // First movement key while the cinematic camera flies = user takeover (same rule
      // as grabbing the view with the mouse). Once, not per frame.
      if (code !== 'ShiftLeft' && code !== 'ShiftRight'
          && typeof currentMode !== 'undefined' && currentMode === 'playback'
          && flyActive && typeof setFly === 'function') setFly(false);
    }
    _kbHeld.add(code);
    e.preventDefault();
    return;
  }
  if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
    e.preventDefault();
    kbHopFocus(code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : 0,
               code === 'ArrowUp'    ? 1 : code === 'ArrowDown' ? -1 : 0);
    return;
  }
  if (code === 'Enter' || code === 'NumpadEnter') {
    if (kbFocusIdx < 0) return;
    // Accessibility: a focused button/link keeps its native Enter behaviour.
    const at = (document.activeElement?.tagName || '').toLowerCase();
    if (at === 'button' || at === 'a') return;
    e.preventDefault();
    // OS auto-repeat would machine-gun the double-tap window into a stream of commits —
    // only genuine presses count, and repeats must not refresh the timestamp either.
    if (e.repeat) return;
    const now = Date.now();
    const doubleTap = _kbLastEnter.idx === kbFocusIdx && (now - _kbLastEnter.t) < 400;
    _kbLastEnter = {idx: kbFocusIdx, t: now};
    // Shift doubles as the flight SPRINT key — while movement keys are held it means
    // "faster", not "commit". Double-tap remains the commit route mid-flight.
    const flying = _kbHeld.has('KeyW') || _kbHeld.has('KeyA') || _kbHeld.has('KeyS')
                || _kbHeld.has('KeyD') || _kbHeld.has('KeyQ') || _kbHeld.has('KeyE');
    kbActivateFocus((e.shiftKey && !flying) || doubleTap);
    return;
  }
  if (code === 'KeyF' && !e.shiftKey && fpvUnlocked()) { e.preventDefault(); if (!e.repeat) toggleFPS(); return; }
  if (code === 'KeyV' && !e.shiftKey) { e.preventDefault(); if (!e.repeat) toggleKeyFanPreview(); return; }
  if (e.key === '?') { e.preventDefault(); if (!e.repeat) toggleKbHelp(); return; }
});
// pilot 16011
document.addEventListener('keyup', e => {
  if (_KB_MOVE_CODES.has(e.code)) _kbHeld.delete(e.code);
});
// pilot 16015
window.addEventListener('blur', () => { _kbHeld.clear(); if (typeof _fpsDragging !== 'undefined') _fpsDragging = false; });
// pilot 16017
function toggleKbHelp() {
  const m = document.getElementById('kbnav-help-modal');
  if (!m) return;
  const opening = getComputedStyle(m).display === 'none';
  // Opening the sheet while the pointer is locked would leave an unclickable modal with
  // mouse-look still running behind it — leave first-person first.
  if (opening && typeof fpsActive !== 'undefined' && fpsActive) exitFPS();
  m.style.display = opening ? 'flex' : 'none';
}
// pilot 16026
function closeKbHelp() { const m = document.getElementById('kbnav-help-modal'); if (m) m.style.display = 'none'; }
// pilot 16028
function kbMaybeShowHint() {
  // Don't burn the one-shot hint on an empty field — defer (flag unset) until the
  // first visit with real tracks, when flying somewhere actually means something.
  if (!catalog.some(e => e.data)) return;
  if (localStorage.getItem('kbnav-hint-seen') === '1') return;
  try { localStorage.setItem('kbnav-hint-seen', '1'); } catch (_) {}
  if (typeof showToast === 'function') showToast('WASD to fly · arrows to hop · Enter to play · ? for keys');
}
// pilot 16039
function renderTrackCount(visN, totalN) {
  const el = document.getElementById('neural-track-count');
  if (!el) return;
  if (!totalN) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  if (visN === totalN) {
    el.innerHTML = `
      <span class="ncb-visible">${totalN}</span>
      <span class="ncb-label">track${totalN!==1?'s':''}</span>`;
  } else {
    el.innerHTML = `
      <span class="ncb-visible">${visN}</span>
      <span class="ncb-sep">/</span>
      <span class="ncb-total">${totalN}</span>
      <span class="ncb-label">tracks</span>`;
  }
}
// pilot 16069
const KEYFAN_MAX        = 12;   // hard cap on spokes/rings drawn
// pilot 16070
const KEYFAN_AZIMUTHS   = 8;    // direction buckets around the hub…
// pilot 16071
const KEYFAN_ELEVATIONS = 3;    // …times elevation bands, so the cap spreads in 3D
// pilot 16072
const KEYFAN_PER_SECTOR = 1;    // nearest N per bucket before the cap is applied
// pilot 16073
const KEYFAN_MIN_ALPHA  = 0.22; // faintest surviving spoke
// pilot 16077
function _keyFanShortlist(hubIdx, cands) {
  const hub = neuralMeshes[hubIdx]?.position;
  if (!hub) return [];
  const scored = [];
  for (const i of cands) {
    if (i === hubIdx) continue;
    const p = neuralMeshes[i]?.position;
    if (!p) continue;
    const dx = p.x - hub.x, dy = p.y - hub.y, dz = p.z - hub.z;
    const d = Math.hypot(dx, dy, dz);
    if (!(d > 1e-6)) continue;          // co-located: no direction to draw
    scored.push({ i, dist: d, dx, dy, dz });
  }
  if (scored.length <= 1) return scored.map(o => ({ i: o.i, dist: o.dist, a: 1 }));
  scored.sort((x, y) => x.dist - y.dist);
  // Thin by direction so a cap of 12 cannot become twelve lines into one cone.
  const perBucket = new Map(), keep = [];
  for (const o of scored) {
    const az = Math.floor((Math.atan2(o.dz, o.dx) + Math.PI) / (2 * Math.PI) * KEYFAN_AZIMUTHS) % KEYFAN_AZIMUTHS;
    const el = Math.min(KEYFAN_ELEVATIONS - 1,
                Math.floor((Math.asin(Math.max(-1, Math.min(1, o.dy / o.dist))) + Math.PI / 2) / Math.PI * KEYFAN_ELEVATIONS));
    const k = az + ':' + el;
    const n = perBucket.get(k) || 0;
    if (n >= KEYFAN_PER_SECTOR) continue;
    perBucket.set(k, n + 1);
    keep.push(o);
    if (keep.length >= KEYFAN_MAX) break;
  }
  // Sparse fields can leave buckets empty and the cap unfilled — top up by distance
  // rather than drawing fewer spokes than asked for.
  if (keep.length < Math.min(KEYFAN_MAX, scored.length)) {
    const taken = new Set(keep.map(o => o.i));
    for (const o of scored) {
      if (keep.length >= KEYFAN_MAX) break;
      if (!taken.has(o.i)) { keep.push(o); taken.add(o.i); }
    }
    keep.sort((x, y) => x.dist - y.dist);
  }
  const n = keep.length;
  return keep.map((o, r) => ({
    i: o.i, dist: o.dist,
    a: n <= 1 ? 1 : 1 - (1 - KEYFAN_MIN_ALPHA) * (r / (n - 1)),
  }));
}
// pilot 16136
function neuralCompatNeighbours(idx) {
  const out = new Set();
  if (idx < 0 || !neuralMeshes[idx] || !neuralNodeData[idx]) return out;
  const eM = (typeof camelotCompatMode !== 'undefined' && camelotCompatMode !== 'off')
    ? camelotCompatMode : 'none';
  if (eM === 'none') return out;
  const ci = neuralNodeData[idx].camelot;
  if (!ci) return out;
  const allowed = compatKeysFor(ci, eM, 'sym');
  for (let j = 0; j < neuralMeshes.length; j++) {
    if (j === idx || !neuralMeshes[j].visible) continue;
    const cj = neuralNodeData[j] && neuralNodeData[j].camelot;
    if (cj && allowed.has(cj)) out.add(j);
  }
  return out;
}
// pilot 16153
function refreshNeuralEdgeHighlight() {
  if (!neuralScene || !neuralThree) return;
  // Dispose old line-segments + compat rings before rebuilding
  if (neuralEdgeHighlight) {
    neuralScene.remove(neuralEdgeHighlight);
    neuralEdgeHighlight.geometry?.dispose?.();
    neuralEdgeHighlight = null;
  }
  for (const r of neuralCompatRings) {
    neuralScene.remove(r);
    r.geometry?.dispose?.();
    r.material?.dispose?.();
  }
  neuralCompatRings = [];

  // Playback disables every other key visual (High-Vis fade, anchor ring) — the teal
  // compat rings and clique lines must not survive into the cinematic view either.
  if (typeof currentMode !== 'undefined' && currentMode === 'playback') {
    if (typeof applyHighVisibility === 'function') applyHighVisibility();
    return;
  }
  // Rings and lines are gated only by their own switches (neuralEdgeStyle) since the
  // Key View master toggle was retired (2026-08-03). The wheel's key FILTER is
  // independent and applies regardless.
  const T = neuralThree;
  const pos = [], segs = [], cols = [];   // cols = RGBA per vertex, so rank can fade a spoke
  // What styles are active right now? Driven by the 3-position switch under TRAIL.
  const wantRings = neuralEdgeStyle === 'rings' || neuralEdgeStyle === 'both';
  const wantLines = neuralEdgeStyle === 'lines' || neuralEdgeStyle === 'both';
  // Compat ring — thin band (≈1.5 px visual outline) sitting just outside the orb edge.
  // Geometry 1.00 → 1.08 keeps the band slim; the per-frame `setScalar` (~1.1×) hugs the orb.
  const compatGeo = wantRings ? new T.RingGeometry(1.00, 1.08, 64) : null;
  const compatMat = wantRings ? new T.MeshBasicMaterial({
    color: 0x1B7A85,
    side: T.DoubleSide,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  }) : null;

  // ── Manual mode: when keys are picked on the wheel with compat-mode = off, treat the
  //    selection as a "highlight set" — ring every currently-visible node whose key is
  //    in the set, and draw a clique of connecting lines between them. Lets the user
  //    visualise "all the tracks I've selected" as a connected sub-graph.
  const manualMode = typeof camelotCompatMode !== 'undefined' && camelotCompatMode === 'off';
  const hasManualKeys = manualMode && typeof activeFilters !== 'undefined'
                        && activeFilters?.keys?.size > 0;
  if (hasManualKeys) {
    // Find every visible node whose key matches the selected Camelot set.
    const selectedIdx = [];
    for (let i = 0; i < neuralMeshes.length; i++) {
      if (!neuralMeshes[i]?.visible) continue;
      const cam = neuralNodeData[i]?.camelot;
      if (cam && activeFilters.keys.has(cam)) selectedIdx.push(i);
    }
    if (!selectedIdx.length) {
      if (typeof applyHighVisibility === 'function') applyHighVisibility();
      return;
    }
    // Rings and lines share ONE shortlist so they agree about what matters, and so a
    // 600-match selection can't ring the entire field (2026-08-29).
    const _mHub = _keyFanHubIdx();
    const _mShort = (_mHub >= 0) ? _keyFanShortlist(_mHub, selectedIdx) : [];
    if (wantRings) {
      // With no hub there is nothing to rank against — fall back to ringing the
      // matches, still capped, so the view stays readable.
      const ringList = _mShort.length ? _mShort
        : selectedIdx.slice(0, KEYFAN_MAX).map(i => ({ i, a: 1 }));
      for (const o of ringList) {
        const ring = new T.Mesh(compatGeo, compatMat.clone());
        ring.material.opacity = 0.92 * o.a;
        ring.userData.nodeIdx = o.i;
        ring.renderOrder = 1;
        neuralScene.add(ring);
        neuralCompatRings.push(ring);
      }
    }
    // Lines FAN OUT FROM THE ORIGIN ONLY (Mark, 2026-08-02): the current full-selected
    // track — or the PREVIEW track when the ⊙ Preview relations switch (V) is on. With
    // no origin there are NO lines at all: the key filter already makes membership
    // obvious from what's visible, so the old no-hub clique was pure noise.
    if (wantLines && selectedIdx.length >= 2 && _mHub >= 0) {
      const ph = neuralMeshes[_mHub].position;
      for (const o of _mShort) {
        const pb = neuralMeshes[o.i].position;
        pos.push(ph.x, ph.y, ph.z, pb.x, pb.y, pb.z);
        segs.push([_mHub, o.i]);
        // Fade along the spoke too — brightest at the hub, softest at the far end.
        cols.push(1, 1, 1, o.a, 1, 1, 1, o.a * 0.55);
      }
    }
  } else {
    // Default flow — origin-based: connect the origin node (anchor, or the preview
    // track when the ⊙ Preview relations switch is on) to its compat set.
    const idx = _keyFanHubIdx();
    const _adj = neuralCompatNeighbours(idx);
    if (idx < 0 || !_adj.size) {
      if (typeof applyHighVisibility === 'function') applyHighVisibility();
      return;
    }
    const pi = neuralMeshes[idx].position;
    // Only the shortlist is drawn — see _keyFanShortlist. The compat SET is unchanged;
    // this is purely about how much of it is worth putting on screen at once.
    for (const o of _keyFanShortlist(idx, _adj)) {
      const pj = neuralMeshes[o.i].position;
      if (wantLines) {
        pos.push(pi.x, pi.y, pi.z, pj.x, pj.y, pj.z);
        segs.push([idx, o.i]);
        cols.push(1, 1, 1, o.a, 1, 1, 1, o.a * 0.55);
      }
      if (wantRings) {
        const ring = new T.Mesh(compatGeo, compatMat.clone());
        ring.material.opacity = 0.92 * o.a;
        ring.userData.nodeIdx = o.i;
        ring.renderOrder = 1;
        neuralScene.add(ring);
        neuralCompatRings.push(ring);
      }
    }
  }

  if (wantLines && pos.length) {
    const eg = new T.BufferGeometry();
    eg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    // 4-component vertex colour = per-spoke alpha (three r166 supports RGBA here), which
    // is what lets rank fade a line without a draw call per spoke.
    if (cols.length === (pos.length / 3) * 4) eg.setAttribute('color', new T.Float32BufferAttribute(cols, 4));
    neuralEdgeHighlight = new T.LineSegments(eg, new T.LineBasicMaterial({
      color: 0x4A3FBF, transparent: true, opacity: 0.95, linewidth: 2,
      vertexColors: cols.length === (pos.length / 3) * 4,
    }));
    // Per-segment node indices so the ◐ Lens can slide line endpoints with their
    // displaced nodes each frame (and restore them when it disengages).
    neuralEdgeHighlight.userData.segIdx = segs;
    neuralScene.add(neuralEdgeHighlight);
  }
  if (typeof applyHighVisibility === 'function') applyHighVisibility();
}
// pilot 16297
function togglePlaylistTrail() {
  // Explicit user toggle wins over any pending Playback auto-restore (see toggleCoverOrbs).
  _pbPrevTrail = null;
  // TWO states since dc42231 (Mark, 2026-09-20): SOLO ⇄ ALL. TRAIL_DIM no longer exists.
  // TRAIL_CYCLE is the authority — read it rather than trusting this comment.
  const i = TRAIL_CYCLE.indexOf(playlistTrailMode);
  setPlaylistTrailMode(TRAIL_CYCLE[(i + 1) % TRAIL_CYCLE.length]);
  // Order matters: rebuildPlaylistTrail rewrites _trailIdSet, which the DIM alpha pass
  // reads. Painting first rendered one edit behind (review, 2026-08-27).
  // setPlaylistTrailMode above already re-derived visibility and alpha, so this used to
  // run the whole O(N) visibility pass twice per click on a 14k-track field.
  rebuildPlaylistTrail();
  if (typeof neuralSyncAlpha === 'function' && neuralInstLayers.length) neuralSyncAlpha();
}
// pilot 16319
let neuralSpread = (() => {
  const v = parseFloat(localStorage.getItem('neural-spread'));
  // Range 2026-07-21: ×0.5 (tighter) … ×3 (wider). Default ×1.
  return (isFinite(v) && v >= 0.5 && v <= 3) ? v : 1.0;
})();
// pilot 16334
function applyViewRange() {
  const k = (typeof neuralSpread === 'number') ? neuralSpread : 1;
  if (typeof neuralControls !== 'undefined' && neuralControls) neuralControls.maxDistance = 500 * k;
  if (typeof neuralCamera !== 'undefined' && neuralCamera) {
    const far = 1000 * k;
    if (neuralCamera.far !== far) { neuralCamera.far = far; neuralCamera.updateProjectionMatrix(); }
  }
  if (typeof applyFog === 'function') applyFog();
  if (typeof requestNeuralRender === 'function') requestNeuralRender();
}
// pilot 16346
function setSpreadFill(n) {
  const sl = document.getElementById('n-spread');
  if (!sl) return;
  const lo = parseInt(sl.min, 10) || 50, hi = parseInt(sl.max, 10) || 300;
  sl.style.setProperty('--nt-spread-pct', (((n - lo) / (hi - lo)) * 100).toFixed(1) + '%');
}
// pilot 16355
function syncSpreadDial() {
  const inp = document.getElementById('n-spread');
  const arc = document.getElementById('nt-spread-arc');
  if (!inp || !arc) return;
  const min = +inp.min || 50, max = +inp.max || 300;
  const t = Math.max(0, Math.min(1, ((+inp.value || 100) - min) / (max - min)));
  const C = 163.4;                       // 2*pi*r with r=26
  const sweep = 0.75;                    // three-quarter dial: -135deg .. +135deg
  arc.style.strokeDashoffset = String(C * (1 - t * sweep));
}
// pilot 16365
(function wireSpreadDial() {
  const wire = () => {
    const d = document.getElementById('nt-spread-dial');
    const inp = document.getElementById('n-spread');
    if (!d || !inp) return;
    syncSpreadDial();
    // VERTICAL drag (Mark, 2026-08-27): up opens the field out, down pulls it in. A
    // native range only drags horizontally, so the pointer is handled here and the input
    // is pointer-events:none — it stays as the value store and the keyboard control.
    d.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const startY = ev.clientY, startV = +inp.value;
      const range = (+inp.max - +inp.min) || 250;
      const PX_FOR_FULL_RANGE = 220;          // a comfortable forearm's travel
      d.setPointerCapture(ev.pointerId);
      const move = e2 => {
        const dv = ((startY - e2.clientY) / PX_FOR_FULL_RANGE) * range;   // up = more
        const step = +inp.step || 5;
        const v = Math.round((startV + dv) / step) * step;
        inp.value = Math.max(+inp.min, Math.min(+inp.max, v));
        setNeuralSpread(inp.value); syncSpreadDial();
        e2.preventDefault();
      };
      const up = () => {
        d.removeEventListener('pointermove', move);
        d.removeEventListener('pointerup', up);
        d.removeEventListener('pointercancel', up);
        commitNeuralSpread();
      };
      d.addEventListener('pointermove', move);
      d.addEventListener('pointerup', up);
      d.addEventListener('pointercancel', up);
      ev.preventDefault();
    });
    // Double-click snaps back to ×1 (Mark, 2026-08-28) — the knob's home position.
    d.addEventListener('dblclick', ev => {
      ev.preventDefault();
      inp.value = 100;
      setNeuralSpread(100); syncSpreadDial();
      commitNeuralSpread();
    });
    // Scroll over the dial nudges it — the gesture people try on a knob first.
    d.addEventListener('wheel', ev => {
      ev.preventDefault();
      const step = (+inp.step || 5) * (ev.deltaY < 0 ? 1 : -1);
      inp.value = Math.max(+inp.min, Math.min(+inp.max, (+inp.value) + step));
      setNeuralSpread(inp.value); syncSpreadDial();
      clearTimeout(d._commitT);
      d._commitT = setTimeout(() => commitNeuralSpread(), 220);
    }, { passive: false });
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
// pilot 16420
function setNeuralSpread(pct) {
  const n = parseInt(pct, 10);
  if (!isFinite(n)) return;
  const lbl = document.getElementById('nt-spread-label');
  // In Playback on the Field tab the slider becomes a camera ZOOM (proximity) control for the
  // cinematic orbit instead of morphing node positions — quick in/out on the node. No graph rebuild.
  if (typeof currentMode !== 'undefined' && currentMode === 'playback') {
    // Fly ON: the auto-modulated zoom owns the camera — the drag moves the visual fill
    // only. pbProximity is NOT written, so turning Fly off later doesn't inherit a value
    // the user set while the slider had no effect.
    if (flyActive) { setSpreadFill(n); if (lbl) lbl.textContent = 'Zoom · auto'; return; }
    // Slider 50–300 → zoom ~0.29×…7× (wide range), exactly 1.0× at the default (100). 1× is the
    // original wide distance; higher zoom flies closer (distance = original ÷ zoom).
    pbProximity = Math.max(0.25, Math.min(8, Math.pow(n / 100, 1.8)));
    if (lbl) lbl.textContent = 'Zoom';
    setSpreadFill(n);
    // Manual zoom (Fly off): dolly the camera directly along its current view axis. The old
    // pbCameraFlyToNode() re-fly restarted a 70–260-frame tween on EVERY input event, which
    // read as stutter/lag. (With Fly on, the hold-phase easing chases pbEffectiveZoom() each
    // frame, so the slider needs no camera work at all.)
    if (!flyActive && neuralCamera && neuralControls) {
      const node = (pbCamNodeIdx >= 0 && neuralMeshes[pbCamNodeIdx]) ? neuralMeshes[pbCamNodeIdx]
                 : (neuralRingIdx  >= 0 && neuralMeshes[neuralRingIdx]) ? neuralMeshes[neuralRingIdx] : null;
      const nodeScale = node ? (node.scale.x || 1) : 1;
      const desired = Math.max(nodeScale * 1.2, (nodeScale * 9) / Math.max(0.25, pbProximity));
      const off = neuralCamera.position.clone().sub(neuralControls.target);
      if (off.lengthSq() > 1e-8) { off.setLength(desired); neuralCamera.position.copy(neuralControls.target).add(off); }
    }
    return;
  }
  neuralSpread = Math.max(0.5, Math.min(3, n / 100));   // range ×0.5–×3 (Mark, 2026-08-28 pm, confirmed); default ×1
  // Reaching this function means the slider moved, which only the user does — so from
  // here on the automatic sizing steps aside for good.
  applyViewRange();      // fog, orbit range and far plane follow the field's new size
  try { localStorage.setItem('neural-spread', neuralSpread); } catch (_) {}
  // Label text is CONSTANT (Mark, 2026-08-04). It used to append "0.9×" and drop the
  // number at exactly 1.0 — as a flex sibling that width change reflowed the whole bar
  // mid-drag, so the slider jumped under the cursor right at the ×1 notch.
  if (lbl) lbl.textContent = 'Spread';
  setSpreadFill(n);
  // Live position-only morph during the drag (rAF-throttled) — the old full rebuildGraph()
  // per input event tore down + rebuilt every mesh and re-fetched every cover texture,
  // which froze the field and flashed the covers on large catalogs. The full
  // collision-relaxed rebuild now happens once, on release (commitNeuralSpread).
  if (!window._spreadMorphRAF) {
    window._spreadMorphRAF = requestAnimationFrame(() => {
      window._spreadMorphRAF = null;
      neuralSpreadLiveMorph();
    });
  }
}
// pilot 16476
function neuralSpreadLiveMorph() {
  if (!neuralInited || !neuralMeshes.length) return;
  const SPREAD = Math.round(neuralFieldSpread());
  const base   = window._neuralBuildSpread || SPREAD;
  const scale  = base ? SPREAD / base : 1;
  // Collision offsets are never SHRUNK below their build value — scaling them down while
  // tightening would let neighbouring orbs interpenetrate during the drag. (The release
  // rebuild re-runs real collision either way.)
  const rdScale = Math.max(1, scale);
  // MUST stay formula-identical with rebuildGraph's morphPos() (incl. the ×1→×2 tanh fade).
  const morph  = (n) => {
    if (neuralSpread <= 1) return n - 0.5;
    const c = (n - 0.5) * 2;
    const w = Math.min(1, neuralSpread - 1);
    return (1 - w) * (c * 0.5) + w * (Math.tanh(c * neuralSpread) * 0.5);
  };
  for (const m of neuralMeshes) {
    const nn = m.userData.rawNorm;
    if (!nn) continue;
    const rd = m.userData.relaxDelta || {x: 0, y: 0, z: 0};
    m.position.set(
      morph(nn.x) * SPREAD + rd.x * rdScale,
      morph(nn.y) * SPREAD + rd.y * rdScale,
      morph(nn.z) * SPREAD + rd.z * rdScale
    );
  }
  // Push the new positions into the instance matrices (proxies just moved).
  neuralSyncMatrices();
  // Sprite covers (V2 sphere-cover style) ride above their node
  if (neuralCoverSprites.length) {
    const idxById = new Map();
    neuralNodeData.forEach((d, i) => idxById.set(d.catalogId, i));
    for (const s of neuralCoverSprites) {
      const i = idxById.get(s.userData?.catalogId);
      if (i === undefined || !neuralMeshes[i]) continue;
      const node = neuralMeshes[i];
      s.position.set(node.position.x, node.position.y + node.scale.x * 2.6, node.position.z);
    }
  }
  // Trail: repositioning the halos is cheap; a full TubeGeometry re-lay per input event is
  // NOT (up to 800 segments) — hide the tube during the drag and let the release rebuild
  // re-lay it. The marker + rings already follow node positions per-frame in the loop.
  if (typeof playlistTrailHalos !== 'undefined' && playlistTrailHalos.length) {
    for (const h of playlistTrailHalos) {
      const i = h.userData.nodeIdx;
      if (typeof i === 'number' && neuralMeshes[i]) h.position.copy(neuralMeshes[i].position);
    }
  }
  if (typeof playlistTrailObj !== 'undefined' && playlistTrailObj) playlistTrailObj.visible = false;
  // Edge-highlight lines connect exact node positions — refresh only while an anchor is live.
  if (typeof refreshNeuralEdgeHighlight === 'function' && neuralRingIdx >= 0) refreshNeuralEdgeHighlight();
}
// pilot 16532
function commitNeuralSpread() {
  if (typeof syncSpreadDial === 'function') syncSpreadDial();
  if (typeof currentMode !== 'undefined' && currentMode === 'playback') return;  // zoom mode — nothing to rebuild
  if (window._spreadMorphRAF) { cancelAnimationFrame(window._spreadMorphRAF); window._spreadMorphRAF = null; }
  clearTimeout(window._spreadCommitTimer);
  window._spreadCommitTimer = setTimeout(() => {
    // No-op commit (value unchanged since the last committed layout): the live morph already
    // reproduces that layout exactly — just re-lay the trail tube we hid during the drag.
    if (window._lastCommittedSpread === neuralSpread && window._neuralBuildSpread) {
      neuralSpreadLiveMorph();
      if (typeof rebuildPlaylistTrail === 'function') rebuildPlaylistTrail();
      return;
    }
    if (typeof rebuildGraph === 'function') rebuildGraph();
  }, 160);
}
// pilot 16549
(function syncSpreadAtBoot() {
  const apply = () => {
    const sl = document.getElementById('n-spread');
    if (sl) {
      const n = Math.round(neuralSpread * 100);
      sl.value = n;
      const lo = parseInt(sl.min, 10) || 50;
      const hi = parseInt(sl.max, 10) || 300;
      const fillPct = ((n - lo) / (hi - lo)) * 100;
      sl.style.setProperty('--nt-spread-pct', fillPct.toFixed(1) + '%');
    }
    const lbl = document.getElementById('nt-spread-label');
    if (lbl) lbl.textContent = 'Spread';   // constant width — see setNeuralSpread
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once:true });
  else apply();
})();
// pilot 16579
const COVER_ORB_SCALE = 1.06;
// pilot 16585
let neuralOrbStyle = localStorage.getItem('neural-orb-style') || 'sphere';
// pilot 16586
function toggleCoverOrbs() {
  // In Playback covers are mandatory, so the button edits what you'll RETURN to rather
  // than switching them off under the cinematic camera. (The dock is hidden in Playback
  // today, so this is a guard for any other route in — keyboard, a future control.)
  if (typeof currentMode !== 'undefined' && currentMode === 'playback') {
    _pbPrevOrbStyle = (_pbPrevOrbStyle === 'cover-orb') ? 'sphere' : 'cover-orb';
    try { localStorage.setItem('neural-orb-style', _pbPrevOrbStyle); } catch (_) {}
    if (typeof toast === 'function') toast('Play always shows covers — set for Explore / Curate');
    return;
  }
  // An explicit user toggle is a real choice — cancel any pending Playback auto-restore
  // so leaving Playback doesn't overwrite what the user just picked.
  _pbPrevOrbStyle = null;
  neuralOrbStyle = (neuralOrbStyle === 'cover-orb') ? 'sphere' : 'cover-orb';
  localStorage.setItem('neural-orb-style', neuralOrbStyle);
  document.body.classList.toggle('neural-coverorbs-on', neuralOrbStyle === 'cover-orb');
  // Covers are now an on-demand overlay on top of the instanced field (the collision footprint
  // already reserves cover-orb space regardless), so a toggle no longer needs a full teardown/
  // rebuild — the render loop's neuralUpdateCovers() reacts on the next frame. Turning covers
  // OFF hides the pool immediately.
  if (neuralOrbStyle !== 'cover-orb') { for (const c of neuralCoverPool) c.visible = false; }
  else if (typeof neuralUpdateCovers === 'function') { _coverFrame = 0; neuralUpdateCovers(); }
}
// pilot 16610
document.body.classList.toggle('neural-coverorbs-on', neuralOrbStyle === 'cover-orb');
// pilot 16624
const SPIKES_HIDDEN = true;
// pilot 16645
(function applyListCollapseAtBoot() {
  const apply = () => { try {
    document.body.classList.toggle('list-filters-collapsed', localStorage.getItem('list-filters-collapsed') === '1');
  } catch (_) {} };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 16654
function applyFilterFoldState() {
  let folded = false;
  try { folded = localStorage.getItem('filters-folded') === '1'; } catch (_) {}
  document.querySelectorAll('.tab-sidebar .filter-bar').forEach(b => b.classList.toggle('folded', folded));
  // Never leave the class on a copy that has been moved into the drawer.
  document.querySelectorAll('#filters-drawer .filter-bar').forEach(b => b.classList.remove('folded'));
}
// pilot 16661
(function applyFilterFoldAtBoot() {
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', applyFilterFoldState, { once: true });
  else applyFilterFoldState();
})();
// pilot 16665
const SNAPSHOTS_HIDDEN = true;
// pilot 16666
(function applySnapshotVisibility() {
  const apply = () => document.body.classList.toggle('snapshots-off', SNAPSHOTS_HIDDEN);
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 16671
let neuralSpikeMetric = SPIKES_HIDDEN ? 'off' : (localStorage.getItem('neural-spike-metric') || 'off');
// pilot 16672
let _sphereGeoCheap = null;   // low-poly smooth sphere for the Off / cover-orb case
// pilot 16673
let _spikeGeoCache  = null;   // [6] icospheres at spike amounts 0.0 … 1.0
// pilot 16675
function _getSphereGeo(T) {
  if (!_sphereGeoCheap) _sphereGeoCheap = new T.SphereGeometry(1, 16, 12);
  return _sphereGeoCheap;
}
// pilot 16679
function _fibonacciSphere(n, T) {
  const pts = [], golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const yy = 1 - (i / (n - 1)) * 2;
    const r  = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = golden * i;
    pts.push(new T.Vector3(Math.cos(th) * r, yy, Math.sin(th) * r));
  }
  return pts;
}
// pilot 16689
function _buildSpikeGeometry(amount, T) {
  // Naval-mine morph. A UV-sphere base (NOT an icosphere) so its equirectangular UVs survive —
  // that's what lets cover art still map cleanly across the body between the cones. ~30 anchors
  // are fibonacci-scattered over the sphere; every vertex falling within a fixed angular cone of
  // its nearest anchor is pushed radially outward on a linear taper (spike = 1 at the anchor →
  // 0 at the cone rim), giving clean, straight-sided cones that leave most of the body smooth
  // and readable. `amount` (0…1) scales the cone length so the 6 cached buckets morph sphere→mine.
  const AN = 30, CONE_DEG = 18, CONE_SHARP = 1.0, SPIKE_LEN = 0.6;
  // 64×48 segments (~3.1k verts / 6k tris). The straight-sided 18° cones don't need the
  // needle-grade 128×96 tessellation — that was 24k tris per node and made every
  // bounding-sphere-hit raycast cost ~0.8 ms (measured). This is visually identical at
  // node scale and 4× cheaper to render AND pick.
  const geo = new T.SphereGeometry(1, 64, 48);
  const anchors = _fibonacciSphere(AN, T);
  const pos = geo.attributes.position, v = new T.Vector3();
  const halfRad = CONE_DEG * Math.PI / 180, cosT = Math.cos(halfRad);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let best = -1;
    for (const a of anchors) { const dd = v.dot(a); if (dd > best) best = dd; }
    let spike = 0;
    if (best > cosT) {
      const ang = Math.acos(Math.min(1, best));           // angular distance to nearest anchor
      spike = Math.pow(Math.max(0, 1 - ang / halfRad), CONE_SHARP);  // linear taper → straight cone
    }
    v.multiplyScalar(1 + amount * SPIKE_LEN * spike);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();   // so raycasting's broad phase accounts for the cones
  return geo;
}
// pilot 16721
function _getSpikeGeos(T) {
  if (_spikeGeoCache) return _spikeGeoCache;
  _spikeGeoCache = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map(a => _buildSpikeGeometry(a, T));
  return _spikeGeoCache;
}
// pilot 16726
function setNeuralSpikeMetric(v) {
  if (SPIKES_HIDDEN) return;          // inert while the control is hidden
  neuralSpikeMetric = v || 'off';
  try { localStorage.setItem('neural-spike-metric', neuralSpikeMetric); } catch (_) {}
  if (typeof rebuildGraph === 'function') rebuildGraph();
}
// pilot 16761
const _NODE_ALPHA_EPS = 0.999;
// pilot 16762
function _nodeAlphaShader(mat, keep, cacheKey) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aOpacity;\nvarying float vOpacity;\n' +
      shader.vertexShader.replace('void main() {', 'void main() {\n\tvOpacity = aOpacity;');
    shader.fragmentShader = 'varying float vOpacity;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `if (!(${keep})) discard;\n\tgl_FragColor.a *= vOpacity;\n\t#include <dithering_fragment>`
      );
  };
  mat.customProgramCacheKey = () => cacheKey;
  return mat;
}
// pilot 16775
function neuralNodeMaterial(T) {
  if (neuralNodeMat) return neuralNodeMat;
  neuralNodeMat = _nodeAlphaShader(
    new T.MeshBasicMaterial({ color: 0xffffff, transparent: false, depthWrite: true, depthTest: true }),
    `vOpacity >= ${_NODE_ALPHA_EPS}`, 'neuralNodeMat-solid-v2');
  return neuralNodeMat;
}
// pilot 16782
function neuralGhostMaterial(T) {
  if (neuralGhostMat) return neuralGhostMat;
  neuralGhostMat = _nodeAlphaShader(
    new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, depthTest: true }),
    `vOpacity < ${_NODE_ALPHA_EPS}`, 'neuralNodeMat-ghost-v2');
  return neuralGhostMat;
}
// pilot 16790
function _disposeInstanceLayers() {
  if (!neuralInstLayers || !neuralInstLayers.length) return;
  for (const L of neuralInstLayers) {
    if (neuralScene) { neuralScene.remove(L.mesh); if (L.ghost) neuralScene.remove(L.ghost); }
    // The ghost twin SHARES the solid mesh's instanceMatrix / instanceColor, so it must not
    // be disposed at all: three's dispose handler frees exactly those shared buffers, which
    // the solid mesh still owns. Nulling them first and then disposing — what this did until
    // 2026-09-20 — is worse again: the handler dereferences instanceMatrix and threw
    // "Cannot read properties of null", aborting the rebuild halfway. Removing it from the
    // scene and dropping the layer is all the ghost needs; L.mesh.dispose() below frees the
    // buffers once, correctly.
    if (L.ghost) { L.ghost.instanceMatrix = null; L.ghost.instanceColor = null; }
    L.mesh.dispose?.();     // frees instanceMatrix / instanceColor GPU buffers
    L.geo?.dispose?.();     // per-layer geometry clone (carries the aOpacity attr)
  }
  neuralInstLayers = [];
}
// pilot 16812
function neuralBuildInstances(T) {
  _disposeInstanceLayers();
  const n = neuralMeshes.length;
  if (!n || !neuralScene) return;
  const spikeGeos = _spikeGeoCache;   // null when spikes have never been built
  const groups = new Map();           // geoKey -> { geo, idxs:[globalNodeIdx,...] }
  for (let i = 0; i < n; i++) {
    const b = neuralMeshes[i].userData.spikeBucket;
    const useSpike = (typeof b === 'number' && b >= 0 && spikeGeos);
    const geoKey = useSpike ? ('s' + b) : 'sphere';
    let g = groups.get(geoKey);
    if (!g) {
      const src = useSpike ? spikeGeos[b] : _getSphereGeo(T);
      // Clone so the per-layer aOpacity InstancedBufferAttribute never mutates the shared,
      // cached master geometry (the base sphere + 6 spike buckets are reused across rebuilds).
      g = { geo: src.clone(), idxs: [] };
      g.geo.computeBoundingSphere();
      groups.set(geoKey, g);
    }
    g.idxs.push(i);
  }
  const mat = neuralNodeMaterial(T);
  const ghostMat = neuralGhostMaterial(T);
  for (const g of groups.values()) {
    const count = g.idxs.length;
    const im = new T.InstancedMesh(g.geo, mat, count);
    im.frustumCulled = true;
    im.instanceMatrix.setUsage(T.DynamicDrawUsage);
    const aOp = new T.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    aOp.setUsage(T.DynamicDrawUsage);
    g.geo.setAttribute('aOpacity', aOp);
    // Ghost twin: same geometry (so the same aOpacity attribute) and the SAME
    // instanceMatrix/instanceColor objects, so it needs no syncing of its own — it is
    // literally the same instances, drawn again with the blended material. Hidden
    // whenever nothing is faded, which is the common case.
    const gm = new T.InstancedMesh(g.geo, ghostMat, count);
    gm.instanceMatrix = im.instanceMatrix;
    gm.frustumCulled = true;
    gm.renderOrder = 2;          // after the solid pass
    gm.visible = false;
    gm.raycast = () => {};       // picking always goes through the solid mesh
    const layer = { mesh: im, ghost: gm, geo: g.geo, nodeIdx: g.idxs, aOpacity: aOp };
    neuralScene.add(im);
    neuralScene.add(gm);
    neuralInstLayers.push(layer);
  }
  neuralSyncMatrices();
  neuralSyncColors();
  neuralSyncAlpha();
}
// pilot 16865
function neuralSyncMatrices() {
  if (!neuralInstLayers.length) return;
  const T = neuralThree; if (!T) return;

  const m4 = (window.__instM4 ||= new T.Matrix4());
  const q  = (window.__instQ  ||= new T.Quaternion());
  const p  = (window.__instP  ||= new T.Vector3());
  const s  = (window.__instS  ||= new T.Vector3());
  for (const L of neuralInstLayers) {
    for (let slot = 0; slot < L.nodeIdx.length; slot++) {
      const node = neuralMeshes[L.nodeIdx[slot]];
      // Global filter fade: above 0 the filtered-out nodes keep their scale and render
      // as clickable ghosts (alpha handled in neuralSyncAlpha); at 0 they truly vanish.
      // EXCEPT in pathway SOLO (Mark, 2026-08-28): "only the route" means GONE, not
      // ghosted — the fade ghosts made SOLO indistinguishable from DIM, and a scale-0
      // instance also drops out of the raycast, so you can't click what you can't see.
      const sc = (node.visible || ghostsInteractive()) ? (node.scale.x || 1) : 0;
      p.copy(node.position); s.set(sc, sc, sc);
      m4.compose(p, q.identity(), s);
      L.mesh.setMatrixAt(slot, m4);
    }
    L.mesh.instanceMatrix.needsUpdate = true;
    L.mesh.computeBoundingSphere();   // keep the raycast broad-phase valid
    // Lens support: remember the TRUE-position sphere radius so applyLens can inflate
    // it by the displacement bound instead of an O(n) recompute every frame.
    L._trueSphereR = L.mesh.boundingSphere ? L.mesh.boundingSphere.radius : 0;
    // Share the (mutated-in-place) sphere so the twin culls identically, including the
    // lens inflation applied further down.
    if (L.ghost) L.ghost.boundingSphere = L.mesh.boundingSphere;
  }
}
// pilot 16901
function applyLens() {
  const T = neuralThree;
  // The pilot orbits INSIDE the bubble radius, so the lens must be off while it drives — but
  // switching it in one frame popped every nearby node (invisible in Playback's chrome-less
  // entry, obvious in Explore where Focus engages mid-browse). Ease the strength instead.
  const pilot = (typeof pbCamActive !== 'undefined' && pbCamActive);
  _lensW += ((pilot ? 0 : 1) - _lensW) * 0.12;
  if (Math.abs((pilot ? 0 : 1) - _lensW) < 0.004) _lensW = pilot ? 0 : 1;
  const active = lensOn && neuralActive && !!T && neuralInstLayers.length &&
                 neuralCamera && neuralMeshes.length && _lensW > 0;
  if (!active) {
    if (_lensWasActive) {
      _lensWasActive = false; _lensFrameActive = false;
      if (neuralInstLayers.length) neuralSyncMatrices();
      _lensSyncEdgeLines();   // lines back to true endpoints (lensShift is a no-op now)
    }
    return;
  }
  _lensWasActive = true; _lensFrameActive = true;

  // ── The BUBBLE (Mark, 2026-08-01: "should emulate being inside a transparent
  // bubble") ── a sphere of radius R_B travels WITH the camera; any node whose true
  // position falls inside it slides radially outward (away from the camera) onto the
  // bubble's surface — d → R_B·(d/R_B)^γ. Omnidirectional (beside/behind too, not a
  // view cone), identity at the boundary (no pop crossing the shell), monotone (order
  // and clickability preserved). As you fly, nodes flow over the glass and settle
  // back exactly where they belong once you've passed. Pure world-space maths — no
  // projection involved, so it is aspect/FOV independent by construction.
  const R_B   = Math.max(15, neuralFieldSpread() * 0.15);  // bubble radius (world units)
  const GAMMA = 0.25;                // shell hardness: smaller = nodes hug the surface tighter
  const D_EPS = 0.02 * R_B;          // camera-coincident guard: distance floor for the remap

  if (!_lensOffArr || _lensOffArr.length !== neuralMeshes.length * 3)
    _lensOffArr = new Float32Array(neuralMeshes.length * 3);
  else _lensOffArr.fill(0);

  neuralCamera.updateMatrixWorld(true);
  const camP = neuralCamera.position;

  const m4 = (window.__instM4 ||= new T.Matrix4());
  const q  = (window.__instQ  ||= new T.Quaternion());
  const p  = (window.__instP  ||= new T.Vector3());
  const s  = (window.__instS  ||= new T.Vector3());
  q.identity();

  for (const L of neuralInstLayers) {
    for (let slot = 0; slot < L.nodeIdx.length; slot++) {
      const i = L.nodeIdx[slot];
      const node = neuralMeshes[i];
      // Same rule as neuralSyncMatrices — this pass runs EVERY frame now that the lens is
      // permanent, so an exception missing here silently wins over one made there.
      const sc = (node.visible || ghostsInteractive()) ? (node.scale.x || 1) : 0;
      p.copy(node.position);
      if (sc > 0) {
        const vx = p.x - camP.x, vy = p.y - camP.y, vz = p.z - camP.z;
        const d = Math.sqrt(vx*vx + vy*vy + vz*vz);
        if (d < R_B) {
          const dE = Math.max(d, D_EPS);
          const dNew = R_B * Math.pow(dE / R_B, GAMMA);
          let ux, uy, uz;
          if (d > 1e-4) { ux = vx / d; uy = vy / d; uz = vz / d; }
          else {
            // Camera-coincident node: deterministic golden-spiral direction per index.
            const a = i * 2.39996, b = Math.acos(1 - 2 * ((i * 0.618034) % 1));
            ux = Math.sin(b) * Math.cos(a); uy = Math.sin(b) * Math.sin(a); uz = Math.cos(b);
          }
          const push = (dNew - dE) * _lensW;
          if (push > 1e-5) {
            const ox = ux * push, oy = uy * push, oz = uz * push;
            p.x += ox; p.y += oy; p.z += oz;
            _lensOffArr[i * 3] = ox; _lensOffArr[i * 3 + 1] = oy; _lensOffArr[i * 3 + 2] = oz;
          }
        }
      }
      s.set(sc, sc, sc);
      m4.compose(p, q, s);
      L.mesh.setMatrixAt(slot, m4);
    }
    L.mesh.instanceMatrix.needsUpdate = true;
    // Broad-phase stays valid: no node moves farther than the bubble radius.
    if (L.mesh.boundingSphere && L._trueSphereR) L.mesh.boundingSphere.radius = L._trueSphereR + R_B;
  }
  // Key View fan lines ride along with their displaced nodes.
  _lensSyncEdgeLines();
}
// pilot 16987
function neuralSyncColors() {
  if (!neuralInstLayers.length) return;
  const T = neuralThree; if (!T) return;
  const c = (window.__instC ||= new T.Color());
  for (const L of neuralInstLayers) {
    for (let slot = 0; slot < L.nodeIdx.length; slot++) {
      c.set(neuralMeshes[L.nodeIdx[slot]].userData.color || 0xffffff);
      L.mesh.setColorAt(slot, c);
    }
    if (L.mesh.instanceColor) L.mesh.instanceColor.needsUpdate = true;
    // instanceColor is created lazily by the first setColorAt — adopt it once it exists.
    if (L.ghost && L.ghost.instanceColor !== L.mesh.instanceColor) L.ghost.instanceColor = L.mesh.instanceColor;
  }
}
// pilot 17005
function neuralSyncAlpha() {
  if (!neuralInstLayers.length) return;
  const _soloOn = (typeof playlistTrailMode !== 'undefined') && playlistTrailMode === TRAIL_SOLO
                  && _trailIdSet && _trailIdSet.size > 0;
  let anyFaded = false;
  for (const L of neuralInstLayers) {
    const arr = L.aOpacity.array;
    for (let slot = 0; slot < L.nodeIdx.length; slot++) {
      const nodeIdx = L.nodeIdx[slot];
      const node = neuralMeshes[nodeIdx];
      const o = node.userData.hvOpacity;
      // SOLO: a hidden node is HIDDEN, never a filter-fade ghost — see neuralSyncMatrices.
      // ONE reason a track is faded: a filter excluded it. Pathway decides WHICH TRACKS
      // are in play (all of them, or only the route); filters decide how visible the
      // excluded ones are. The two no longer both reach for opacity.
      const v = node.visible ? ((typeof o === 'number') ? o : 1) : (_soloOn ? 0 : filterFade);
      arr[slot] = v;
      if (v < 0.999) anyFaded = true;
    }
    L.aOpacity.needsUpdate = true;
  }
  // The solid material stays opaque + depth-writing at ALL times; the ghost pass is simply
  // switched on when there is anything for it to draw. Nothing else needs to change.
  for (const L of neuralInstLayers) if (L.ghost) L.ghost.visible = anyFaded;
}
// pilot 17034
function neuralPickNode(ndcX, ndcY) {
  if (!neuralInstLayers.length || !neuralCamera) return -1;
  const T = neuralThree;
  if (!_neuralPickRay) _neuralPickRay = new T.Raycaster();
  _neuralPickRay.setFromCamera({ x: ndcX, y: ndcY }, neuralCamera);
  const hits = _neuralPickRay.intersectObjects(neuralInstLayers.map(L => L.mesh), false);
  for (const h of hits) {
    if (h.instanceId == null) continue;
    const layer = neuralInstLayers.find(L => L.mesh === h.object);
    if (!layer) continue;
    const gi = layer.nodeIdx[h.instanceId];
    // Ghosts (filtered-out, rendered at filterFade alpha) are deliberately clickable —
    // at fade 0 their scale is 0 so the ray can't hit them anyway.
    if (gi != null && neuralMeshes[gi] && (neuralMeshes[gi].visible || ghostsInteractive())) return gi;
  }
  return -1;
}
// pilot 17070
const COVER_POOL_FLOOR = 24, COVER_POOL_CAP = 1500;
// pilot 17074
const COVER_ALL_BELOW = 1000;
// pilot 17075
const COVER_NEAR_EACH = 75;   // plus this many nearest neighbours per attention point (25→50→75, Mark 2026-08-28: +50% again)
// pilot 17076
const COVER_FADE_STEP = 0.12; // opacity change per frame — ~8 frames end to end
// pilot 17080
const COVER_TEX_CAP   = 384;   // LRU texture-cache ceiling (scaled with the pool)
// pilot 17081
let neuralCoverPool = [];      // reusable textured sphere meshes (one per visible near-slot)
// pilot 17082
let _coverTexCache  = new Map();   // catalogId -> {tex,used} | 'loading' | 'none'
// pilot 17083
let _coverFrame = 0;
// pilot 17085
function _coverEvict() {
  // Cap applies to REAL textures only — 'none'/'loading' string markers (which dominate on a
  // no-art catalog) must not count toward it, or they'd force real textures to be evicted.
  const real = [..._coverTexCache.entries()].filter(([, v]) => v && v.tex);
  if (real.length <= COVER_TEX_CAP) return;
  // NEVER evict a texture a pool slot is currently wearing. dispose() frees the GPU
  // texture while the material still points at it, and three.js then draws the material's
  // base colour — a plain white sphere. THAT is the "node ghost" the scale dial kept
  // producing (Mark, 2026-08-27): a spread commit rebuilds the graph, which reloads every
  // cover at once, and each successful load calls this — so a busy field crossed the cap
  // mid-burst and plain LRU happily picked the covers that were on screen. Measured: 18
  // of 18 visible orbs disposed in a single pass, all still holding the dead map.
  const onScreen = new Set();
  for (const c of neuralCoverPool) if (c.material && c.material.map) onScreen.add(c.material.map);
  const evictable = real.filter(([, v]) => !onScreen.has(v.tex));
  let over = real.length - COVER_TEX_CAP;
  if (over <= 0 || !evictable.length) return;
  evictable.sort((a, b) => a[1].used - b[1].used);
  for (const [id, v] of evictable) {
    if (over-- <= 0) break;
    v.tex.dispose?.();
    _coverTexCache.delete(id);
  }
}
// pilot 17112
function neuralUpdateCovers() {
  const T = neuralThree;
  const coversOn = (typeof neuralOrbStyle !== 'undefined') && neuralOrbStyle === 'cover-orb';
  if (!coversOn || !neuralInstLayers.length || !neuralCamera) {
    if (neuralCoverPool.length) for (const c of neuralCoverPool) c.visible = false;
    return;
  }
  // Reposition already-assigned covers every frame (nodes can move during spread-morph).
  // Fade rather than flip. A cover appearing or vanishing between one frame and the next
  // reads as a flicker even when the choice behind it is perfectly stable — moving the
  // cursor across a dense field would otherwise strobe. Each cover carries its own
  // opacity and eases toward where it should be, so entering and leaving are both smooth.
  for (const c of neuralCoverPool) {
    const want = c.userData._want ? 1 : 0;
    const cur = c.userData._op ?? 0;
    if (cur !== want) {
      const next = cur + Math.sign(want - cur) * COVER_FADE_STEP;
      // Snap when within one step — the target can now be a fraction (the DIM level),
      // so an exact equality test would leave it oscillating around it forever.
      c.userData._op = (Math.abs(want - next) < COVER_FADE_STEP) ? want : next;
      c.material.opacity = c.userData._op;
      c.material.transparent = c.userData._op < 1;
      c.material.needsUpdate = true;
    }
    // Outside the branch on purpose: opacity is the single source of truth for whether a
    // cover is on screen. Setting it only when the fade MOVED let .visible drift out of
    // step with _op, which is half of the stale-orb bug above.
    c.visible = (c.userData._op ?? 0) > 0.01;
    if (!c.visible) {
      // A slot that has fully faded out releases its texture reference. Holding it made
      // the evictor's in-use guard treat up to POOL-CAP (1500) textures as untouchable,
      // so the 384 LRU ceiling stopped meaning anything (review, 2026-08-28). The texture
      // itself stays in the cache — reassignment is a Map lookup, not a reload.
      if (!c.userData._want && c.material.map) {
        c.material.map = null; c.userData._texId = null; c.material.needsUpdate = true;
      }
      continue;
    }
    const ni = c.userData._nodeIdx;
    const node = (ni != null) ? neuralMeshes[ni] : null;
    if (!node || !node.visible) { c.visible = false; continue; }
    c.position.copy(node.position);
    lensShift(c.position, ni);   // covers ride their (possibly lens-displaced) node
    c.scale.setScalar((node.scale.x || 1) * COVER_ORB_SCALE);
    // Keep this cover's LRU stamp fresh EVERY frame it is on screen, not just on the
    // 12-frame recompute — a stale stamp is what let the evictor rank a visible cover as
    // the least-recently-used thing in the cache.
    const _tid = c.userData._texId;
    if (_tid) { const _e = _coverTexCache.get(_tid); if (_e && _e.tex) _e.used = _coverFrame; }
  }
  if ((_coverFrame++ % 12) !== 0) return;   // recompute the nearest set only periodically

  const cam = neuralCamera.position;
  // How far away a node of scale 1 still projects to COVER_MIN_PX. Beyond it the art is
  // too small to read, so it is not drawn at all.
  // No on-screen-size gate: a track you have selected shows its cover however far away
  // it is. Which covers appear is decided below, by attention rather than by pixels.
  const cand = [];
  for (let i = 0; i < neuralMeshes.length; i++) {
    if (neuralMeshes[i].visible) cand.push([neuralMeshes[i].position.distanceToSquared(cam), i]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  // Share of what's VISIBLE, nearest to the camera first — so flying somewhere new
  // re-picks the set around wherever you now are.
  // Small Field: art on everything.
  // Large Field: art on the three things you are actually looking at — the selected
  // track, whatever is playing, and whatever the cursor is over — plus the nearest few
  // to each, so a cover always has context around it rather than floating alone. At most
  // 3 x (1 + 75) = 228 covers, which is why a 14,694-track Field stops being a wall.
  let near;
  if (cand.length <= COVER_ALL_BELOW) {
    near = cand.slice(0, Math.min(cand.length, COVER_POOL_CAP));
  } else {
    const visible = new Set(cand.map(([, i]) => i));
    const anchors = [];
    for (const idx of [neuralRingIdx, neuralPlayingIdx, neuralHoverIdx]) {
      if (idx != null && idx >= 0 && visible.has(idx) && !anchors.includes(idx)) anchors.push(idx);
    }
    const picked = new Map();     // nodeIdx -> distance² from the camera (pool order)
    for (const a of anchors) {
      const ap = neuralMeshes[a]?.position;
      if (!ap) continue;
      const byDist = [];
      for (const [, i] of cand) {
        if (i === a) continue;
        byDist.push([neuralMeshes[i].position.distanceToSquared(ap), i]);
      }
      byDist.sort((x, y) => x[0] - y[0]);
      picked.set(a, neuralMeshes[a].position.distanceToSquared(cam));
      for (let n = 0; n < Math.min(COVER_NEAR_EACH, byDist.length); n++) {
        const i = byDist[n][1];
        if (!picked.has(i)) picked.set(i, neuralMeshes[i].position.distanceToSquared(cam));
      }
    }
    near = [...picked.entries()].map(([i, d2]) => [d2, i]).sort((x, y) => x[0] - y[0]);
  }

  while (neuralCoverPool.length < near.length) {
    const mat = new T.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new T.Mesh(_getSphereGeo(T), mat);
    mesh.visible = false;
    neuralScene.add(mesh);
    neuralCoverPool.push(mesh);
  }
  // Keep a node on the SAME slot between recomputes. The set is capped
  // (COVER_POOL_CAP), so at high percentages the "nearest N" membership churns every
  // recompute as the camera drifts — and reassigning a slot to a different track swaps
  // its texture, which is the flicker. Nodes still in the set keep the slot they had;
  // only genuinely freed slots take on new tracks.
  const wanted = new Set(near.map(([, i]) => i));
  const slotOfNode = new Map();
  const freeSlots = [];
  neuralCoverPool.forEach((c, slot) => {
    const held = c.userData._nodeIdx;
    if (held != null && wanted.has(held) && !slotOfNode.has(held)) slotOfNode.set(held, slot);
    else {
      c.userData._want = false;                 // fades out; the slot frees when it lands
      if ((c.userData._op ?? 0) <= 0.01) freeSlots.push(slot);
    }
  });
  near.forEach(([, nodeIdx]) => {
    let slot = slotOfNode.get(nodeIdx);
    if (slot === undefined) {
      if (!freeSlots.length) return;          // nothing free this pass; next one gets it
      slot = freeSlots.pop();
      slotOfNode.set(nodeIdx, slot);
    }
    const node = neuralMeshes[nodeIdx];
    const catId = neuralNodeData[nodeIdx]?.catalogId;
    const c = neuralCoverPool[slot];
    c.userData._nodeIdx = nodeIdx;
    c.position.copy(node.position);
    lensShift(c.position, nodeIdx);
    c.scale.setScalar((node.scale.x || 1) * COVER_ORB_SCALE);
    const cached = catId ? _coverTexCache.get(catId) : 'none';
    if (cached && cached.tex) {          // art ready → fade it in over the instanced sphere
      c.material.map = cached.tex; c.material.needsUpdate = true;
      c.userData._want = true; c.visible = true;
      c.userData._texId = catId;         // what this slot is wearing — see _coverEvict
      cached.used = _coverFrame;
      return;
    }
    // 'none' (no art) or 'loading' → leave the instanced coloured sphere showing.
    if (catId && !_coverTexCache.has(catId)) {
      _coverTexCache.set(catId, 'loading');
      if (!neuralTexLoader) neuralTexLoader = new T.TextureLoader();
      neuralTexLoader.load(`/catalog/${catId}/cover`,
        tex => { tex.anisotropy = neuralRenderer?.capabilities?.getMaxAnisotropy?.() || 1; _coverTexCache.set(catId, { tex, used: _coverFrame }); _coverEvict(); },
        undefined,
        () => { _coverTexCache.set(catId, 'none'); });
    }
  });
}
// pilot 17269
function sizeAxisLabels() {
  if (!neuralCamera || typeof neuralAxisObjs === 'undefined' || !neuralAxisObjs) return;
  const h = (neuralRenderer && neuralRenderer.domElement && neuralRenderer.domElement.clientHeight) || 600;
  const PX = 72;                                   // sprite height; the 22px-font text inside reads ~25px
  const sy = PX * 2 * Math.tan((neuralCamera.fov || 60) * Math.PI / 360) / h;
  for (const o of neuralAxisObjs) if (o.label) {
    const k = o.label.userData && o.label.userData.small ? 0.6 : 1;   // low-end words smaller
    o.label.scale.set(sy * 4 * k, sy * k, 1);                          // canvas is 256×64
  }
}
// pilot 17280
function rebuildPlaylistTrail() {
  if (!neuralScene || !neuralThree) return;
  const T = neuralThree;
  // Dispose previous
  if (playlistTrailObj) {
    neuralScene.remove(playlistTrailObj);
    playlistTrailObj.geometry?.dispose?.();
    playlistTrailObj.material?.dispose?.();
    playlistTrailObj = null;
  }
  if (playlistTrailMarker) {
    neuralScene.remove(playlistTrailMarker);
    playlistTrailMarker.geometry?.dispose?.();
    playlistTrailMarker.material?.dispose?.();
    playlistTrailMarker = null;
  }
  playlistTrailHalos.forEach(h => {
    neuralScene.remove(h);
    h.geometry?.dispose?.();
    h.material?.dispose?.();
  });
  playlistTrailHalos = [];
  // Explore traces YOUR PATH, every other mode traces the active playlist (2026-08-26).
  const _trailIdList = (typeof trailTrackIds === 'function')
    ? trailTrackIds() : (activePlaylist?.tracks || []).map(t => t.track_id);
  // Clear the membership set BEFORE any early return. It is what the DIM state dims
  // against, so leaving a stale set behind meant clearing the path (or emptying the
  // playlist) left the field dimmed around a route that no longer existed, with no way
  // to get the brightness back except another edit (review, 2026-08-27).
  _trailIdSet = new Set(_trailIdList);
  if (!playlistTrailVisible || !_trailIdList.length || !neuralMeshes.length) {
    if (!_trailIdList.length) _trailIdSet = new Set();
    // SOLO hides the off-route nodes by setting mesh.visible = false (updateMatrixVisibility),
    // NOT by alpha — so repainting opacity here cannot bring them back. Only the two writers
    // of mesh.visible can, and neither runs on this path. Repainting alone shipped as a no-op
    // at the default filterFade of 0: clearing a route left the field blank until some
    // unrelated filter change happened to re-derive visibility.
    // Re-derive visibility FIRST, then repaint the alpha that depends on it.
    if (playlistTrailMode === TRAIL_SOLO) {
      if (typeof updateMatrixVisibility === 'function') updateMatrixVisibility();
      if (typeof neuralSyncAlpha === 'function'
          && typeof neuralInstLayers !== 'undefined' && neuralInstLayers.length) neuralSyncAlpha();
    }
    return;
  }
  // Map ordered track_ids → mesh indices in current matrix view
  const idxByCatId = new Map(neuralNodeData.map((d, i) => [d.catalogId, i]));
  const points = [];
  const trailIds = [];
  _pbTrailHueByTrack.clear();
  // Per-playlist-node halo geometry (shared) — much cheaper than per-node geometry
  const haloGeo = new T.SphereGeometry(1, 18, 12);
  for (const t of _trailIdList.map(id => ({ track_id: id }))) {
    const idx = idxByCatId.get(t.track_id);
    if (idx === undefined) continue;
    const node = neuralMeshes[idx];
    points.push(node.position.clone());
    trailIds.push(t.track_id);
    // Soft golden halo around every playlist member — additive blending makes dense
    // clusters of playlist tracks bloom collectively, separating them from non-members.
    const haloMat = new T.MeshBasicMaterial({
      color: 0xffd06a,
      transparent: true,
      opacity: 0.12,             // toned down: was 0.22
      depthWrite: false,
      blending: T.AdditiveBlending,
      // BackSide so the halo renders only its FAR hemisphere: with the (opaque, depth-writing)
      // cover-orb in front, the near hemisphere is occluded and the glow reads as a rim AROUND
      // the artwork's silhouette instead of washing directly OVER the cover face.
      side: T.BackSide,
    });
    const halo = new T.Mesh(haloGeo, haloMat);
    halo.position.copy(node.position);
    halo.scale.setScalar(Math.max(node.scale.x, 0.6) * 1.25);   // scaled down: was 1.6
    halo.userData.nodeIdx = idx;
    halo.renderOrder = 0;        // below trail tube and marker
    halo.visible = node.visible; // sync with filter visibility from the start
    neuralScene.add(halo);
    playlistTrailHalos.push(halo);
  }
  // Full-spectrum hue per track along the pathway — the Playback dial adopts it.
  { const denom = Math.max(1, trailIds.length - 1); trailIds.forEach((tid, i) => _pbTrailHueByTrack.set(tid, i / denom)); }
  if (points.length < 2) return;
  // Smooth curve through the ordered points
  const curve = new T.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const tubularSegments = Math.min(Math.max(points.length * 12, 24), 800);
  const TRAIL_RADIAL = 8;
  const tubeGeo = new T.TubeGeometry(curve, tubularSegments, 0.35, TRAIL_RADIAL, false);
  // Subtle "unicorn" full-spectrum gradient graded along the tube's length (per-vertex colours).
  const posCount = tubeGeo.attributes.position.count;
  const colArr = new Float32Array(posCount * 3);
  const cc = new T.Color();
  for (let i = 0; i < posCount; i++) {
    const seg = Math.floor(i / (TRAIL_RADIAL + 1));
    const tt = tubularSegments > 0 ? seg / tubularSegments : 0;
    cc.setHSL(tt, 0.6, 0.58);
    colArr[i*3] = cc.r; colArr[i*3+1] = cc.g; colArr[i*3+2] = cc.b;
  }
  tubeGeo.setAttribute('color', new T.Float32BufferAttribute(colArr, 3));
  const tubeMat = new T.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  playlistTrailObj = new T.Mesh(tubeGeo, tubeMat);
  // Tube above ambient edges but below rings, so the gold reads as primary path
  playlistTrailObj.renderOrder = 1;
  neuralScene.add(playlistTrailObj);

  // Current-point marker: bright sphere, pulses larger + opacity wave
  const markerGeo = new T.SphereGeometry(1, 24, 16);
  const markerMat = new T.MeshBasicMaterial({
    color: 0xffe488,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: T.AdditiveBlending,
    // BackSide (as with the halos): the "you are here" glow becomes a rim around the current
    // node rather than a bright dome painted over its cover art.
    side: T.BackSide,
  });
  playlistTrailMarker = new T.Mesh(markerGeo, markerMat);
  playlistTrailMarker.renderOrder = 2;
  neuralScene.add(playlistTrailMarker);
}
// pilot 17408
let _trailIdxCache = {src:null, n:0, map:null}, _trailPlCache = {src:null, set:null};
// pilot 17409
function updatePlaylistTrailAnimation() {
  // Halo pulse + filter-visibility sync run independently of the tube (a single-track
  // playlist still has halos but no tube). Slightly slower / shallower than the marker
  // pulse so the eye reads it as ambient glow, not animation.
  if (playlistTrailHalos.length) {
    const hPhase = Date.now() * 0.0015;
    // Pulse centred on the toned-down 0.12 baseline (0.09–0.15) — the old 0.15–0.24 range
    // silently overrode the quieter base every frame, keeping the halos brighter than set.
    const hOpa   = 0.09 + 0.06 * (0.5 + 0.5 * Math.sin(hPhase));
    for (const h of playlistTrailHalos) {
      h.material.opacity = hOpa;
      const idx = h.userData.nodeIdx;
      if (typeof idx === 'number' && neuralMeshes[idx]) {
        h.visible = neuralMeshes[idx].visible;
        // Track the node every frame so halos follow lens displacement (and drop back
        // exactly when it disengages). Position source stays the true proxy + offset.
        h.position.copy(neuralMeshes[idx].position);
        lensShift(h.position, idx);
      }
    }
  }
  if (!playlistTrailObj) return;
  // Pulse the whole tube's opacity in a slow breathing wave
  const t = Date.now() * 0.0016;
  const pulse = 0.55 + 0.22 * (0.5 + 0.5 * Math.sin(t));
  playlistTrailObj.material.opacity = pulse;
  if (!playlistTrailMarker || !activePlaylist?.tracks?.length || !neuralMeshes.length) return;
  // Pick the marker target: currently-playing track if it's in the playlist,
  // else the playlist's anchor, else the first playlist track visible in matrix.
  // PERF: this runs EVERY FRAME — the id→index Map and playlist Set are cached and
  // rebuilt only when the underlying array/playlist object identity changes (both are
  // replaced wholesale on rebuild/reload, so identity checks self-invalidate).
  if (_trailIdxCache.src !== neuralNodeData || _trailIdxCache.n !== neuralNodeData.length) {
    _trailIdxCache = { src: neuralNodeData, n: neuralNodeData.length,
                       map: new Map(neuralNodeData.map((d, i) => [d.catalogId, i])) };
  }
  if (_trailPlCache.src !== activePlaylist) {
    _trailPlCache = { src: activePlaylist,
                      set: new Set(activePlaylist.tracks.map(tr => tr.track_id)) };
  }
  const idxByCatId = _trailIdxCache.map;
  const inPlaylist = _trailPlCache.set;
  let targetIdx = -1;
  const playingId = (neuralPlayingIdx >= 0) ? neuralNodeData[neuralPlayingIdx]?.catalogId : null;
  if (playingId && inPlaylist.has(playingId)) targetIdx = idxByCatId.get(playingId) ?? -1;
  if (targetIdx < 0 && activePlaylist.anchor_track_id) {
    const a = idxByCatId.get(activePlaylist.anchor_track_id);
    if (a !== undefined) targetIdx = a;
  }
  if (targetIdx < 0) {
    for (const tr of activePlaylist.tracks) {
      const a = idxByCatId.get(tr.track_id);
      if (a !== undefined) { targetIdx = a; break; }
    }
  }
  if (targetIdx >= 0 && neuralMeshes[targetIdx]) {
    const node = neuralMeshes[targetIdx];
    playlistTrailMarker.position.copy(node.position);
    lensShift(playlistTrailMarker.position, targetIdx);
    const ns = node.scale.x;
    const pbMarker = (typeof currentMode !== 'undefined' && currentMode === 'playback');
    const mPulse = 1 + 0.12 * Math.sin(Date.now() * 0.0032);
    playlistTrailMarker.scale.setScalar(ns * (pbMarker ? 1.15 : 1.7) * mPulse);
    // In Playback the centre glow is nearly invisible (~5%) so it never washes out the cover art;
    // elsewhere it stays a bright "you are here" marker.
    playlistTrailMarker.material.opacity = pbMarker
      ? 0.045 + 0.015 * (0.5 + 0.5 * Math.sin(Date.now() * 0.0038))
      : 0.72  + 0.18  * (0.5 + 0.5 * Math.sin(Date.now() * 0.0038));
    playlistTrailMarker.visible = true;
  } else {
    playlistTrailMarker.visible = false;
  }
}
// pilot 17483
let neuralHoverIdx = -1;      // whatever the cursor is over, or -1
// pilot 17484
function neuralShowTooltip(idx, pos3d) {
  neuralHoverIdx = idx;
  const canvas=document.getElementById('neural-canvas');
  const rect=canvas.getBoundingClientRect();
  const T=neuralThree;
  const tt=document.getElementById('neural-tooltip');
  const nd=neuralNodeData[idx]; const d=nd.data;
  // Slimmed 2026-08-03 (Mark: "a lot of mouse position view blocking") — the hover
  // tooltip is ONE line now: Artist — Title when the filename parses, otherwise the
  // bare name (samples etc). No cover, no metric block; full detail lives in the
  // List row / selection panel.
  const cover = document.getElementById('nt-cover');
  if (cover) { cover.style.display = 'none'; cover.removeAttribute('src'); }
  const pt = (typeof trackArtistTitle === 'function') ? trackArtistTitle(nd) : null;
  document.getElementById('nt-name').textContent =
    (pt && pt.artist && pt.title) ? `${pt.artist} — ${pt.title}`
    : (pt && pt.title) ? pt.title
    : nd.filename;
  // ONE line of metrics under the title (Mark, 2026-08-04): BPM · Key · Genre.
  // Key follows the ⚙ wheel-notation setting so the tooltip and the wheel agree.
  const bpm = Math.round(d?.rhythm?.bpm || 0);
  const keyTxt = (typeof wheelNotation === 'undefined' || wheelNotation === 'standard')
    ? (d?.harmony?.key || '')
    : (wheelNotation === 'openkey' ? (camelotToOpenKey(nd.camelot) || '') : (nd.camelot || ''));
  const genre = (catalog.find(t => t.id === nd.catalogId)?.genre || '').trim();
  const parts = [];
  if (bpm)    parts.push(`${bpm} BPM`);
  if (keyTxt) parts.push(esc(keyTxt));
  if (genre)  parts.push(esc(genre));
  document.getElementById('nt-meta').innerHTML = parts.join(' &nbsp;·&nbsp; ');

  // ── Placement ──────────────────────────────────────────────────────────────
  // Content is filled first so the box can be measured, then placed so it (a) clears
  // the hovered node's projected silhouette + a cursor-comfort gap, and (b) covers as
  // few OTHER visible nodes as possible: four candidate positions (right/left/below/
  // above) are scored by how many projected node centres each would overlap, with a
  // tie-break preferring the side pointing AWAY from the canvas centre (nodes cluster
  // centrally, so outward placement usually covers least).
  tt.style.cssText='display:flex;left:-9999px;top:-9999px';
  const w=tt.offsetWidth||380, h=tt.offsetHeight||152;
  const v=pos3d.clone().project(neuralCamera);
  const px=(v.x*.5+.5)*rect.width, py=(v.y*-.5+.5)*rect.height;
  // Projected screen radius of the node (incl. spike extent) — offset must clear it
  const mesh=neuralMeshes[idx];
  let screenR=24;
  if (mesh && T) {
    const worldR=mesh.scale.x*(1+0.6*(mesh.userData.spikeAmt||0));
    const right=new T.Vector3().setFromMatrixColumn(neuralCamera.matrixWorld,0);
    const edge=pos3d.clone().addScaledVector(right,worldR).project(neuralCamera);
    screenR=Math.max(16, Math.hypot(((edge.x*.5+.5)*rect.width)-px, ((edge.y*-.5+.5)*rect.height)-py));
  }
  const gap=screenR+44;   // node silhouette + comfortable cursor clearance
  const cands=[
    {x:px+gap,       y:py-h/2, dirx: 1, diry: 0},   // right
    {x:px-gap-w,     y:py-h/2, dirx:-1, diry: 0},   // left
    {x:px-w/2,       y:py+gap, dirx: 0, diry: 1},   // below
    {x:px-w/2,       y:py-gap-h, dirx:0, diry:-1},  // above
  ];
  // Screen positions of every OTHER visible node (cheap: runs only on hover change)
  const pts=[];
  for (let i=0;i<neuralMeshes.length;i++){
    const m=neuralMeshes[i];
    if (!m || !m.visible || i===idx) continue;
    const p=m.position.clone().project(neuralCamera);
    if (p.z>1) continue;                              // behind the camera
    pts.push([(p.x*.5+.5)*rect.width, (p.y*-.5+.5)*rect.height]);
  }
  const cx=rect.width/2, cy=rect.height/2;
  const odx=px-cx, ody=py-cy, olen=Math.hypot(odx,ody)||1;
  let best=null, bestScore=Infinity;
  for (const c of cands){
    // Clamp inside the canvas
    c.x=Math.min(Math.max(4,c.x), rect.width-w-4);
    c.y=Math.min(Math.max(4,c.y), rect.height-h-4);
    // After clamping the box may slide back over the node — hard-reject that
    const overNode = px>c.x-screenR && px<c.x+w+screenR && py>c.y-screenR && py<c.y+h+screenR
                     && (px>c.x&&px<c.x+w&&py>c.y&&py<c.y+h);
    let covered=0;
    for (const [qx,qy] of pts){ if (qx>c.x-8&&qx<c.x+w+8&&qy>c.y-8&&qy<c.y+h+8) covered++; }
    // Outward preference: candidates pointing with the centre→node direction win ties
    const outward=(c.dirx*odx+c.diry*ody)/olen;       // −1…1
    const score=covered*10 + (overNode?1000:0) - outward;
    if (score<bestScore){ bestScore=score; best=c; }
  }
  tt.style.cssText=`display:flex;left:${Math.round(best.x)}px;top:${Math.round(best.y)}px`;
}
// pilot 17570
function neuralHideTooltip() { neuralHoverIdx = -1; document.getElementById('neural-tooltip').style.display='none'; }
// pilot 17585
const FIELD_SKINS = {
  light: {
    bg:'#E7E0D2', fog:0xE7E0D2, fogNear:190, fogFar:520,
    numS:62, numL:42,           // numeric-metric gradient  (sat %, light %)
    clS:55,  clL:44,            // cluster / genre categorical
    camAS:58, camAL:42, camBS:52, camBL:52,   // Camelot A / B rings
    axX:0xD6451B, axY:0x3F7D5A, axZ:0x2E5AAC, // axis cross
    edge:0x6E6357, edgeOp:0.30,
  },
  dark: {
    bg:'#050508', fog:0x050508, fogNear:160, fogFar:420,
    numS:80, numL:55,
    clS:68,  clL:56,
    camAS:70, camAL:48, camBS:65, camBL:58,
    axX:0xff5555, axY:0x44dd88, axZ:0x4488ff,
    edge:0x3344aa, edgeOp:0.22,
  },
};
// pilot 17615
(function applySavedAppSkin() {
  let n = 'light';
  try { const v = localStorage.getItem('app-skin'); if (v === 'dark' || v === 'vintage') n = v; } catch (_) {}
  if (n !== 'light') document.documentElement.setAttribute('data-skin', n);
  const apply = () => { const sw = document.getElementById('app-skin-switch'); if (sw) sw.dataset.on = n; };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 17623
function fieldSkinName() {
  return localStorage.getItem('field-skin') === 'dark' ? 'dark' : 'light';
}
// pilot 17626
function FS() { return FIELD_SKINS[fieldSkinName()]; }
// pilot 17630
let fogEnabled = (() => { try { return localStorage.getItem('field-fog') !== '0'; } catch { return true; } })();
// pilot 17631
function _fogK() { return (typeof neuralSpread === 'number') ? neuralSpread : 1; }
// pilot 17632
function applyFog() {
  if (typeof neuralScene === 'undefined' || !neuralScene) return;
  // Three is an ES-module import held in neuralThree, NOT a global. Reading window.THREE
  // here found undefined and returned early, so the switch moved and the fog never did.
  const T = (typeof neuralThree !== 'undefined' && neuralThree) || window.THREE;
  if (!T) return;
  neuralScene.fog = fogEnabled ? new T.Fog(FS().fog, FS().fogNear * _fogK(), FS().fogFar * _fogK()) : null;
  // Materials compile fog in or out, so every one of them has to be told to rebuild.
  neuralScene.traverse(o => { if (o.material) {
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.fog = fogEnabled; m.needsUpdate = true; });
  }});
  if (typeof requestNeuralRender === 'function') requestNeuralRender();
}
// pilot 17672
function getNeuralBackground() {
  const v = localStorage.getItem('neural-bg-color');
  return v || FS().bg;
}
// pilot 17676
(function applySavedFieldSkin() {
  const apply = () => {
    const n = fieldSkinName();
    const sw = document.getElementById('field-skin-switch');
    if (sw) sw.dataset.on = n;
    document.body.classList.toggle('field-dark', n === 'dark');
    const wrap = document.querySelector('.neural-canvas-wrap');
    if (wrap) wrap.style.background = FS().bg;
  };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();
// pilot 17688
function setNeuralBackground(hex) {
  localStorage.setItem('neural-bg-color', hex);
  if (typeof neuralScene !== 'undefined' && neuralScene && typeof neuralThree !== 'undefined' && neuralThree) {
    neuralScene.background = new neuralThree.Color(hex);
  }
  const inp = document.getElementById('neural-bg-input');
  if (inp && inp.value.toLowerCase() !== hex.toLowerCase()) inp.value = hex;
}
// pilot 17697
function neuralNorm(vals, useLog=false) {
  const v = useLog ? vals.map(x => Math.log1p(Math.max(0,x))) : vals;
  // Loop, not Math.min(...v): spread passes one argument per track and engines cap
  // argument counts (~65k) — a very large catalog would throw a RangeError here.
  let mn = Infinity, mx = -Infinity;
  for (const x of v) { if (x < mn) mn = x; if (x > mx) mx = x; }
  const r = mx - mn || 1;
  return v.map(x=>(x-mn)/r);
}
// pilot 17713
function neuralNormFold(vals) {
  const n = vals.length;
  let fullMn = Infinity, fullMx = -Infinity;
  for (const x of vals) { if (x < fullMn) fullMn = x; if (x > fullMx) fullMx = x; }
  // Constant axis (e.g. formula "z=1" to flatten the field) → the CENTRE plane, not
  // the edge (plain min-max maps a constant to 0).
  if (fullMx === fullMn) return vals.map(() => 0.5);
  if (n < 40) return neuralNorm(vals, false);
  const sorted = [...vals].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  const lo = q(0.025), hi = q(0.975), mn = sorted[0], mx = sorted[n - 1];
  if (!(hi > lo)) return neuralNorm(vals, false);   // degenerate middle → plain min–max
  const M = 0.03, loR = lo - mn, hiR = mx - hi, mid = hi - lo;
  return vals.map(x => {
    if (x < lo) return loR > 0 ? ((x - mn) / loR) * M : 0;
    if (x > hi) return hiR > 0 ? 1 - M + ((x - hi) / hiR) * M : 1;
    return M + ((x - lo) / mid) * (1 - 2 * M);
  });
}
// pilot 17741
const FIELD_BASE = 180;
// pilot 17742
function neuralFieldSpread() {
  return FIELD_BASE * (window._neuralFieldGrowth || 1)
       * (typeof neuralSpread !== 'undefined' ? neuralSpread : 1);
}
// pilot 17746
function _fieldGrowth(xN, yN, zN, radii) {
  const n = radii.length; if (!n) return 1;
  let sv = 0; for (const r of radii) sv += r * r * r;
  sv *= (4 / 3) * Math.PI;                                    // Σ collision-sphere volume
  // Density-aware region volume from an OCCUPANCY GRID over the normalised cube
  // (20³ cells): count non-empty cells × cell volume. Unlike the per-axis-σ product
  // this collapses correctly when the axes are correlated — all-same-metric fields
  // are a thin diagonal tube whose per-axis spread looks huge but which occupies
  // only ~20 cells, so the valve actually fires there instead of never.
  const G = 20, cells = new Set();
  const ci = (v) => Math.min(G - 1, Math.max(0, Math.floor(v * G)));
  for (let i = 0; i < n; i++) cells.add(ci(xN[i]) + ci(yN[i]) * G + ci(zN[i]) * G * G);
  const cellVol = Math.pow(FIELD_BASE / G, 3);
  const V = Math.max(cellVol, cells.size * cellVol);
  return Math.min(3, Math.max(1, Math.cbrt((sv / V) / 0.5)));
}
// pilot 17763
function rebuildGraph() {
  if (!neuralInited||!neuralThree) return;
  window._neuralGraphDirty = false;   // this build reflects the current catalog array
  // First sight of a Field: frame it. The camera used to start at a fixed (0,50,180)
  // however big the field was — fine for a few hundred tracks, and inside the cloud for
  // fourteen thousand, which is what made a large library look like a solid wall.
  const _catSig = (typeof activeCatalog !== 'undefined') ? String(activeCatalog) : '';
  const _needFrame = _catSig !== _framedForCat;
  const T=neuralThree;
  // Invalidate any in-flight cover-texture callbacks from the previous build
  const buildToken = ++neuralRebuildToken;
  // Preserve selection across rebuild (look up by catalog id)
  const prevSelectedCatalogId = (neuralRingIdx >= 0) ? neuralNodeData[neuralRingIdx]?.catalogId : null;
  // Same for the keyboard focus — indices point into the OLD arrays and are remapped below.
  const prevFocusCatalogId = (kbFocusIdx >= 0) ? neuralNodeData[kbFocusIdx]?.catalogId : null;
  // (Focus-Frame anchor capture removed 2026-08-03 — ◎ Focus is camera-only now.)
  // Dispose GPU resources on every removal — detaching from the scene alone leaks the
  // underlying geometry/material/textures, and rebuildGraph runs on every axis/colour/
  // spread/filter change (all normal user actions).
  // Node geometries are SHARED + cached (the base sphere and the 6 spike buckets) and reused
  // across rebuilds — dispose only the per-node material + texture, never the geometry.
  // Node spheres live in the InstancedMesh layer(s), not as per-node scene objects — dispose
  // those once. The neuralMeshes proxies are scene-detached, so they just drop for GC.
  _disposeInstanceLayers();
  // Lens offsets index the OLD node array — drop them so the first post-rebuild frame's
  // lensShift consumers (rings/halos run before applyLens in the loop) see clean zeros.
  _lensOffArr = null; _lensFrameActive = false;
  // Cover-pool slots reference old node indices. Hiding them is NOT enough (Mark,
  // 2026-08-27 — "the scale setting triggered it"): the fade loop in neuralUpdateCovers
  // keys off _op/_want, not off .visible. An orb left at _op=1 with _want=true is turned
  // visible again by the very next cover pass — and the reposition step then snaps it onto
  // whatever track now occupies its STALE node index. So every spread commit threw a burst
  // of covers onto the wrong nodes (and blank white spheres wherever the stale index no
  // longer resolved) for a few frames. Free the slots outright instead, so the next
  // recompute assigns them from scratch.
  for (const c of neuralCoverPool) {
    c.visible = false;
    c.userData._want = false;
    c.userData._op = 0;
    c.userData._nodeIdx = null;      // the index it held belongs to the old array
    c.userData._texId = null;
    c.material.map = null;           // never show the previous track's art on a reused slot
    c.material.opacity = 0;
    c.material.transparent = true;
    c.material.needsUpdate = true;
  }
  // Drop any in-flight 'loading' markers so a load abandoned mid-rebuild can be retried
  // (successful {tex} and 'none' results stay cached — they're keyed by stable catalog id).
  for (const [k, v] of _coverTexCache) if (v === 'loading') _coverTexCache.delete(k);
  neuralCoverSprites.forEach(s=>{neuralScene.remove(s); s.material?.map?.dispose?.(); s.material?.dispose?.();});
  neuralMeshes=[]; neuralCoverSprites=[]; neuralNodeData=[]; neuralRingIdx=-1;
  if (neuralRing){neuralScene.remove(neuralRing); neuralRing.geometry?.dispose?.(); neuralRing.material?.dispose?.(); neuralRing=null;}
  // The progress dial is a THREE.Group (arc + aura children) — it has NO .geometry of its
  // own. The old `.geometry.dispose()` threw a TypeError here whenever audio was playing,
  // aborting rebuildGraph mid-teardown: the field vanished on any axis/colour/covers/spread
  // change during playback. Dispose via traverse like every other dial teardown site.
  if (neuralProgressRing){neuralScene.remove(neuralProgressRing);neuralProgressRing.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });neuralProgressRing=null;}
  if (neuralEdgeObj){neuralScene.remove(neuralEdgeObj); neuralEdgeObj.geometry?.dispose?.(); neuralEdgeObj.material?.dispose?.(); neuralEdgeObj=null;}
  if (neuralEdgeHighlight){neuralScene.remove(neuralEdgeHighlight);neuralEdgeHighlight.geometry?.dispose?.(); neuralEdgeHighlight.material?.dispose?.(); neuralEdgeHighlight=null;}
  // Dispose any compat-rings from the previous layout so they don't sit on stale nodeIdx refs
  for (const r of neuralCompatRings) { neuralScene.remove(r); r.geometry?.dispose?.(); r.material?.dispose?.(); }
  neuralCompatRings = [];
  // Axis arrows are THREE.ArrowHelper (dispose()), labels are sprites with a canvas texture.
  neuralAxisObjs.forEach(o=>{
    const d = o.arrow?.userData?._endDot;
    if (d) { neuralScene.remove(d); d.geometry?.dispose?.(); d.material?.dispose?.(); }
    neuralScene.remove(o.arrow); o.arrow?.dispose?.();
    // Negative arms carry no label — only the positive three do.
    if (o.label) { neuralScene.remove(o.label); o.label.material?.map?.dispose?.(); o.label.material?.dispose?.(); }
  });
  neuralAxisObjs=[];

  // Layout uses the FULL catalog so node world-positions stay rock-stable while filters are
  // toggled. Filters then act as a visibility pass (mesh.visible) so the camera, anchor ring,
  // and currently-playing track never drift when the user picks a key on the Camelot wheel.
  const tracks = catalog.filter(e => e.data);
  const filteredIds = (typeof getFilteredCatalog === 'function')
    ? new Set(getFilteredCatalog().map(t => t.id))
    : null;
  const playbackIds = matrixPlaybackVisibleIds();   // playback mode → only pathway tracks show
  // The currently-playing track and the selected (anchor) node are NEVER hidden by filters
  // or mode switches — the listener must not lose sight of "where they are" mid-play.
  const keepIds = new Set();
  if (typeof audioCurrentId !== 'undefined' && audioCurrentId) keepIds.add(audioCurrentId);
  // The ring-restore target below (previous selection, falling back to the playlist anchor)
  // must be protected too — otherwise a filtered-out anchor gets its ring restored onto an
  // invisible node.
  const restoreId = prevSelectedCatalogId || (typeof anchorTrackId === 'function' ? anchorTrackId() : null);
  if (restoreId) keepIds.add(restoreId);
  // Anything ON the displayed pathway is always visible — filter override (Mark, 07-24).
  // The golden trail must never thread through invisible nodes.
  // Same route source as updateMatrixVisibility — see the note there.
  const _routeIds2 = (typeof trailTrackIds === 'function') ? trailTrackIds()
                   : (activePlaylist?.tracks || []).map(t => t.track_id);
  if (typeof playlistTrailVisible !== 'undefined' && playlistTrailVisible && _routeIds2.length) {
    for (const id of _routeIds2) keepIds.add(id);
  }
  // Playback disables all filters: visibility depends only on pathway membership (the user's
  // filters are preserved and re-apply on exit). Otherwise the filter set governs.
  // SOLO must survive a REBUILD too: without this, adding a track, changing an axis or any
  // other rebuildGraph reverted SOLO to ALL silently (review, 2026-08-27).
  const _solo2 = (typeof playlistTrailMode !== 'undefined') && playlistTrailMode === TRAIL_SOLO
                 && _routeIds2.length > 0;
  const nodeVisible = (id) => keepIds.has(id)
    || (_solo2 ? false
              : (playbackIds ? playbackIds.has(id) : (!filteredIds || filteredIds.has(id))));
  const visN = tracks.filter(t => nodeVisible(t.id)).length;
  renderTrackCount(visN, tracks.length);
  // Empty field: show the overlay instead of a silent black pane (and hide it again
  // as soon as tracks exist — e.g. after the first analysis lands). The message
  // distinguishes "nothing selected" (all chips off) from "selected but empty".
  const emptyEl = document.getElementById('neural-empty');
  if (emptyEl) {
    emptyEl.style.display = tracks.length ? 'none' : 'flex';
    const msg = document.getElementById('neural-empty-msg');
    if (msg && !tracks.length) {
      msg.innerHTML = (typeof viewedCatalogs !== 'undefined' && viewedCatalogs.size === 0)
        ? 'No Fields selected.<br>Pick one (or several) in the FIELDS drawer on the left.'
        : 'This Field is empty.<br>Analyse some tracks on the <b>Analyse</b> tab and they\'ll appear here.';
    }
  }
  if (!tracks.length) return;

  const xK=document.getElementById('nx-axis').value;
  const yK=document.getElementById('ny-axis').value;
  const zK=document.getElementById('nz-axis').value;
  const cK=document.getElementById('n-color').value;
  updateNeuralLegend(cK);
  const sK=document.getElementById('n-size').value;
  // Edges are driven by the Camelot wheel's compat-mode (off / tight / extended / parallel
  // / full). 'off' maps to no edges. The dedicated neural-toolbar n-edges dropdown is gone.
  const eM = (typeof camelotCompatMode !== 'undefined' && camelotCompatMode !== 'off')
    ? camelotCompatMode
    : 'none';
  // CONSTANT field size (see neuralFieldSpread) multiplied by the user's Spread slider;
  // morphPos() below applies a tanh S-curve so wild outlier metrics stay bounded inside
  // the on-screen field instead of flying off the edges as the slider expands the universe.
  // SPREAD itself is defined a few lines down, after the axis norms + radii exist —
  // the 50%-free-space growth valve needs them first.
  const userSpread = (typeof neuralSpread === 'number') ? neuralSpread : 1.0;
  // n is normalised 0..1; returns centred -0.5..0.5 with the morph applied.
  // At spread=1 the function is the identity (linear) — baseline behaviour preserved.
  // The tanh outlier-compression FADES IN over ×1→×2 (weight w) instead of switching on
  // at the notch: raw tanh at s=1+ε would snap the outer shell ~18% inward the moment the
  // slider crossed ×1. MUST stay formula-identical with neuralSpreadLiveMorph's morph().
  const morphPos = (n) => {
    if (userSpread <= 1) return n - 0.5;
    const c = (n - 0.5) * 2; // -1..1
    const w = Math.min(1, userSpread - 1);
    return (1 - w) * (c * 0.5) + w * (Math.tanh(c * userSpread) * 0.5);
  };
  const METRICS=allNeuralMetrics();
  const mm=k=>METRICS.find(m=>m.key===k);
  const mg=k=>mm(k)?.get||((_d,_e)=>0);

  // Position pipeline (2026-07-31): dropdown metrics OR user formulas, then the optional
  // Focus-Frame recentring on the committed track — see neuralAxisPositions.
  const [xN, yN, zN] = neuralAxisPositions(tracks, {xK, yK, zK, mm, mg});
  // Size is a formula target too since 2026-08-04 (`size=` / `s=`), otherwise the dropdown.
  const _sizeF = formulaAxes && formulaAxes.size;
  const _sizeRaw = tracks.map(t => {
    try { return _sizeF ? _sizeF.fn(t.data, t) : mg(sK)(t.data, t); } catch (_) { return NaN; }
  });
  if (_sizeF) {   // junk → median, same contract as the position axes
    const fin = _sizeRaw.filter(Number.isFinite).sort((a,b)=>a-b);
    const med = fin.length ? fin[fin.length>>1] : 0;
    for (let i=0;i<_sizeRaw.length;i++) if (!Number.isFinite(_sizeRaw[i])) _sizeRaw[i]=med;
  }
  const sN=neuralNorm(_sizeRaw, _sizeF ? false : mm(sK)?.log);
  // Colour NORMALISATION (fixed 2026-08-04). The numeric colour branch below used to
  // feed the RAW metric into hsl((1-v)*240) — correct only for 0..1 metrics. Colouring
  // by BPM (~124), Released (a year) or Rating (0..5) drove the hue far out of range,
  // so it wrapped into arbitrary colours that contradicted the legend's lo→hi gradient.
  // Normalise across the visible tracks first, exactly like size does.
  const _cNumeric = !['mood','key','genre','cluster'].includes(cK);
  let cN = null;
  if (_cNumeric) {
    const _cRaw = tracks.map(t => mg(cK)(t.data, t));
    // Non-finite (e.g. a track with no usable release date) → the median, exactly as
    // Size does above. Without this one NaN makes the whole normalised array NaN.
    if (_cRaw.some(v => !Number.isFinite(v))) {
      const finC = _cRaw.filter(Number.isFinite).sort((a, b) => a - b);
      const medC = finC.length ? finC[finC.length >> 1] : 0;
      for (let i = 0; i < _cRaw.length; i++) if (!Number.isFinite(_cRaw[i])) _cRaw[i] = medC;
    }
    cN = neuralNorm(_cRaw, mm(cK)?.log);
  }
  // Lock this build's growth valve, then the world size everything below uses.
  window._neuralFieldGrowth = _fieldGrowth(xN, yN, zN,
    sN.map(s => (0.7 + s * 1.4) * COVER_ORB_SCALE));
  const SPREAD = Math.round(neuralFieldSpread());
  // (Texture 6th-dim / TEXTURE_PRESETS removed — V2 feature parked.)

  // Cover-orb toggle — driven by the 🎨 Covers button under Pathway. Persists via localStorage.
  const nStyle = (typeof neuralOrbStyle !== 'undefined') ? neuralOrbStyle : 'sphere';
  if (!neuralTexLoader) neuralTexLoader = new T.TextureLoader();
  const baseGeo = _getSphereGeo(T);
  // Spike morph — normalise the chosen metric and pick a bucketed spiked geometry per node.
  const spikeKey = (typeof neuralSpikeMetric !== 'undefined') ? neuralSpikeMetric : 'off';
  const spikeOn  = spikeKey && spikeKey !== 'off' && !!mm(spikeKey);
  const spN      = spikeOn ? neuralNorm(tracks.map(t=>mg(spikeKey)(t.data,t)), mm(spikeKey)?.log) : null;
  const spikeGeos = spikeOn ? _getSpikeGeos(T) : null;
  tracks.forEach((track,i)=>{
    const d=track.data;
    const x=morphPos(xN[i])*SPREAD, y=morphPos(yN[i])*SPREAD, z=morphPos(zN[i])*SPREAD;
    const radius=0.7+sN[i]*1.4;
    let col;
    if (cK==='mood') col=MOOD_COLOR[d.scores?.mood]||'#7c6cff';
    else if (cK==='key') {
      const cam = noteToCamelot(d.harmony?.root, d.harmony?.mode);
      if (cam) {
        const pos = parseInt(cam), ring = cam.slice(-1);
        const hue = (pos - 1) * 30;
        col = ring === 'A' ? `hsl(${hue},${FS().camAS}%,${FS().camAL}%)` : `hsl(${hue},${FS().camBS}%,${FS().camBL}%)`;
      } else col = '#444';
    }
    else if (cK==='genre') { col = genreColor(track.genre); }
    else if (cK==='cluster') {
      // Discovered clusters are CATEGORICAL — distinct hues, not a gradient.
      const ci = Math.round(mg(cK)(d, track));
      col = ci ? `hsl(${((ci - 1) * 137.508) % 360},${FS().clS}%,${FS().clL}%)` : '#8A8073';   // golden-angle spacing
    }
    else { const cv=cN ? cN[i] : 0; col=`hsl(${Math.round((1-cv)*240)},${FS().numS}%,${FS().numL}%)`; }

    // Spike bucket (6th-dimension geometry). -1 = plain sphere; 0..5 = spike-mine geometry.
    // The InstancedMesh builder groups nodes by this bucket into one layer per geometry.
    let spikeBucket = -1, spikeAmt = 0;
    if (spikeOn) {
      spikeBucket = Math.min(5, Math.max(0, Math.round(spN[i] * 5)));
      spikeAmt = spikeBucket / 5;   // 0…1 — collision relaxation uses this for the true extent
    }
    // Lightweight, scene-detached proxy — holds everything the rest of the app reads off a
    // node (.position / .scale / .visible / .userData). The visible sphere is drawn by the
    // InstancedMesh layer built from these proxies after collision (neuralBuildInstances).
    const mesh = new T.Object3D();
    mesh.matrixAutoUpdate = false;              // never in the scene graph — no per-frame matrix work
    mesh.position.set(x,y,z);
    mesh.scale.setScalar(radius);
    mesh.userData.color = new T.Color(col);     // per-instance instanceColor source
    mesh.userData.spikeBucket = spikeBucket;
    mesh.userData.spikeAmt = spikeAmt;
    mesh.userData.hvOpacity = 1;                 // High-Vis fade writes this → synced to aOpacity
    // Style-independent collision footprint: always the COVER-ORB size so the layout is
    // byte-identical whether covers are shown or not (position encodes data — a visual toggle
    // must never move a node). COVER_ORB_SCALE tracks the on-demand cover overlay size.
    mesh.userData.collideR = radius * COVER_ORB_SCALE;
    // Live spread morph support — normalised coords so the Spread slider can recompute this
    // node's position cheaply during a drag (no teardown/rebuild).
    mesh.userData.rawNorm = {x: xN[i], y: yN[i], z: zN[i]};
    // Filter visibility (also hides non-pathway nodes in Playback mode). Hidden proxies are
    // zero-scaled in the instance matrix → invisible and unhittable by the raycast.
    if (!nodeVisible(track.id)) mesh.visible = false;
    neuralMeshes.push(mesh);

    neuralNodeData.push({filename:track.filename,data:d,catalogId:track.id,camelot:noteToCamelot(d.harmony?.root,d.harmony?.mode)});
  });

  // ── Collision resolution (relax overlapping nodes apart) ────────────
  // Few iterations of pair-wise repulsion. Keeps approximate axis positions
  // but pushes spheres that would overlap apart along their connecting axis.
  // PAD raised 0.6 → 1.5 (2026-07-21): guaranteed clear channel between any two
  // node silhouettes, so hover/click targets never touch. More iterations so the
  // larger minimum distance still converges in dense clusters.
  const PAD = 1.5;
  // Collision relaxation — spatial-hash broad phase (2026-08-01). The constant-size
  // field packs big catalogs denser, so the old all-pairs pass (O(N²), throttled to 2
  // iterations above 2500 nodes) stopped converging exactly where it mattered most.
  // With the hash each iteration is ~O(N): a node only tests neighbours within one
  // cell, where the cell edge ≥ the largest possible colliding centre distance
  // (2·maxR + PAD) — so no colliding pair can be missed, and the full 8 iterations
  // run at EVERY catalog size. Pushes are ≤ CELL/2, so a stale-by-one-cell bucket
  // mid-iteration is caught by the next iteration's fresh grid.
  //
  // Pair maths is UNCHANGED from the all-pairs version:
  // - STYLE-INDEPENDENT footprint (userData.collideR), never the live display scale:
  //   cover-orbs render 2.1× larger than spheres, and toggling 🎨 Covers must never
  //   move a node (Mark, 2026-07-28) — space is always reserved for the largest
  //   representation. Spike overhang (1 + 0.6·amount) still applies.
  // - Coincident pairs get a DETERMINISTIC hash direction seeded from (i,j) so the
  //   layout is identical across rebuilds (all-axes-same-metric fields collapse onto
  //   a diagonal and nearly every node collides — Math.random() here reshuffled them
  //   on every rebuild).
  const RELAX_N = neuralMeshes.length;
  const effR = new Float64Array(RELAX_N);
  let relaxMaxR = 0;
  for (let i = 0; i < RELAX_N; i++) {
    const m = neuralMeshes[i];
    effR[i] = (m.userData.collideR ?? m.scale.x) * (1 + 0.6 * (m.userData.spikeAmt || 0));
    if (effR[i] > relaxMaxR) relaxMaxR = effR[i];
  }
  const CELL = Math.max(2 * relaxMaxR + PAD, 1e-3);
  // Integer cell key: 21 bits per axis around the origin — the field is a few hundred
  // units, cells a few units, so coordinates stay far inside the ±2^20 range.
  const ckey = (x, y, z) =>
    (Math.floor(x / CELL) + 0x100000) +
    (Math.floor(y / CELL) + 0x100000) * 0x200000 +
    (Math.floor(z / CELL) + 0x100000) * 0x40000000000;
  // 16 iterations: with the hash each costs ~O(N), and dense constant-size fields
  // genuinely need the extra passes to settle (early-exit keeps sparse fields cheap).
  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    const grid = new Map();
    for (let i = 0; i < RELAX_N; i++) {
      const p = neuralMeshes[i].position;
      const k = ckey(p.x, p.y, p.z);
      const arr = grid.get(k);
      if (arr) arr.push(i); else grid.set(k, [i]);
    }
    for (let i = 0; i < RELAX_N; i++) {
      const a = neuralMeshes[i], pa = a.position;
      const cx = Math.floor(pa.x / CELL), cy = Math.floor(pa.y / CELL), cz = Math.floor(pa.z / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const bucket = grid.get(
          (cx + ox + 0x100000) + (cy + oy + 0x100000) * 0x200000 + (cz + oz + 0x100000) * 0x40000000000);
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const j = bucket[bi];
          if (j <= i) continue;
          const b = neuralMeshes[j];
          const minDist = effR[i] + effR[j] + PAD;
          const dx = b.position.x - pa.x;
          const dy = b.position.y - pa.y;
          const dz = b.position.z - pa.z;
          const d2 = dx*dx + dy*dy + dz*dz;
          if (d2 > minDist * minDist) continue;
          let d = Math.sqrt(d2);
          let ux, uy, uz;
          if (d < 1e-4) {
            const hx = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
            const hy = Math.sin(i * 39.346  + j * 11.135) * 24634.6345;
            const theta = (hx - Math.floor(hx)) * 2 * Math.PI;
            const phi   = Math.acos((hy - Math.floor(hy)) * 2 - 1);
            ux = Math.sin(phi) * Math.cos(theta);
            uy = Math.sin(phi) * Math.sin(theta);
            uz = Math.cos(phi);
            d = 0.01;
          } else {
            ux = dx / d; uy = dy / d; uz = dz / d;
          }
          const push = (minDist - d) * 0.5;
          pa.x -= ux * push; pa.y -= uy * push; pa.z -= uz * push;
          b.position.x += ux * push; b.position.y += uy * push; b.position.z += uz * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // (Focus-Frame origin-pinning removed 2026-08-03 — ◎ Focus no longer moves nodes.)

  // Live spread morph support — record the offset the collision pass introduced for each
  // node (position − raw morph position) plus the build-time SPREAD. During a slider drag,
  // neuralSpreadLiveMorph() re-derives positions from rawNorm at the new spread and carries
  // this offset along (scaled), so clusters stay separated without re-running collision.
  window._neuralBuildSpread = SPREAD;
  window._lastCommittedSpread = userSpread;   // lets commitNeuralSpread skip no-op rebuilds
  neuralMeshes.forEach(m => {
    const nn = m.userData.rawNorm;
    if (!nn) return;
    m.userData.relaxDelta = {
      x: m.position.x - morphPos(nn.x) * SPREAD,
      y: m.position.y - morphPos(nn.y) * SPREAD,
      z: m.position.z - morphPos(nn.z) * SPREAD,
    };
  });

  // Positions are final — build the InstancedMesh layer(s) from the proxies (colours + alpha
  // synced inside). This is the single draw-call-collapsing step: 8000 meshes → 1 (or up to 7
  // when spikes are on).
  neuralBuildInstances(T);

  // (The all-pairs edge build that stood here is gone — see neuralCompatNeighbours().)
  refreshNeuralEdgeHighlight();

  // Axis arrows + labels — scale with the tuniverse (SPREAD grows with √N tracks) so the
  // axes always read as a sensible reference frame regardless of library size.
  const LEN  = Math.max(28, Math.round(SPREAD * 0.55));
  const HEAD = Math.max(4, Math.round(LEN * 0.11));
  const HR   = Math.max(2, Math.round(LEN * 0.06));
  const LABEL_OFF = Math.max(8, Math.round(LEN * 0.18));
  const LABEL_SZ  = Math.max(8, Math.round(LEN * 0.22));
  // When a formula owns an axis, the big arrow says so — the primary reading frame
  // must never claim the dropdown metric while positions encode the formula. The
  // arrow names the INGREDIENTS, not the maths (Mark, 2026-08-29): "ƒz (bpm)" beats
  // "ƒz = log(bpm)" hanging over the field, and a five-term blend collapses to its
  // first two metrics + …. The full expression lives in the ƒx editor.
  const axLabel = (ax, K) => {
    if (!(formulaAxes && formulaAxes[ax])) return (mm(K)?.label || K);
    const src = formulaAxes[ax].src;
    const vn = new Set(FORMULA_VARS.map(v => v[0]));
    const ids = [...new Set((src.toLowerCase().match(/[a-z_]+/g) || [])
      .map(t => FORMULA_ALIASES[t] || t).filter(t => vn.has(t)))];
    if (!ids.length) return 'ƒ' + ax + ' = ' + src.slice(0, 10) + (src.length > 10 ? '…' : '');
    return 'ƒ' + ax + ' (' + ids.slice(0, 2).join(', ') + (ids.length > 2 ? ', …' : '') + ')';
  };
  // Which way is up (Mark, 2026-08-28): every linear axis says what its ENDS mean —
  // the positive arrow carries the metric name plus its high-end word, the dim negative
  // arm a small low-end word. Per-metric words where they read better than low/high.
  const AXIS_ENDS = {
    bpm:['slow','fast'], energy:['quiet','loud'], dance:['stiff','danceable'],
    brightness:['dark','bright'], camelot:['1A','12B'], vocals:['instrumental','vocal'],
    mood:['dark','bright'], rating:['unrated','5★'], released:['older','newer'],
  };
  const axEnds = (ax, K) => (formulaAxes && formulaAxes[ax]) ? ['−','+']
    : (AXIS_ENDS[K] || (String(K).startsWith('tag_') ? ['off','on'] : ['low','high']));
  const axesDef=[
    {dir:[1,0,0], color:FS().axX, label:axLabel('x', xK), ends:axEnds('x', xK)},
    {dir:[0,1,0], color:FS().axY, label:axLabel('y', yK), ends:axEnds('y', yK)},
    {dir:[0,0,1], color:FS().axZ, label:axLabel('z', zK), ends:axEnds('z', zK)},
  ];
  // Six-point cross, not a three-arm corner (Mark, 2026-08-04). The negative arms carry
  // the same colour so each axis reads as ONE line through the origin, but they're dimmed
  // and unlabelled — the labels belong on the positive end, and doubling them would just
  // clutter the middle of the field.
  const NEG_ALPHA = 0.32;
  const allAxes = axesDef.concat(axesDef.map(a => ({
    dir: a.dir.map(v => -v), color: a.color, label: null, lowEnd: a.ends[1] === a.ends[0] ? null : a.ends[0], dim: true,
  })));
  allAxes.forEach(a=>{
    const dir=new T.Vector3(...a.dir);
    const arrow=new T.ArrowHelper(dir,new T.Vector3(0,0,0),LEN,a.color,HEAD,HR);
    if (a.dim) {
      // ArrowHelper is a Line + a cone Mesh; both need the fade applied to their own material.
      for (const part of [arrow.line, arrow.cone]) {
        if (!part?.material) continue;
        part.material.transparent = true;
        part.material.opacity = NEG_ALPHA;
        part.material.depthWrite = false;
      }
      // The LOW end is not an arrow (Mark, 2026-08-28): a head on both ends made the two
      // directions read identically. The negative arm terminates in a small flat DOT —
      // a floor, not a direction — so only the high end points.
      arrow.cone.visible = false;
      const dot = new T.Mesh(
        new T.SphereGeometry(Math.max(1.0, LEN * 0.012), 10, 8),
        new T.MeshBasicMaterial({ color: a.color, transparent: true, opacity: NEG_ALPHA + 0.1, depthWrite: false }));
      dot.position.set(a.dir[0] * LEN, a.dir[1] * LEN, a.dir[2] * LEN);
      neuralScene.add(dot);
      arrow.userData._endDot = dot;
    }
    neuralScene.add(arrow);
    let sp = null;
    if (a.label) {
      // Canvas label sprite — metric name with its HIGH-end word underneath, so the
      // arrow direction is legible without guessing (Mark, 2026-08-28).
      const cv=document.createElement('canvas'); cv.width=256; cv.height=64;
      const ctx=cv.getContext('2d');
      ctx.clearRect(0,0,256,64);
      const hex='#'+a.color.toString(16).padStart(6,'0');
      ctx.fillStyle=hex; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font='bold 22px -apple-system,sans-serif';
      ctx.fillText(a.label,128,22);
      if (a.ends) { ctx.font='600 13px -apple-system,sans-serif'; ctx.globalAlpha=.85;
        ctx.fillText(a.ends[1] + ' ▸', 128, 48); ctx.globalAlpha=1; }
      // Fixed APPARENT size (Mark, 2026-08-28): sizeAttenuation off renders the label at
      // constant screen size whatever the camera distance or spread — sizeAxisLabels()
      // below converts the target pixel height into the clip-space scale (and re-runs
      // on every canvas resize, where the conversion changes).
      sp=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(cv),transparent:true,depthTest:false,sizeAttenuation:false}));
      // Fixed-size sprites carry TINY world-space cull bounds (clip-space scale ~0.4) while
      // rendering ~288px — the frustum test popped whole labels at screen edges (review).
      sp.frustumCulled = false;
      sp.position.set(a.dir[0]*(LEN+LABEL_OFF), a.dir[1]*(LEN+LABEL_OFF), a.dir[2]*(LEN+LABEL_OFF));
      neuralScene.add(sp);
    }
    // The dim negative arm gets a small LOW-end word so both directions read.
    if (a.lowEnd) {
      const cv2=document.createElement('canvas'); cv2.width=256; cv2.height=64;
      const c2=cv2.getContext('2d');
      c2.font='600 15px -apple-system,sans-serif';
      c2.fillStyle='#'+a.color.toString(16).padStart(6,'0');
      c2.globalAlpha=.7; c2.textAlign='center'; c2.textBaseline='middle';
      c2.fillText('◂ ' + a.lowEnd, 128, 32);
      sp=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(cv2),transparent:true,depthTest:false,sizeAttenuation:false}));
      sp.frustumCulled = false;
      sp.userData.small = true;
      // Hugs the tip (Mark, 2026-08-28): the big positive label needs LABEL_OFF of air,
      // but this small word floated disconnected at that distance.
      const _lo = LEN + LABEL_OFF * 0.35;
      sp.position.set(a.dir[0]*_lo, a.dir[1]*_lo, a.dir[2]*_lo);
      neuralScene.add(sp);
    }
    neuralAxisObjs.push({arrow,label:sp});
  });
  sizeAxisLabels();

  // Restore selection if the same track is still in the rebuilt list — prefer the
  // previous ring, fall back to the playlist anchor so it persists across tab switches.
  // (restoreId computed up top so keepIds protects it from the filter pass.)
  if (restoreId) {
    const newIdx = neuralNodeData.findIndex(nd => nd.catalogId === restoreId);
    if (newIdx >= 0) {
      neuralRingIdx = newIdx;
      const TT = neuralThree;
      const geoR = new TT.RingGeometry(1, 1.45, 64);
      const matR = new TT.MeshBasicMaterial({color:0x4A3FBF, side:TT.DoubleSide, transparent:true, opacity:0.85, depthTest:false});
      neuralRing = new TT.Mesh(geoR, matR); neuralScene.add(neuralRing);
      refreshNeuralEdgeHighlight();
    }
  }

  applyHighVisibility();
  // Mesh positions just changed — re-lay the playlist trail along the new layout.
  rebuildPlaylistTrail();
  // The playing-track index points into the OLD arrays — remap it by catalog id like the
  // anchor, so the progress arc / preview ring / trail marker follow the right node.
  if (typeof neuralPlayingIdx !== 'undefined' && neuralPlayingIdx >= 0) {
    neuralPlayingIdx = (typeof audioCurrentId !== 'undefined' && audioCurrentId)
      ? neuralNodeData.findIndex(nd => nd.catalogId === audioCurrentId)
      : -1;
  }
  // Keyboard focus follows its track through the rebuild; drops if the track is gone —
  // and dropping must take the ring + tooltip with it (kbClearFocus), not orphan them.
  kbFocusIdx = prevFocusCatalogId ? neuralNodeData.findIndex(nd => nd.catalogId === prevFocusCatalogId) : -1;
  if (prevFocusCatalogId && kbFocusIdx < 0 && typeof kbClearFocus === 'function') kbClearFocus();
  // Idle-gated hover raycast must re-test against the new meshes even if the cursor is still
  if (window.__neuralRayDirty) window.__neuralRayDirty();
  // Frame a Field the first time it is drawn — after the nodes exist, so the bounding
  // sphere is real. Filter and axis rebuilds skip this and leave the camera alone.
  if (_needFrame && neuralMeshes.length) resetNeural();
}
// pilot 18289
function matrixPlaybackVisibleIds() {
  // Play used to force "only the pathway is visible", full stop. Since the Pathway
  // switch became three states (SOLO / DIM / ALL) that override fought it: entering Play
  // pushed every other track into the ghost pass at filter-fade alpha, where they render
  // pale AND lose their cover art — the ghost pass carries no cover textures, they live
  // on the solid layers. That is the "nodes lose colour/covers on mode switch" bug
  // (Mark, 2026-08-26). The Pathway switch now governs in every mode, Play included;
  // SOLO is where "only the pathway" lives, and it is one click away.
  if (currentMode !== 'playback') return null;
  if (typeof playlistTrailMode !== 'undefined' && playlistTrailMode !== TRAIL_SOLO) return null;
  const tracks = activePlaylist?.tracks;
  if (!tracks || !tracks.length) return null;
  return new Set(tracks.map(t => t.track_id));
}
// pilot 18307
function updateMatrixVisibility() {
  if (!neuralInited || !neuralMeshes.length) return;
  const T = neuralThree;
  const filteredIds = (typeof getFilteredCatalog === 'function')
    ? new Set(getFilteredCatalog().map(t => t.id))
    : null;
  const playbackIds = matrixPlaybackVisibleIds();   // playback mode → only pathway tracks show
  // Keep-visible set: the playing track + the anchored node survive every filter/mode change
  // (mirrors rebuildGraph's keepIds — the two visibility passes must agree).
  const keepIds = new Set();
  if (typeof audioCurrentId !== 'undefined' && audioCurrentId) keepIds.add(audioCurrentId);
  if (neuralRingIdx >= 0 && neuralNodeData[neuralRingIdx]?.catalogId) keepIds.add(neuralNodeData[neuralRingIdx].catalogId);
  // Anything ON the displayed pathway is always visible — filter override (Mark, 07-24).
  // It must read the DRAWN route, which in Explore is the traced path and elsewhere the
  // active playlist. Reading activePlaylist directly made SOLO isolate the playlist even
  // in Explore, where the route on screen is the path (review, 2026-08-27).
  const _routeIds = (typeof trailTrackIds === 'function') ? trailTrackIds()
                  : (activePlaylist?.tracks || []).map(t => t.track_id);
  if (typeof playlistTrailVisible !== 'undefined' && playlistTrailVisible && _routeIds.length) {
    for (const id of _routeIds) keepIds.add(id);
  }
  // Playback disables all filters: visibility = pathway membership only (filters preserved for exit).
  // SOLO (pathway state 2): keepIds already holds every pathway track (plus the playing /
  // anchored one), so "only the pathway" is simply "keepIds and nothing else".
  const solo = (typeof playlistTrailMode !== 'undefined') && playlistTrailMode === TRAIL_SOLO
               && _routeIds.length > 0;
  const nodeVisible = (id) => !!(id && keepIds.has(id))
    || (solo ? false
             : (playbackIds ? !!(id && playbackIds.has(id)) : (!filteredIds || (id && filteredIds.has(id)))));
  // Mesh + cover-sprite visibility
  let visN = 0;
  neuralMeshes.forEach((mesh, i) => {
    const vis = nodeVisible(neuralNodeData[i]?.catalogId);
    mesh.visible = vis;
    if (vis) visN++;
  });
  // Reflect the new visibility in the instance matrices (hidden → zero scale).
  neuralSyncMatrices();
  neuralCoverSprites.forEach(spr => {
    spr.visible = nodeVisible(spr.userData?.catalogId);
  });
  // Track count badge
  renderTrackCount(visN, neuralMeshes.length);
  // Edges: rebuild only between visible nodes so the Camelot lattice reflects the filter.
  const eM = (typeof camelotCompatMode !== 'undefined' && camelotCompatMode !== 'off')
    ? camelotCompatMode
    : 'none';
  if (neuralEdgeObj) { neuralScene.remove(neuralEdgeObj); neuralEdgeObj.geometry?.dispose?.(); neuralEdgeObj.material?.dispose?.(); neuralEdgeObj = null; }
  // The all-pairs edge build lived here; see neuralCompatNeighbours(). It cost O(N²) per
  // filter change to fill a geometry that was never drawn, and overflowed on a big field.
  refreshNeuralEdgeHighlight();
  applyHighVisibility();
  // Hide the anchor ring if its node got filtered out
  if (neuralRing && neuralMeshes[neuralRingIdx]) {
    neuralRing.visible = neuralMeshes[neuralRingIdx].visible;
  }
}
// pilot 18371
function applyHighVisibility() {
  neuralMeshes.forEach(m => { m.userData.hvOpacity = 1; });
  neuralSyncAlpha();
  // Base edge mesh stays hidden in every mode — only neuralEdgeHighlight (the purple edges
  // from the selected node to its compatible neighbours) is ever drawn.
  if (neuralEdgeObj) neuralEdgeObj.visible = false;
  if (neuralCoverSprites.length) neuralCoverSprites.forEach(s => { s.material.opacity = 1.0; });
}
// pilot 18382
const VIEW_FILL = 0.95;
// pilot 18388
const VIEW_FRAME_PCTL = 0.90;
// pilot 18392
let _framedForCat = null;
// pilot 18394
function resetNeural() {
  if (!neuralControls || !neuralCamera || !neuralThree) return;
  // Reset means "back to the standard orbit framing" — leave first-person first, or the
  // stale FPS yaw/pitch would snap the view back on the next locked mouse move.
  if (typeof fpsActive !== 'undefined' && fpsActive) exitFPS();
  const T = neuralThree;
  // Bounding sphere of the whole field so we can frame 100% of it.
  let center = new T.Vector3(0, 0, 0), radius = 60;
  const meshes = (typeof neuralMeshes !== 'undefined') ? neuralMeshes : [];
  if (meshes.length) {
    const box = new T.Box3();
    meshes.forEach(m => box.expandByPoint(m.position));
    center = box.getCenter(new T.Vector3());
    let maxScale = 0;
    const dists = [];
    meshes.forEach(m => { dists.push(m.position.distanceTo(center)); maxScale = Math.max(maxScale, m.scale.x || 1); });
    dists.sort((a, b) => a - b);
    radius = dists.length
      ? dists[Math.min(dists.length - 1, Math.floor(dists.length * VIEW_FRAME_PCTL))]
      : 0;
    radius += maxScale * 1.2;                 // pad for orb size so edge nodes aren't clipped
  }
  if (!(radius > 1)) radius = 60;
  // View direction: 45° azimuth, ~20° elevation → BPM (+X) right, Valence (+Z) left, Energy (+Y) up.
  const dir = new T.Vector3(1, 0.5, 1).normalize();
  // Distance that fits the bounding sphere in the MORE-constraining (vertical or horizontal) FOV.
  const vFov = neuralCamera.fov * Math.PI / 180;
  const aspect = neuralCamera.aspect || 1;
  const limitFov = Math.min(vFov, 2 * Math.atan(Math.tan(vFov / 2) * aspect));
  // Frame the field at ~75% of the viewport rather than edge-to-edge (Mark, 2026-08-06).
  // Filling the frame leaves nothing to orbit into: the outermost tracks sit against the
  // edge, so any rotation immediately pushes some of them off-screen. A quarter of the
  // frame as breathing room means the whole field stays in view while you move around it.
  const dist = (radius / Math.sin(limitFov / 2)) / VIEW_FILL;
  neuralControls.target.copy(center);
  neuralCamera.position.copy(center).addScaledVector(dir, dist);
  neuralLerpT = 1;
  neuralControls.update();
  _framedForCat = (typeof activeCatalog !== 'undefined') ? String(activeCatalog) : '';
}
// pilot 19027
(function initFogSwitch() {
  const paint = () => { const sw = document.getElementById('fog-switch');
                        if (sw) sw.dataset.on = fogEnabled ? '1' : '0'; };
  if (true /* module: runs before DOMContentLoaded */) document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();
// pilot 19289
function showToast(msg, opts) {
  opts = opts || {};
  const subtle = !!opts.subtle;
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'toast';
    t.style.cssText = 'position:fixed;z-index:700;pointer-events:none;text-align:center;'   /* above the z-650 formula backdrop — its Apply/Save toasts must not dim (seam review 2026-08-26) */
      + 'opacity:0;transition:opacity .18s ease, transform .18s ease';
    document.body.appendChild(t);
  }
  // COLOUR AND TYPE LIVE IN CSS (#toast rules), not here. This used to be a wall of inline
  // styles with a hardcoded near-black fill, which meant every skin sweep silently skipped
  // it — the light skin ended up drawing dark ink on that dark fill and the toast became
  // unreadable (Mark, 2026-08-04). Inline styles win over stylesheets, so anything set
  // here is invisible to future theming. Only POSITION and the animation stay inline.
  t.className = subtle ? 'toast-subtle' : 'toast-main';
  Object.assign(t.style, subtle ? {
    top:'auto', bottom:'92px', left:'50%', right:'auto',
    transform:'translateX(-50%) translateY(6px)',
  } : {
    top:'50%', bottom:'auto', left:'50%', right:'auto',
    transform:'translate(-50%,-50%) scale(.96)',
  });
  t.textContent = msg;
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = subtle ? 'translateX(-50%) translateY(0)' : 'translate(-50%,-50%) scale(1)';
  });
  clearTimeout(t._tid);
  t._tid = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = subtle ? 'translateX(-50%) translateY(6px)' : 'translate(-50%,-50%) scale(.96)';
  }, opts.duration || (subtle ? 1100 : 2800));
}
// pilot 19327
let activePlaylist = null;   // full data {tracks, snapshots, anchor_track_id, ...}
// pilot 19328
const currentMode = 'learn';   /* Lite has no modes: every pilot mode branch reads as Curate until it is stripped */
// pilot 19360
let exploreTrail = (() => {
  try {
    const v = JSON.parse(localStorage.getItem('explore-trail') || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch (_) { return []; }
})();
// pilot 19492
function trailTrackIds() {
  if (typeof currentMode !== 'undefined' && currentMode === 'explore') return exploreTrail.slice();
  return (activePlaylist?.tracks || []).map(t => t.track_id);
}
// pilot 20400
let _pbLastPct = 0;
// pilot 20407
let _pbCurrentFull = false, _pbNextFull = false;
// pilot 20414
let _pbSequencing = false, _pbErrCount = 0;
// pilot 20420
let _pbSeqIdx = -1;
// pilot 21486
function matrixPreviewIdx(idx) {
  if (idx < 0 || !neuralMeshes[idx]) return;
  const nd = neuralNodeData[idx];
  if (!nd?.catalogId) return;
  // Start audio without disturbing anchor ring/edges/camera
  audioPlayById(nd.catalogId, { keepAnchor: true });
}
// pilot 22509
function featUse(name) {
  try {
    const seen = JSON.parse(localStorage.getItem('feat-first-use') || '[]');
    if (seen.includes(name)) return;
    seen.push(name);
    localStorage.setItem('feat-first-use', JSON.stringify(seen.slice(0, 200)));
  } catch (_) {                          // storage unavailable → dedupe per page at least
    featUse._mem = featUse._mem || new Set();
    if (featUse._mem.has(name)) return;
    featUse._mem.add(name);
  }
  if (typeof fieldEvent === 'function') fieldEvent('feature_first_use', { name: String(name).slice(0, 60) });
}

// pilot 7726 — Field (catalogue) management. Lives here because it writes activeCatalog,
// viewedCatalogs and allCatalogs, which this module owns.
function setActiveCatalog(slug) {
  activeCatalog = slug;
  try { localStorage.setItem('active-catalog', slug); } catch (_) {}
  window.onActiveCatalogChange?.();
  if (!viewedCatalogs.has(slug)) {
    viewedCatalogs.add(slug);
    if (_fdStaged) _fdStaged.add(slug);   // same reason as in toggleViewedCatalog
    renderCombineChips();
    try { localStorage.setItem('viewed-catalogs', JSON.stringify([...viewedCatalogs])); } catch (_) {}
  }
  renderCatSelector();
  loadCatalog();
}
// pilot 7744
async function newCatalogPrompt() {
  const name = prompt('New Field name:');
  if (!name?.trim()) return null;
  const res  = await fetch('/catalogs', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name: name.trim() })
  });
  const data = await res.json();
  if (data.error) { showToast(data.error); return null; }
  allCatalogs.push({ name: data.name, slug: data.slug, count: 0 });
  activeCatalog = data.slug;
  try { localStorage.setItem('active-catalog', data.slug); } catch (_) {}
  // A brand-new Field takes the view on its own — adding the slug would blend the empty
  // Field into whatever was already selected (Mark, 2026-08-27).
  viewedCatalogs = new Set([data.slug]);
  try { localStorage.setItem('viewed-catalogs', JSON.stringify([...viewedCatalogs])); } catch (_) {}
  renderCatSelector(); renderCombineChips();
  window.onActiveCatalogChange?.();
  await loadCatalog();
  return data.slug;
}
// pilot 7775
async function deleteCatalogPrompt() {
  if (allCatalogs.length <= 1) { showToast('Cannot delete the only Field.'); return; }
  const c = allCatalogs.find(x => x.slug === activeCatalog);
  if (!confirm(`Delete Field "${c?.name || activeCatalog}" and all its tracks? Audio moves to Tunefield's trash and entries are snapshotted.`)) return;
  const res  = await fetch(`/catalogs/${activeCatalog}`, { method:'DELETE' });
  const data = await res.json();
  if (data.error) { showToast(data.error); return; }
  allCatalogs    = allCatalogs.filter(x => x.slug !== activeCatalog);
  viewedCatalogs.delete(activeCatalog);
  activeCatalog  = allCatalogs[0].slug;
  if (!viewedCatalogs.size) viewedCatalogs.add(activeCatalog);
  renderCatSelector(); renderCombineChips();
  window.onActiveCatalogChange?.();
  await loadCatalog();
}
// pilot 7790
async function renameCatalogPrompt() {
  const c = allCatalogs.find(x => x.slug === activeCatalog);
  const name = prompt('Rename Field:', c?.name || '');
  if (!name?.trim() || name.trim() === c?.name) return;
  const res  = await fetch(`/catalogs/${activeCatalog}`, {
    method:'PATCH', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name: name.trim() })
  });
  const data = await res.json();
  if (data.error) { showToast(data.error); return; }
  if (c) c.name = name.trim();
  renderCatSelector(); renderCombineChips();
  window.onActiveCatalogChange?.();
}

function updateTabCounts() {
  for (const id of ['tab-neural-count', 'tab-catalog-count']) {
    const n = document.getElementById(id);
    if (n) n.textContent = catalog.length;
  }
}

// Called by app.js on every switch to or from the Field tab (was part of the pilot's switchTab).
async function fieldShow(on) {
  neuralActive = on;
  if (!on) {
    if (typeof fpsActive !== 'undefined' && fpsActive) exitFPS();
    if (typeof _kbHeld !== 'undefined') { _kbHeld.clear(); _kbVel.x = _kbVel.y = _kbVel.z = 0; }
    return;
  }
  closeAllDrawers();
  try {
    await loadCatalogMeta(); await loadCatalog(); await initNeural();
  } catch (err) {
    console.error('Tunefield init failed:', err); showToast('Could not load the Field — is the app still running?');
  }
  window.__syncNeuralSize?.();
}

// ── Filters and key wheel (pilot; shared by Field and List) ──
// pilot 6045
function renderTagFilterRow() {
  const row = document.getElementById('tag-filter-row');
  const fp  = document.getElementById('fp-tags');
  if (!row || !fp) return;
  row.style.display = allTags.length ? 'flex' : 'none';
  fp.innerHTML = allTags.map(t => {
    const on = activeFilters.tags.has(t.id);
    return `<span class="filter-pill${on?' active':''}" data-tag-id="${t.id}"
      style="${on?`background:${t.color};color:#000;border-color:transparent`:`border-color:${t.color};color:${t.color}`}"
      onclick="toggleTagFilter('${t.id}',this)">${esc(t.name)}</span>`;
  }).join('');
}
// pilot 6057
function toggleTagFilter(id, el) {
  if (activeFilters.tags.has(id)) {
    activeFilters.tags.delete(id);
    el.classList.remove('active');
    const t = allTags.find(x => x.id === id);
    if (t) { el.style.background=''; el.style.color=t.color; el.style.borderColor=t.color; }
  } else {
    activeFilters.tags.add(id);
    el.classList.add('active');
    const t = allTags.find(x => x.id === id);
    if (t) { el.style.background=t.color; el.style.color='#000'; el.style.borderColor='transparent'; }
  }
  applyFilters();
}
// pilot 7658
function renderFieldChecks() {
  const build = (src) => (allCatalogs || []).map(c => {
    const on = src.has(c.slug);
    return `<label class="fc-row${on ? ' on' : ''}" style="--ch-c:${catalogColor(c.slug)}"
              title="${on ? 'In view — untick to remove' : 'Tick to add to the combined view'}">
      <input type="checkbox" ${on ? 'checked' : ''}
             onchange="toggleViewedCatalog('${esc(c.slug)}', event)">
      <span class="fc-dot"></span>
      <span class="fc-name">${esc(c.name)}</span>
      <span class="fc-count">${c.count ?? ''}</span>
    </label>`;
  }).join('') || '<div class="fc-empty">No Fields yet.</div>';
  // Both surfaces show their own STAGED set while open, the live selection otherwise.
  const drawer = document.getElementById('field-checks');
  if (drawer) drawer.innerHTML = build(_fdStaged || viewedCatalogs);
  const fdApply = document.getElementById('fd-apply');
  if (fdApply) {
    const dirty = (typeof _fdDirty === 'function') && _fdDirty();
    fdApply.classList.toggle('dirty', dirty);
    fdApply.textContent = dirty ? 'Apply' : 'Applied';
    fdApply.disabled = !dirty;
  }
  const pick = document.getElementById('field-picker-list');
  if (pick) pick.innerHTML = build(_fpStaged || viewedCatalogs);
  const n = viewedCatalogs.size;
  const label = n ? `Fields (${n}) ▾` : 'Fields ▾';
  ['list-field-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = label;
  });
}
// pilot 7695
function toggleViewedCatalog(slug, evt) {
  // Inside the open dropdown picker: stage only — closeFieldPicker() applies.
  if (_fpStaged && evt && evt.target && evt.target.closest && evt.target.closest('#field-picker')) {
    if (_fpStaged.has(slug)) _fpStaged.delete(slug); else _fpStaged.add(slug);
    renderFieldChecks();
    return;
  }
  // Inside the FIELDS drawer: stage only — applyFieldDrawer() (or closing) commits.
  if (_fdStaged && evt && evt.target && evt.target.closest && evt.target.closest('#fields-drawer')) {
    if (_fdStaged.has(slug)) _fdStaged.delete(slug); else _fdStaged.add(slug);
    renderFieldChecks();
    return;
  }
  // A toggle from ANOTHER surface (combine chips, another tab) while the FIELDS drawer sits
  // open with staged ticks: mirror it, or Apply would silently undo what just happened.
  if (viewedCatalogs.has(slug)) { viewedCatalogs.delete(slug); if (_fdStaged) _fdStaged.delete(slug); }
  else { viewedCatalogs.add(slug); if (_fdStaged) _fdStaged.add(slug); }
  // Persist the selection so a page reload restores the same multi-library view.
  try { localStorage.setItem('viewed-catalogs', JSON.stringify([...viewedCatalogs])); } catch (_) {}
  renderCombineChips();
  loadCatalog();
  // Repair follows the selection. ON the repair tab renderRepair handles every
  // state itself (empty-selection message, first scan, stale-scan rescan prompt).
  // Off-tab, only refresh existing results (never kick off a scan from another tab).
  if (typeof renderRepair === 'function') {
    if (document.body.classList.contains('on-tab-repair')) renderRepair();
    else if (typeof repairData !== 'undefined' && repairData) renderRepair();
  }
  // Analyse is destination-driven since 2026-08-24 — it no longer follows viewedCatalogs.
}
// pilot 7883
let _filterDebounceT = null;
// pilot 7884
function applyFiltersDebounced() {
  clearTimeout(_filterDebounceT);
  _filterDebounceT = setTimeout(() => applyFilters(), 140);
}
// pilot 7915
function refreshActiveFilterCount() {
  if (typeof activeFilters === 'undefined') return;
  const f = activeFilters;
  let n = 0;
  if (f.bpmMin > 60   || f.bpmMax  < 200)  n++;
  if (f.danceMin > 0  || f.danceMax  < 100) n++;
  if (f.energyMin > 0 || f.energyMax < 100) n++;
  if (f.durMin > 0    || f.durMax  < 900)  n++;
  if (f.relMin > 1950 || f.relMax < 2027)  n++;   // Released — was missing from the count
  if (f.moods?.size)   n++;
  if (f.modes?.size)   n++;
  if (f.keys?.size)    n++;
  if (f.tags?.size)    n++;
  if (f.genres?.size)  n++;   // set from the Neural genre legend — filters the table too
  if (f.vocals)        n++;
  const search = document.getElementById('cat-search');
  if (search && search.value.trim()) n++;
  // NOT counted: playbackRange (the preview window). It's a PLAYBACK setting and filters
  // no tracks — counting it made the badge read "1" with every filter cleared (2026-08-04).
  const badge = document.getElementById('fb-active-count');
  if (badge) { badge.textContent = n; badge.classList.toggle('show', n > 0); }
  // Mirror on the ☰ FILTERS drawer tab — visible even while the drawer is closed, so
  // "why is half my library missing?" is answerable at a glance.
  const dBadge = document.getElementById('fd-active-count');
  if (dBadge) { dBadge.textContent = n; dBadge.classList.toggle('show', n > 0); }
}
// pilot 7943
const MULTI_SELECT_GROUPS = new Set(['mood','mode']);
// pilot 7945
function togglePill(el, group) {
  const val = el.dataset.val;
  if (!MULTI_SELECT_GROUPS.has(group)) {
    // Single-select (vocals)
    el.parentElement.querySelectorAll('.filter-pill').forEach(p => {
      p.classList.remove('active'); p.style.background=''; p.style.color=''; p.style.borderColor='';
    });
    el.classList.add('active');
    activatePillStyle(el);
    activeFilters.vocals = val;
  } else {
    // Multi-select (mood, mode)
    const filterKey = group + 's'; // 'mood'→'moods', 'mode'→'modes'
    const allPill = el.parentElement.querySelector('[data-val=""]');
    if (val === '') {
      // Clear all → activate "All"
      activeFilters[filterKey].clear();
      el.parentElement.querySelectorAll('.filter-pill').forEach(p => {
        p.classList.remove('active'); p.style.background=''; p.style.color=''; p.style.borderColor='';
      });
      el.classList.add('active'); activatePillStyle(el);
    } else {
      // Toggle this value
      if (activeFilters[filterKey].has(val)) {
        activeFilters[filterKey].delete(val);
        el.classList.remove('active'); el.style.background=''; el.style.color=''; el.style.borderColor='';
      } else {
        activeFilters[filterKey].add(val);
        el.classList.add('active'); activatePillStyle(el);
      }
      // Sync "All" pill: active only when set is empty
      if (allPill) {
        const isEmpty = activeFilters[filterKey].size === 0;
        allPill.classList.toggle('active', isEmpty);
        if (isEmpty) activatePillStyle(allPill); else { allPill.style.background=''; allPill.style.color=''; allPill.style.borderColor=''; }
      }
    }
  }
  applyFilters();
}
// pilot 7986
function activatePillStyle(el) {
  const pc = el.style.getPropertyValue('--pc') || 'var(--accent)';
  el.style.background=pc; el.style.color='#000'; el.style.borderColor='transparent';
}
// pilot 7992
document.querySelectorAll('.filter-pill.active').forEach(el => activatePillStyle(el));
// pilot 7994
function clearFilters() {
  // The KEY selection is NOT a filter-panel concern (Mark, 2026-08-05). It belongs to the
  // ◍ KEY wheel, which has its own Clear in the hub — so the two controls are discrete:
  // "Clear filters" clears the filter panel, the wheel's Clear clears the wheel. Wiping
  // the key from here meant clearing a BPM range silently threw away the harmonic
  // selection the user had built up on the wheel.
  const keptKeys = (activeFilters && activeFilters.keys) ? activeFilters.keys : new Set();
  const keptAnchor = activeFilters ? activeFilters._anchor : null;
  document.getElementById('cat-search').value = '';
  activeFilters = {
    moods:new Set(), modes:new Set(), vocals:'',
    bpmMin:60,    bpmMax:200,
    danceMin:0,   danceMax:100,
    energyMin:0,  energyMax:100,
      durMin:0,     durMax:900,
    relMin:1950,  relMax:2027,
    keys:keptKeys, tags:new Set(), genres:new Set()
  };
  activeFilters._anchor = keptAnchor;
  renderTagFilterRow();
  // Reset every dual-range filter to its full span
  document.querySelectorAll('.dual-range').forEach(dr => {
    const low = dr.querySelector('.dr-low'), high = dr.querySelector('.dr-high');
    low.value = low.min; high.value = high.max;
    refreshDualRange(dr);
  });
  document.querySelectorAll('.filter-pills').forEach(g => {
    g.querySelectorAll('.filter-pill').forEach((p,i) => {
      p.classList.toggle('active', i===0);
      if (i===0) activatePillStyle(p); else { p.style.background=''; p.style.color=''; p.style.borderColor=''; }
    });
  });
  updateKeyCount();
  renderCamelotWheel();
  // (Ring bias deliberately NOT reset here — it is a wheel setting, and the wheel's own
  //  Clear owns it. See clearKeyFilter.)
  // Genre filters live in the Neural legend's checkboxes — re-render it so the
  // just-cleared genre set is reflected visually there too (only when it's showing genre).
  const nColorSel = document.getElementById('n-color');
  if (nColorSel && nColorSel.value === 'genre' && typeof updateNeuralLegend === 'function') {
    try { updateNeuralLegend('genre'); } catch (_) {}
  }
  applyFilters();
}
// pilot 8041
function refreshDualRange(container) {
  const key  = container.dataset.key;
  const low  = container.querySelector('.dr-low');
  const high = container.querySelector('.dr-high');
  let lv = +low.value, hv = +high.value;
  if (lv > hv) { [lv, hv] = [hv, lv]; low.value = lv; high.value = hv; }
  const min = +low.min, max = +low.max;
  const fillFrom = ((lv - min) / (max - min)) * 100;
  const fillTo   = ((hv - min) / (max - min)) * 100;
  container.style.setProperty('--fill-from', fillFrom + '%');
  container.style.setProperty('--fill-to',   fillTo   + '%');
  // Numeric entry fields flank the slider — dragging writes back into them, so the
  // typed value and the thumb position can never disagree. Skip the field the user
  // is currently typing into, or we'd yank the caret mid-edit.
  const numLo = document.getElementById(`f-${key}-num-lo`);
  const numHi = document.getElementById(`f-${key}-num-hi`);
  if (numLo) {
    if (document.activeElement !== numLo) numLo.value = lv;
    numLo.classList.toggle('mb-num-set', lv > min);
  }
  if (numHi) {
    if (document.activeElement !== numHi) numHi.value = hv;
    numHi.classList.toggle('mb-num-set', hv < max);
  }
  // Map data-key → activeFilters keys
  const capKey = key === 'dur' ? 'dur' : key;
  activeFilters[`${capKey}Min`] = lv;
  activeFilters[`${capKey}Max`] = hv;
}
// pilot 8070
document.querySelectorAll('.dual-range').forEach(container => {
  const low  = container.querySelector('.dr-low');
  const high = container.querySelector('.dr-high');
  const handler = which => () => {
    let lv = +low.value, hv = +high.value;
    // Enforce min-gap of 1 so thumbs never cross
    if (which === 'low'  && lv > hv - 1) low.value  = Math.max(+low.min,  hv - 1);
    if (which === 'high' && hv < lv + 1) high.value = Math.min(+high.max, lv + 1);
    refreshDualRange(container);
    applyFilters();
  };
  low.addEventListener('input',  handler('low'));
  high.addEventListener('input', handler('high'));
  refreshDualRange(container);

  // Per-thumb tooltips derived from the metric. The minimum thumb raises the floor
  // (hide tracks below this value); the maximum thumb lowers the ceiling.
  const key = container.dataset.key || '';
  const label = ({
    bpm:     'BPM',
    dance:   'danceability %',
    energy:  'energy %',
    dur:     'duration (s)',
  })[key] || key;
  if (!low.hasAttribute('title'))  low.title  = `Minimum ${label} — drag right to hide quieter / slower tracks below this value.`;
  if (!high.hasAttribute('title')) high.title = `Maximum ${label} — drag left to hide louder / faster tracks above this value.`;

  // ── Manual numeric entry ──────────────────────────────────────────
  // Commit on Enter or blur (NOT on every keystroke — typing "150" would otherwise
  // apply "1" then "15" and refilter the whole field twice for nothing). Arrow keys
  // and the mouse wheel step live, since those are already discrete intents.
  const numLo = document.getElementById(`f-${key}-num-lo`);
  const numHi = document.getElementById(`f-${key}-num-hi`);
  const commit = (el, which) => {
    const bound = which === 'low' ? low : high;
    let v = parseFloat(el.value);
    if (!isFinite(v)) { refreshDualRange(container); return; }   // gibberish → snap back
    v = Math.round(Math.max(+bound.min, Math.min(+bound.max, v)));
    // Keep the 1-unit gap the thumbs enforce, so entry can't invert the range
    if (which === 'low')  v = Math.min(v, +high.value - 1);
    else                  v = Math.max(v, +low.value  + 1);
    bound.value = v;
    refreshDualRange(container);
    applyFilters();
  };
  [[numLo,'low'], [numHi,'high']].forEach(([el, which]) => {
    if (!el) return;
    el.addEventListener('change', () => commit(el, which));
    el.addEventListener('focus',  () => el.select());
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); refreshDualRange(container); el.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Native number-input stepping fires no 'change' until blur — commit now
        setTimeout(() => commit(el, which), 0);
      }
      e.stopPropagation();   // never let filter typing reach the WASD / arrow flight keys
    });
    el.addEventListener('keyup',   e => e.stopPropagation());
    el.addEventListener('keypress',e => e.stopPropagation());
  });
});
// pilot 8343
function openFieldPicker(btnId) {
  const popup = document.getElementById('field-picker');
  _fpStaged = new Set(viewedCatalogs);
  renderFieldChecks();   // fill #field-picker-list with the current selection
  // Position near button (right-edge clamped), same as the Columns picker.
  const btn  = document.getElementById(btnId);
  const rect = btn.getBoundingClientRect();
  popup.style.display = 'block';
  const pw = popup.offsetWidth;
  let left = rect.left;
  if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
  popup.style.left = left + 'px';
  popup.style.top  = (rect.bottom + 6) + 'px';
}
// pilot 10563
let camelotCompatDir  = 'sym';   // 'sym' | 'up' | 'down'
// pilot 10789
const WHEEL_NOTATIONS = ['openkey', 'camelot', 'standard'];
// pilot 10796
function cycleWheelNotation() {
  const i = WHEEL_NOTATIONS.indexOf(wheelNotation);
  setWheelNotation(WHEEL_NOTATIONS[(i + 1) % WHEEL_NOTATIONS.length]);
}
// pilot 10809
function setWheelNotation(mode) {
  if (mode !== 'standard' && mode !== 'camelot' && mode !== 'openkey') return;
  wheelNotation = mode;
  try { localStorage.setItem('wheel-notation', mode); } catch (_) {}
  document.querySelectorAll('#cw-notation .cwn-stop').forEach(b => {
    b.classList.toggle('active', b.dataset.val === mode);
  });
  _syncNotationCycleBtn();
  if (typeof renderCamelotWheel === 'function') renderCamelotWheel();
}
// pilot 10870
function currentAnchorCamelotKey() {
  try {
  let trackId = null;
  if (typeof neuralRingIdx !== 'undefined' && neuralRingIdx >= 0 && neuralNodeData?.[neuralRingIdx]) {
    if (neuralNodeData[neuralRingIdx].camelot) return neuralNodeData[neuralRingIdx].camelot;
    trackId = neuralNodeData[neuralRingIdx].catalogId;
  }
  if (!trackId && typeof audioCurrentId !== 'undefined' && audioCurrentId) trackId = audioCurrentId;
  if (!trackId && typeof anchorTrackId === 'function') {
    // anchorTrackId reads activePlaylist (declared with let in script #3) — guard against
    // ReferenceError when this is called from script #2's init path before that runs.
    try { trackId = anchorTrackId(); } catch (_) { trackId = null; }
  }
  if (!trackId || typeof catalog === 'undefined') return null;
  const ent = catalog.find(e => e.id === trackId);
  if (!ent?.data?.harmony) return null;
  return noteToCamelot(ent.data.harmony.root, ent.data.harmony.mode);
  } catch (_) { return null; }
}
// pilot 10890
function setCompatMode(v) {
  camelotCompatMode = v;
  // Drive the gearstick visuals: the data-mode attribute slides the ball + colours the stop
  const modes = document.getElementById('cw-modes');
  if (modes) modes.dataset.mode = v;
  // Switching AWAY from Manual with no anchor set yet → auto-seed from current node
  if (v !== 'off' && (!activeFilters._anchor || !activeFilters.keys.size)) {
    const auto = currentAnchorCamelotKey();
    if (auto) {
      activeFilters._anchor = auto;
      activeFilters.keys = compatKeys(auto);
      updateKeyCount();
      renderCamelotWheel();
      applyFilters();
    }
  }
  reapplyKeySelectionIfAuto();
  // Camelot wheel is the single source for matrix edges too — rebuild if neural is up.
  if (typeof rebuildGraph === 'function' && typeof neuralMeshes !== 'undefined' && neuralMeshes.length) {
    rebuildGraph();
  }
}
// pilot 10914
function reapplyKeySelectionIfAuto() {
  // Re-derive the set from whatever single anchor key the user previously picked
  if (camelotCompatMode === 'off' || !activeFilters.keys.size) return;
  // Find an anchor: smallest set member by current selection order — pick any
  // We treat the anchor as the previously stored one, or just use the first
  const anchor = activeFilters._anchor || [...activeFilters.keys][0];
  activeFilters._anchor = anchor;
  activeFilters.keys = compatKeys(anchor);
  updateKeyCount();
  renderCamelotWheel();
  applyFilters();
}
// pilot 10955
function compatKeys(id) { return compatKeysFor(id, camelotCompatMode, camelotCompatDir); }
// pilot 10963
let camelotRingBias = 'both';   // 'both' | 'dark' | 'light'
// pilot 10991
function _applyRingBias() {
  activeFilters.modes = new Set(
    camelotRingBias === 'dark' ? ['minor'] : camelotRingBias === 'light' ? ['major'] : []);
  applyFilters();
}
// pilot 10996
function _syncModeIconUI() {
  const m = document.getElementById('cw-modes');
  if (!m) return;
  m.dataset.bias = camelotRingBias;
  m.querySelectorAll('.cw-stop').forEach(b => {
    const active = b.dataset.val === camelotCompatMode;
    b.classList.toggle('bias-dark',  active && camelotRingBias === 'dark');
    b.classList.toggle('bias-light', active && camelotRingBias === 'light');
  });
}
// pilot 11006
function onModeIconClick(v) {
  if (camelotCompatMode !== v) {
    camelotRingBias = 'both';
    _applyRingBias();
    setCompatMode(v);
  } else {
    camelotRingBias = camelotRingBias === 'both' ? 'dark'
                    : camelotRingBias === 'dark' ? 'light' : 'both';
    _applyRingBias();
    if (typeof showToast === 'function')
      showToast(camelotRingBias === 'dark'  ? 'Dark — minor keys only'
              : camelotRingBias === 'light' ? 'Light — major keys only'
              : 'All modes', { subtle: true });
  }
  _syncModeIconUI();
}
// pilot 11102
function clearKeyFilter() {
  // Clear = back to "just where I am": select ONLY the current track's key (Mark,
  // 2026-08-03). No current track → empty selection (all keys shown). Always Manual.
  camelotCompatMode = 'off';
  // Ring bias moved here from clearFilters — it's a wheel setting, so the wheel's Clear
  // owns it and the filter panel's Clear leaves it alone.
  if (typeof camelotRingBias !== 'undefined') camelotRingBias = 'both';
  const m = document.getElementById('cw-modes');
  if (m) m.dataset.mode = 'off';
  if (typeof _syncModeIconUI === 'function') _syncModeIconUI();
  activeFilters._anchor = null;
  activeFilters.keys.clear();
  // Clear now clears EVERYTHING — no key stays hard-selected (Mark, 2026-08-04).
  // The current track's key still reads on the wheel, but as the SOFT .cam-current
  // outline only: "you are here", not "this is filtering". Previously Clear re-selected
  // the current key, which left a filter active behind a button that says Clear.
  updateKeyCount();
  renderCamelotWheel();
  syncKeyViewToFilter();
  applyFilters();
}
// pilot 11128
function syncKeyViewToFilter() {
  if (typeof applyHighVisibility === 'function') applyHighVisibility();
}
// pilot 11132
function camelotClick(e) {
  let el = e.target;
  while (el && el !== e.currentTarget) {
    if (el.dataset && el.dataset.key) { toggleCamelotKey(el.dataset.key); return; }
    el = el.parentElement;
  }
}
// pilot 11140
function toggleCamelotKey(id) {  // e.g. '8B', '5A'
  // Touching the wheel = Manual mode, always (Mark, 2026-08-03). If a compat mode was
  // active, its computed selection stays as the base and the clicked key toggles on top;
  // Manual only ends via Clear or one of the four mode pads.
  if (camelotCompatMode !== 'off') {
    camelotCompatMode = 'off';
    const m = document.getElementById('cw-modes');
    if (m) m.dataset.mode = 'off';
    if (typeof _syncModeIconUI === 'function') _syncModeIconUI();
  }
  activeFilters._anchor = null;
  if (activeFilters.keys.has(id)) activeFilters.keys.delete(id);
  else activeFilters.keys.add(id);
  updateKeyCount();
  renderCamelotWheel();
  syncKeyViewToFilter();
  applyFilters();
}
// pilot 11160
function updateKeyCount() {
  const n   = activeFilters.keys.size;
  const lbl = document.getElementById('kp-selected-label');
  if (lbl) {
    if (n === 0) {
      lbl.textContent = 'No keys selected — showing all';
    } else {
      const names = [...activeFilters.keys].sort((a,b) => {
        const pa=parseInt(a), pb=parseInt(b);
        return pa!==pb ? pa-pb : a.slice(-1).localeCompare(b.slice(-1));
      });
      lbl.textContent = names.join('  ·  ');
    }
  }
}
// pilot 11176
function renderCamelotWheel() {
  const svg = document.getElementById('camelot-svg');
  if (!svg) return;

  const rInner = 42, rMid = 110, rOuter = 172;
  const GAP_DEG = 1.5; // gap on each side of segment

  function seg(r1, r2, posIdx, ring) {
    const centerDeg = -90 + posIdx * 30;
    const s = (centerDeg - 15 + GAP_DEG) * Math.PI / 180;
    const e = (centerDeg + 15 - GAP_DEG) * Math.PI / 180;
    const cos = Math.cos, sin = Math.sin;
    const x1=r1*cos(s),y1=r1*sin(s), x2=r2*cos(s),y2=r2*sin(s);
    const x3=r2*cos(e),y3=r2*sin(e), x4=r1*cos(e),y4=r1*sin(e);
    const id = `${CAMELOT[posIdx].pos}${ring}`;
    const selected = activeFilters.keys.has(id);
    const hue = posIdx * 30;

    let fill;
    // Saturation cranked across the board so the wheel reads as a full colour spectrum
    // at rest, not a muted grid. Lightness kept low on unselected so the colour is
    // present but doesn't compete with selected / hover states.
    // The wheel is CHROME, so it follows the app skin (not the field skin). Unselected
    // keys are a quiet tint of their hue — pale on paper, deep on black — and selected
    // keys go to full strength. Label ink flips with the fill so it stays legible in
    // every combination. Hardcoding the light values left a glaring white wheel on the
    // dark skin (2026-08-05).
    const _skin = document.documentElement.getAttribute('data-skin');
    const darkSkin = _skin === 'dark' || _skin === 'vintage';
    // Vintage keys are aged — lower saturation than dark's neon, same depth logic.
    const _sat = _skin === 'vintage';
    if (selected) {
      fill = ring==='A' ? `hsl(${hue},${darkSkin?(_sat?'64%,46%':'92%,52%'):'64%,44%'})` : `hsl(${hue},${darkSkin?(_sat?'58%,40%':'88%,46%'):'58%,38%'})`;
    } else {
      fill = ring==='A' ? `hsl(${hue},${darkSkin?(_sat?'40%,19%':'60%,20%'):'46%,84%'})` : `hsl(${hue},${darkSkin?(_sat?'36%,15%':'54%,16%'):'40%,88%'})`;
    }
    const textCol = darkSkin ? (_sat ? '#F7EDDA' : '#FFFFFF') : (selected ? '#FFFFFF' : '#1C1917');

    const path = `M${x1},${y1} L${x2},${y2} A${r2},${r2} 0 0,1 ${x3},${y3} L${x4},${y4} A${r1},${r1} 0 0,0 ${x1},${y1} Z`;
    const rMidSeg  = (r1 + r2) / 2;
    const angleMid = (centerDeg) * Math.PI / 180;
    const lx = rMidSeg * cos(angleMid), ly = rMidSeg * sin(angleMid);
    const c   = CAMELOT[posIdx];
    const note = c[ring].label;

    // Rotate text to be radial (readable from outside)
    const rotDeg = centerDeg + (centerDeg > 90 || centerDeg < -90 ? 180 : 0);

    // Notation: 'standard' shows note+mode (bigger letter); 'camelot' shows position+ring.
    // Only one is rendered at a time so each label has room to breathe.
    const useCamelot = wheelNotation === 'camelot' || wheelNotation === 'openkey';
    const posTxt = wheelNotation === 'openkey'
      ? `${CAMELOT[posIdx].open}${ring === 'A' ? 'm' : 'd'}`
      : `${CAMELOT[posIdx].pos}${ring}`;
    // No maj/min sub-label (Mark, 2026-08-28): the words were dead weight in every
    // notation. Note names carry minor as an m suffix (Am vs A) — the same convention
    // as the List's Key column; the ring's position already says the rest. Full words
    // stay in the segment's tooltip.
    // Inner-ring labels sized to their segment, not to the outer ring (Mark, 2026-08-28:
    // "too squashed at this size"): the minor ring's arcs are ~40% smaller, so its note
    // sits at 15px with the m as a lighter 10px suffix instead of a full-height character
    // — three glyphs no longer collide with their neighbours at small wheel sizes.
    const labels = useCamelot
      ? `<text class="cam-pos" x="0" y="0" text-anchor="middle" dominant-baseline="middle"
            font-size="${ring==='A'?'15':'19'}" font-weight="600" fill="${textCol}" pointer-events="none">${posTxt}</text>`
      : ring === 'A'
      ? `<text class="cam-note" x="0" y="0" text-anchor="middle" dominant-baseline="middle"
            font-size="15" font-weight="600" fill="${textCol}" pointer-events="none">${note}<tspan font-size="10" opacity=".85" dy="1">m</tspan></text>`
      : `<text class="cam-note" x="0" y="0" text-anchor="middle" dominant-baseline="middle"
            font-size="21" font-weight="600" fill="${textCol}" pointer-events="none">${note}</text>`;

    return `<g data-key="${id}" class="cam-key" style="cursor:pointer">
      <path d="${path}" fill="${fill}" stroke="var(--bg)" stroke-width="1.5">
        <title>${c.pos}${ring} · ${note} ${ring==='A'?'minor':'major'}</title>
      </path>
      <g transform="rotate(${centerDeg+90},${lx},${ly}) translate(${lx},${ly})">
        ${labels}
      </g>
    </g>`;
  }

  // Position numbers on the dividing ring at r=98
  function posNum(posIdx) {
    const angleDeg = -90 + posIdx * 30;
    const a = angleDeg * Math.PI / 180;
    const r = rMid;
    const x = r * Math.cos(a), y = r * Math.sin(a);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
      font-size="10" font-weight="500" fill="var(--muted)" opacity=".5" pointer-events="none">${CAMELOT[posIdx].pos}</text>`;
  }

  const segments = CAMELOT.map((_, i) => seg(rInner, rMid, i, 'A') + seg(rMid, rOuter, i, 'B')).join('');
  const nums     = CAMELOT.map((_, i) => posNum(i)).join('');

  svg.innerHTML = `
    ${segments}
    ${nums}
    <circle r="${rInner}" fill="var(--surface2)" stroke="var(--border)" stroke-width="1"/>
    <g id="kp-halo" style="pointer-events:none"></g>`;
  attachCamelotHover();
  // Auto-highlight the segment that matches the currently-anchored / playing track so the
  // wheel always shows "you are HERE" even when no key filter is active.
  syncCamelotCurrent();
}
// pilot 11282
function syncCamelotCurrent() {
  const svg = document.getElementById('camelot-svg');
  if (!svg) return;
  svg.querySelectorAll('.cam-current').forEach(g => g.classList.remove('cam-current'));
  const cam = (typeof currentAnchorCamelotKey === 'function') ? currentAnchorCamelotKey() : null;
  if (!cam) return;
  const g = svg.querySelector(`g[data-key="${cam}"]`);
  if (g) g.classList.add('cam-current');
}
// pilot 11293
function safeNeighbors(id) {
  const pos = parseInt(id), ring = id.slice(-1), other = ring === 'A' ? 'B' : 'A';
  const prev = pos === 1 ? 12 : pos - 1, next = pos === 12 ? 1 : pos + 1;
  return new Set([id, `${pos}${other}`, `${prev}${ring}`, `${next}${ring}`]);
}
// pilot 11299
let camHoveredKey = null;
// pilot 11300
function attachCamelotHover() {
  const svg = document.getElementById('camelot-svg');
  if (!svg || svg._hoverAttached) return;
  svg._hoverAttached = true;
  svg.addEventListener('mousemove', e => {
    const g = e.target.closest('[data-key]');
    const k = g?.dataset?.key || null;
    if (k === camHoveredKey) return;
    camHoveredKey = k;
    if (k) showSafeHalo(k); else hideSafeHalo();
  });
  svg.addEventListener('mouseleave', () => {
    camHoveredKey = null;
    hideSafeHalo();
  });
}
// pilot 11317
function showSafeHalo(id) {
  // Gentle text-highlight: the hovered key + every compatible neighbour gets a brighter
  // text-fill via .cam-suggested / .cam-anchor classes (CSS rules near the wheel styles).
  // The old neon-arc overlay was too loud at the demo zoom.
  clearCamelotHighlight();
  const svg  = document.getElementById('camelot-svg');
  if (!svg) return;
  const keys = camelotCompatMode === 'off' ? safeNeighbors(id) : compatKeys(id);
  svg.querySelectorAll('g[data-key]').forEach(g => {
    const k = g.dataset.key;
    if (k === id)       g.classList.add('cam-anchor');
    else if (keys.has(k)) g.classList.add('cam-suggested');
  });
}
// pilot 11332
function hideSafeHalo() { clearCamelotHighlight(); }
// pilot 11334
function clearCamelotHighlight() {
  const svg = document.getElementById('camelot-svg');
  if (!svg) return;
  svg.querySelectorAll('.cam-anchor, .cam-suggested')
     .forEach(g => g.classList.remove('cam-anchor', 'cam-suggested'));
}
// pilot 14582
function _syncEdgeToggles() {
  const ringsOn = neuralEdgeStyle === 'rings' || neuralEdgeStyle === 'both';
  const linesOn = neuralEdgeStyle === 'lines' || neuralEdgeStyle === 'both';
  const r = document.getElementById('edge-toggle-rings');
  const l = document.getElementById('edge-toggle-lines');
  if (r) r.classList.toggle('on', ringsOn);
  if (l) l.classList.toggle('on', linesOn);
}
// pilot 14591
function toggleEdgeFeature(feature) {
  if (!['rings','lines'].includes(feature)) return;
  let ringsOn = neuralEdgeStyle === 'rings' || neuralEdgeStyle === 'both';
  let linesOn = neuralEdgeStyle === 'lines' || neuralEdgeStyle === 'both';
  if (feature === 'rings') ringsOn = !ringsOn;
  if (feature === 'lines') linesOn = !linesOn;
  neuralEdgeStyle = (ringsOn && linesOn) ? 'both'
                   : ringsOn            ? 'rings'
                   : linesOn            ? 'lines'
                                        : 'none';
  localStorage.setItem('neural-edge-style', neuralEdgeStyle);
  _syncEdgeToggles();
  if (typeof refreshNeuralEdgeHighlight === 'function') refreshNeuralEdgeHighlight();
}
// pilot 16628
function toggleFilterFold() {
  // On the LIST tab the fold is HORIZONTAL (Mark, 2026-08-28): the whole sidebar column
  // collapses to a slim rail and the table takes the width. Elsewhere (playlists
  // sidebar) the old vertical fold stands.
  if (document.body.classList.contains('on-tab-catalog')) {
    const on = !document.body.classList.contains('list-filters-collapsed');
    document.body.classList.toggle('list-filters-collapsed', on);
    try { localStorage.setItem('list-filters-collapsed', on ? '1' : '0'); } catch (_) {}
    return;
  }
  // Only ever the sidebar copy — the drawer must never end up folded (see the CSS note).
  const bar = document.querySelector('.tab-sidebar .filter-bar');
  if (!bar) return;
  const folded = !bar.classList.contains('folded');
  bar.classList.toggle('folded', folded);
  try { localStorage.setItem('filters-folded', folded ? '1' : '0'); } catch (_) {}
}
// pilot 18480
renderCamelotWheel();
// pilot 18481
renderTagFilterRow();

// ── Catalogue edits used by the List (they write state this module owns) ──
// pilot 7804
async function moveEntry(id, fromSlug, sel) {
  const toSlug = sel.value; sel.value = '';
  if (!toSlug) return;
  const form = new FormData();
  form.append('from', fromSlug);
  form.append('to', toSlug);
  const res  = await fetch(`/catalog/${id}/move`, { method:'POST', body:form });
  const data = await res.json();
  if (data.error) { showToast(data.error); return; }
  const entry = catalog.find(c => c.id === id);
  if (entry) entry._cat = toSlug;
  const fm = allCatalogs.find(c => c.slug === fromSlug);
  const tm = allCatalogs.find(c => c.slug === toSlug);
  if (fm && fm.count > 0) fm.count--;
  if (tm) tm.count++;
  renderCatSelector();
  if (!viewedCatalogs.has(toSlug)) catalog = catalog.filter(c => c.id !== id);
  updateTabCounts(); applyFilters();
}
// pilot 8251
async function deleteCatalogEntry(id, e) {
  e.stopPropagation();
  const entry = catalog.find(c => c.id === id);
  // Entry deletion IS snapshotted server-side (repair_undo_entries restores) and the ×
  // sits right next to the rescan button — confirm, and only mutate local state when
  // the server actually deleted it.
  if (!confirm(`Remove "${entry?.filename || 'this track'}" from the Field?\n\nOnly the catalog entry is removed — the audio file stays on disk.`)) return;
  const cat   = entry?._cat || activeCatalog;
  try {
    const r = await fetch(`/catalog/${id}?cat=${cat}`, { method:'DELETE' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return showToast(err.error || `Delete failed (${r.status})`);
    }
  } catch (err) {
    return showToast('Delete failed: ' + (err.message || err));
  }
  catalog = catalog.filter(c => c.id !== id);
  window.listForgetExpanded?.(id);   // the List owns its expanded row
  updateTabCounts(); applyFilters();
}
// pilot 13272
function markFieldStale(opts) {
  window._neuralCatalogSig = null;
  window._neuralGraphDirty = true;
  if (opts && opts.vec) {
    _vecGen++;
    _vecCache = null; _vecAdjCache = null;
    _vecComputed = { pca:null, tsne:null, clusters:null, sim:null };
  }
  if ((!opts || opts.live !== false) && typeof neuralActive !== 'undefined' && neuralActive
      && typeof neuralScene !== 'undefined' && neuralScene && typeof rebuildGraph === 'function') {
    rebuildGraph();
  }
}

// Inline on*="" handlers and generated markup call these by global name.
Object.assign(window, { moveEntry, deleteCatalogEntry, markFieldStale, renderTagFilterRow, toggleTagFilter, renderFieldChecks, toggleViewedCatalog, applyFiltersDebounced, refreshActiveFilterCount, togglePill, activatePillStyle, clearFilters, refreshDualRange, openFieldPicker, cycleWheelNotation, setWheelNotation, currentAnchorCamelotKey, setCompatMode, reapplyKeySelectionIfAuto, compatKeys, _applyRingBias, _syncModeIconUI, onModeIconClick, clearKeyFilter, syncKeyViewToFilter, camelotClick, toggleCamelotKey, updateKeyCount, renderCamelotWheel, syncCamelotCurrent, safeNeighbors, attachCamelotHover, showSafeHalo, hideSafeHalo, clearCamelotHighlight, _syncEdgeToggles, toggleEdgeFeature, toggleFilterFold, updateTabCounts, setActiveCatalog, newCatalogPrompt, deleteCatalogPrompt, renameCatalogPrompt, fieldShow, closeAllDrawers, _genreColorMap, genreColor, listGenres, genreIndex, loadGenreGroups, genreGroupMembers, getRating, getTrackTags, annoPush, _annoSnapshot, _annoFlush, catalogColor, camelotToOpenKey, noteToCamelot, loadCatalogMeta, loadCatalog, renderCatSelector, renderCombineChips, getFilteredCatalog, applyFilters, _fdDirty, applyFieldDrawer, fieldPickerAll, splitArtistTitle, trackArtistTitle, pct, esc, escJs, _drawerTouch, _drawerSetWanted, layoutEdgeDrawers, toggleDrawer, _syncNotationCycleBtn, compatKeysFor, ghostsInteractive, _keyFanHubIdx, toggleKeyFanPreview, audioFade, volTarget, anchorTrackId, tfSeekTo, isTypingContext, enterNeuralScrub, _plausibleYear, releasedValue, compileFormula, parseFormulaPatch, neuralFocusJump, disarmFocusFrame, toggleFocusFrame, lensShift, _lensSyncEdgeLines, neuralAxisPositions, toggleFormulaPanel, applyFormula, clearFormula, _syncAxisDropdownsToFormula, _formulaPatches, renderFormulaPatches, _patchByValue, loadFormulaPatch, deleteFormulaPatch, drawAxisGizmo, _vecCamPos, _viewsLoad, _viewsStore, captureFieldView, applyFieldView, saveFieldView, importFieldView, renderFieldViews, fieldEvent, _fieldEvFlush, _fieldSessionTick, _vecGroupSize, vecMatrix, vecPCA, vecArith, vecParseArith, vecTSNE, vecTSNECancel, _vecMapMetric, vecComputedMetrics, setVecEnabled, toggleVecPanel, vmResetView, vmRenderWeights, vmCurrentTrack, vmName, vmHitList, vmRunPCA, vmRunTSNE, vmRunArith, neuralTagMetrics, allNeuralMetrics, legendHTML, updateNeuralLegend, refreshNeuralAxisSelects, setPlaylistTrailMode, nmOpts, initNeural, pbEaseInOut, pbEffectiveZoom, pbCurrentNodeIdx, pbCameraStart, pbCameraStop, pbCameraFlyToNode, resetNeuralUser, exploreFlyOn, pbCameraTick, setFly, toggleFly, _fpsDragLookFallback, enterFPS, exitFPS, toggleFPS, fpvUnlocked, _fpvApplyLock, _fpvUnlock, _kbModalOpen, _kbBlocked, setKbSpeed, applyKeyNav, kbClearFocus, kbSetFocus, kbUpdateFocusRing, kbHopFocus, kbActivateFocus, toggleKbHelp, closeKbHelp, kbMaybeShowHint, renderTrackCount, _keyFanShortlist, neuralCompatNeighbours, refreshNeuralEdgeHighlight, togglePlaylistTrail, applyViewRange, setSpreadFill, syncSpreadDial, setNeuralSpread, neuralSpreadLiveMorph, commitNeuralSpread, toggleCoverOrbs, applyFilterFoldState, _getSphereGeo, _fibonacciSphere, _buildSpikeGeometry, _getSpikeGeos, setNeuralSpikeMetric, _nodeAlphaShader, neuralNodeMaterial, neuralGhostMaterial, _disposeInstanceLayers, neuralBuildInstances, neuralSyncMatrices, applyLens, neuralSyncColors, neuralSyncAlpha, neuralPickNode, _coverEvict, neuralUpdateCovers, sizeAxisLabels, rebuildPlaylistTrail, updatePlaylistTrailAnimation, neuralShowTooltip, neuralHideTooltip, fieldSkinName, FS, _fogK, applyFog, getNeuralBackground, setNeuralBackground, neuralNorm, neuralNormFold, neuralFieldSpread, _fieldGrowth, rebuildGraph, matrixPlaybackVisibleIds, updateMatrixVisibility, applyHighVisibility, resetNeural, showToast, trailTrackIds, matrixPreviewIdx, featUse, adoptPlaylistStrays, audioPlayById, matrixCommitIdx, renderCatalog, renderRepair, returnToAnchor, setMode, syncTransportPos });

export { catalog, activeCatalog, allCatalogs, loadCatalogMeta, loadCatalog, esc, showToast, MOOD_COLOR, RATINGS, activePlaylist, allTags, annoPush, applyFilters, audioCurrentId, camelotToOpenKey, catalogColor, currentMode, featUse, formulaAxes, getFilteredCatalog, getRating, getTrackTags, globalAudio, markFieldStale, neuralNodeData, noteToCamelot, pct, refreshNeuralAxisSelects, trackArtistTitle, trackTags, viewedCatalogs, wheelNotation };
