// Set tools: the vector maths as one-click buttons (Mark, 26 Oct: "simplified into single click
// buttons"), grouped by what they act on. The engine is the pilot's (vecKNN, vecArith,
// vecPathFind, vecPathStats, PCA/t-SNE/k-means — all in field.js); the advanced ⋈ panel with
// free-form arithmetic, weights and counts stays in Settings.
import { catalog, activePlaylist, activePlaylistSlug, vecMatrix, vecDist2, vecKNN, vecArith, vecParseArith,
         vecPathFind, vecPathStats, addTrackToActivePlaylist, esc, showToast } from './field.js';

const $ = id => document.getElementById(id);
const OUTS = ['tools-out', 'vm-sim-out', 'vm-clusters-out', 'vm-sb-out'];
let lastIds = [];

function show(html, outId = 'tools-out') {
  for (const id of OUTS) if ($(id)) $(id).innerHTML = '';
  $(outId).innerHTML = html;
}
const note = msg => show(`<div class="vm-empty">${msg}</div>`);
const selected = () => window.vmCurrentTrack();
const setIds = () => (activePlaylist?.tracks || []).map(t => t.track_id);
const name = id => esc(window.vmName(id));

function hitList(title, ids, addLabel = '＋ Add all to the set') {
  lastIds = ids;
  show(`<div class="vm-note">${title}</div>`
    + ids.map((id, i) => `<div class="vm-hit" onclick="vmPreview('${id}')" title="Click to preview">
        <span class="vm-rank">${i + 1}</span><span class="vm-title">${name(id)}</span></div>`).join('')
    + (ids.length ? `<button class="btn-sm vm-add" onclick="toolsAddAll()">${addLabel}</button>` : ''));
}
async function addAll() {
  const inSet = new Set(setIds());
  let n = 0;
  for (const id of lastIds) if (!inSet.has(id) && await addTrackToActivePlaylist(id)) n++;
  showToast(n ? `Added ${n} track${n === 1 ? '' : 's'} to the set` : 'Already in the set');
}
function needTrack() {
  const t = selected();
  if (!t) note('Select a track first: click one in the Field.');
  return t;
}
function needSet(min) {
  const ids = setIds();
  if (ids.length < min) note(`Needs a set with at least ${min} tracks.`);
  return ids.length >= min ? ids : null;
}
const notInSet = ids => { const s = new Set(setIds()); return ids.filter(id => !s.has(id)); };

// ── This track ──────────────────────────────────────────────────────────────
function moreLikeThis() {
  const t = needTrack(); if (!t) return;
  hitList(`Nearest to <b>${name(t.id)}</b>`, notInSet(vecKNN(t.id, 15).map(h => h.id)).slice(0, 10));
}
async function bridgeToHere() {
  const t = needTrack(); if (!t) return;
  const from = setIds().at(-1);
  if (!from) return note('Add a track to the set first: the bridge runs from its last track.');
  if (from === t.id) return note('Select a different track: this one already ends the set.');
  show('<div class="vm-note">Finding the route…</div>');
  const r = await vecPathFind(from, t.id, 12);
  if (!r) return note('No route between those two in this Field.');
  hitList(`From <b>${name(from)}</b> to <b>${name(t.id)}</b>, ${r.ids.length - 1} steps`, notInSet(r.ids.slice(1)), '＋ Add the route to the set');
}
const NUDGES = { lessvocal: ['-voc', 'less vocal'], energy: ['+ene', 'more energy'], darker: ['-bri', 'darker'], brighter: ['+bri', 'brighter'] };
function nudge(kind) {
  const t = needTrack(); if (!t) return;
  const [terms, label] = NUDGES[kind];
  hitList(`Like <b>${name(t.id)}</b>, but ${label}`, notInSet(vecArith(t.id, vecParseArith(terms), 12).hits.map(h => h.id)).slice(0, 8));
}
function distanceAxis() {
  const t = needTrack(); if (!t) return;
  window.vmFindSimilar();   // publishes "distance from this track" as the simdist axis metric
  const x = $('nx-axis');
  if (x && [...x.options].some(o => o.value === 'simdist')) { x.value = 'simdist'; x.dispatchEvent(new Event('change', { bubbles: true })); }
  show(`<div class="vm-note">X axis now runs from <b>${name(t.id)}</b> outward: nearest on the left. Reset view puts it back.</div>`);
}

// ── This set ────────────────────────────────────────────────────────────────
function moreLikeThisSet() {
  const ids = needSet(2); if (!ids) return;
  const M = vecMatrix(), rows = ids.map(id => M.idx.get(id)).filter(i => i !== undefined);
  if (!rows.length) return note('None of the set is in this Field.');
  const c = new Float64Array(M.d);
  for (const r of rows) for (let j = 0; j < M.d; j++) c[j] += M.mat[r * M.d + j] / rows.length;
  const inSet = new Set(ids), hits = [];
  for (let i = 0; i < M.n; i++) {
    if (inSet.has(M.ids[i])) continue;
    let s = 0; for (let j = 0; j < M.d; j++) { const dv = c[j] - M.mat[i * M.d + j]; s += dv * dv; }
    hits.push({ id: M.ids[i], s });
  }
  hits.sort((a, b) => a.s - b.s);
  hitList('Closest to the set as a whole', hits.slice(0, 10).map(h => h.id));
}
function smoothOrder() { if (needSet(3)) { show(''); window.plReorderSmooth(activePlaylistSlug); } }
function checkFlow() { if (needSet(2)) { show(''); window.vmSetArcFor(activePlaylistSlug); } }
async function fixWorstJump() {
  const ids = needSet(2); if (!ids) return;
  const s = vecPathStats(ids);
  if (!s) return note('The set isn’t in this Field.');
  const a = ids[s.worstAt], b = ids[s.worstAt + 1];
  show('<div class="vm-note">Looking for a stepping stone…</div>');
  const r = await vecPathFind(a, b, 12);
  const mids = r ? notInSet(r.ids.slice(1, -1)) : [];
  if (!mids.length) return note(`The roughest step is ${s.worstAt + 1} → ${s.worstAt + 2}, and nothing in this Field sits between them.`);
  const pickId = mids[Math.floor(mids.length / 2)];
  lastIds = [pickId];
  show(`<div class="vm-note">Roughest step: <b>${name(a)}</b> → <b>${name(b)}</b> (${s.worstAt + 1} → ${s.worstAt + 2}).</div>
    <div class="vm-hit" onclick="vmPreview('${pickId}')"><span class="vm-rank">＋</span><span class="vm-title">${name(pickId)}</span></div>
    <button class="btn-sm vm-add" onclick="toolsInsert('${pickId}', ${s.worstAt + 1})">Insert it between them</button>`);
}
async function insertAt(id, at) { if (await addTrackToActivePlaylist(id, undefined, at)) showToast('Inserted'); }
function oddOneOut() {
  const ids = needSet(3); if (!ids) return;
  const M = vecMatrix(), rows = ids.map(id => [id, M.idx.get(id)]).filter(([, i]) => i !== undefined);
  let worst = null, worstD = -1;
  for (const [id, i] of rows) {
    let sum = 0; for (const [, j] of rows) if (j !== i) sum += Math.sqrt(vecDist2(M, i, j));
    const mean = sum / (rows.length - 1);
    if (mean > worstD) { worstD = mean; worst = id; }
  }
  const at = ids.indexOf(worst);
  show(`<div class="vm-note">Sits furthest from the rest of the set:</div>
    <div class="vm-hit" onclick="vmPreview('${worst}')"><span class="vm-rank">${at + 1}</span><span class="vm-title">${name(worst)}</span></div>
    <button class="btn-sm vm-add" onclick="removeTrackAt(${at}); toolsNote('Removed. Undo brings it back.')">Remove it from the set</button>`);
}
function buildSet() {
  if (!needTrack()) return;
  window.sbMarkStart();
  show('', 'vm-sb-out');
  window.sbGenerate();   // 20 tracks from the selected one, shaped by energy; preview offers Save
}

// ── The Field ───────────────────────────────────────────────────────────────
function arrangeBySound() { window.vmRunPCA(); window.vmApplyPCAAxes(); show('<div class="vm-note">The Field is laid out by overall sound. Reset view puts the axes back.</div>'); }
async function mapBySimilarity() {
  show('<div class="vm-note">Mapping by similarity… (a few seconds on a big Field)</div>');
  await window.vmRunTSNE();
  window.vmApplyTSNEAxes();
  show('<div class="vm-note">Similar tracks now sit together. Reset view puts the axes back.</div>');
}
function groupBySound() { show('', 'vm-clusters-out'); window.vmRunClusters(true); }
function resetView() { window.vmResetView(); show(''); }

// ── Library ─────────────────────────────────────────────────────────────────
function nearDuplicates() {
  const M = vecMatrix(), pairs = [];
  const LIMIT = 0.15;   // shortcut: fixed distance threshold; tune once real libraries report back
  for (let i = 0; i < M.n; i++) for (let j = i + 1; j < M.n; j++) {
    const d = vecDist2(M, i, j);
    if (d < LIMIT * LIMIT) pairs.push([M.ids[i], M.ids[j], Math.sqrt(d)]);
  }
  pairs.sort((a, b) => a[2] - b[2]);
  show(pairs.length
    ? `<div class="vm-note">${pairs.length} pair${pairs.length === 1 ? '' : 's'} that sound almost identical${pairs.length > 30 ? ' (closest 30)' : ''}:</div>`
      + pairs.slice(0, 30).map(([a, b]) => `<div class="vm-pair"><span onclick="vmPreview('${a}')">${name(a)}</span><span onclick="vmPreview('${b}')">${name(b)}</span></div>`).join('')
    : '<div class="vm-empty">No near-duplicates in this Field.</div>');
}

function openTools() { $('settools-box').classList.add('open'); }
function closeTools() { $('settools-box').classList.remove('open'); }

Object.assign(window, {
  openSetToolsBox: openTools, closeSetToolsBox: closeTools, toolsAddAll: addAll, toolsInsert: insertAt, toolsNote: note,
  tMoreLike: moreLikeThis, tBridge: bridgeToHere, tNudge: nudge, tDistAxis: distanceAxis,
  tMoreLikeSet: moreLikeThisSet, tSmooth: smoothOrder, tFlow: checkFlow, tFixJump: fixWorstJump, tOddOne: oddOneOut, tBuild: buildSet,
  tArrange: arrangeBySound, tMap: mapBySimilarity, tGroup: groupBySound, tReset: resetView, tDupes: nearDuplicates,
});
