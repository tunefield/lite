// Up next: the auto-queue under the set (Mark, 26 Oct). Holds five tracks ahead of the seed —
// the track last double-clicked, else the set's last track — steered by energy shape, Roam
// and Key discipline. A track joins the set when you keep it or when the set plays into it.
// Scoring is the pilot's flowPickNext (index.html @ 7c8c0e7) cut to those three controls;
// familiarity and the learned fingerprint are gone (the fingerprint was ~200x too loud).
import { activePlaylist, anchorTrackId, getFilteredCatalog, vecMatrix, vecDist2, _vecCamPos, VEC_DIMS,
         esc, catalog, trackArtistTitle, noteToCamelot, addTrackToActivePlaylist, audioPlayById } from './field.js';

const AHEAD = 5;
const SPAN = 20;   // tracks the shape takes to run (pilot: flowState.len)
const stored = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } };
const state = { shape: stored('upnext-shape', 'steady'), roam: +stored('upnext-roam', 22), keyd: +stored('upnext-keyd', 35) };
let queue = [];
const rejected = new Set();   // removed this session; never offered again
const seed = Math.floor(Math.random() * 0xffffffff);   // per session: varied between nights, stable within one

// pilot _flowNoise
function noise(id) {
  let h = seed ^ 0x9e3779b9;
  for (const c of String(id)) { h = Math.imul(h ^ c.charCodeAt(0), 0x5bd1e995); h ^= h >>> 15; }
  return ((h >>> 0) % 100000) / 100000;
}
// pilot _flowTarget, three shapes (20 Sep note): target loudness 0..1 at set position i.
function target(i) {
  const t = (i % SPAN) / SPAN;
  return state.shape === 'up' ? 0.3 + 0.6 * t : state.shape === 'down' ? 0.85 - 0.55 * t : 0.55;
}
function energy(d) {
  const v = VEC_DIMS.find(x => x.name === 'ene')?.get(d);
  return Number.isFinite(v) ? v : NaN;
}

// pilot flowPickNext: the weights and their reasons are documented there.
function pick(fromId, step, exclude, pool, M) {
  const roam = state.roam / 100, keyd = state.keyd / 100;
  const fromIdx = fromId != null ? M.idx.get(fromId) : undefined;
  const fromEntry = catalog.find(e => e.id === fromId);
  const fromCam = fromEntry?.data ? _vecCamPos(fromEntry.data) : null;
  const want = 0.15 + roam * 2.2;
  const goal = target(step);
  let best = null, bestScore = -Infinity;
  for (const e of pool) {
    if (exclude.has(e.id)) continue;
    let score = 0;
    if (fromIdx !== undefined) {
      const j = M.idx.get(e.id);
      if (j === undefined) continue;
      const dist = Math.sqrt(Math.max(0, vecDist2(M, fromIdx, j)));
      score -= Math.min(1.5, Math.abs(dist - want) / Math.max(0.5, want)) * 1.1;
    }
    if (keyd > 0.05 && fromCam) {
      const cam = _vecCamPos(e.data);
      if (cam && Math.min((cam - fromCam + 12) % 12, (fromCam - cam + 12) % 12) > 1) score -= keyd * 3.2;
    }
    const lo = energy(e.data);
    if (Number.isFinite(lo)) score -= Math.abs(lo - goal) * 2.4;
    score += noise(e.id) * 0.12;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best?.id ?? null;
}

function rebuild() {
  const set = activePlaylist?.tracks || [];
  queue = [];
  if (activePlaylist) {
    const pool = getFilteredCatalog().filter(e => e.data);
    const M = vecMatrix();
    const exclude = new Set([...set.map(t => t.track_id), ...rejected]);
    let from = anchorTrackId() || set.at(-1)?.track_id || null;
    for (let i = 0; i < AHEAD && M; i++) {
      const id = pick(from, set.length + i, exclude, pool, M);
      if (!id) break;
      queue.push(id); exclude.add(id); from = id;
    }
  }
  render();
}

function render() {
  const list = document.getElementById('un-list');
  if (!list) return;
  document.querySelectorAll('.un-shape').forEach(b => b.classList.toggle('on', b.dataset.shape === state.shape));
  if (!activePlaylist) { list.innerHTML = '<p class="un-empty">Open or create a set to see what comes next.</p>'; return; }
  if (!queue.length) { list.innerHTML = '<p class="un-empty">Nothing fits — loosen Key or widen Roam, or clear a filter.</p>'; return; }
  list.innerHTML = queue.map((id, i) => {
    const e = catalog.find(x => x.id === id) || {};
    const d = e.data || {}, h = d.harmony || {};
    const { artist, title } = trackArtistTitle(e);
    const bpm = Math.round(e.bpm_user || d.rhythm?.bpm || 0);
    const key = noteToCamelot(h.root, h.mode) || '';
    return `<div class="un-row" data-i="${i}" title="Click to preview · double-click or ＋ to keep">
      <span class="un-title">${esc(artist ? `${artist} — ${title}` : title)}</span>
      <span class="un-meta">${bpm ? bpm + ' BPM' : ''}${key ? ' · ' + key : ''}</span>
      <button class="un-keep" data-i="${i}" title="Keep: add to the set">＋</button>
      <button class="un-drop" data-i="${i}" title="Not this one">×</button>
    </div>`;
  }).join('');
}

async function keep(i) { const id = queue[i]; if (id) await addTrackToActivePlaylist(id); }   // refill comes via onSetChange
function drop(i) { const id = queue[i]; if (id) { rejected.add(id); rebuild(); } }

function setDial(key, value) {
  state[key] = key === 'shape' ? value : +value;
  try { localStorage.setItem('upnext-' + key, String(state[key])); } catch (_) {}
  rebuild();
}

let _t = 0;
window.onSetChange = () => { clearTimeout(_t); _t = setTimeout(rebuild, 150); };
window.upNextTake = async () => { if (!queue.length) rebuild(); return queue[0] || null; };

{   // modules run after the page is parsed, so the markup is already here
  const list = document.getElementById('un-list');
  list.addEventListener('click', e => {
    const b = e.target.closest('button'), row = e.target.closest('.un-row');
    if (b?.classList.contains('un-keep')) return keep(+b.dataset.i);
    if (b?.classList.contains('un-drop')) return drop(+b.dataset.i);
    if (row) audioPlayById(queue[+row.dataset.i]);
  });
  list.addEventListener('dblclick', e => { const row = e.target.closest('.un-row'); if (row && !e.target.closest('button')) keep(+row.dataset.i); });
  document.getElementById('un-roam').value = state.roam;
  document.getElementById('un-keyd').value = state.keyd;
}

Object.assign(window, { upNextSetDial: setDial });
