// Export: M3U8, Rekordbox XML (download or the bridge file Rekordbox watches), Ableton .als,
// Traktor NML. Lifted from the pilot (index.html @ 7c8c0e7) with the paid gates removed;
// "// pilot N" marks each source line. The experimental direct Rekordbox collection write is not shipped.
import { activeCatalog, activePlaylist, allTags, catalog, featUse, getFilteredCatalog, getRating, getTrackTags, noteToCamelot, showToast, trackArtistTitle } from './field.js';


// pilot 6125
const TRAKTOR_CHROMA = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
// pilot 6126
function traktorKeyValue(root, mode) {
  const i = TRAKTOR_CHROMA.indexOf(root);
  if (i < 0) return null;
  if (mode === 'major') return i;
  if (mode === 'minor') return 12 + i;
  return null;
}
// pilot 8459
let exportSource = 'filtered'; // 'filtered' | 'playlist'
// pilot 8460
function setExportSource(v) {
  exportSource = v;
  const csvItem = document.getElementById('exp-csv');
  if (csvItem) csvItem.style.opacity = (v === 'playlist') ? '0.4' : '1';
}
// Export is Pro (Mark, 29 Oct 2026): every format, on sale in January. Until then every way
// into export opens the Pro card. In January this checks the licence instead.
const PRO_SIGNUP_URL = 'https://tunefield.app/pro?src=app';
function exportLocked() { return true; }
function openProCard() {
  closeExportMenu();
  document.getElementById('pro-modal').style.display = 'flex';
  if (typeof featUse === 'function') featUse('pro_card');
}
function closeProCard() { document.getElementById('pro-modal').style.display = 'none'; }
function proSignUp() {
  if (typeof featUse === 'function') featUse('pro_signup');
  window.tfOpenExternal(PRO_SIGNUP_URL);
  closeProCard();
}
// pilot 8465
function openExportMenu(ev) {
  if (ev) ev.stopPropagation();
  if (exportLocked()) { openProCard(); return; }
  const popup = document.getElementById('export-menu');
  // Lite: two entry points. The set panel's button exports the open set; the List's exports
  // what the filters show.
  const btn   = ev?.currentTarget || document.getElementById('c-export-btn');
  const rect  = btn.getBoundingClientRect();
  const src   = btn.id === 'sp-export-btn' ? 'playlist' : 'filtered';
  setExportSource(src);
  const radio = document.querySelector(`input[name="export-src"][value="${src}"]`);
  if (radio) radio.checked = true;
  const nCat = (typeof getFilteredCatalog === 'function') ? getFilteredCatalog().length : (catalog?.length || 0);
  const nPl  = activePlaylist?.tracks?.length || 0;
  document.getElementById('exp-src-cat-n').textContent = `(${nCat})`;
  document.getElementById('exp-src-pl-n').textContent  = activePlaylist ? `“${activePlaylist.name}” · ${nPl}` : '(none)';
  document.getElementById('export-menu-header').textContent = 'Export';
  popup.style.display = 'block';
  const pw = popup.offsetWidth;
  let left = rect.left;
  if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
  if (left < 12) left = 12;
  popup.style.left = left + 'px';
  const below = rect.bottom + 6 + popup.offsetHeight < window.innerHeight;
  popup.style.top  = (below ? rect.bottom + 6 : Math.max(12, rect.top - popup.offsetHeight - 6)) + 'px';
}
// pilot 8485
function closeExportMenu() { document.getElementById('export-menu').style.display = 'none'; }
// pilot 8491
async function exportRows() {
  if (exportSource === 'playlist') {
    if (!activePlaylist?.tracks?.length) return { rows: [], baseName: 'playlist', dropped: 0 };
    const byId = new Map(catalog.map(t => [t.id, t]));
    const missing = [...new Set(activePlaylist.tracks.filter(t => !byId.has(t.track_id)).map(t => t.track_id))];
    const foreign = new Map();
    if (missing.length) {
      try {
        const r = await fetch('/tracks/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                   body: JSON.stringify({ ids: missing }) });
        if (r.ok) {
          const d = await r.json();
          Object.entries(d.found || {}).forEach(([id, x]) => foreign.set(id, {
            id, filename: x.filename, library_file: x.library_file, genre: x.genre || '',
            data: { original_filename: x.original_filename,
                    rhythm:   { bpm: x.bpm },
                    // key rides along so foreign rows take the same MUSICAL_KEY path as
                    // local ones instead of the Camelot fallback (a second wrong format)
                    harmony:  { root: x.root, mode: x.mode, key: x.key },
                    // artist/title must survive here or foreign playlist rows silently
                    // fall back to filename parsing — the exact bug this synthesis
                    // shares with the exporters it feeds (P1a)
                    metadata: { duration_sec: x.duration_sec, codec: x.codec,
                                artist: x.artist, title: x.title,
                                bitrate_kbps: x.bitrate_kbps, sample_rate_hz: x.sample_rate_hz } },
          }));
        }
      } catch (_) {}   // resolve down → foreign tracks fall into `dropped`, reported below
    }
    const rows = activePlaylist.tracks.map(t => byId.get(t.track_id) || foreign.get(t.track_id)).filter(Boolean);
    return { rows, baseName: activePlaylist.slug, dropped: activePlaylist.tracks.length - rows.length };
  }
  return { rows: getFilteredCatalog(), baseName: (activeCatalog || 'catalog'), dropped: 0 };
}
// pilot 8531
async function exportAs(kind) {
  if (exportLocked()) { openProCard(); return; }
  if (typeof featUse === 'function') featUse('export_' + kind);
  closeExportMenu();
  if (kind === 'csv') {
    if (exportSource === 'playlist') { showToast('CSV exports the full Field — switch source to "Filtered Field" or use M3U8/XML/NML for playlists'); return; }
    window.location.href = '/catalog/export.csv?cat=' + encodeURIComponent(activeCatalog||'');
    return;
  }
  const { rows, baseName: raw, dropped } = await exportRows();
  if (dropped > 0) showToast(`${dropped} track${dropped === 1 ? '' : 's'} skipped — not found in any Field`);
  if (!rows.length) { showToast(exportSource === 'playlist' ? 'Active playlist is empty' : 'No tracks to export (check filters)'); return; }
  const baseName = raw.replace(/[^a-z0-9_-]+/gi, '_');
  fetch('/diagnostics/first-export', { method: 'POST' }).catch(() => {});   // stamps once: time to first export
  const name = exportSource === 'playlist' ? activePlaylist?.name : null;
  if (kind === 'rekordbox-bridge')     { exportRbBridge(rows, name); return; }
  if (kind === 'ableton') {
    exportAls(rows, name, baseName); return;
  }
  if (kind === 'm3u8-abs') downloadBlob(`${baseName}.m3u8`, buildM3U8(rows, true),  'audio/x-mpegurl');
  if (kind === 'm3u8-rel') downloadBlob(`${baseName}.m3u8`, buildM3U8(rows, false), 'audio/x-mpegurl');
  if (kind === 'rekordbox') downloadBlob(`${baseName}.rekordbox.xml`, buildRekordboxXml(rows, name), 'application/xml');
  if (kind === 'traktor')   downloadBlob(`${baseName}.nml`, buildTraktorNml(rows, name), 'application/xml');
  const src = exportSource === 'playlist' ? 'playlist' : 'filtered';
  showToast(`Exported ${rows.length} ${src} track${rows.length===1?'':'s'} → ${baseName}.${kind.startsWith('m3u')?'m3u8':kind==='rekordbox'?'rekordbox.xml':'nml'}`);
}
// pilot 8560
function downloadBlob(name, content, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// pilot 8570
function escXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
// pilot 8574
function fileUri(absPath) {
  if (!absPath) return '';
  const segs = absPath.split('/').map(s => encodeURIComponent(s));
  return 'file://localhost' + segs.join('/');
}
// pilot 8617
const RATING_TO_255 = [0, 51, 102, 153, 204, 255];
// pilot 8619
function buildM3U8(rows, absolute) {
  const lines = ['#EXTM3U'];
  for (const e of rows) {
    const dur = Math.round(e.data?.metadata?.duration_sec || 0);
    const { artist, title } = trackArtistTitle(e);
    const label = artist ? `${artist} - ${title}` : title;
    lines.push(`#EXTINF:${dur},${label}`);
    const abs = e.library_file || e.filename;
    const path = absolute ? abs : abs.split('/').pop();
    lines.push(path);
  }
  return lines.join('\n') + '\n';
}
// pilot 8635
function rekordboxTrackAttrs(e) {
  const d   = e.data || {};
  const md  = d.metadata || {};
  const r   = d.rhythm  || {};
  const h   = d.harmony || {};
  const { artist, title } = trackArtistTitle(e);
  const camelot = noteToCamelot(h.root, h.mode) || '';
  // Rekordbox Tonality: single-letter mode, e.g. "Am" minor / "C" major
  const tonality = h.root ? (h.root + (h.mode === 'minor' ? 'm' : '')) : '';
  const rating   = RATING_TO_255[getRating(e.id) || 0];
  const tagNames = [...getTrackTags(e.id)].map(tid => allTags.find(t => t.id === tid)?.name).filter(Boolean);
  return {
    name: title, artist, genre: e.genre || '',
    kind: (md.codec||'').toUpperCase() + ' File',
    total_time:  String(Math.round(md.duration_sec||0)),
    bit_rate:    String(md.bitrate_kbps||0),
    sample_rate: String(md.sample_rate_hz||0),
    bpm: (r.bpm||0).toFixed(2),
    tonality, rating: String(rating),
    comments: [camelot, ...tagNames].filter(Boolean).join(' / '),
    location: e.library_file || '',
  };
}
// pilot 8659
function buildRekordboxXml(rows, name) {
  const dateAdded = new Date().toISOString().slice(0, 10);
  const tracks = rows.map((e, i) => {
    const a = rekordboxTrackAttrs(e);
    return `    <TRACK TrackID="${i+1}" Name="${escXml(a.name)}" Artist="${escXml(a.artist)}" Genre="${escXml(a.genre)}" Kind="${escXml(a.kind)}" TotalTime="${a.total_time}" BitRate="${a.bit_rate}" SampleRate="${a.sample_rate}" AverageBpm="${a.bpm}" DateAdded="${dateAdded}" Tonality="${escXml(a.tonality)}" Rating="${a.rating}" PlayCount="0" Comments="${escXml(a.comments)}" Location="${escXml(fileUri(a.location))}"/>`;
  }).join('\n');
  const playlistName = name || activeCatalog || 'Field';
  const trackRefs = rows.map((_, i) => `        <TRACK Key="${i+1}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="Field" Version="1.0" Company="Field"/>
  <COLLECTION Entries="${rows.length}">
${tracks}
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Name="${escXml(playlistName)}" Type="1" KeyType="0" Entries="${rows.length}">
${trackRefs}
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>
`;
}
// pilot 8685
let _rbStatus = null;
// pilot 8686
async function rbStatus(force) {
  if (_rbStatus && !force) return _rbStatus;
  try { _rbStatus = await fetch('/export/rekordbox/status').then(r => r.ok ? r.json() : null); }
  catch (_) { _rbStatus = null; }
  return _rbStatus;
}
// pilot 8693
function rbExportName() {
  return (exportSource === 'playlist' ? activePlaylist?.name : activeCatalog) || 'Field';
}
// pilot 8697
async function exportAls(rows, name, baseName) {
  const payload = { name: name || baseName, tracks: rows.map(e => {
    const d = e.data || {}, md = d.metadata || {}, r = d.rhythm || {}, h = d.harmony || {};
    const { artist, title } = trackArtistTitle(e);
    return { location: e.library_file || '', artist, title,
             bpm: e.bpm_user || r.bpm,           // honour the user tempo override
             key: h.key || noteToCamelot(h.root, h.mode) || '',
             duration_sec: md.duration_sec, sample_rate_hz: md.sample_rate_hz };
  }).filter(t => t.location) };
  if (!payload.tracks.length) { showToast('No exportable tracks (missing file paths)'); return; }
  try {
    const r = await fetch('/export/als', { method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${baseName}.als`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const offline = parseInt(r.headers.get('X-Tracks-Offline') || '0', 10);
    showToast(`Exported ${payload.tracks.length} track${payload.tracks.length===1?'':'s'} → ${baseName}.als`
              + (offline ? ` (${offline} offline — will relink when their drive mounts)` : '')
              + ' — open in Ableton Live');
  } catch (err) { showToast('Ableton export failed: ' + err.message); }
}
// pilot 8724
async function exportRbBridge(rows, name) {
  const payload = { name: name || rbExportName(), tracks: rows.map(rekordboxTrackAttrs).filter(t => t.location) };
  if (!payload.tracks.length) { showToast('No exportable tracks (missing file paths)'); return; }
  try {
    const r = await fetch('/export/rekordbox/bridge', { method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    _rbStatus = null; // playlist list changed
    showToast(`“${j.playlist}” → Rekordbox bridge (${j.playlists} playlist${j.playlists===1?'':'s'}, ${j.tracks} tracks)`);
    if (!localStorage.getItem('rb-bridge-setup-seen')) openRbSetup();
  } catch (err) { showToast('Bridge export failed: ' + err.message); }
}
// pilot 8738
async function openRbSetup() {
  if (exportLocked()) { openProCard(); return; }
  closeExportMenu();
  localStorage.setItem('rb-bridge-setup-seen', '1');
  const s = await rbStatus();
  if (s?.bridge_path) document.getElementById('rb-bridge-path').textContent = s.bridge_path;
  document.getElementById('rb-setup-modal').style.display = 'flex';
}
function closeRbSetup() { document.getElementById('rb-setup-modal').style.display = 'none'; }
function copyRbBridgePath() {
  const path = document.getElementById('rb-bridge-path')?.textContent || '';
  navigator.clipboard?.writeText(path).then(() => showToast('Path copied'), () => showToast('Could not copy — select the path and copy it'));
}
// pilot 8790
function buildTraktorNml(rows, name) {
  const nowIso = new Date().toISOString().slice(0, 19);
  const entries = rows.map(e => {
    const d   = e.data || {};
    const md  = d.metadata || {};
    const r   = d.rhythm  || {};
    const h   = d.harmony || {};
    const { artist, title } = trackArtistTitle(e);
    // INFO KEY is free text (key name is right there); MUSICAL_KEY must be the integer.
    const keyName = h.key || (noteToCamelot(h.root, h.mode) || '');
    const keyInt  = traktorKeyValue(h.root, h.mode);
    const rating  = RATING_TO_255[getRating(e.id) || 0];
    const tagNames = [...getTrackTags(e.id)].map(tid => allTags.find(t => t.id === tid)?.name).filter(Boolean).join(' ');
    // Traktor location: VOLUME (root, e.g. ""), DIR (path with /::/), FILE (basename)
    const abs = e.library_file || '';
    const slash = abs.lastIndexOf('/');
    const dir   = slash >= 0 ? abs.slice(0, slash + 1).replace(/\//g, '/:') : '/:';
    const file  = slash >= 0 ? abs.slice(slash + 1) : abs;
    return `    <ENTRY MODIFIED_DATE="${nowIso.slice(0,10)}" MODIFIED_TIME="0" TITLE="${escXml(title)}" ARTIST="${escXml(artist)}">
      <LOCATION DIR="${escXml(dir)}" FILE="${escXml(file)}" VOLUME="" VOLUMEID=""/>
      <INFO BITRATE="${(md.bitrate_kbps||0)*1000}" GENRE="${escXml(e.genre || '')}" PLAYTIME="${Math.round(md.duration_sec||0)}" IMPORT_DATE="${nowIso.slice(0,10)}" RANKING="${rating}" COMMENT="${escXml(tagNames)}" KEY="${escXml(keyName)}"/>
      <TEMPO BPM="${(r.bpm||0).toFixed(6)}" BPM_QUALITY="100.000000"/>${keyInt === null ? '' : `
      <MUSICAL_KEY VALUE="${keyInt}"/>`}
    </ENTRY>`;
  }).join('\n');
  const playlistName = name || activeCatalog || 'Field';
  const playlistEntries = rows.map(e => {
    const abs = e.library_file || '';
    const slash = abs.lastIndexOf('/');
    const dir   = slash >= 0 ? abs.slice(0, slash + 1).replace(/\//g, '/:') : '/:';
    const file  = slash >= 0 ? abs.slice(slash + 1) : abs;
    return `        <ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${escXml(dir + file)}"/></ENTRY>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
  <HEAD COMPANY="www.tunefield.dj" PROGRAM="Field"/>
  <MUSICFOLDERS/>
  <COLLECTION ENTRIES="${rows.length}">
${entries}
  </COLLECTION>
  <PLAYLISTS>
    <NODE TYPE="FOLDER" NAME="$ROOT">
      <SUBNODES COUNT="1">
        <NODE TYPE="PLAYLIST" NAME="${escXml(playlistName)}">
          <PLAYLIST ENTRIES="${rows.length}" TYPE="LIST" UUID="tunefield-${Date.now()}">
${playlistEntries}
          </PLAYLIST>
        </NODE>
      </SUBNODES>
    </NODE>
  </PLAYLISTS>
</NML>
`;
}

// A click anywhere else closes the menu (openExportMenu stops its own click from bubbling here).
document.addEventListener('click', e => {
  const m = document.getElementById('export-menu');
  if (m && m.style.display === 'block' && !m.contains(e.target)) closeExportMenu();
});

Object.assign(window, {exportLocked, openProCard, closeProCard, proSignUp, traktorKeyValue, setExportSource, openExportMenu, closeExportMenu, exportRows, exportAs, downloadBlob, escXml, fileUri, buildM3U8, rekordboxTrackAttrs, buildRekordboxXml, rbStatus, rbExportName, exportAls, exportRbBridge, openRbSetup, closeRbSetup, copyRbBridgePath, buildTraktorNml, exportMenuClose: closeExportMenu });
