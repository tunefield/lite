// List tab: the sortable table of the Fields in view. Lifted from the pilot (index.html @ 7c8c0e7);
// "// pilot N" marks each statement's source line. Filters and the key wheel live in field.js
// (they are the Field's drawers too); this module renders what getFilteredCatalog() returns.
import { MOOD_COLOR, RATINGS, activeCatalog, activePlaylist, activePlaylistSlug, addTrackToActivePlaylist, allCatalogs, allTags, annoPush, applyFilters, audioCurrentId, audioPlayById, audioStop, camelotToOpenKey, catalog, catalogColor, currentMode, esc, featUse, formulaAxes, getFilteredCatalog, getRating, getTrackTags, globalAudio, markFieldStale, matrixCommitIdx, neuralNodeData, noteToCamelot, pct, refreshNeuralAxisSelects, setAnchorTrack, showToast, trackArtistTitle, trackTags, viewedCatalogs, wheelNotation } from './field.js';
import { apiJson } from './analyse.js';

// Owned by modules not written yet; they register on window when they land.


// pilot 5692
const COLS = [
  { key:'#',        label:'#',          weight:0.4, fixedW: 46, required:true,  sort:null,                        catalogOnly:false },
  { key:'cover',    label:'',  pickLabel:'Cover art', weight:0.4, fixedW: 38, required:false, sort:null,             catalogOnly:false },
  // Preview column retired 2026-08-28 (Mark): the play trigger lives ON the cover now,
  // and the card-expose switch moved to the track number.
  { key:'artist',   label:'Artist',     weight:1.4,             required:false, sort:r=>trackArtistTitle(r).artist, catalogOnly:false },
  { key:'title',    label:'Title',      weight:2.2,             required:false, sort:r=>trackArtistTitle(r).title,  catalogOnly:false },
  // Exactly wide enough for the five stars, never resizable (Mark, 2026-08-28).
  { key:'rating',   label:'★',          weight:1.2, fixedW: 74, noResize:true, required:false, sort:r=>getRating(r.id),          catalogOnly:false },
  { key:'tags',     label:'Tags',       weight:1.2,             required:false, sort:r=>[...getTrackTags(r.id)].length, catalogOnly:false },
  { key:'bpm',      label:'BPM',        weight:0.5, fixedW: 46, required:false, sort:r=>r.data?.rhythm?.bpm,      catalogOnly:false },
  { key:'key',      label:'Key',        weight:1.5, fixedW: 56, required:false, sort:r=>r.data?.harmony?.key,     catalogOnly:false },
  // Mood renders as a colour DOT (Mark, 2026-08-28) — the head shows a dot too; the
  // column picker still says "Mood" via label.
  { key:'mood',     label:'Mood',       weight:0.6, fixedW: 52, required:false, sort:r=>r.data?.scores?.mood,     catalogOnly:false },
  { key:'genre',    label:'Genre',      weight:1.0,             required:false, sort:r=>(r.genre||'').toLowerCase(), catalogOnly:false },
  { key:'dance',    label:'Dance',      weight:1.8, fixedW: 92, required:false, sort:r=>r.data?.scores?.danceability, catalogOnly:false },
  { key:'energy',   label:'Loudness',   weight:1.8, fixedW: 92, required:false, sort:r=>r.data?.energy?.level,    catalogOnly:false },
  { key:'loudness', label:'LUFS',   weight:1.1, fixedW: 84, required:false, sort:r=>r.data?.energy?.loudness_lufs ?? -99, catalogOnly:false },
  { key:'vocals',   label:'Vocals',     weight:1.5, fixedW: 84, required:false, sort:r=>r.data?.content?.voice_presence, catalogOnly:false },
  { key:'duration', label:'Length', headTitle:'Duration', weight:1.0, fixedW: 64, required:false, sort:r=>r.data?.metadata?.duration_sec, catalogOnly:false },
  { key:'codec',    label:'Format',     weight:0.9, fixedW: 62, required:false, sort:r=>r.data?.metadata?.codec,  catalogOnly:false },
  { key:'bitrate',  label:'Bitrate',    weight:1.0, fixedW: 76, required:false, sort:r=>r.data?.metadata?.bitrate_kbps, catalogOnly:false },
  // Sort stays on the REAL score (Mark, 2026-08-28: dots display, values order): reds
  // first in exact score order, no-pulse blues grouped between red and yellow (they are
  // suspect but have no score of their own), then yellows and greens by score.
  { key:'check',    label:'Check',      weight:1.0, fixedW: 52, required:false, sort:r=>{ const rh=r.data?.rhythm||{}; return !rh.bpm ? -0.49 : -checkScore(r); }, catalogOnly:true  },
  { key:'date',     label:'Analysed',   weight:1.2, fixedW:118, required:false, sort:r=>r.analyzedAt,             catalogOnly:true  },
  { key:'del',      label:'Move',       weight:0.4, fixedW: 96, required:false, sort:null,                        catalogOnly:true  },
];
// pilot 5728
function checkScore(r) {
  const rh = r.data?.rhythm;
  if (!rh || !rh.bpm) return 0;
  if (rh.bpm_user) return 0;                      // already human-confirmed
  if (rh.bpm_source === 'tag' && rh.bpm_detected) {
    // Tag and audio disagree: distance from the nearest "innocent" ratio (1, the
    // octave, the triplet multiples). Sitting ON one of those is still suspicious —
    // it is exactly how detectors fail — but a ratio near 1 means agreement.
    const ratio = rh.bpm / rh.bpm_detected;
    if (ratio > 0.98 && ratio < 1.02) return 0;
    return Math.min(1, 0.5 + Math.min(Math.abs(ratio - 1), 1) * 0.5);
  }
  // No tag to check against — low pulse clarity marks the tracks the tracker was
  // least sure about. Ceiling of 0.45 keeps the no-evidence tier below every
  // real tag disagreement.
  const pc = rh.pulse_clarity;
  return (pc == null) ? 0 : Math.min(0.45, Math.max(0, 0.45 * (1 - pc / 0.25)));
}
// pilot 5748
let session        = [];
// pilot 5750
let analyseView    = 'cards';
// pilot 5751
let catalogView    = 'table';
// pilot 5752
let sortCol        = null, sortDir = 1;
// pilot 5753
let catSortCol     = null, catSortDir = 1;
// pilot 5754
let expandedId     = null;
// pilot 5755
let catExpandedId  = null;
// pilot 5756
let colPickerCtx   = 'session';
// pilot 5869
function saveRating(id, stars) {
  if (stars === 0) delete RATINGS[id];
  else RATINGS[id] = stars;
  localStorage.setItem('track-ratings', JSON.stringify(RATINGS));
  if (typeof annoPush === 'function') annoPush('ratings');
  // Ratings can drive size/colour/axes but live outside the catalog — no signature
  // sees them. Flag stale always; rebuild live only when rating is actually in use.
  if (typeof markFieldStale === 'function') markFieldStale({ live: _fieldUsesRating() });
}
// pilot 5880
const STAR_COLORS = ['','#ff4444','#ff8844','#ffd700','#44dd88','#7c6cff'];
// pilot 5881
function starWidget(id) {
  const r = getRating(id);
  const color = STAR_COLORS[r] || 'var(--border)';
  const labels = ['', 'Poor (1★)', 'OK (2★)', 'Good (3★)', 'Great (4★)', 'Essential (5★)'];
  return `<span class="star-widget" style="white-space:nowrap" title="${r ? labels[r] : 'Not rated — click a star to rate'}">` +
    [1,2,3,4,5].map(n =>
      `<span class="star" data-id="${id}" data-n="${n}" onclick="setRating('${id}',${n},event)" title="Set rating to ${n} ★${n>1?'s':''} (click again to clear)" style="cursor:pointer;color:${n<=r?color:'var(--star-empty, var(--muted))'};opacity:${n<=r?1:.55}">★</span>`
    ).join('') + `</span>`;
}
// pilot 5890
function setRating(id, n, e) {
  e.stopPropagation();
  const cur = getRating(id);
  saveRating(id, cur === n ? 0 : n);
  document.querySelectorAll(`[data-id="${id}"].star`).forEach(s => {
    const sn = parseInt(s.dataset.n);
    const nr = getRating(id);
    const nc = STAR_COLORS[nr] || 'var(--border)';
    s.style.color = sn <= nr ? nc : 'var(--border)';
  });
}
// pilot 5914
function saveTrackTags() {
  const raw = {};
  Object.entries(trackTags).forEach(([k,v]) => { raw[k] = [...v]; });
  localStorage.setItem('track-tags', JSON.stringify(raw));
  if (typeof annoPush === 'function') annoPush('track_tags');
}
// pilot 5995
function addTagToTrack(id, sel) {
  const tid = sel.value; if (!tid) return; sel.value = '';
  if (!trackTags[id]) trackTags[id] = new Set();
  trackTags[id].add(tid);
  saveTrackTags();
  applyFilters();
}
// pilot 6002
function removeTag(id, tid, e) {
  e.stopPropagation();
  if (trackTags[id]) { trackTags[id].delete(tid); saveTrackTags(); }
  applyFilters();
}
// pilot 6135
function defaultColVis() {
  const v = {};
  COLS.forEach(c => { v[c.key] = true; });
  return v;
}
// pilot 6140
let colVis = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem('col-vis')) || {};
    return { ...defaultColVis(), ...stored };
  } catch { return defaultColVis(); }
})();
// pilot 6146
function saveColVis() { localStorage.setItem('col-vis', JSON.stringify(colVis)); }
// pilot 6148
let colWidths = (() => {
  try { return JSON.parse(localStorage.getItem('col-widths')) || {}; }
  catch { return {}; }
})();
// pilot 6152
function saveColWidths() { localStorage.setItem('col-widths', JSON.stringify(colWidths)); }
// pilot 6154
function startColResize(key, e) {
  e.stopPropagation(); e.preventDefault();
  const handle = e.target;
  const cols = document.querySelectorAll(`col[data-col-key="${key}"]`);
  if (!cols.length) return;
  // Use the first matching col element to read current width
  const startX = e.clientX;
  const startW = cols[0].getBoundingClientRect().width;
  document.body.classList.add('col-resizing');
  handle.classList.add('dragging');
  function onMove(ev) {
    const w = Math.max(40, Math.round(startW + (ev.clientX - startX)));
    cols.forEach(col => { col.style.width = w + 'px'; });
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('col-resizing');
    handle.classList.remove('dragging');
    const w = parseInt(cols[0].style.width);
    if (w) { colWidths[key] = w; saveColWidths(); }
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
// pilot 6182
let colOrder = (() => { try { const v = JSON.parse(localStorage.getItem('col-order') || 'null');
  return Array.isArray(v) ? v : null; } catch (_) { return null; } })();
// pilot 6184
function orderedCols() {
  if (!colOrder) return COLS;
  const idx = new Map(colOrder.map((k, i) => [k, i]));
  return [...COLS].sort((a, b) => (idx.has(a.key) ? idx.get(a.key) : 99) - (idx.has(b.key) ? idx.get(b.key) : 99));
}
// pilot 6189
let _colDragKey = null;
// pilot 6190
function colDragStart(ev, key) {
  // The resize grip owns its own mousedown — a drag from it must not become a reorder.
  if (ev.target.closest('.col-resize')) { ev.preventDefault(); return; }
  _colDragKey = key; ev.dataTransfer.effectAllowed = 'move';
  try { ev.dataTransfer.setData('text/plain', key); } catch (_) {}
}
// pilot 6196
function colDragOver(ev) { if (_colDragKey) ev.preventDefault(); }
// pilot 6197
function colDrop(ev, key) {
  if (!_colDragKey || _colDragKey === key) { _colDragKey = null; return; }
  ev.preventDefault();
  const order = orderedCols().map(c => c.key);
  const from = order.indexOf(_colDragKey), to = order.indexOf(key);
  if (from < 0 || to < 0) { _colDragKey = null; return; }
  order.splice(to, 0, ...order.splice(from, 1));
  colOrder = order;
  try { localStorage.setItem('col-order', JSON.stringify(order)); } catch (_) {}
  _colDragKey = null;
  applyFilters();
}
// pilot 6209
function visibleCols(ctx) {
  return orderedCols().filter(c => {
    if (ctx === 'session' && c.catalogOnly) return false;
    if (!colVis[c.key]) return false;
    return true;
  });
}
// pilot 8274
function openColPicker(btnId, ctx) {
  colPickerCtx = ctx;
  const popup = document.getElementById('col-picker');
  // Build checklist
  const cols = COLS.filter(c => ctx==='session' ? !c.catalogOnly : true);
  document.getElementById('cp-list').innerHTML = cols.map(c => `
    <label class="cp-item ${c.required?'required':''}">
      <input type="checkbox" ${colVis[c.key]?'checked':''} ${c.required?'disabled':''}
        onchange="toggleCol('${c.key}',this.checked)">
      <label>${c.pickLabel || c.label}</label>
    </label>`).join('');

  // Position near button
  const btn  = document.getElementById(btnId);
  const rect = btn.getBoundingClientRect();
  popup.style.display = 'block';
  const pw = popup.offsetWidth;
  let left = rect.left;
  if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
  popup.style.left = left + 'px';
  popup.style.top  = (rect.bottom + 6) + 'px';
}
// pilot 8297
function closeColPicker() {
  document.getElementById('col-picker').style.display = 'none';
}
// pilot 8405
function toggleCol(key, checked) {
  const col = COLS.find(c => c.key === key);
  if (col?.required) return;
  colVis[key] = checked;
  saveColVis();
  colPickerCtx === 'session' ? renderAnalyse() : renderCatalog();
}
// pilot 8413
function colPickerAll(show) {
  COLS.forEach(c => { if (!c.required) colVis[c.key] = show; });
  saveColVis();
  // Sync checkboxes
  document.querySelectorAll('#cp-list input[type=checkbox]').forEach(cb => {
    if (!cb.disabled) cb.checked = show;
  });
  colPickerCtx === 'session' ? renderAnalyse() : renderCatalog();
}
// pilot 8423
function colPickerReset() {
  colVis = defaultColVis(); saveColVis();
  colWidths = {}; saveColWidths();
  document.querySelectorAll('#cp-list input[type=checkbox]').forEach(cb => { cb.checked = true; });
  colPickerCtx === 'session' ? renderAnalyse() : renderCatalog();
}
// pilot 8852
function setCatalogView(v) {
  catalogView = v; catExpandedId = null;
  document.getElementById('c-btn-cards').classList.toggle('active', v==='cards');
  document.getElementById('c-btn-table').classList.toggle('active', v==='table');
  renderCatalog();
}
// pilot 8865
function renderAnalyse() {
  if (!document.getElementById('analyse-count')) return;   // the pilot's session list; Lite's Analyse tab is analyse.js
  const done = session.filter(r=>r.status==='done').length;
  const busy = session.filter(r=>r.status==='analyzing').length;
  document.getElementById('analyse-count').textContent =
    busy ? `Analysing… (${done}/${session.length})` : `${done} track${done!==1?'s':''} analysed this session`;
  const out = document.getElementById('analyse-content');
  out.innerHTML = analyseView==='table' ? tableHTML(session,'session') : cardsHTML(session,'session');
}
// pilot 8875
function renderCatalog() {
  const filtered = getFilteredCatalog();
  const total    = catalog.length;
  document.getElementById('catalog-count').textContent =
    filtered.length===total ? `${total} track${total!==1?'s':''} in this Field`
    : `${filtered.length} of ${total} tracks`;
  const out = document.getElementById('catalog-content');
  if (catalog.length === 0) {
    out.innerHTML = (typeof viewedCatalogs !== 'undefined' && viewedCatalogs.size === 0)
      ? `<div class="empty-state"><div class="icon">📭</div><p>No Fields selected — pick one in the Fields menu above.</p></div>`
      : `<div class="empty-state"><div class="icon">📭</div><p>No tracks in this Field yet.<br>Analyse some tracks and they'll appear here.</p></div>`;
    return;
  }
  if (filtered.length === 0) {
    out.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No tracks match current filters.</p></div>`;
    return;
  }
  const rows = filtered.map(e => ({ id:e.id, filename:e.filename, status:'done', data:e.data, analyzedAt:e.analyzed_at, scanDuration:e.scan_duration, has_file:e.has_file, isCatalog:true }));
  out.innerHTML = catalogView==='table' ? tableHTML(rows,'catalog') : cardsHTML(rows,'catalog');
}
// pilot 8897
function fmtScanLen(v) {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return '?';
  if (n >= 9999) return 'Full';
  if (n <= 1) return Math.round(n * 100) + '%';
  return n + 's';
}
// pilot 8906
function cardsHTML(rows, ctx) {
  if (!rows.length) return '';
  return `<div class="cards-stack">${rows.map((r,i) => `
    <div>
      <div class="track-card-header">
        <span class="track-num">${String(i+1).padStart(2,'0')}</span>
        <span class="track-name">${esc(r.filename)}</span>
        ${r.analyzedAt ? `<span class="track-date">${fmtDate(r.analyzedAt)}</span>` : ''}
        ${r.scanDuration ? `<span class="scan-badge">${fmtScanLen(r.scanDuration)} scan</span>` : ''}
        ${r.status==='analyzing' ? '<span style="color:var(--muted)"><span class="row-spinner"></span> analysing…</span>' : ''}
        ${r.status==='error' ? `<span style="color:#ff6666">⚠ ${esc(r.error)}</span>` : ''}
        ${ctx==='catalog' && r.has_file ? `<button class="rescan-btn" onclick="rescanEntry('${r.id}',event)" title="Rescan">↻</button>` : ''}
        ${ctx==='catalog' ? `<button class="delete-btn" onclick="deleteCatalogEntry('${r.id}',event)">×</button>` : ''}
      </div>
      ${r.status==='done' ? buildCard(r.data, r.id) : ''}
    </div>`).join('')}</div>`;
}
// pilot 8925
function tableHTML(rows, ctx) {
  const sc    = ctx==='catalog' ? catSortCol : sortCol;
  const sd    = ctx==='catalog' ? catSortDir : sortDir;
  const expId = ctx==='catalog' ? catExpandedId : expandedId;
  const vcols = visibleCols(ctx);

  // Width resolution per column, in priority order:
  //   1. User-dragged width (persisted in localStorage('col-widths'))   → exact px
  //   2. COL.fixedW         (known-extent values like BPM, key, etc.)   → exact px
  //   3. Flex share         (filename, artist, title, genre, tags)      → calc((100% - fixedSum)*weight/flexTotal)
  // The mix below keeps numeric columns from stretching while title-ish columns absorb
  // whatever space is left, truncating with ellipsis.
  let fixedSum = 0;
  let flexTotal = 0;
  for (const c of vcols) {
    const w = c.noResize ? 0 : colWidths[c.key];   // locked columns ignore dragged widths
    if (w)            fixedSum += w;
    else if (c.fixedW) fixedSum += c.fixedW;
    else              flexTotal += c.weight;
  }
  // Flex columns get a share of (container - sum-of-fixed-px) weighted by c.weight —
  // computed as EXPLICIT px with a 120px HARD FLOOR. Two reasons: (a) when every column
  // is visible the fixed columns alone can exceed the container (≈1.5k px), which used
  // to collapse Artist/Title/Genre to ~3px invisible slivers (the floor makes the table
  // overflow into its horizontal scroll instead); (b) CSS max()/calc() col widths
  // compute to 0 in fixed table layout in Chromium, so the px must be resolved here.
  // Responsive because the window-resize listener re-renders the table, recomputing these.
  const host = document.getElementById(ctx === 'catalog' ? 'catalog-content' : 'analyse-content');
  const availW = (host && host.clientWidth) ? host.clientWidth : 1200;
  const flexAvail = Math.max(0, availW - fixedSum - 4);
  const colgroup = `<colgroup>${vcols.map(c => {
    const w = c.noResize ? 0 : colWidths[c.key];   // locked columns (rating) ignore dragged widths here too
    let style;
    if (w)            style = `width:${w}px`;
    else if (c.fixedW) style = `width:${c.fixedW}px`;
    else if (flexTotal > 0) {
      const pct = (c.weight / flexTotal);
      style = `width:${Math.max(120, Math.round(flexAvail * pct))}px`;
    } else {
      style = 'width:auto';
    }
    return `<col data-col-key="${c.key}" style="${style}">`;
  }).join('')}</colgroup>`;

  // Sort
  let sorted = [...rows];
  if (sc) {
    const col = COLS.find(c=>c.key===sc);
    if (col?.sort) sorted = sorted.sort((a,b) => {
      const va=col.sort(a)??-Infinity, vb=col.sort(b)??-Infinity;
      return va<vb?-sd:va>vb?sd:0;
    });
  }

  const handle = k => { const cdef = COLS.find(c=>c.key===k);
    return cdef && cdef.noResize ? '' : `<span class="col-resize" onmousedown="startColResize('${k}',event)" onclick="event.stopPropagation()"></span>`; };
  // Headers are drag-to-reorder (2026-08-28); a plain click still sorts, and the resize
  // grip refuses to start a drag. `head` is the compact header glyph (Mood's dot);
  // `label` stays the human name for the column picker.
  const drag = c => ` draggable="true" ondragstart="colDragStart(event,'${c.key}')" ondragover="colDragOver(event)" ondrop="colDrop(event,'${c.key}')"${c.headTitle?` title="${c.headTitle}"`:''}`;
  const thead = `<tr>${vcols.map(c => {
    const cap = c.head ?? c.label;
    if (!c.sort) return `<th class="no-sort"${drag(c)}>${cap}${handle(c.key)}</th>`;
    const active = sc===c.key;
    return `<th class="${active?'sorted':''}"${drag(c)} onclick="tblSort('${ctx}','${c.key}')">${cap}${active?(sd===1?' ↑':' ↓'):''}${handle(c.key)}</th>`;
  }).join('')}</tr>`;

  const tbody = sorted.map((r,i) => {
    const isExp = r.id === expId;
    const d     = r.data;
    let cells   = '';

    if (r.status !== 'done') {
      const msg = r.status==='analyzing'
        ? `<span class="row-spinner"></span> analysing…`
        : r.status==='error' ? `<span style="color:#ff6666">⚠ ${esc(r.error)}</span>`
        : '<span style="color:var(--muted)">queued…</span>';
      // Fill first two cols + span rest
      const firstTwo = vcols.slice(0,2).map((c,ci) => ci===0
        ? `<td style="color:var(--muted);font-size:11px">${i+1}</td>`
        : `<td class="col-file">${esc(r.filename)}</td>`).join('');
      cells = firstTwo + `<td colspan="${vcols.length-2}">${msg}</td>`;
    } else if (!d || !d.scores || !d.rhythm) {
      // Defensive: an entry whose analysis failed (or was hand-edited) has no scores /
      // rhythm keys. Render it as an error row — dereferencing it would throw inside
      // this .map and blank the ENTIRE table over one broken entry.
      const firstTwo = vcols.slice(0,2).map((c,ci) => ci===0
        ? `<td style="color:var(--muted);font-size:11px">${i+1}</td>`
        : `<td class="col-file">${esc(r.filename)}</td>`).join('');
      cells = firstTwo + `<td colspan="${vcols.length-2}"><span style="color:#ff6666">⚠ ${esc(d?.error || 'analysis data missing — rescan this track')}</span></td>`;
    } else {
      const mc = MOOD_COLOR[d.scores.mood]||'var(--accent)';
      cells = vcols.map(c => cellHTML(c, r, d, mc, i, ctx)).join('');
    }

    const rowEl = `<tr onclick="tableRowClick('${ctx}','${r.id}',event)" ondblclick="tableRowDblClick('${ctx}','${r.id}',event)"${ctx==='catalog' ? ` oncontextmenu="rowCtxMenu(event,'${r.id}')"` : ''} class="${isExp?'expanded':''}">${cells}</tr>`;
    const detEl = isExp && r.status==='done'
      ? `<tr class="detail-row"><td colspan="${vcols.length}"><div class="detail-inner">${buildCard(d, r.id)}</div></td></tr>`
      : '';
    return rowEl + detEl;
  }).join('');

  return `<div class="table-wrap"><table>${colgroup}<thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}
// pilot 9030
function cellHTML(c, r, d, mc, i, ctx) {
  switch(c.key) {
    case '#':        return `<td class="num-cell" style="color:var(--muted);font-size:11px;cursor:pointer" onclick="event.stopPropagation();tblExpand('${ctx}','${r.id}')" title="Click to expand the full track card">${i+1}</td>`;
    case 'cover': {
      // The cover IS the preview trigger (Mark, 2026-08-28): click to play/pause, a play
      // glyph on hover (kept lit + swapped to pause by the audio code via #play-<id>),
      // and the seek/progress bar rides the cover's bottom edge. Card expose moved to
      // the track number. No file → the cover falls back to the expose action.
      const pid = r.data?.catalog_id || r.id;
      const canPlay = pid && r.has_file !== false && (r.status === 'done' || r.has_file);
      const art = r.has_cover === false
        ? `<div class="cover-cell cover-empty">♪</div>`
        : `<img class="cover-cell" loading="lazy" src="/catalog/${pid}/cover" onerror="coverFailed(this,'${ctx}','${r.id}')">`;
      if (!canPlay) return `<td><div class="cover-play" onclick="event.stopPropagation();tblExpand('${ctx}','${r.id}')" title="Click to expand the full track card">${art}</div></td>`;
      return `<td><div class="cover-play" onclick="audioToggle('${pid}',event)" title="${esc(r.filename)} — click to preview">${art}<span class="cp-glyph" id="play-${pid}">▶</span><span class="tbl-progress" id="prog-${pid}" onclick="audioSeek('${pid}',event)" title="Click to seek"><span class="tbl-progress-fill" id="progf-${pid}"></span></span></div></td>`;
    }
    case 'check': {
      // Traffic light (Mark, 2026-08-28): blue = no pulse to read, red = low confidence,
      // yellow = medium, green = high. The REAL score is kept — it drives the sort and
      // shows in the tooltip — only the display reduces to the dot.
      const rh = r.data?.rhythm || {};
      const dot = (c, t) => `<td style="text-align:center" title="${esc(t)}"><span class="chk-dot" style="background:${c}"></span></td>`;
      if (!rh.bpm) return dot('var(--bh-blue)', 'No pulse — the analysis found no usable tempo to check');
      const sc = checkScore(r);
      const why = rh.bpm_user ? 'BPM confirmed by you — nothing to check'
        : (rh.bpm_source === 'tag' && rh.bpm_detected)
        ? `Tag says ${Math.round(rh.bpm)} BPM, audio analysis heard ${Math.round(rh.bpm_detected)} — one of them is wrong; a listen settles it`
        : `Pulse clarity ${(rh.pulse_clarity ?? 0).toFixed(2)} — how firmly the tempo tracker locked on`;
      const tip = `${why} · check score ${(sc*100)|0}`;
      if (sc >= 0.5)  return dot('var(--bh-red)',    'LOW tempo confidence — ' + tip);
      if (sc >= 0.25) return dot('var(--bh-yellow)', 'MEDIUM tempo confidence — ' + tip);
      return dot('var(--bh-green)', 'HIGH tempo confidence — ' + tip);
    }
    case 'artist': return `<td style="color:var(--muted);font-size:12px">${esc(trackArtistTitle(r).artist)}</td>`;
    case 'title': {
      // Analysis warnings (e.g. "decoded far less audio than the tags claim") were
      // computed server-side and then never shown anywhere — a corrupt-but-analysable
      // file looked identical to a clean one (M2 report P5's real gap).
      const warns = d?.warnings?.length
        ? `<span title="${esc(d.warnings.join('\n'))}" style="color:#e6b34a;margin-left:5px;cursor:help">⚠</span>` : '';
      // The multi-Field badge lived in the retired Preview column — it rides Title now.
      const badge = (viewedCatalogs.size > 1 && r._cat)
        ? `<span class="cat-badge" style="background:${catalogColor(r._cat)};margin-left:5px">${esc(allCatalogs.find(c=>c.slug===r._cat)?.name||r._cat)}</span>`
        : '';
      return `<td>${esc(trackArtistTitle(r).title)}${warns}${badge}</td>`;
    }
    case 'rating': return `<td>${starWidget(r.id)}</td>`;
    case 'tags': {
      const tids = getTrackTags(r.id);
      const chips = [...tids].map(tid => {
        const t = allTags.find(x => x.id === tid);
        if (!t) return '';
        return `<span class="tag-chip" style="background:${t.color}22;border:1px solid ${t.color};color:${t.color}" onclick="removeTag('${r.id}','${tid}',event)">${esc(t.name)} ×</span>`;
      }).join('');
      const tagSel = allTags.length
        ? `<select class="move-sel" onchange="addTagToTrack('${r.id}',this)" onclick="event.stopPropagation()" title="Add tag"><option value="">＋</option>${allTags.filter(t=>[...tids].indexOf(t.id)===-1).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>`
        : '';
      return `<td style="white-space:nowrap">${chips}${tagSel}</td>`;
    }
    case 'bpm':      return `<td class="col-bpm" style="color:${mc}">${Math.round(d.rhythm.bpm)}</td>`;
    case 'key':      return `<td>${keyPill(d.harmony)}</td>`;
    case 'mood':     return `<td style="text-align:center"><span class="mood-dot" style="background:${mc}" title="${esc(d.scores.mood)}"></span></td>`;
    case 'genre': {
      const g = r.genre || '';
      return `<td><input class="genre-input" value="${esc(g)}" placeholder="—" data-id="${r.id}" onclick="event.stopPropagation()" onblur="saveGenre('${r.id}',this.value)" onkeydown="if(event.key==='Enter')this.blur()"></td>`;
    }
    case 'dance':    return `<td>${tblBar(d.scores.danceability, mc)}</td>`;
    case 'energy':   return `<td>${tblBar(d.energy.level, '#ff8844')}</td>`;
    case 'loudness': {
      const lf = d.energy?.loudness_lufs;
      if (lf == null) return `<td style="color:var(--muted);font-size:11px">—</td>`;
      // Map -30 LUFS (very quiet) → 0, -6 LUFS (loud) → 1
      const norm = Math.max(0, Math.min(1, (lf + 30) / 24));
      const col = norm > 0.7 ? '#ff4444' : norm > 0.45 ? '#ffaa22' : '#44dd88';
      return `<td><span style="color:${col};font-weight:600">${lf.toFixed(1)}</span><span style="color:var(--muted);font-size:10px;margin-left:3px">LUFS</span></td>`;
    }
    case 'vocals':   return `<td><span class="tbl-dot" style="background:${d.content.has_vocals?'#44dd88':'var(--border)'}"></span><span style="font-size:11px;color:var(--muted);margin-left:5px">${pct(d.content.voice_presence)}%</span></td>`;
    case 'duration': return `<td style="color:var(--muted)">${formatDur(d.metadata.duration_sec)}</td>`;
    case 'codec':    return `<td style="color:var(--muted)">${esc((d.metadata.codec||'').toUpperCase())}</td>`;
    case 'bitrate':  return `<td style="color:var(--muted)">${d.metadata.bitrate_kbps} kbps</td>`;
    case 'date': {
      // "Analysed" now shows scan-coverage (how much of the track was analysed) vs total
      // duration — "2:00 / 4:35" or "Full / 4:35". Date-of-scan moved to the cell tooltip.
      const totalSec = d.metadata?.duration_sec || 0;
      const scanSec  = r.scanDuration || 0;
      const total    = totalSec ? formatDur(totalSec) : '—';
      // scan_duration is EITHER a fraction of the track in (0,1] (since 2026-08-26) or a
      // legacy number of seconds. Treating a fraction as seconds rendered a 100% scan as
      // "0:01 / 4:35 · 0%" (review, 2026-08-27).
      const scanIsFrac = scanSec > 0 && scanSec <= 1;
      const scanAbs    = scanIsFrac ? scanSec * totalSec : scanSec;
      const scanned  = !scanSec ? '—'
                     : scanSec >= 9999 ? 'Full'
                     : (scanIsFrac && scanSec >= 0.999) ? 'Full'
                     : (!scanIsFrac && scanSec >= totalSec && totalSec > 0) ? 'Full'
                     : totalSec ? formatDur(scanAbs) : (scanIsFrac ? Math.round(scanSec*100) + '%' : formatDur(scanSec));
      const pct = (totalSec > 0 && scanAbs > 0 && scanSec < 9999)
                ? ` · ${Math.min(100, Math.round((scanAbs / totalSec) * 100))}%` : '';
      const when = r.analyzedAt ? ` · scanned ${fmtDate(r.analyzedAt)}` : '';
      return `<td style="color:var(--muted);font-size:11px" title="${esc(scanned + ' of ' + total + pct + when)}">${esc(scanned)} <span style="opacity:.55">/ ${esc(total)}</span></td>`;
    }
    case 'del': {
      const rCat = r._cat || activeCatalog;
      const others = allCatalogs.filter(c => c.slug !== rCat);
      const moveSel = others.length
        ? `<select class="move-sel" onchange="moveEntry('${r.id}','${rCat}',this)" onclick="event.stopPropagation()" title="Move to another Field"><option value="">⇄</option>${others.map(c=>`<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}</select>`
        : '';
      return `<td style="white-space:nowrap">
        ${moveSel}
        <button class="rescan-btn" id="rscan-${r.id}" onclick="rescanEntry('${r.id}',event)" title="${r.has_file?'Rescan':'No file'}" ${r.has_file?'':'disabled'}>↻</button>
        <button class="delete-btn" onclick="deleteCatalogEntry('${r.id}',event)" title="Remove">×</button>
      </td>`;
    }
    default:         return '<td></td>';
  }
}
// pilot 9147
function tblSort(ctx, col) {
  if (ctx==='catalog') { catSortDir=catSortCol===col?-catSortDir:1; catSortCol=col; renderCatalog(); }
  else                 { sortDir=sortCol===col?-sortDir:1; sortCol=col; renderAnalyse(); }
}
// pilot 9154
function coverFailed(img, ctx, id) {
  img.outerHTML = `<div class="cover-cell cover-empty" onclick="event.stopPropagation();tblExpand('${ctx}','${id}')" title="Click cover to expand the full track card" style="cursor:pointer">♪</div>`;
}
// pilot 9158
function tblExpand(ctx, id) {
  if (ctx==='catalog') { catExpandedId=catExpandedId===id?null:id; renderCatalog(); }
  else                 { expandedId=expandedId===id?null:id; renderAnalyse(); }
}
// pilot 9169
async function setBpmMul(id, mul) {
  const ent = catalog.find(t => t.id === id);
  const cur = ent?.data?.rhythm?.bpm;
  if (!cur) return;
  const next = Math.round(cur * mul * 10) / 10;
  if (next < 20 || next > 400) { showToast(`${next} BPM is outside anything musical — not applied.`); return; }
  const r = await apiJson(`/catalog/${id}/bpm`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bpm: next }) });
  if (r.fail) { showToast('Could not save that correction — ' + r.message); return; }
  if (typeof featUse === 'function') featUse('bpm_correct');
  if (ent) { ent.data.rhythm.bpm = next; ent.data.rhythm.bpm_user = true; }
  markFieldStale({ vec: true });              // the tempo axis just moved
  renderCatalog(); applyFilters();
  showToast(`Tempo set to ${next} BPM.`, { subtle: true });
}
// pilot 9185
async function clearBpm(id) {
  const r = await apiJson(`/catalog/${id}/bpm`, { method: 'DELETE' });
  if (r.fail) { showToast('Could not undo that — ' + r.message); return; }
  if (typeof featUse === 'function') featUse('bpm_clear');
  const ent = catalog.find(t => t.id === id);
  if (ent && r.data && r.data.bpm) { ent.data.rhythm.bpm = r.data.bpm; delete ent.data.rhythm.bpm_user; }
  markFieldStale({ vec: true });
  renderCatalog(); applyFilters();
  showToast('Back to the analysed tempo.', { subtle: true });
}
// pilot 9202
const KEY_CHROMA = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
// pilot 9203
async function setKeyStep(id, kind) {
  const ent = catalog.find(t => t.id === id);
  const h = ent?.data?.harmony;
  const i = h ? KEY_CHROMA.indexOf(h.root) : -1;
  if (i < 0) { showToast('No detected key to correct — set one after a rescan.'); return; }
  let root = h.root, mode = h.mode === 'minor' ? 'minor' : 'major';
  if (kind === 'down')  root = KEY_CHROMA[(i + 11) % 12];
  if (kind === 'up')    root = KEY_CHROMA[(i + 1) % 12];
  if (kind === 'mode')  mode = mode === 'minor' ? 'major' : 'minor';
  if (kind === 'rel') { // relative key: Am <-> C
    root = KEY_CHROMA[(i + (mode === 'minor' ? 3 : 9)) % 12];
    mode = mode === 'minor' ? 'major' : 'minor';
  }
  const r = await apiJson(`/catalog/${id}/key`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root, mode }) });
  if (r.fail) { showToast('Could not save that correction — ' + r.message); return; }
  if (typeof featUse === 'function') featUse('key_correct');
  Object.assign(h, { root, mode, key: `${root} ${mode}`, key_user: true });
  markFieldStale({ vec: true });              // keysin/keycos/mode axes just moved
  renderCatalog(); applyFilters();
  showToast(`Key set to ${root} ${mode}.`, { subtle: true });
}
// pilot 9226
async function clearKey(id) {
  const r = await apiJson(`/catalog/${id}/key`, { method: 'DELETE' });
  if (r.fail) { showToast('Could not undo that — ' + r.message); return; }
  if (typeof featUse === 'function') featUse('key_clear');
  const ent = catalog.find(t => t.id === id);
  if (ent && r.data && r.data.root) {
    Object.assign(ent.data.harmony, { root: r.data.root, mode: r.data.mode, key: r.data.key });
    delete ent.data.harmony.key_user;
  }
  markFieldStale({ vec: true });
  renderCatalog(); applyFilters();
  showToast('Back to the analysed key.', { subtle: true });
}
// pilot 9240
function buildCard(d, entryId) {
  // Defensive: a failed-analysis entry has only {metadata, error} — show the error
  // instead of throwing on the missing sub-objects.
  if (!d || !d.scores || !d.rhythm) {
    return `<div class="summary-bar"><div class="summary-text" style="color:#ff6666">⚠ ${esc(d?.error || 'analysis data missing — rescan this track')}</div></div>`;
  }
  const mc=MOOD_COLOR[d.scores.mood]||'var(--accent)';
  const r=d.rhythm,h=d.harmony,e=d.energy,t=d.timbre,c=d.content,s=d.scores;
  return `
    <div class="summary-bar"><div class="mood-dot" style="background:${mc}"></div><div class="summary-text">${esc(d.summary||'')}</div></div>
    <div class="card-grid">
      <div class="card"><h3>Rhythm</h3>
        <div class="bpm-num" style="color:${mc}">${Math.round(r.bpm)}</div>
        <div class="bpm-unit">BPM${r.bpm_source === 'tag' ? ' <span class="bpm-src" title="Taken from the tag the file was released with, not from the audio">tagged</span>' : ''}${r.bpm_user ? ' <span class="bpm-src bpm-src-user" title="You corrected this. Analysis will not overwrite it.">yours</span>' : ''}</div>
        ${entryId ? `<div class="bpm-fix" title="Tempo detection lands on the wrong multiple sometimes — most often a triplet feel (×2/3, ×3/2), less often the octave (×2, ÷2). Measured on this library: 78% exact, 10% triplet, 4.5% octave.">
          <button onclick="event.stopPropagation();setBpmMul('${entryId}',0.5)">÷2</button>
          <button onclick="event.stopPropagation();setBpmMul('${entryId}',2/3)">×⅔</button>
          <button onclick="event.stopPropagation();setBpmMul('${entryId}',1.5)">×1½</button>
          <button onclick="event.stopPropagation();setBpmMul('${entryId}',2)">×2</button>
          ${r.bpm_user ? `<button class="bpm-reset" onclick="event.stopPropagation();clearBpm('${entryId}')">reset</button>` : ''}
        </div>` : ''}
        <div class="mini-bars">${miniBarRow('Pulse',r.pulse_clarity,mc)}${miniBarRow('Dynamics',e.dynamic_range,mc)}</div>
      </div>
      <div class="card"><h3>Harmony</h3>
        <div class="key-display"><span class="key-root" style="color:${mc}">${esc(h.root)}</span><span class="key-mode ${h.mode}">${h.mode}</span></div>
        <div style="color:var(--muted);font-size:12px">${esc(h.key)}${h.key_user ? ' <span class="bpm-src bpm-src-user" title="You corrected this. Analysis will not overwrite it.">yours</span>' : ''}</div>
        ${entryId && h.root && h.root !== 'unknown' ? `<div class="bpm-fix" title="Key detection's classic confusions are the fifth and the relative major/minor; same-root mode flips are the near-tie case. ‹ › step a semitone, maj↔min flips the mode, rel swaps to the relative key (Am↔C).">
          <button onclick="event.stopPropagation();setKeyStep('${entryId}','down')">‹</button>
          <button onclick="event.stopPropagation();setKeyStep('${entryId}','up')">›</button>
          <button onclick="event.stopPropagation();setKeyStep('${entryId}','mode')">maj↔min</button>
          <button onclick="event.stopPropagation();setKeyStep('${entryId}','rel')">rel</button>
          ${h.key_user ? `<button class="bpm-reset" onclick="event.stopPropagation();clearKey('${entryId}')">reset</button>` : ''}
        </div>` : ''}
      </div>
      <div class="card"><h3>Mood</h3>
        <div class="mood-name" style="color:${mc}">${esc(s.mood)}</div>
        <div class="vibe-tags">${(d.vibe_tags||[]).map(v=>`<span class="vibe-tag">${esc(v)}</span>`).join('')}</div>
      </div>
      <div class="card"><h3>Scores</h3>
        <div class="gauges">${gaugeWrap(s.danceability,mc,'Dance')}${gaugeWrap(e.level,'#ff8844','Loudness')}</div>
      </div>
      <div class="card"><h3>Timbre</h3>
        <div class="timbre-bars">${timRow('Brightness',t.brightness,'#ffdd44')}${timRow('Roughness',t.roughness,'#ff4488')}${timRow('Percussive',t.percussive_ratio,'#aa88ff')}</div>
      </div>
      <div class="card"><h3>Content</h3>
        <div class="content-rows">
          <div class="content-row"><div class="dot ${c.has_vocals?'on':'off'}"></div><span class="content-label">Vocals</span><span class="content-val">${pct(c.voice_presence)}%</span></div>
          <div class="content-row"><div class="dot ${c.likely_instrumental?'on':'off'}"></div><span class="content-label">Likely instrumental</span></div>
          <div class="content-row"><div class="dot on" style="background:#aa88ff"></div><span class="content-label">Percussive</span><span class="content-val">${esc(c.percussive_content)}</span></div>
          <div class="content-row"><div class="dot on" style="background:#4488ff"></div><span class="content-label">Bass</span><span class="content-val">${esc(c.bass_presence)}</span></div>
          <div style="margin-top:6px">${miniBarRow('Dynamic range',e.dynamic_range,'var(--muted)')}</div>
        </div>
      </div>
    </div>
    <div class="meta-strip">
      <div class="meta-item"><span class="meta-key">Duration</span><span class="meta-val">${formatDur(d.metadata.duration_sec)}</span></div>
      <div class="meta-item"><span class="meta-key">Format</span><span class="meta-val">${esc((d.metadata.codec||'').toUpperCase())}</span></div>
      <div class="meta-item"><span class="meta-key">Bitrate</span><span class="meta-val">${d.metadata.bitrate_kbps} kbps</span></div>
      <div class="meta-item"><span class="meta-key">Sample rate</span><span class="meta-val">${(d.metadata.sample_rate_hz/1000).toFixed(1)} kHz</span></div>
      <div class="meta-item"><span class="meta-key">Channels</span><span class="meta-val">${d.metadata.channels===2?'Stereo':d.metadata.channels===1?'Mono':d.metadata.channels}</span></div>
    </div>`;
}
// pilot 9304
function svgGauge(value, color, size=76) {
  const r=(size-10)/2, cx=size/2, cy=size/2, circ=2*Math.PI*r, arcLen=circ*0.75;
  const sa=135*Math.PI/180, ea=45*Math.PI/180;
  const path=`M${cx+r*Math.cos(sa)},${cy+r*Math.sin(sa)} A${r},${r} 0 1,1 ${cx+r*Math.cos(ea)},${cy+r*Math.sin(ea)}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <path d="${path}" fill="none" stroke="#2a2a3d" stroke-width="6" stroke-linecap="round"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${arcLen}" stroke-dashoffset="${arcLen-arcLen*value}"/>
  </svg>`;
}
// pilot 9314
function gaugeWrap(v,color,label) { return `<div class="gauge-wrap">${svgGauge(v,color)}<span class="gauge-value">${pct(v)}%</span><span class="gauge-label">${label}</span></div>`; }
// pilot 9315
function timRow(label,value,color) { return `<div class="timbre-row"><span class="timbre-label">${label}</span><div class="timbre-track"><div class="timbre-fill" style="width:${pct(value)}%;background:${color}"></div></div><span class="timbre-pct">${pct(value)}%</span></div>`; }
// pilot 9316
function miniBarRow(label,value,color) { return `<div class="mini-bar-row"><span class="mini-bar-label">${label}</span><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${pct(value)}%;background:${color}"></div></div><span class="mini-bar-val">${pct(value)}%</span></div>`; }
// pilot 9317
function tblBar(v,color) { return `<div class="tbl-bar-wrap"><div class="tbl-bar-track"><div class="tbl-bar-fill" style="width:${pct(v)}%;background:${color}"></div></div><span class="tbl-bar-num">${pct(v)}%</span></div>`; }
// pilot 9321
function keyPill(h) {
  const cam = h.root ? noteToCamelot(h.root, h.mode) : null;
  if (cam && (wheelNotation === 'camelot' || wheelNotation === 'openkey')) {
    const txt = wheelNotation === 'openkey' ? camelotToOpenKey(cam) : cam;
    return `<span class="key-pill"><span class="kp-root kp-note ${h.mode}">${esc(txt)}</span></span>`;
  }
  return `<span class="key-pill"><span class="kp-root kp-note ${h.mode}">${esc(h.root)}${h.mode === 'minor' ? 'm' : ''}</span></span>`;
}
// pilot 9350
function formatDur(s) { if(!s)return'—'; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); return h>0?`${h}h ${m}m`:`${m}:${String(sec).padStart(2,'0')}`; }
// pilot 9351
function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d=new Date(iso), diff=Date.now()-d;
    if (diff<60000)    return 'just now';
    if (diff<3600000)  return `${Math.floor(diff/60000)}m ago`;
    if (diff<86400000) return `${Math.floor(diff/3600000)}h ago`;
    return d.toLocaleDateString(undefined,{day:'numeric',month:'short'});
  } catch { return iso; }
}
// pilot 9363
let rescanningIds = new Set();
// pilot 9365
async function rescanEntry(id, e) {
  e.stopPropagation();
  if (rescanningIds.has(id)) return;

  const duration = document.getElementById('rescan-duration')?.value || '0.5';   // Lite: no scan-length menu; the pilot's default
  rescanningIds.add(id);

  // Spin the button
  const btn = document.getElementById(`rscan-${id}`);
  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }

  try {
    const entry = catalog.find(c => c.id === id);
    const cat   = entry?._cat || activeCatalog;
    const form  = new FormData();
    form.append('duration', duration);
    const res  = await fetch(`/catalog/${id}/rescan?cat=${cat}`, { method:'POST', body:form });
    const data = await res.json();

    if (data.error) {
      showToast(`Rescan failed: ${data.error}`);
    } else {
      // Update catalog entry in memory
      const entry = catalog.find(c => c.id === id);
      if (entry) {
        entry.data          = data;
        entry.analyzed_at   = new Date().toISOString().slice(0,19);
        entry.scan_duration = parseFloat(duration);
      }
      // Collapse expanded row if open so it refreshes
      if (catExpandedId === id) catExpandedId = null;
      renderCatalog();
    }
  } catch(err) {
    showToast(`Rescan error: ${err.message}`);
  } finally {
    rescanningIds.delete(id);
    // Button will be re-rendered by renderCatalog();
  markFieldStale({ vec: true, live: false });   // feature VALUES changed — same ids, so only analyzed_at moves the sig; the vec caches never see it if error, restore manually
    const b2 = document.getElementById(`rscan-${id}`);
    if (b2) { b2.classList.remove('spinning'); b2.disabled = false; }
  }
}
// pilot 9409
async function saveGenre(id, value) {
  const v = (value || '').trim();
  // Update local catalog cache immediately
  const entry = catalog.find(e => e.id === id);
  if (entry) entry.genre = v;
  try {
    await fetch(`/catalog/${id}`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ genre: v })
    });
  } catch (e) { /* fail silently — local cache already updated */ }
  // Refresh matrix axis selects if genre might be a metric option
  if (typeof refreshNeuralAxisSelects === 'function') refreshNeuralAxisSelects();
}
// pilot 11549
function audioToggle(id, e) {
  e.stopPropagation();
  if (audioCurrentId === id) { globalAudio.paused ? globalAudio.play().catch(() => {}) : audioStop({ keepAnchor: true }); return; }
  audioPlayById(id, { keepAnchor: true });
  const btn = document.getElementById(`play-${id}`);
  if (btn) { btn.textContent = '⏸'; btn.classList.add('playing'); }
}
// pilot 13287
function _fieldUsesRating() {
  for (const id of ['nx-axis','ny-axis','nz-axis','n-color','n-size']) {
    if (document.getElementById(id)?.value === 'rating') return true;
  }
  try { if (typeof formulaAxes !== 'undefined' && JSON.stringify(formulaAxes || {}).includes('rat')) return true; } catch (_) {}
  return false;
}
// pilot 21495
let tableClickTimer = null;
// pilot 21496
const TABLE_DBLCLICK_MS = 250;
// pilot 21497
function tableRowClick(ctx, id, e) {
  // ignore clicks coming from interactive children (buttons, ratings, edits, selects, cover)
  if (e.target.closest('button, .star-widget, input, select, .tag-bar, [contenteditable=true], .cover-cell')) return;
  if (e.shiftKey) { tableRowCommit(ctx, id); return; }
  clearTimeout(tableClickTimer);
  // Row body click → preview only (artwork cell handles the expand)
  tableClickTimer = setTimeout(() => {
    if (audioCurrentId !== id) audioPlayById(id, { keepAnchor: true });
  }, TABLE_DBLCLICK_MS);
}
// pilot 21507
function tableRowDblClick(ctx, id, e) {
  clearTimeout(tableClickTimer);
  tableRowCommit(ctx, id);
}
// pilot 21599
async function tableRowCommit(ctx, id) {
  // If matrix has node data, route through matrixCommitIdx so visuals + edges update consistently
  if (typeof neuralNodeData !== 'undefined' && neuralNodeData.length) {
    const idx = neuralNodeData.findIndex(nd => nd.catalogId === id);
    if (idx >= 0) return matrixCommitIdx(idx);
  }
  // Matrix not built yet: commit without fly
  const prevAnchorId = activePlaylist?.anchor_track_id || null;
  audioPlayById(id, { keepAnchor: true });
  if (activePlaylistSlug) await setAnchorTrack(id);
  if (currentMode === 'learn') {
    let atIndex;
    if (prevAnchorId && activePlaylist?.tracks) {
      const pos = activePlaylist.tracks.findIndex(t => t.track_id === prevAnchorId);
      if (pos >= 0) atIndex = pos + 1;
    }
    const ok = await addTrackToActivePlaylist(id, 'learn', atIndex);
    if (ok) showToast('Added to playlist', { subtle: true });
  } else if (currentMode === 'explore') {
    fetch('/explore-log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_id: id, mode: 'explore', played_sec: 0 }) });
  }
}

function listForgetExpanded(id) { if (catExpandedId === id) catExpandedId = null; }

Object.assign(window, { listRenderCatalog: renderCatalog, listForgetExpanded, checkScore, saveRating, starWidget, setRating, saveTrackTags, addTagToTrack, removeTag, defaultColVis, saveColVis, saveColWidths, startColResize, orderedCols, colDragStart, colDragOver, colDrop, visibleCols, openColPicker, closeColPicker, toggleCol, colPickerAll, colPickerReset, setCatalogView, renderAnalyse, fmtScanLen, cardsHTML, tableHTML, cellHTML, tblSort, coverFailed, tblExpand, setBpmMul, clearBpm, setKeyStep, clearKey, buildCard, svgGauge, gaugeWrap, timRow, miniBarRow, tblBar, keyPill, formatDur, fmtDate, rescanEntry, saveGenre, audioToggle, _fieldUsesRating, tableRowClick, tableRowDblClick, tableRowCommit });
export { rescanningIds };
