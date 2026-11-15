// Export: M3U8, Rekordbox XML (download or the bridge file Rekordbox watches), Ableton .als,
// Traktor NML. Lifted from the pilot (index.html @ 7c8c0e7) with the paid gates removed;
// "// pilot N" marks each source line. The experimental direct Rekordbox collection write is not shipped.
import { activeCatalog, activePlaylist, allTags, catalog, esc, featUse, getFilteredCatalog, getRating, getTrackTags, noteToCamelot, showToast, trackArtistTitle } from './field.js';


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
// Release switches (Boss, 15 Nov): the riskier 1.1.0 exports can be turned off before the
// candidate with one line each. Off hides the menu item; nothing else changes.
const EXPORT_SWITCHES = { arrangement: true };

// A small modal for export choices (export.js only). `html` may hold inputs with a
// data-field attribute; OK resolves with {field: value}, Cancel/×/backdrop with null.
function tfDialog({ title, html, ok = 'OK', cancel = 'Cancel' }) {
  return new Promise(resolve => {
    const m = document.getElementById('tf-dialog');
    document.getElementById('tfd-title').textContent = title;
    document.getElementById('tfd-body').innerHTML = html;
    document.getElementById('tfd-ok').textContent = ok;
    document.getElementById('tfd-cancel').textContent = cancel;
    const done = v => { m.style.display = 'none'; m.onclick = null; resolve(v); };
    const collect = () => Object.fromEntries([...m.querySelectorAll('[data-field]')].map(el =>
      [el.dataset.field, (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value]));
    document.getElementById('tfd-ok').onclick = () => done(collect());
    document.getElementById('tfd-cancel').onclick = () => done(null);
    document.getElementById('tfd-x').onclick = () => done(null);
    m.onclick = ev => { if (ev.target === m) done(null); };
    m.style.display = 'flex';
    document.getElementById('tfd-ok').focus();
  });
}
// pilot 8459
let exportSource = 'filtered'; // 'filtered' | 'playlist'
// pilot 8460
function setExportSource(v) {
  exportSource = v;
  const csvItem = document.getElementById('exp-csv');
  if (csvItem) csvItem.style.opacity = (v === 'playlist') ? '0.4' : '1';
}
// Export is Pro (Mark, 29 Oct 2026): every format, on sale 12 Jan 2027. Without a Pro key every
// way into export opens the Pro card. The key is checked offline by /api/license (app.py),
// which also guards the server-side exports.
const PRO_SIGNUP_URL = 'https://tunefield.app/pro?src=app';
let _pro = { licensed: false };
function exportLocked() { return !_pro.licensed; }
function _proRender() {
  const st = document.getElementById('pro-settings-state');
  const btn = document.getElementById('pro-settings-btn');
  const day = iso => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  // Customer keys are lifetime; only test keys carry an expiry (Mark, 9 Nov 2026).
  if (st) st.textContent = !_pro.licensed ? 'Not unlocked'
    : _pro.expires ? `Test key, until ${day(_pro.expires)}`
    : `Unlocked${_pro.issued ? ' since ' + day(_pro.issued) : ''}`;
  if (btn) btn.textContent = _pro.licensed ? 'Remove key' : 'Enter key';
}
async function proRefresh() {
  try {
    const r = await fetch('/api/license');
    if (r.ok) _pro = await r.json();
  } catch (_) {}
  _proRender();
}
function _proMsg(text, ok) {
  const m = document.getElementById('pro-key-msg');
  if (!m) return;
  m.textContent = text || '';
  m.style.color = ok ? 'var(--ink-green)' : 'var(--ink-red)';
  m.hidden = !text;
}
async function proUnlock() {
  const input = document.getElementById('pro-key-input');
  const key = (input?.value || '').trim();
  if (!key) { _proMsg('Paste your Tunefield Pro key first.'); input?.focus(); return; }
  const btn = document.getElementById('pro-key-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/license', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ key }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.licensed) { _proMsg(j.error || 'That key could not be checked. Try again.'); return; }
    _pro = j;
    _proRender();
    if (input) input.value = '';
    _proMsg('');
    closeProCard();
    if (typeof featUse === 'function') featUse('pro_unlocked');
    showToast('Tunefield Pro unlocked: every export is on. Thank you!');
  } catch (_) {
    _proMsg('That key could not be checked. Try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function proSettingsAction() {
  if (!_pro.licensed) {
    if (typeof window.closeSettings === 'function') window.closeSettings();
    _proMsg('');
    document.getElementById('pro-modal').style.display = 'flex';
    document.getElementById('pro-key-input')?.focus();
    return;
  }
  if (!confirm('Remove the Tunefield Pro key from this Mac?\n\nExports lock again until you paste the key back in. Keep the email with your key.')) return;
  try {
    const r = await fetch('/api/license', { method: 'DELETE' });
    if (r.ok) _pro = await r.json();
  } catch (_) {}
  _proRender();
}
proRefresh();
function openProCard() {
  // Time to first export: without a key, opening the Pro card IS the export attempt
  // (with a key, exportAs stamps it past the gate).
  fetch('/diagnostics/first-export', { method: 'POST' }).catch(() => {});   // stamps once
  closeExportMenu();
  _proMsg('');
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
  for (const [k, id] of [['arrangement', 'exp-ableton-arr']]) {
    const el = document.getElementById(id); if (el) el.hidden = !EXPORT_SWITCHES[k];
  }
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
            id, filename: x.filename, library_file: x.library_file, abs_path: x.abs_path, genre: x.genre || '',
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
  // Rekordbox and Traktor carry the user's field mapping: confirmed once before anything is written (E1).
  if (['rekordbox', 'rekordbox-bridge', 'traktor'].includes(kind) && !(await ensureFields())) return;
  if (kind === 'rekordbox-bridge')     { exportRbBridge(rows, name); return; }
  if (kind === 'ableton') {
    exportAls(rows, name, baseName); return;
  }
  if (kind === 'ableton-arr') { exportArrangement(rows, name, baseName); return; }
  if (kind === 'serato')      { exportSerato(rows, name, baseName); return; }
  if (kind === 'collect')     { exportCollect(rows, name, baseName); return; }
  if (kind === 'm3u8-abs') downloadBlob(`${baseName}.m3u8`, buildM3U8(rows, true),  'audio/x-mpegurl');
  if (kind === 'm3u8-rel') downloadBlob(`${baseName}.m3u8`, buildM3U8(rows, false), 'audio/x-mpegurl');
  if (kind === 'rekordbox') downloadBlob(`${baseName}.rekordbox.xml`, buildRekordboxXml(rows, name), 'application/xml');
  if (kind === 'traktor')   downloadBlob(`${baseName}.nml`, buildTraktorNml(rows, name), 'application/xml');
  if (kind === 'setsheet')  downloadBlob(`${baseName}.set-sheet.csv`, buildSetSheet(rows), 'text/csv');
  const src = exportSource === 'playlist' ? 'playlist' : 'filtered';
  showToast(`Exported ${rows.length} ${src} track${rows.length===1?'':'s'} → ${baseName}.${kind.startsWith('m3u')?'m3u8':kind==='rekordbox'?'rekordbox.xml':kind==='setsheet'?'set-sheet.csv':'nml'}`);
}
// ── Set sheet (1.1.0, E2) ────────────────────────────────────────────────────
// The set in running order, for printing or a booth sheet: position, start time and
// the numbers a DJ reads at a glance. Unlike the metadata CSV it follows the export
// source (the active set or the filtered Field), in that order.
const _csvCell = v => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const _clock = sec => {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
};
function buildSetSheet(rows) {
  const out = [['#', 'Start', 'Artist', 'Title', 'BPM', 'Key', 'Camelot', 'Energy (1-10)', 'Length'].join(',')];
  let t = 0;
  rows.forEach((e, i) => {
    const d = e.data || {}, md = d.metadata || {}, h = d.harmony || {};
    const { artist, title } = trackArtistTitle(e);
    const bpm = e.bpm_user || d.rhythm?.bpm;
    const root = e.key_user?.root || h.root, mode = e.key_user?.mode || h.mode;
    const key = root && root !== 'unknown' ? root + (mode === 'minor' ? 'm' : '') : '';
    const energy = d.energy?.level != null ? Math.max(1, Math.min(10, Math.round(d.energy.level * 9) + 1)) : '';
    out.push([i + 1, _clock(t), artist, title, bpm ? (+bpm).toFixed(1) : '', key,
              noteToCamelot(root, mode) || '', energy, _clock(md.duration_sec)].map(_csvCell).join(','));
    t += md.duration_sec || 0;
  });
  out.push(['', _clock(t), '', 'Total', '', '', '', '', ''].map(_csvCell).join(','));
  return '\ufeff' + out.join('\r\n') + '\r\n';      // BOM + CRLF: Excel opens UTF-8 names right
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
  // Control characters (bar tab, LF, CR) are illegal in XML 1.0 even escaped: one in a tag
  // made Rekordbox/Traktor reject the whole file. A space keeps the text readable.
  return String(s ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
// Where a track lives, for anything written into an export: abs_path (absolute, from the
// server) first. library_file is relative on the portable build — useless to another app.
const trackPath = e => e.abs_path || e.library_file || '';
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
    const label = (artist ? `${artist} - ${title}` : title).replace(/[\r\n]+/g, ' ');   // one line, or it splits the entry
    lines.push(`#EXTINF:${dur},${label}`);
    const abs = trackPath(e) || e.filename;
    let path = absolute ? abs : abs.split('/').pop();
    if (path.startsWith('#')) path = './' + path;   // a bare "#…" line is an M3U comment
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
    comments: _fields ? fieldText(e, _fields.rb_comments) : [camelot, ...tagNames].filter(Boolean).join(' / '),
    colour: _fields?.rb_colour === 'energy' ? RB_COLOUR_BY_ENERGY(energy10(e))
          : _fields?.rb_colour === 'mood' ? (RB_COLOUR_BY_MOOD[d.scores?.mood] || '') : '',
    grouping: _fields && _fields.rb_grouping !== 'off' ? fieldToken(e, _fields.rb_grouping) : '',
    location: trackPath(e),
  };
}
// ── Field mapping for Rekordbox and Traktor (1.1.0, E1) ──────────────────────
// Mark, 15 Nov: energy, mood and vocals can travel into Rekordbox (Comments, Colour,
// Grouping) and Traktor (Comment). The user picks the mapping, and nothing is written
// until it has been seen and confirmed once; the 1.0.0 behaviour is the default.
let _fields = null;
const energy10 = e => { const l = e.data?.energy?.level; return l == null ? null : Math.max(1, Math.min(10, Math.round(l * 9) + 1)); };
const RB_COLOUR_BY_ENERGY = n => n == null ? '' : n <= 2 ? '0x0000FF' : n <= 4 ? '0x25FDE9' : n === 5 ? '0x00FF00'
  : n === 6 ? '0xFFFF00' : n === 7 ? '0xFFA500' : n <= 9 ? '0xFF0000' : '0xFF007F';   // blue → aqua → green → yellow → orange → red → pink
const RB_COLOUR_BY_MOOD = { euphoric: '0xFFFF00', intense: '0xFF0000', upbeat: '0x00FF00', melancholic: '0x0000FF' };
function fieldToken(e, tok) {
  const d = e.data || {}, h = d.harmony || {};
  if (tok === 'camelot') return noteToCamelot(h.root, h.mode) || '';
  if (tok === 'tags') return [...getTrackTags(e.id)].map(tid => allTags.find(t => t.id === tid)?.name).filter(Boolean).join(' / ');
  if (tok === 'energy') { const n = energy10(e); return n == null ? '' : 'E' + n; }
  if (tok === 'mood') { const m = d.scores?.mood; return m ? m[0].toUpperCase() + m.slice(1) : ''; }
  if (tok === 'vocals') { const v = d.content?.has_vocals; return v == null ? '' : v ? 'Vocal' : 'Instrumental'; }
  return '';
}
const fieldText = (e, toks) => (toks || []).map(t => fieldToken(e, t)).filter(Boolean).join(' / ');
async function loadFields() {
  try { _fields = await fetch('/export/fields').then(r => r.ok ? r.json() : null); } catch (_) { _fields = null; }
  return _fields;
}
async function editFields(firstTime) {
  const f = (await loadFields()) || {};
  const box = (name, tok, list) => `<label style="display:inline-flex;gap:4px;margin-right:10px"><input type="checkbox" data-field="${name}:${tok}" ${(list || []).includes(tok) ? 'checked' : ''}>${tok === 'camelot' ? 'Camelot key' : tok[0].toUpperCase() + tok.slice(1)}</label>`;
  const radio = (name, val, cur, label) => `<label style="display:inline-flex;gap:4px;margin-right:10px"><input type="radio" name="${name}" data-field="${name}=${val}" ${cur === val ? 'checked' : ''}>${label}</label>`;
  const T = ['camelot', 'tags', 'energy', 'mood', 'vocals'];
  const v = await tfDialog({
    title: 'Rekordbox & Traktor fields', ok: firstTime ? 'Confirm and export' : 'Save',
    html: `${firstTime ? '<p style="margin:0">Check what Tunefield writes into Rekordbox and Traktor. Nothing is written there until you confirm this once; change it any time in Settings.</p>' : ''}
      <div><b>Rekordbox · Comments</b><br>${T.map(t => box('rb_comments', t, f.rb_comments)).join('')}</div>
      <div><b>Rekordbox · Colour</b><br>${radio('rb_colour', 'off', f.rb_colour, 'None')}${radio('rb_colour', 'energy', f.rb_colour, 'By energy (blue → pink)')}${radio('rb_colour', 'mood', f.rb_colour, 'By mood')}</div>
      <div><b>Rekordbox · Grouping</b><br>${radio('rb_grouping', 'off', f.rb_grouping, 'None')}${radio('rb_grouping', 'energy', f.rb_grouping, 'Energy')}${radio('rb_grouping', 'mood', f.rb_grouping, 'Mood')}${radio('rb_grouping', 'vocals', f.rb_grouping, 'Vocals')}</div>
      <div><b>Traktor · Comment</b><br>${T.map(t => box('tk_comment', t, f.tk_comment)).join('')}</div>
      <p style="margin:0;color:var(--muted);font-size:12px">Energy is written as E1–E10, mood as Euphoric / Intense / Upbeat / Melancholic, vocals as Vocal / Instrumental. BPM, key and rating always go into their own fields.</p>`,
  });
  if (!v) return false;
  const pick = n => T.filter(t => v[`${n}:${t}`]);
  const one = (n, opts) => opts.find(o => v[`${n}=${o}`]) || 'off';
  const body = { rb_comments: pick('rb_comments'), tk_comment: pick('tk_comment'),
                 rb_colour: one('rb_colour', ['off', 'energy', 'mood']), rb_grouping: one('rb_grouping', ['off', 'energy', 'mood', 'vocals']) };
  const r = await fetch('/export/fields', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { showToast('Could not save the field mapping'); return false; }
  _fields = await r.json();
  if (!firstTime) showToast('Rekordbox & Traktor fields saved');
  return true;
}
// true once the mapping has been confirmed; asks the first time.
async function ensureFields() {
  const f = _fields || await loadFields();
  if (f?.confirmed) return true;
  return editFields(true);
}
// pilot 8659
function buildRekordboxXml(rows, name) {
  const dateAdded = new Date().toISOString().slice(0, 10);
  const tracks = rows.map((e, i) => {
    const a = rekordboxTrackAttrs(e);
    return `    <TRACK TrackID="${i+1}" Name="${escXml(a.name)}" Artist="${escXml(a.artist)}" Genre="${escXml(a.genre)}" Kind="${escXml(a.kind)}" TotalTime="${a.total_time}" BitRate="${a.bit_rate}" SampleRate="${a.sample_rate}" AverageBpm="${a.bpm}" DateAdded="${dateAdded}" Tonality="${escXml(a.tonality)}" Rating="${a.rating}" PlayCount="0" Comments="${escXml(a.comments)}"${a.grouping ? ` Grouping="${escXml(a.grouping)}"` : ''}${a.colour ? ` Colour="${a.colour}"` : ''} Location="${escXml(fileUri(a.location))}"/>`;
  }).join('\n');
  const playlistName = name || activeCatalog || 'Field';
  const trackRefs = rows.map((_, i) => `        <TRACK Key="${i+1}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="Tunefield" Version="1.0" Company="Tunefield"/>
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
async function exportAls(rows, name, baseName, extra) {
  const payload = { name: name || baseName, ...(extra || {}), tracks: rows.map(e => {
    const d = e.data || {}, md = d.metadata || {}, r = d.rhythm || {}, h = d.harmony || {};
    const { artist, title } = trackArtistTitle(e);
    return { location: trackPath(e), artist, title,
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
// ── Approvals (1.1.0, E0) ───────────────────────────────────────────────────
// Anything written into another app's place or into the user's own files needs the
// user's OK first (Mark, 15 Nov). The server answers 409 approval_required with the
// exact path and writes nothing; we ask, record the OK (per Mac, or on the stick for a
// stick folder) and retry once. Declining writes nothing.
const APPROVAL_TEXT = {
  collect_folder: p => `Tunefield will copy sets into this folder (a sub-folder per set):\n\n${p}\n\nIt never replaces a file there without asking.\n\nAllow this? You can remove it later in Settings → Export locations.`,
  serato_crate: p => `Tunefield will write Serato crates into Serato's own folder:\n\n${p}\n\nOnly crate files it is asked to export; it never changes your Serato library or other crates.\n\nAllow this ${p.startsWith('/Volumes/') ? 'for that drive' : 'on this Mac'}? You can remove it later in Settings → Export locations.`,
  rekordbox_bridge: p => `Tunefield will write its Rekordbox file here, and update it on every Rekordbox bridge export:\n\n${p}\n\nRekordbox only reads it; your Rekordbox collection is never changed.\n\nAllow this on this Mac? You can remove it later in Settings → Export locations.`,
};
async function withApproval(doFetch) {
  // One OK per place: a Serato export can touch the Mac and several drives, each asked once.
  for (let round = 0; round < 8; round++) {
    const r = await doFetch();
    if (r.status !== 409) return r;
    const req = (await r.clone().json().catch(() => ({}))).approval_required;
    if (!req) return r;
    const say = APPROVAL_TEXT[req.kind] || (p => `Tunefield will write here:\n\n${p}\n\nAllow this? You can remove it later in Settings → Export locations.`);
    if (!confirm(say(req.target))) return null;
    const ok = await fetch('/export/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify(req) });
    if (!ok.ok) { showToast('Could not save your OK — nothing was written'); return null; }
    renderExportApprovals();
  }
  return null;
}
async function renderExportApprovals() {
  const el = document.getElementById('export-approvals');
  if (!el) return;
  let j = null;
  try { j = await fetch('/export/approvals').then(r => r.ok ? r.json() : null); } catch (_) {}
  const list = j?.approvals || [];
  const label = { rekordbox_bridge: 'Rekordbox file', serato_crate: 'Serato crates', collect_folder: 'Collect folder', tag_write: 'Tags in files' };
  el.innerHTML = list.length
    ? list.map((a, i) => `<div class="ea-row"><span class="ea-kind">${esc(label[a.kind] || a.kind)}${a.host ? '' : ' · on this stick'}</span>
        <code class="ea-path" title="${esc(a.absolute || a.target)}">${esc(a.absolute || a.target)}</code>
        <button class="btn-sm" data-i="${i}">Remove</button></div>`).join('')
    : '<span class="ea-none">Nothing approved yet. Tunefield asks before it writes outside its own folder.</span>';
  el.querySelectorAll('button[data-i]').forEach(b => b.onclick = async () => {
    const a = list[+b.dataset.i];
    await fetch('/export/approvals', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                                       body: JSON.stringify({ kind: a.kind, target: a.target }) });
    _rbStatus = null;
    renderExportApprovals();
  });
}
// ── Serato crate (1.1.0, E3) ────────────────────────────────────────────────
// A crate per drive, in Serato's own _Serato_/Subcrates (Serato's rule). Shown first,
// approved per place, never replacing a crate without a yes. Serato analyses BPM and
// key itself: the crate carries the track list and order only.
async function exportSerato(rows, name, baseName) {
  const paths = rows.map(trackPath).filter(p => p && p.startsWith('/'));
  if (!paths.length) { showToast('No exportable tracks (missing file paths)'); return; }
  const body = extra => JSON.stringify({ name: name || baseName, paths, ...extra });
  const post = extra => fetch('/export/serato', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(extra) });
  let plan;
  try { plan = await (await post({ dry_run: true })).json(); } catch (_) { plan = null; }
  if (!plan?.targets) { showToast('Serato export failed: ' + (plan?.error || 'no answer')); return; }
  const rowsHtml = plan.targets.map(t => `<li><code style="word-break:break-all">${esc(t.crate)}</code> — ${t.tracks} track${t.tracks === 1 ? '' : 's'}${
      !t.serato_ready ? ' <b>(Serato folder not set up on this drive yet: open Serato once; skipped)</b>' : t.exists ? ' <b>(replaces the crate of that name)</b>' : ''}</li>`).join('');
  const v = await tfDialog({
    title: 'Serato DJ crate', ok: 'Export',
    html: `<p style="margin:0">Writes the crate <b>${esc(plan.crate.replace(/\.crate$/, ''))}</b> in the order of the set. Serato keeps one crate per drive:</p>
      <ul style="margin:0;padding-left:18px">${rowsHtml}</ul>
      <p style="margin:0;color:var(--muted);font-size:12px">Serato reads BPM and key with its own analysis when it loads the tracks; Tunefield's values are not carried over. Restart Serato or reopen the crate list to see a new crate.</p>`,
  });
  if (!v) return;
  const overwrite = plan.targets.some(t => t.exists && t.serato_ready);
  try {
    const r = await withApproval(() => post({ overwrite }));
    if (!r) { showToast('Nothing written: the Serato folder needs your OK first'); return; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    showToast(`Serato crate written to ${j.written.length} place${j.written.length === 1 ? '' : 's'}`
              + (j.skipped?.length ? ` · ${j.skipped.length} skipped (${j.skipped[0].reason})` : ''));
  } catch (err) { showToast('Serato export failed: ' + err.message); }
}
// ── Collect set to folder (1.1.0, E5) ───────────────────────────────────────
// Copies of the set's audio, numbered in set order, plus a relative M3U8, into a folder
// the user picks: a stick for the club, a folder to hand over. Size and free space come
// first; nothing is replaced without a yes.
const _bytes = n => n == null ? '?' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB';
async function exportCollect(rows, name, baseName) {
  const tracks = rows.filter(e => trackPath(e).startsWith('/')).map(e => {
    const { artist, title } = trackArtistTitle(e);
    return { path: trackPath(e), label: artist ? `${artist} - ${title}` : title, duration: e.data?.metadata?.duration_sec || 0 };
  });
  if (!tracks.length) { showToast('No exportable tracks (missing file paths)'); return; }
  let target;
  try { target = await (await fetch('/library/browse', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                          body: JSON.stringify({ prompt: 'Pick where to collect the set' }) })).json(); }
  catch (_) { target = null; }
  if (!target || target.cancelled) return;
  if (target.error || !target.path) { showToast(target.error || 'Could not open the folder picker'); return; }
  const setName = name || baseName;
  const post = extra => fetch('/export/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: setName, target: target.path, tracks, ...extra }) });
  const plan = await (await post({ dry_run: true })).json().catch(() => null);
  if (!plan?.dest) { showToast('Collect failed: ' + (plan?.error || 'no answer')); return; }
  const short = plan.free != null && plan.bytes_to_copy + 64e6 > plan.free;
  const v = await tfDialog({
    title: 'Collect set to folder', ok: 'Copy',
    html: `<p style="margin:0">Copies <b>${plan.to_copy}</b> track${plan.to_copy === 1 ? '' : 's'} (<b>${_bytes(plan.bytes_to_copy)}</b>), numbered in set order, and a playlist file into</p>
      <code style="word-break:break-all">${esc(plan.dest)}</code>
      <p style="margin:0">Free there: ${_bytes(plan.free)}${short ? ' — <b style="color:var(--ink-red)">not enough for this set</b>' : ''}.</p>
      ${plan.already_there.length ? `<p style="margin:0;color:var(--muted)">${plan.already_there.length} already there, unchanged: left as they are.</p>` : ''}
      ${plan.missing.length ? `<p style="margin:0;color:var(--muted)">${plan.missing.length} not found on disk: left out.</p>` : ''}
      ${plan.differs.length ? `<div>${plan.differs.length} file${plan.differs.length === 1 ? ' is' : 's are'} already there with different contents:<br>
        <label style="margin-right:12px"><input type="radio" name="cex" data-field="skip" checked> keep those</label>
        <label><input type="radio" name="cex" data-field="replace"> replace them</label></div>` : ''}`,
  });
  if (!v) return;
  const existing = v.replace ? 'replace' : 'skip';
  showToast(`Copying ${plan.to_copy} track${plan.to_copy === 1 ? '' : 's'}…`, { duration: 60000 });
  try {
    const r = await withApproval(() => post({ existing }));
    if (!r) { showToast('Nothing copied: that folder needs your OK first'); return; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    showToast(`Collected ${j.written.length} track${j.written.length === 1 ? '' : 's'} into ${plan.dest.split('/').pop()}`
              + (j.failed.length ? ` · ${j.failed.length} failed (${j.failed[0].reason})` : ''), { duration: 6000 });
  } catch (err) { showToast('Collect failed: ' + err.message); }
}
// ── Arrangement mix (1.1.0, E6) ─────────────────────────────────────────────
// One continuous mix in Live's Arrangement view. Mark: end to end at one tempo with the
// user's overlap, and the dialog says plainly that downbeats are not lined up.
async function exportArrangement(rows, name, baseName) {
  const first = rows.find(e => (e.bpm_user || e.data?.rhythm?.bpm) > 0);
  const tempo = first ? Math.round((first.bpm_user || first.data.rhythm.bpm) * 10) / 10 : 120;
  let last = 8;
  try { last = Math.max(0, Math.min(64, parseInt(localStorage.getItem('arr-overlap') || '8', 10) || 0)); } catch (_) {}
  const v = await tfDialog({
    title: 'Ableton Live Set — Arrangement mix',
    ok: 'Export',
    html: `<p style="margin:0">One continuous mix in Arrangement view: ${rows.length} tracks end to end on two decks at
        <b>${tempo} BPM</b> (the first track's), each fading into the next.</p>
      <label style="display:flex;align-items:center;gap:8px">Overlap
        <input type="number" data-field="overlap" min="0" max="64" step="1" value="${last}" style="width:64px"> bars</label>
      <p style="margin:0;color:var(--muted);font-size:12px">Tempos are matched, but downbeats and phrases are <b>not</b> lined up:
        Tunefield doesn't know where each track's bar starts. In Live, nudge each clip onto the beat of the one before.</p>`,
  });
  if (!v) return;
  const bars = Math.max(0, Math.min(64, parseInt(v.overlap, 10) || 0));
  try { localStorage.setItem('arr-overlap', String(bars)); } catch (_) {}
  exportAls(rows, name, `${baseName}-mix`, { view: 'arrangement', overlap_bars: bars });
}
// pilot 8724
async function exportRbBridge(rows, name) {
  const payload = { name: name || rbExportName(), tracks: rows.map(rekordboxTrackAttrs).filter(t => t.location) };
  if (!payload.tracks.length) { showToast('No exportable tracks (missing file paths)'); return; }
  try {
    const r = await withApproval(() => fetch('/export/rekordbox/bridge', { method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) }));
    if (!r) { showToast('Nothing written: the Rekordbox file needs your OK first'); return; }
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
    const tagNames = _fields ? fieldText(e, _fields.tk_comment)
      : [...getTrackTags(e.id)].map(tid => allTags.find(t => t.id === tid)?.name).filter(Boolean).join(' ');
    // Traktor location: VOLUME (root, e.g. ""), DIR (path with /::/), FILE (basename)
    const abs = trackPath(e);
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
    const abs = trackPath(e);
    const slash = abs.lastIndexOf('/');
    const dir   = slash >= 0 ? abs.slice(0, slash + 1).replace(/\//g, '/:') : '/:';
    const file  = slash >= 0 ? abs.slice(slash + 1) : abs;
    return `        <ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${escXml(dir + file)}"/></ENTRY>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
  <HEAD COMPANY="www.tunefield.dj" PROGRAM="Tunefield"/>
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

Object.assign(window, {exportCollect, editFields, ensureFields, exportSerato, tfDialog, exportArrangement, buildSetSheet, withApproval, renderExportApprovals, exportLocked, openProCard, closeProCard, proSignUp, proRefresh, proUnlock, proSettingsAction, traktorKeyValue, setExportSource, openExportMenu, closeExportMenu, exportRows, exportAs, downloadBlob, escXml, fileUri, buildM3U8, rekordboxTrackAttrs, buildRekordboxXml, rbStatus, rbExportName, exportAls, exportRbBridge, openRbSetup, closeRbSetup, copyRbBridgePath, buildTraktorNml, exportMenuClose: closeExportMenu });
