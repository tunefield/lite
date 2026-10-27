// Analyse tab: add a folder, analyse everything new in it, show it unmissably.
// The queue, pump and resume logic is the pilot's (index.html @ 7c8c0e7), copied verbatim
// with the size cap removed; "// pilot N" marks each source line. The UI layer at the
// bottom is Lite's own.
// Modules talk through window.name?.() (as the pilot's inline handlers do); only the
// owning module assigns its own state.
import { catalog, activeCatalog, allCatalogs, loadCatalogMeta, esc, showToast } from './field.js';

// pilot 6555, 6599 — moved here from the Field: this module owns the music folders.
let libRoots = [];
let libRootsFailed = false;
let _anAlready = 0;   // already in this Field, per the server
let _anKnown = 0;     // already in this Field, filtered out before sending

// pilot 6556
let libScanResults = null;
// pilot 6564
let APP_STALE = false;   // sticky: this condition lasts until the app is restarted
// pilot 6565
const SKEW_MSG = 'This page is newer than the program that\u2019s running. '
               + 'Quit Tunefield and start it again.';
// pilot 6578
async function apiJson(url, opts) {
  let r;
  try { r = await fetch(url, opts); }
  catch (_) { return { fail: 'offline', message: 'Tunefield isn\u2019t responding. Is it still running?' }; }
  let d = null;
  try { d = await r.json(); } catch (_) { /* not JSON — fall through on status alone */ }
  if (!r.ok) {
    if (d && d.stale_client) { APP_STALE = true; return { fail: 'stale', message: SKEW_MSG, status: r.status }; }
    return { fail: 'api', status: r.status,
             message: (d && d.error) || ('The app returned an error (' + r.status + ').') };
  }
  return { ok: true, data: d };
}
// pilot 6600
async function libRootsLoad() {
  // The old form assigned the parsed body straight in. On any error that body is
  // {error, code} — an object, so renderLibRoots' `!libRoots.length` is `!undefined`,
  // true, and the panel announces "No music folders yet". Nothing was lost; the app
  // just told the user their entire library configuration had vanished. Always end up
  // with an ARRAY, and remember that we failed so the empty state can say which it is.
  const r = await apiJson('/library/roots');
  libRootsFailed = !r.ok;
  libRoots = (r.ok && Array.isArray(r.data)) ? r.data : [];
  if (r.fail) showToast('Could not read your music folders \u2014 ' + r.message);
  renderLibRoots();
}
// pilot 6749
async function libRootAdd() {
  const inp  = document.getElementById('lib-root-input');
  const addBtn = document.getElementById('lib-add-btn');
  const path = (inp.value || '').trim();
  // Empty path + at least one existing root → treat the CTA as a rescan of every root.
  // Empty path + zero roots → focus the input so the user knows to enter something.
  if (!path) {
    if ((libRoots || []).length) { await libScan(); return; }
    inp.focus(); return;
  }
  // Lock the button + show inline progress while we hit the server.
  if (addBtn) addBtn.classList.add('scanning');
  setInlineScan(true, 'Adding folder…');
  try {
    const res = await fetch('/library/roots', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      // New folders are assigned to the current destination Field.
      body: JSON.stringify({ path, cat: _analyseTargetCat() || null })
    });
    const j = await res.json();
    if (j.error) { setInlineScan(false); showToast(j.error); return; }
    // Re-add of an existing root → behave as "look for new files only". Force the
    // Hide-already-analysed filter on so the user sees just the diff against their library.
    if (j.already) {
      const newOnly = document.getElementById('lib-filter-new');
      if (newOnly && !newOnly.checked) newOnly.checked = true;
      setInlineScan(true, 'Already a music folder — checking for new files…');
      showToast('Already a music folder — scanning for new files only');
    }
    inp.value = '';
    await libRootsLoad();
    await libScan();
    // After the scan, surface how many new files were found from the re-add.
    if (j.already && libScanResults) {
      const n = libScanResults.new || 0;
      showToast(n ? `${n} new file${n===1?'':'s'} found in ${path.split('/').pop() || path}` : 'No new files since last scan');
      // Scroll the results into view so the user sees what's been discovered.
      document.getElementById('lib-scan-results')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }
  } catch (e) {
    // Network / server error — clear the "Adding folder…" strip (it would otherwise hang
    // forever) and surface the failure instead of leaving the user staring at a spinner.
    setInlineScan(false);
    showToast('Could not add folder: ' + (e.message || e));
  } finally {
    if (addBtn) addBtn.classList.remove('scanning');
  }
}
// pilot 6810
async function libRootBrowse() {
  try {
    const res = await fetch('/library/browse', { method:'POST' });
    const j = await res.json();
    if (j.cancelled) return;
    if (j.error) { showToast(j.error); return; }
    if (j.path) document.getElementById('lib-root-input').value = j.path;
  } catch (e) { showToast('Browse failed: ' + e.message); }
}
// pilot 6820
async function libRootRemove(path) {
  if (!confirm(`Remove this music folder?\n\n${path}\n\n(Does not delete any audio files.)`)) return;
  // A folder assigned to ONE Field: offer to take its tracks out of that Field too.
  // Otherwise they linger invisibly — gone from the folder list, still "in" the Field,
  // and the scan keeps refusing them for every other Field (Mark, 2026-08-22).
  // Shared folders (no Field) get no offer: there is no single Field to purge.
  const root = (libRoots || []).find(r => r.path === path);
  const slug = root && root.cat;
  let purge = false, count = 0;
  if (slug) {
    try {
      const c = await fetch(`/library/roots/entries?path=${encodeURIComponent(path)}&cat=${encodeURIComponent(slug)}`).then(r => r.ok ? r.json() : null);
      count = (c && c.count) || 0;
    } catch (_) {}
    if (count) {
      const name = (allCatalogs || []).find(c => c.slug === slug)?.name || slug;
      purge = confirm(`${count} track${count === 1 ? '' : 's'} from this folder ${count === 1 ? 'is' : 'are'} analysed into "${name}".\n\n`
        + `OK — also remove ${count === 1 ? 'it' : 'them'} from "${name}" (audio files untouched; undoable)\n`
        + `Cancel — keep ${count === 1 ? 'it' : 'them'} in "${name}", just remove the folder`);
    }
  }
  let j = null;
  try {
    const q = `/library/roots?path=${encodeURIComponent(path)}` + (purge ? `&cat=${encodeURIComponent(slug)}&purge=1` : '');
    const r = await fetch(q, { method:'DELETE' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    j = await r.json();
  } catch (e) {
    return showToast('Could not remove folder: ' + (e.message || e));
  }
  await libRootsLoad();
  if (j && j.purged) {
    const msg = `Folder removed · ${j.purged} track${j.purged === 1 ? '' : 's'} removed from the Field (audio kept)`;
    if (j.undoable) showEntriesUndoToast(msg); else showToast(msg);
    if (typeof loadCatalogMeta === 'function') loadCatalogMeta();
  }
  libScan();
}
// pilot 6859
async function libScan() {
  const btn    = document.getElementById('lib-scan-btn');
  const addBtn = document.getElementById('lib-add-btn');
  if (btn) { btn.disabled = true; btn.textContent = '🔍 Scanning…'; }
  if (addBtn) addBtn.classList.add('scanning');
  document.getElementById('lib-scan-status').textContent = 'Walking folders…';
  setInlineScan(true, 'Walking folders…');
  try {
    // Scan the DESTINATION Field's folders (+ shared ones) — the step-1 selector is
    // the single source of scope here since 2026-08-24 (Mark: the chip row made this
    // page swing between "no folders shown" and "walk all 14k files"). Deepest-folder
    // attribution happens server-side, so nested master/sub folders never double-list.
    const _dest = _analyseTargetCat();
    const _sc = await apiJson('/library/scan?cats=' + encodeURIComponent(_dest || ''));
    // Without this check the error body flows into the template below and the user reads
    // "undefined files · undefined new" — which looks like a crash and says nothing.
    // libScanResults must also be nulled, or libRootAdd reports its stale count as fact.
    if (_sc.fail) { libScanResults = null; throw new Error(_sc.message); }
    libScanResults = _sc.data;
    const summary = `${libScanResults.total} file${libScanResults.total !== 1 ? 's' : ''} · ${libScanResults.new} new`;
    document.getElementById('lib-scan-status').textContent = summary;
    setInlineScan(true, summary);
    renderLibScan();
    // Auto-hide the inline strip after a short pause so the user sees the result
    setTimeout(() => setInlineScan(false), 1400);
  } catch (e) {
    document.getElementById('lib-scan-status').textContent = 'Scan failed: ' + e.message;
    setInlineScan(true, 'Scan failed: ' + (e.message || 'error'));
    setTimeout(() => setInlineScan(false), 2200);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan now'; }
    if (addBtn) addBtn.classList.remove('scanning');
  }
}
// pilot 6983
async function libAnalyseAllNew() {
  const target = _analyseTargetCat();
  const all = libScanResults.files
    .filter(f => !(f.catalog_slugs && f.catalog_slugs.includes(target)))
    .map(f => f.path);
  const paths = all;
  if (!paths.length) { anNothingNew(libScanResults.files.length); return; }
  await libAnalyseBatch(paths);
}
// pilot 7013
function uiForegroundBusy() {
  return document.body.classList.contains('on-tab-neural')
      || document.body.classList.contains('on-tab-catalog');
}
// pilot 7017
const BG_THROTTLE_MS = 400;         // pause between chunks while Field/List is up
// pilot 7018
const BG_ANALYSE_WORKERS = 2;       // librosa threads to request then (server default: 4)
// pilot 7019
function bgBreather() {
  return uiForegroundBusy() ? new Promise(r => setTimeout(r, BG_THROTTLE_MS)) : Promise.resolve();
}
// pilot 7023
let _anQueue = [], _anQueued = new Set();
// pilot 7024
let _anInFlightSlice = [];   // the chunk currently at the server — persisted alongside _anQueue
// pilot 7025
let _anActive = false, _anDone = 0, _anAdded = 0, _anCopied = 0, _anErrors = 0, _anErrList = [];
// pilot 7026
let _anStartT = 0, _anSpTok = 0, _anInFlight = 0;
// pilot 7027
let _anAborted = null;   // reason a run stopped early, so the summary can never claim success
// pilot 7028
let _anResumePending = null;   // boot found an interrupted run's queue file — records to offer
// pilot 7029
let _anPersistWarned = false;  // one warning per page load — persistence stays fire-and-forget
// pilot 7034
function _anPersist(pendingExtra) {
  // While a dismissed boot-time resume offer is alive (_anResumePending), merge its
  // records into every write — a NEW run's first persist would otherwise overwrite
  // the file and destroy the interrupted run's only surviving copy.
  const live = (pendingExtra || []).concat(_anInFlightSlice, _anQueue);
  const seen = new Set(live.map(r => r.path));
  const pending = live
    .concat((_anResumePending || []).filter(r => !seen.has(r.path)))
    .map(({ path, cat, duration }) => ({ path, cat, duration }));
  const warn = () => {
    if (_anPersistWarned) return;
    _anPersistWarned = true;
    showToast('Resume protection unavailable for this run — an interrupted scan won’t be resumable');
  };
  fetch('/library/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending }),
  }).then(res => { if (!res.ok) warn(); }).catch(warn);
}
// pilot 7057
let _scanDur = (() => { const v = parseFloat(localStorage.getItem('scan-duration')); return (v > 0 && v <= 1) ? v : 0.5; })();
// pilot 7064
function scanDur() { return _scanDur; }
// pilot 7066
async function libAnalyseBatch(paths) {
  const cat = _analyseTargetCat();
  // Scan length is a FRACTION of the track since 2026-08-26.
  const dur = scanDur();
  // _anQueued is the "already queued or in flight" guard, and it is only trustworthy
  // while a run is live. With nothing running, a path in the set but in neither _anQueue
  // nor the in-flight slice is an ORPHAN — left behind by a run that threw before its
  // loop, or a page whose run never reached its finally — and treating it as "already
  // queued" made every later click send nothing and say nothing (Mark, 2026-09-02:
  // two new tracks, no toast, no request, no joy).
  if (!_anActive) {
    const live = new Set(_anQueue.map(s => s.path).concat(_anInFlightSlice.map(s => s.path)));
    for (const p of [..._anQueued]) if (!live.has(p)) _anQueued.delete(p);
  }
  let queued = 0;
  for (const p of paths) {
    if (_anQueued.has(p)) continue;   // already queued or currently in flight
    _anQueued.add(p);
    _anQueue.push({ path: p, cat, duration: dur });
    queued++;
  }
  if (queued) _anPersist();   // mid-run additions must reach the resume file too
  if (_anActive) {
    if (queued) {
      showToast(`${queued} file${queued === 1 ? '' : 's'} added to the analysis queue`, { subtle: true });
      _anUpdateBar();
    } else {
      showToast('Those files are already in the queue', { subtle: true });
    }
    return;
  }
  if (!_anQueue.length) { showToast('Nothing to analyse \u2014 those files are already queued'); return; }
  await _anPump();
}
// pilot 7111
function _anTotal() { return _anDone + _anInFlight + _anQueue.length; }
// pilot 7117
const _AN_WIN = 40;                 // chunks to average over
// pilot 7118
let _anWin = [], _anLastT = 0, _anLastDone = 0;
// pilot 7119
function _anRate() {
  const now = performance.now();
  if (_anLastT && _anDone > _anLastDone) {
    _anWin.push({ dt: (now - _anLastT) / 1000, n: _anDone - _anLastDone });
    if (_anWin.length > _AN_WIN) _anWin.shift();
  }
  _anLastT = now; _anLastDone = _anDone;
  const dt = _anWin.reduce((a, w) => a + w.dt, 0);
  const n  = _anWin.reduce((a, w) => a + w.n, 0);
  if (n >= 3) return dt / n;                                   // windowed
  const el = (performance.now() - _anStartT) / 1000;            // fall back early on
  return _anDone > 0 ? el / _anDone : 0;
}
// pilot 7149
async function _anPump() {
  _anActive = true;
  _anDone = 0; _anAdded = 0; _anAlready = 0; _anCopied = 0; _anErrors = 0; _anErrList = [];
  _anStartT = performance.now();
  _anWin = []; _anLastT = 0; _anLastDone = 0;   // fresh rolling window per run
  _anAborted = null;
  // Function scope on purpose: the `finally` below writes the end-of-run summary and the
  // failure-details list through it. It lived inside the pre-loop try for two days
  // (639f06a), where the finally's reads silently resolved to the global `window.status`
  // — a string — so every run ended with no summary line and no failure list.
  const status = document.getElementById('lib-scan-status');
  // Everything up to the loop runs OUTSIDE the loop's try/finally. A throw here used to
  // leave _anActive stuck true with the files parked in _anQueued, so every later click
  // was answered with a subtle "already in the queue" and no request (2026-09-02).
  try {
    _anSpTok = startScanProgress(`Analysing ${_anQueue.length} tracks…`, 1);   // width driven by time below
  } catch (e) {
    _anActive = false;
    _anQueue.forEach(s => _anQueued.delete(s.path)); _anQueue = [];
    console.error('[analyse] could not start', e);
    showToast('Analyse could not start \u2014 ' + (e?.message || e));
    return;
  }
  const CHUNK = 5;
  try {
    while (_anQueue.length) {
      if (isScanCancelled(_anSpTok)) break;
      // Take a chunk sharing the head's destination + scan length.
      const head = _anQueue[0];
      const slice = [];
      while (slice.length < CHUNK && _anQueue.length &&
             _anQueue[0].cat === head.cat && _anQueue[0].duration === head.duration) {
        slice.push(_anQueue.shift());
      }
      _anInFlight = slice.length;   // keep in-flight files inside the visible total
      _anInFlightSlice = slice;     // _anPersist folds this in on every write
      // Persist BEFORE the fetch so a crash mid-chunk re-queues the in-flight files —
      // the server's "already cataloged" pre-flight absorbs any that did land.
      _anPersist();
      try {
        const res = await fetch('/library/analyse', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ paths: slice.map(s => s.path), duration: head.duration, cat: head.cat,
                                 workers: uiForegroundBusy() ? BG_ANALYSE_WORKERS : 0 }),
          signal: scanSignal(_anSpTok),
        });
        const j = await res.json().catch(() => null);
        // res.ok was never checked here. Because app.py answers every error as JSON, a
        // failed chunk parsed fine: added_count and error_count came back undefined (→ 0),
        // j.errors wasn't an array, _anDone still advanced, and the run drained the whole
        // queue at error speed and announced "0 added, 0 errors" — a completed-looking
        // scan that did nothing. The live trigger is deleting the target Field mid-run:
        // the destination slug is frozen per queued file, so every remaining chunk 404s.
        if (!res.ok) {
          const why = (j && j.error) || ('the app returned an error (' + res.status + ')');
          _anErrors += slice.length;
          _anErrList.push(...slice.map(s2 => ({ path: s2.path, error: why })));
          _anDone += slice.length;
          _anInFlight = 0;
          _anInFlightSlice = [];
          slice.forEach(s2 => _anQueued.delete(s2.path));
          _anAborted = why;      // stop: the next chunk will fail the same way
          break;
        }
        _anAdded  += j.added_count || 0;
        _anAlready += j.already_count || 0;
        _anCopied += j.copied_count || 0;
        _anErrors += j.error_count || 0;
        if (Array.isArray(j.errors)) _anErrList.push(...j.errors);
      } catch (e) {
        if (e?.name === 'AbortError') break;
        // A network failure is almost always TRANSIENT (server restart, laptop slept) —
        // fail-fast-draining the rest of the queue would turn one blip into thousands
        // of instant errors AND wipe the resume file at the end. Record this slice,
        // then stop; the finally persists the remainder so boot can offer to resume.
        _anErrors += slice.length;
        _anErrList.push(...slice.map(s => ({ path: s.path, error: 'request failed — server unreachable?' })));
        _anDone += slice.length;
        _anInFlight = 0;
        _anInFlightSlice = [];
        slice.forEach(s => _anQueued.delete(s.path));
        _anAborted = 'request failed — server unreachable?';
        break;
      }
      _anDone += slice.length;
      _anInFlight = 0;
      _anInFlightSlice = [];
      slice.forEach(s => _anQueued.delete(s.path));
      _anUpdateBar();
      // Field/List up → let the UI breathe between chunks (no-op elsewhere; read live,
      // so switching tabs mid-run changes the pace immediately).
      await bgBreather();
    }
  } finally {
    const wasCancelled = isScanCancelled(_anSpTok);
    _anInFlight = 0;
    _anInFlightSlice = [];
    if (_anAborted && !wasCancelled && _anQueue.length) {
      // Aborted with work still queued (server unreachable, Field deleted mid-run):
      // keep the remainder ON DISK so the boot path can offer to resume it, THEN drop
      // it from memory like any other stopped run.
      _anPersist();
      _anQueue.forEach(s => _anQueued.delete(s.path));
      _anQueue = [];
    } else {
      if (wasCancelled || _anQueue.length) {   // cancelled → drop whatever was still queued
        _anQueue.forEach(s => _anQueued.delete(s.path));
        _anQueue = [];
      }
      // Done or cancelled — nothing of THIS run to resume. A still-dismissed boot
      // offer (_anResumePending) survives: _anPersist merges its records into every
      // write, so the file only truly empties once that offer is consumed or gone.
      _anPersist([]);
    }
    endScanProgress(_anSpTok);
    _anActive = false;
    // "0 added, 2 errors" with no reason is a riddle the errors list can answer. Name the
    // dominant reason in the toast so nobody is left guessing (2026-09-02).
    const _why = (() => {
      if (!_anErrList.length) return '';
      const n = new Map();
      for (const e of _anErrList) { const k = String(e.error || 'unknown').slice(0, 60); n.set(k, (n.get(k) || 0) + 1); }
      const [k, c] = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
      return ` \u2014 ${c === _anErrList.length ? 'all' : c}: ${k}`;
    })();
    showToast(wasCancelled
      ? `Analyse cancelled: ${_anAdded} added so far`
      : _anAborted
        ? `Analyse stopped \u2014 ${_anAborted}`
        : `Analysis finished: ${anSummary()}`);
    // Rescan FIRST — libScan rewrites the status line, so the final summary and the
    // failure-details list must be written after it or they'd be wiped instantly.
    await libScan();
    await loadCatalogMeta();
    window.updateTabCounts?.();
    if (status) status.textContent = wasCancelled
      ? `Cancelled · ${anSummary()}`
      : _anAborted
        ? `Stopped (${_anAborted}) · ${anSummary()}`
        : anSummary();
    // WHICH files failed and WHY — a bare count is unactionable feedback material.
    if (_anErrList.length && status) {
      const det = document.createElement('details');
      det.style.cssText = 'margin-top:6px;font-size:11px;color:var(--muted)';
      det.innerHTML = `<summary style="cursor:pointer">${_anErrList.length} file${_anErrList.length === 1 ? '' : 's'} couldn’t be read — details</summary>` +
        _anErrList.slice(0, 60).map(e =>
          `<div style="padding:2px 0 2px 12px" title="${esc(e.path || '')}">${esc((e.path || '').split('/').pop())} — ${esc(e.error || 'unknown error')}</div>`).join('') +
        (_anErrList.length > 60 ? `<div style="padding:2px 0 2px 12px">…and ${_anErrList.length - 60} more (see console)</div>` : '');
      status.appendChild(det);
      console.log('Analyse failures:', _anErrList);
    }
    anRunEnded(wasCancelled);
  }
}
// pilot 7379
async function resumeAnalysisQueue() {
  _anKnown = 0;
  const recs = _anResumePending || [];
  _anResumePending = null;
  if (!recs.length) return;
  // CLAIM the queue before starting: clear the server file so a second window's
  // boot offer can't resume the same run in parallel (both would append every
  // track — mass duplication). The records live on in `recs`; the first chunk's
  // _anPersist re-persists whatever is still pending. Best-effort by design.
  try {
    await fetch('/library/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending: [] }),
    });
  } catch (_) {}
  window.switchTab?.('analyse');
  for (const rec of recs) {
    if (_anQueued.has(rec.path)) continue;
    _anQueued.add(rec.path);
    _anQueue.push({ path: rec.path, cat: rec.cat, duration: rec.duration });
  }
  if (_anActive) { _anPersist(); _anUpdateBar(); return; }
  if (!_anQueue.length) return;
  await _anPump();
}
// pilot 20908
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  // Hour-long mixes render 1:15:30 (matching formatDuration) instead of 75:30.
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2,'0')}:${s.toString().padStart(2,'0')}`
           : `${m}:${s.toString().padStart(2,'0')}`;
}
// ── Lite UI ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
let _anState = 'idle';   // idle | scanning | running | done

// Lite adds to the Field you're on — the pilot's separate destination picker is gone.
function _analyseTargetCat() { return activeCatalog || ''; }
// shortcut: folder removal still snapshots server-side, but there's no undo button yet; add one with the Repair tab.
function showEntriesUndoToast(msg) { showToast(msg); }
function renderLibScan() {}   // Lite analyses straight after the scan — nothing to tick

function anShow(state, head) {
  _anState = state;
  $('an-progress').hidden = state === 'idle';
  $('an-progress').dataset.state = state;
  $('an-cancel').hidden = state !== 'running';
  $('an-open').hidden = state !== 'done';
  $('an-resume').hidden = $('an-dismiss').hidden = state !== 'resume';
  $('lib-add-btn').disabled = state === 'scanning';
  // Scanning, or analysing before the first chunk lands, shows a moving band — never a stalled bar.
  $('an-progress').classList.toggle('waiting', state === 'scanning');
  if (state === 'scanning') { $('an-fill').style.width = ''; $('an-eta').textContent = ''; $('lib-scan-status').textContent = ''; }
  if (state === 'done') { $('an-fill').style.width = '100%'; $('an-eta').textContent = ''; }
  if (head !== undefined) $('an-head').textContent = head;
}
// The pilot's inline scan strip — in Lite it only narrates the scanning phase.
function setInlineScan(on, status) {
  if (_anState === 'scanning' && on && status) $('an-head').textContent = status;
}

function anSummary() {
  const n = (v, one, many) => `${v.toLocaleString()} ${v === 1 ? one : many}`;
  return [n(_anAdded, 'track added', 'tracks added'),
          (_anAlready + _anKnown) ? `${(_anAlready + _anKnown).toLocaleString()} already in this Field` : '',
          _anErrors ? `${n(_anErrors, 'file', 'files')} couldn’t be read` : ''].filter(Boolean).join(' · ');
}
function fmtEta(s) {
  if (s < 60) return 'less than a minute';
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// pilot 7132 (rewritten for the Lite surface) — same time-weighted fill and windowed rate.
function _anUpdateBar() {
  const elapsed = (performance.now() - _anStartT) / 1000;
  const per  = _anRate();
  const etaS = per > 0 ? Math.round(per * _anQueue.length) : 0;
  const frac = (_anDone > 0 && elapsed + etaS > 0) ? elapsed / (elapsed + etaS) : 0;
  anShow('running', `Analysing ${_anDone.toLocaleString()} of ${_anTotal().toLocaleString()}`);
  $('an-progress').classList.remove('waiting');
  $('an-fill').style.width = (Math.max(0.02, frac) * 100).toFixed(1) + '%';
  $('an-eta').textContent = etaS <= 0 ? '' : etaS < 60 ? 'less than a minute left' : `about ${fmtEta(etaS)} left`;
  $('lib-scan-status').textContent = anSummary();
}

// The pilot tracked two task owners (analyse, repair); Lite's Analyse tab has one.
let _scan = { tok: null, abort: null, cancelled: false };
function startScanProgress(label) {
  if (_scan.tok) _scan.tok.superseded = true;   // a superseded loop must not drive its successor
  try { _scan.abort?.abort(); } catch (_) {}
  const abort = new AbortController();
  _scan = { tok: { abort }, abort, cancelled: false };
  anShow('running', label);
  $('an-progress').classList.add('waiting');
  $('an-eta').textContent = 'starting up · the first few tracks take longest';
  return _scan.tok;
}
function endScanProgress(tok) { if (tok && tok === _scan.tok) _scan.abort = null; }
function cancelScan() {
  if (!_scan.abort) return;
  _scan.cancelled = true; _scan.tok.superseded = true;
  try { _scan.abort.abort(); } catch (_) {}
}
function scanSignal(tok)      { return tok?.abort?.signal; }
function isScanCancelled(tok) { return !!tok?.superseded || (tok === _scan.tok && _scan.cancelled); }

function anRunEnded(cancelled) {
  anShow('done', (cancelled || _anAborted) ? 'Stopped' : 'Done');
  renderLibRoots();
}
// pilot 7344 (rewritten): offer an interrupted run back in the Analyse panel, not a toast.
// Records whose Field was deleted are dropped; Not now keeps the file for next launch.
function offerAnalysisResume(pending) {
  const known = new Set((allCatalogs || []).map(c => c.slug));
  const usable = pending.filter(p => p && typeof p.path === 'string' && known.has(p.cat));
  if (!usable.length) return false;
  _anResumePending = usable;
  anShow('resume', 'Analysis was interrupted');
  $('lib-scan-status').textContent = `${usable.length.toLocaleString()} ${usable.length === 1 ? 'file' : 'files'} still to go.`;
  return true;
}
function anResumeDismiss() { anShow('idle'); }

function anNothingNew(total) {
  anShow('done', 'Nothing new');
  $('lib-scan-status').textContent = total
    ? `All ${total.toLocaleString()} files here are already in this Field.`
    : 'No music files found in that folder.';
}

// One action: pick a folder (or take a pasted path), add it, analyse everything new.
async function addMusic(fromInput) {
  const inp = $('lib-root-input');
  if (!fromInput) {
    try {
      const j = await (await fetch('/library/browse', { method: 'POST' })).json();
      if (j.cancelled) return;
      if (j.error) { showToast(j.error); return; }
      inp.value = j.path || '';
    } catch (e) { showToast('Could not open the folder picker: ' + e.message); return; }
  }
  if (!inp.value.trim()) { inp.focus(); return; }
  anShow('scanning', 'Looking through your folder…');
  await libRootAdd();
  await anAnalyseScanned();
}
// Re-walk every folder of this Field and analyse what's new since last time.
async function checkForNew() {
  anShow('scanning', 'Looking for new music…');
  await libScan();
  await anAnalyseScanned();
}
async function anAnalyseScanned() {
  if (_anState !== 'scanning') return;
  if (!libScanResults) { anShow('done', 'Couldn’t read that folder'); return; }
  const target = _analyseTargetCat();
  _anKnown = libScanResults.files.filter(f => f.catalog_slugs && f.catalog_slugs.includes(target)).length;
  await libAnalyseAllNew();
}

// pilot 6619 (rewritten) — this Field's folders, each removable.
function renderLibRoots() {
  const list = $('lib-roots-list');
  if (!list) return;
  const mine = libRoots.filter(r => r.cat == null || r.cat === activeCatalog);
  $('an-folders').hidden = !mine.length;
  list.replaceChildren(...mine.map(r => {
    const row = document.createElement('div');
    row.className = 'an-folder';
    row.innerHTML = `<span class="an-folder-name">${esc(r.path.split('/').filter(Boolean).pop() || r.path)}</span>
      <span class="an-folder-path">${esc(r.path)}</span><button class="btn-sm">Remove</button>`;
    row.querySelector('button').onclick = () => libRootRemove(r.path);
    return row;
  }));
}
window.onActiveCatalogChange = () => { renderLibRoots(); if (_anState !== 'running') anShow('idle'); };

// Returns true when an interrupted run is waiting, so the app opens on this tab.
async function analyseBoot() {
  await libRootsLoad();
  // An interrupted run's queue is still on disk — offer it back (pilot 22365).
  try {
    const qr = await fetch('/library/queue');
    if (qr.ok) {
      const q = await qr.json().catch(() => null);
      const pending = (q && Array.isArray(q.pending)) ? q.pending : [];
      if (pending.length) return offerAnalysisResume(pending);
    }
  } catch (_) {}
  return false;
}

Object.assign(window, { addMusic, checkForNew, cancelScan, libRootRemove, renderLibRoots, resumeAnalysisQueue, anResumeDismiss });
export { analyseBoot, apiJson };
