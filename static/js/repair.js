// Repair tab: Field health — missing covers, broken paths, duplicates, missing metadata, filename
// tags. The pilot's (index.html @ 7c8c0e7), offline only: the Discogs/AcoustID lookups, online
// cover fetching and the API-keys panel are LATER (Mark, 26 Oct). "// pilot N" marks each source line.
import { _coverTexCache, activeCatalog, allCatalogs, catalog, esc, loadCatalog, markFieldStale, noteToCamelot, renderCatalog, showToast, trackArtistTitle } from './field.js';
import { bgBreather, showEntriesUndoToast, uiForegroundBusy } from './analyse.js';
import { rescanningIds } from './list.js';


let repairData = null;   // pilot 6x: moved here — only the Repair tab writes it

// pilot 9425
async function extractGenres() {
  const btn = document.getElementById('extract-genres-btn');
  if (btn) { btn.disabled = true; btn.textContent = '🏷 Extracting…'; }
  // Chunked with a moving count — one silent mega-request answered none of the
  // "alive? oversized? crashed?" questions on a big library.
  let _spTok;
  try {
    const all = await fetch(`/catalog?cat=${encodeURIComponent(activeCatalog)}`).then(r => r.json());
    const ids = all.filter(e => !e.genre).map(e => e.id);
    if (!ids.length) { showToast('Every track already has a genre'); return; }
    _spTok = startScanProgress(`Extracting genre tags 0/${ids.length}`, ids.length);
    const CH = 25;
    let updated = 0, skipped = 0, failed = 0;
    for (let i = 0; i < ids.length; i += CH) {
      await bgBreather();   // stay fluid on Field/List (no-op elsewhere)
      if (isScanCancelled(_spTok)) break;
      const res = await fetch(`/catalog/extract-genres?cat=${encodeURIComponent(activeCatalog)}`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ ids: ids.slice(i, i + CH) }), signal: scanSignal(_spTok) });
      const j = await res.json();
      updated += j.updated || 0; skipped += j.skipped || 0; failed += j.failed || 0;
      const done = Math.min(ids.length, i + CH);
      updateScanProgress(done, `Extracting genre tags ${done}/${ids.length} · ${updated} found`, _spTok);
    }
    showToast(updated === 0 && failed === 0
      ? `Nothing to update — the remaining tracks carry no genre tag in the file (re-running won't change that)`
      : `Genres: ${updated} updated, ${skipped} without a tag, ${failed} failed`);
    await loadCatalog();
  } catch (e) {
    if (e?.name !== 'AbortError') showToast(`Extract failed: ${e.message}`);
  } finally {
    endScanProgress(_spTok);
    if (btn) { btn.disabled = false; btn.textContent = '📇 Genres'; }
  }
}
// pilot 9469
let _repairField = (() => { try { return localStorage.getItem('repair-field') || null; } catch (_) { return null; } })();
// pilot 9470
function repairSlugs() {
  if (!(allCatalogs || []).some(c => c.slug === _repairField))
    _repairField = (typeof activeCatalog !== 'undefined' && activeCatalog) ? activeCatalog : (allCatalogs?.[0]?.slug ?? null);
  return _repairField ? [_repairField] : [];
}
// pilot 9475
function setRepairField(slug) {
  _repairField = slug;
  try { localStorage.setItem('repair-field', slug); } catch (_) {}
  repairData = null; _repairScanSlugs = null;
  if (document.body.classList.contains('on-tab-repair')) repairScan();
}
// pilot 9481
function syncRepairFieldSelect() {
  const sel = document.getElementById('repair-field-select');
  if (!sel) return;
  repairSlugs();   // validates/defaults _repairField
  sel.innerHTML = (allCatalogs || []).map(c =>
    `<option value="${esc(c.slug)}"${c.slug === _repairField ? ' selected' : ''}>${esc(c.name)} (${c.count})</option>`).join('');
}
// pilot 9489
let _repairScanSlugs = null;
// pilot 9490
const _slugsKey = () => repairSlugs().join(',');
// pilot 9492
async function repairScan() {
  syncRepairFieldSelect();
  if (!repairSlugs().length) {
    repairData = null; _repairScanSlugs = null;
    document.getElementById('repair-content').innerHTML =
      '<div class="rep-empty">No Fields selected — pick one in the Fields menu above to scan it.</div>';
    return;
  }
  const btn = document.getElementById('repair-scan-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = REP_ICO('<path d="M5 4v5a4.5 4.5 0 0 0 9 0V4M7 3.5v1.8M12 3.5v1.8"/><path d="M9.5 13.5V16a4.5 4.5 0 0 0 9 0v-1.6"/><circle cx="18.5" cy="12" r="2.2"/>') + ' Scanning…'; }
  document.getElementById('repair-content').innerHTML = '<div class="rep-empty">Scanning health…</div>';
  const _spTok = startScanProgress('Scanning health…', 0);
  try {
    // Confine the scan to the selected Fields (Mark, 2026-08-02).
    const res = await fetch('/repair/health?slugs=' + encodeURIComponent(repairSlugs().join(','))
                            + (typeof uiForegroundBusy === 'function' && uiForegroundBusy() ? '&fg=1' : ''),
                            { signal: scanSignal(_spTok) });
    // res.ok was unchecked. Every error body parses fine and carries none of the issue
    // arrays, so renderRepair counted zero of everything and drew the green
    // "Field is healthy - no issues detected" card. The scan never ran. Of all the
    // silent failures in this file this is the one that most directly misleads: the user
    // asked "is my library broken?" and was told no by a check that did not happen.
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error((j && j.error) || ('the app returned an error (' + res.status + ')'));
    }
    repairData = await res.json();
    _repairScanSlugs = _slugsKey();
    renderRepair();
  } catch (e) {
    if (e?.name === 'AbortError') {
      document.getElementById('repair-content').innerHTML = `<div class="rep-empty">Scan cancelled.</div>`;
    } else {
      document.getElementById('repair-content').innerHTML = `<div class="rep-empty">Scan failed: ${esc(e.message)}</div>`;
    }
  } finally {
    endScanProgress(_spTok);
    if (btn) { btn.disabled = false; btn.innerHTML = REP_ICO('<path d="M5 4v5a4.5 4.5 0 0 0 9 0V4M7 3.5v1.8M12 3.5v1.8"/><path d="M9.5 13.5V16a4.5 4.5 0 0 0 9 0v-1.6"/><circle cx="18.5" cy="12" r="2.2"/>') + ' <strong>Scan health</strong>'; }
  }
}
// pilot 9539
const REP_ICO = paths => `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
// pilot 9541
const REPAIR_CATEGORIES = [
  { key:'broken_paths',     icon:REP_ICO('<path d="M12 3 2.5 20h19z"/><path d="M12 9.5v5m0 2.6v.2"/>'),  title:'Files not found',            desc:'Tunefield could not reach these files — deleted, moved, or on a drive that is not connected', sev:'crit',
    actions: cat => [
      { label:'Delete all orphan entries', danger:true, run: async () => {
        if (!confirm(`Delete ${cat.length} entries with missing files?\n\nAn Undo will be offered right afterwards (and the removed entries are kept in the trash for a while), so this is recoverable.`)) return;
        // Scope the sweep to the libraries selected in the Repair view — the confirm
        // count above is scoped, so the deletion must be too.
        const scoped = { method:'POST', headers:{'Content-Type':'application/json'},
                         body: JSON.stringify({ slugs: repairSlugs() }) };
        let r = await tfConfirmFetch('/repair/delete-orphans', scoped);
        if (r.status === 409) {
          const err = await r.json().catch(() => ({}));
          const roots = (err.missing_roots || []).join('\n  ');
          if (confirm(`Some library folders are unreachable (unmounted drive?):\n  ${roots}\n\nEntries on those volumes will be protected. Delete the rest anyway?`)) {
            r = await tfConfirmFetch('/repair/delete-orphans?force=true', scoped);
          } else { return; }
        }
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          showToast(err.error || 'Delete orphans failed');
        } else {
          const j = await r.json().catch(() => ({}));
          let msg = `Deleted ${j.deleted ?? 0} orphan entr${(j.deleted ?? 0) === 1 ? 'y' : 'ies'}`;
          if (j.skipped_unreachable) msg += ` · ${j.skipped_unreachable} kept (volume unreachable)`;
          if (j.undoable) showEntriesUndoToast(msg); else showToast(msg);
        }
        await repairScan();
      }}
    ],
    rowExtra: r => `<span class="rep-meta" title="${esc(r.library_file)}">missing: ${esc((r.library_file||'').split('/').pop())}</span>` },
  { key:'missing_cover',    icon:REP_ICO('<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m3 17 5.5-5 4 3.5L16 12l5 4.5"/>'),  title:'Missing cover art',          desc:'No embedded art and no folder cover.jpg', sev:'warn',
    actions: cat => [
      { label:'Extract covers (active Field)', run: async () => { await extractCovers(); await repairScan(); } },
      // For files that genuinely carry no embedded art (untagged Beatport WAVs are the
      // classic case) extraction has nothing to find — this asks Discogs instead.
      // And for what Discogs doesn't know either: key colour + artist + title.
      { label:`Generate key-colour covers (${cat.length})`, run: () => generateCovers(cat.map(r => r.id)) },
    ] },
  { key:'missing_artist_title', icon:REP_ICO('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16.5c.6-1.7 1.7-2.5 3-2.5s2.4.8 3 2.5M14 9.5h4.5M14 13h4.5"/>'), title:'Missing artist / title',      desc:'No artist or title field stored — ID3 tags never extracted', sev:'warn',
    actions: cat => [
      { label:`Backfill tags from files (${cat.length})`, run: async () => {
        // Exactly the scoped issue rows, in chunks, with real progress — the old
        // version ffprobed EVERY entry in EVERY catalog in one silent request.
        const ids = cat.map(r => r.id);
        if (!ids.length) return showToast('Nothing to backfill');
        const CH = 25;
        let updated = 0, skipped = 0, failed = 0;
        const _spTok = startScanProgress(`Reading tags 0/${ids.length}…`, ids.length);
        try {
          for (let i = 0; i < ids.length; i += CH) {
      await bgBreather();   // stay fluid on Field/List (no-op elsewhere)
            if (isScanCancelled(_spTok)) break;
            const res = await fetch('/catalog/extract-metadata', { method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ ids: ids.slice(i, i + CH), cats: repairSlugs() }), signal: scanSignal(_spTok) });
            const j = await res.json();
            updated += j.updated || 0; skipped += j.skipped || 0; failed += j.failed || 0;
            const done = Math.min(ids.length, i + CH);
            updateScanProgress(done, `Reading tags ${done}/${ids.length} · ${updated} backfilled`, _spTok);
          }
          showToast(updated === 0 && failed === 0
            ? `Nothing to backfill — the remaining tracks have no artist/title tags in the file (re-running won't change that)`
            : `Backfilled ${updated} entries · ${skipped} already had data · ${failed} failed`);
          await loadCatalog();
          await repairScan();
        } catch (e) {
          if (e?.name !== 'AbortError') showToast(`Backfill failed: ${e.message}`);
        } finally { endScanProgress(_spTok); }
      } }
    ],
    rowExtra: r => `<button class="rep-row-btn" onclick="repairLookupTrack('${r.id}','discogs')" title="Search Discogs for this track">🔎 Discogs</button>` },
  { key:'missing_genre',    icon:REP_ICO('<path d="M3.5 12.5 12 4h7.5V11l-8.5 8.5a1.5 1.5 0 0 1-2.1 0l-5.4-5.4a1.5 1.5 0 0 1 0-2.1z" transform="rotate(180 11.5 12)"/><circle cx="15.8" cy="7.8" r=".4"/>'),  title:'Missing genre',              desc:'Entry has no genre tag set', sev:'warn',
    actions: cat => [
      { label:'Extract genres (active Field)', run: async () => { await extractGenres(); await repairScan(); } }
    ],
    rowExtra: r => `<button class="rep-row-btn" onclick="repairLookupTrack('${r.id}','discogs')" title="Search Discogs for this track">🔎 Discogs</button>` },
  { key:'missing_loudness', icon:REP_ICO('<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15.5 9a5 5 0 0 1 0 6M18 6.7a8.5 8.5 0 0 1 0 10.6"/>'),  title:'Missing LUFS loudness',      desc:'Track was analysed before LUFS was added — rescan to populate', sev:'warn',
    actions: rows => [rescanRowsAction(rows)] },
  { key:'failed_analysis',  icon:REP_ICO('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>'),  title:'Failed / partial analysis',  desc:'BPM=0 or duration=0 — analysis likely failed', sev:'crit',
    actions: rows => [rescanRowsAction(rows)],
    rowExtra: r => `<span class="rep-meta">[${esc(r.catalog)}]</span>` },
  { key:'filename_tag_mismatch', icon:REP_ICO('<path d="M3 7h4l10 10h4m0 0-2.5-2.5M21 17l-2.5 2.5M3 17h4l2.5-2.5M17 7h4m0 0-2.5-2.5M21 7l-2.5 2.5"/>'), title:'Stored name ↔ tag mismatch',  desc:'Embedded ID3 tags disagree with the name Tunefield stores for this track. Files on disk are never renamed.', sev:'warn',
    actions: () => [
      { label:'Auto-apply tags to stored names…', run: previewTagFilenames },
      { label:'Undo all tag rewrites', danger:true, run: undoTagFilenames },
    ],
    rowExtra: r => `<span class="rep-meta">catalog: <strong>${esc(r.filename_artist || '?')}</strong> – <strong>${esc(r.filename_title || '?')}</strong> · tag: <strong>${esc(r.tag_artist || '?')}</strong> – <strong>${esc(r.tag_title || '?')}</strong></span>
      <button class="rep-row-btn" onclick="repairLookupTrack('${r.id}','discogs')" title="Search Discogs">🔎 Discogs</button>
      <button class="rep-row-btn${fpcalcMissing() ? ' is-disabled' : ''}" data-acoustid="1" onclick="repairLookupTrack('${r.id}','acoustid')" title="${fpcalcMissing() ? 'AcoustID needs Chromaprint fpcalc (not installed) — see 🔑 API keys' : 'Fingerprint via AcoustID'}">🎧 AcoustID</button>` },
  { key:'duplicate_files',  icon:REP_ICO('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),  title:'Duplicate file references',  desc:'Same audio file referenced by multiple entries', sev:'warn',
    actions: () => [{ label:'Auto-delete duplicates (keep best)…', danger:true, run: () => previewDedup('duplicate_files') }],
    isGroups: true },
  { key:'duplicate_titles', icon:REP_ICO('<circle cx="8" cy="8" r="3"/><path d="M3 19c.8-3 2.7-4.5 5-4.5s4.2 1.5 5 4.5"/><path d="M15.5 5.2A3 3 0 0 1 19 8a3 3 0 0 1-2.2 2.9M17.4 14.8c1.9.5 3.1 1.9 3.6 4.2"/>'),  title:'Duplicate titles',           desc:'Same artist + title across multiple entries', sev:'warn',
    actions: () => [{ label:'Auto-delete duplicates (keep best)…', danger:true, run: () => previewDedup('duplicate_titles') }],
    isGroups: true },
  { key:'unknown_key',      icon:REP_ICO('<circle cx="7" cy="17" r="2.6"/><path d="M9.6 17V5.5L19 4v10.7"/><circle cx="16.4" cy="14.7" r="2.6"/>'),  title:'Unrecognised musical key',   desc:'Key root not in standard 12-note set — analysis quirk', sev:'warn',
    actions: () => [],
    rowExtra: r => `<span class="rep-meta">root: ${esc(r.root)}</span>` },
];
// pilot 9645
function renderRepair() {
  syncRepairFieldSelect();
  if (!repairSlugs().length) {
    // Selection cleared after a scan — mirror repairScan's empty-selection state.
    const rc = document.getElementById('repair-content');
    if (rc) rc.innerHTML = '<div class="rep-empty">No Fields selected — pick one in the Fields menu above to scan it.</div>';
    const banner = document.getElementById('repair-stat-banner');
    if (banner) banner.style.display = 'none';
    return;
  }
  if (!repairData) { repairScan(); return; }   // selected but never scanned → scan now
  // Selection changed since the scan ran → the (server-scoped) results on screen don't
  // cover it. Prompt for a rescan instead of silently filtering a stale result — the
  // banner string is prepended to the final content write below.
  const staleBanner = (_repairScanSlugs !== null && _repairScanSlugs !== _slugsKey())
    ? '<div id="repair-stale-banner" style="margin:0 0 12px;padding:10px 14px;border:1px solid var(--bh-yellow);border-radius:0;background:rgba(232,161,60,.12);display:flex;align-items:center;gap:12px;font-size:13px">' +
      '<span>⚠️ The Field selection changed — these results cover the previous selection.</span>' +
      '<button class="btn-sm" style="border-color:#ffc46b;color:#ffe1b3" onclick="repairScan()">Rescan now</button></div>'
    : '';
  const s    = repairData.summary || {};
  const raw  = repairData.issues  || {};
  // Filter every category's items down to the user's chip-selected libraries. Issues each
  // carry a `slug` field so the scope follows the same selector that drives the Library tab.
  const scopeSlugs = repairSlugs().length ? new Set(repairSlugs()) : null;
  const inScope = r => !scopeSlugs || scopeSlugs.has(r.slug);
  const is = {};
  REPAIR_CATEGORIES.forEach(c => {
    const arr = raw[c.key] || [];
    if (c.isGroups) {
      // Duplicate groups: keep only members in-scope, then drop groups that collapse below 2.
      is[c.key] = arr.map(g => g.filter(inScope)).filter(g => g.length > 1);
    } else {
      is[c.key] = arr.filter(inScope);
    }
  });
  const totalIssues = REPAIR_CATEGORIES.reduce((sum, c) => {
    const items = is[c.key] || [];
    return sum + (c.isGroups ? items.reduce((n, g) => n + g.length, 0) : items.length);
  }, 0);
  // Selected-library entry count from the local catalog meta (server's total_entries is global).
  const selectedEntries = scopeSlugs
    ? (allCatalogs || []).filter(c => scopeSlugs.has(c.slug)).reduce((n, c) => n + (c.count || 0), 0)
    : (s.total_entries || 0);
  const ignoredTotal = s.ignored_total || 0;
  // Headline banner — replaces the old toolbar caption.
  const banner = document.getElementById('repair-stat-banner');
  if (banner) {
    banner.style.display = 'flex';
    document.getElementById('rsb-entries-n').textContent = selectedEntries;
    document.getElementById('rsb-issues-n').textContent  = totalIssues;
    document.getElementById('rsb-ignored').style.display = ignoredTotal ? 'inline' : 'none';
    document.getElementById('rsb-ignored-n').textContent = ignoredTotal;
    // Scope chip — shows which libraries the numbers cover.
    const scopeEl = document.getElementById('rsb-scope');
    if (scopeEl) {
      if (!scopeSlugs || scopeSlugs.size === (allCatalogs || []).length) {
        scopeEl.textContent = 'scope: all Fields';
      } else {
        const names = (allCatalogs || []).filter(c => scopeSlugs.has(c.slug)).map(c => c.name);
        scopeEl.textContent = `scope: ${names.join(' · ')}`;
      }
    }
  }
  const igBtn = document.getElementById('repair-ignored-btn');
  if (igBtn) {
    igBtn.style.display = ignoredTotal ? 'inline-block' : 'none';
    const igCount = document.getElementById('rep-ignored-count');
    if (igCount) igCount.textContent = ignoredTotal;
  }

  const html = REPAIR_CATEGORIES.map(cat => {
    const items = is[cat.key] || [];
    const n = items.length;
    if (n === 0) return '';  // hide healthy sections to reduce noise
    const sev = n === 0 ? 'ok' : cat.sev;
    // Duplicates and broken paths are the Pro half of repair (Mark, 2026-08-29).
    // A free user still SEES what was found — hiding the finding would make the scan
    // lie about the state of their library — but the bulk fixes are gated.
    const catLocked = false;   // Lite: free, nothing locked
    // Built-in actions plus a universal "Ignore all in this category"
    const builtIn = catLocked ? [] : (cat.actions ? cat.actions(items) : []);
    const allActions = [...builtIn, { label:`Ignore all ${n} (suppress in scan)`, danger:false, run: () => ignoreCategoryAll(cat.key) }];
    // Repair card action buttons: pick a colour + emoji per action so each verb reads at a
    // glance — same palette as the Library toolbar so the whole app speaks one visual language.
    const styleFor = (lbl, danger) => {
      if (/^Delete|Auto-delete/i.test(lbl))   return { cls:'lib-tb-danger',  icon:REP_ICO('<path d="M4.5 6.5h15M9.5 6V4.5h5V6m-8 .5.8 13h9.4l.8-13"/>') };
      if (/Undo/i.test(lbl))                  return { cls:'lib-tb-cols',    icon:REP_ICO('<path d="M8.5 14 4 9.5 8.5 5"/><path d="M4 9.5h10a6 6 0 0 1 0 12h-3"/>') };
      if (/Extract covers/i.test(lbl))        return { cls:'lib-tb-covers',  icon:REP_ICO('<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m3 17 5.5-5 4 3.5L16 12l5 4.5"/>') };
      if (/Extract genres/i.test(lbl))        return { cls:'lib-tb-genres',  icon:REP_ICO('<rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M7 6V4.5M12 6V4.5M7 11h6M7 15h10"/>') };
      if (/Backfill|Read tags/i.test(lbl))    return { cls:'lib-tb-import',  icon:REP_ICO('<path d="M12 4v10m0 0 4-4m-4 4-4-4"/><path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/>') };
      if (/^Rescan/i.test(lbl))               return { cls:'lib-tb-rescan',  icon:REP_ICO('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 3.5v3.7h-3.7"/>') };
      if (/Auto-apply tags/i.test(lbl))       return { cls:'lib-tb-tags',    icon:REP_ICO('<path d="M3.5 12.5 12 4h7.5V11l-8.5 8.5a1.5 1.5 0 0 1-2.1 0l-5.4-5.4a1.5 1.5 0 0 1 0-2.1z"/><circle cx="15.8" cy="7.8" r=".4"/>') };
      if (/^Ignore all/i.test(lbl))           return { cls:'lib-tb-genres',  icon:REP_ICO('<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>') };
      return danger ? { cls:'lib-tb-danger', icon:REP_ICO('<path d="M12 3 2.5 20h19z"/><path d="M12 9.5v5m0 2.6v.2"/>') } : { cls:'lib-tb-import', icon:REP_ICO('<path d="m4.5 12.5 5 5 10-11"/>') };
    };
    const actions = allActions.map((a, ai) => {
      const s = styleFor(a.label, a.danger);
      return `<button class="lib-tb-btn ${s.cls}" onclick="repairAction('${cat.key}',${ai})">${s.icon} ${esc(a.label)}</button>`;
    }).join('');
    const ignoreBtn = id => `<button class="rep-row-btn" onclick="ignoreRepairRow('${cat.key}','${esc(id)}',this)" title="Hide this issue from future scans">🚫 ignore</button>`;
    let body;
    if (cat.isGroups) {
      body = items.map(group => `<div style="border:1px solid var(--border);border-radius:0;padding:8px 10px;margin-bottom:6px">
        <div style="color:var(--muted);font-size:10px;text-transform:uppercase;margin-bottom:4px">${group.length} duplicates</div>
        ${group.map(r => `<div class="repair-row">
          <span class="rep-fname" title="${esc(r.filename)}">${esc(r.filename)}</span>
          <span class="rep-meta">[${esc(r.catalog)}]</span>
          <button class="rep-row-btn" onclick="deleteDupRow('${esc(r.id)}','${esc(r.slug)}',this)" title="Delete just this entry">× delete</button>
          ${ignoreBtn(r.id)}
        </div>`).join('')}
      </div>`).join('');
    } else {
      body = items.map(r => `<div class="repair-row">
        <span class="rep-fname" title="${esc(r.filename)}">${esc(r.filename)}</span>
        ${cat.rowExtra ? cat.rowExtra(r) : ''}
        ${ignoreBtn(r.id)}
      </div>`).join('');
    }
    // Save the action set on the cat object so repairAction can find the synthetic ignore-all
    cat._lastActions = allActions;
    return `<div class="repair-card" data-cat="${cat.key}">
      <div class="repair-card-hdr" onclick="repairToggle('${cat.key}')">
        <span class="rep-icon">${cat.icon}</span>
        <h3>${cat.title}${catLocked ? ' <span class="rep-pro" title="Fixing these in bulk is a Pro feature — the scan still shows you what it found">PRO</span>' : ''}<span class="rep-desc">${esc(cat.desc)}</span></h3>
        <span class="rep-count ${sev}">${n}</span>
      </div>
      ${actions ? `<div class="repair-card-actions">${actions}</div>` : ''}
      <div class="repair-card-body" id="rep-body-${cat.key}">${body || `<div class="rep-empty">No issues</div>`}</div>
    </div>`;
  }).filter(Boolean).join('');

  document.getElementById('repair-content').innerHTML = staleBanner +
    (totalIssues === 0
      ? `<div class="repair-card" style="text-align:center;padding:40px 20px"><div style="font-size:36px;margin-bottom:8px">✨</div><h3 style="font-size:14px;color:#44dd88">Field is healthy</h3><p style="color:var(--muted);font-size:12px;margin-top:6px">${selectedEntries} entries · no issues detected</p></div>`
      : html);
}
// pilot 9782
function repairToggle(key) {
  document.getElementById(`rep-body-${key}`)?.classList.toggle('open');
}
// pilot 9786
async function repairAction(catKey, actionIdx) {
  const cat = REPAIR_CATEGORIES.find(c => c.key === catKey);
  if (!cat) return;
  // _lastActions was stamped on the cat during render and includes the synthetic
  // "Ignore all" entry appended after the built-ins
  const acts = cat._lastActions || (cat.actions ? cat.actions(repairData?.issues?.[catKey] || []) : []);
  const act  = acts[actionIdx];
  if (act?.run) await act.run();
}
// pilot 9796
async function ignoreRepairRow(category, id, btn) {
  if (btn) btn.disabled = true;
  try {
    await fetch('/repair/ignore', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ category, ids: [id] }) });
    await repairScan();
    showToast('Issue ignored', { subtle: true });
  } catch (e) {
    showToast('Ignore failed: ' + e.message);
    if (btn) btn.disabled = false;
  }
}
// pilot 9808
async function ignoreCategoryAll(category) {
  if (!confirm(`Ignore every current issue in this category? They'll stop appearing in future scans. You can revert from "Ignored issues" at the top.`)) return;
  await fetch('/repair/ignore', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ category, ids: 'all' }) });
  await repairScan();
  showToast('Category cleared', { subtle: true });
}
// pilot 9815
async function unignoreAll() {
  if (!confirm('Restore every ignored issue back into the next scan?')) return;
  await fetch('/repair/unignore', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ category:'*' }) });
  await repairScan();
  showToast('All ignored issues restored');
}
// pilot 9830
function fpcalcMissing() { return window.__health && window.__health.fpcalc === false; }
// pilot 9898
async function deleteDupRow(id, slug, btn) {
  if (!confirm(`Delete this Field entry?\n\nOnly the catalog entry is removed — the audio file stays on disk.`)) return;
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/catalog/${id}?cat=${encodeURIComponent(slug)}`, { method:'DELETE' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast(err.error || `Delete failed (${r.status})`);
      if (btn) btn.disabled = false;
      return;
    }
    _purgeMissingCoverCache();
    markFieldStale({ live: false });
    await loadCatalog();
    await repairScan();
    showToast('Entry deleted', { subtle: true });
  } catch (e) {
    showToast('Delete failed: ' + e.message);
    if (btn) btn.disabled = false;
  }
}
// pilot 9920
async function previewDedup(category) {
  // Instant busy feedback — the dry-run walks every scoped catalog, and with no
  // indicator users assumed the click was dead and wandered off to another tab,
  // where the confirm dialog then "landed" seconds later.
  const _spTok = startScanProgress('Checking for duplicates…', 0);
  // The preferred-root choice persists in /repair/config — the FIRST dry-run must
  // already carry it, or this preview would disagree with what apply later computes.
  let curPref = '';
  try {
    const cfg = await (await fetch('/repair/config')).json();
    curPref = cfg.dedup_preferred_root || '';
  } catch (_) {}
  const ddBody = (dryRun) => JSON.stringify({
    // Same scope as the Repair tab's health scan (the chip selection).
    category, dry_run: dryRun, slugs: repairSlugs(),
    // duplicate_files groups share ONE path — a root preference can never separate
    // them, so don't send one (it would only mislead the response's echo).
    ...(curPref && category !== 'duplicate_files' ? { preferred_root: curPref } : {}),
  });
  let r, j;
  try {
    r = await fetch('/repair/dedup', { method:'POST', headers:{'Content-Type':'application/json'},
      body: ddBody(true),
      signal: scanSignal(_spTok) });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    endScanProgress(_spTok);
    // The ✕ aborts the request — "Task cancelled" already toasted; don't stack a
    // failure toast on top of a deliberate cancel.
    if (e?.name !== 'AbortError') showToast('Dedup scan failed: ' + (e.message || e));
    return;
  }
  endScanProgress(_spTok);
  if (isScanCancelled(_spTok)) return;   // response won the race against the ✕ — still honour it
  // An error response has no plan — surfacing it as "No duplicates" would falsely
  // tell the user their library is clean.
  if (!r.ok) return showToast(j.error || `Dedup scan failed (${r.status})`);
  const plan = j.plan || [];
  if (!plan.length) return showToast('No duplicates to dedup');
  const rowsHtml = (pl) => pl.slice(0, 200).map(p => `
    <div style="border:1px solid var(--border);border-radius:0;padding:6px 8px;margin-bottom:6px;font-size:11px">
      <div style="color:#44dd88;margin-bottom:3px"><strong>Keep:</strong> ${esc(p.keep.filename)} <span style="color:var(--muted)">[${esc(p.keep.catalog)}]${p.keep.has_cover?' · 🖼':''}${p.keep.under_pref?' · 📁 preferred root':''}</span></div>
      ${p.drop.map(d => `<div style="color:#ff6666"><strong>Drop:</strong> ${esc(d.filename)} <span style="color:var(--muted)">[${esc(d.catalog)}]</span></div>`).join('')}
    </div>
  `).join('') + (pl.length > 200 ? `<div style="text-align:center;color:var(--muted);padding:6px">… and ${pl.length - 200} more groups</div>` : '');
  // Preferred-root picker — hidden for duplicate_files: those groups share ONE path,
  // so a root preference can never separate them.
  let prefHtml = '';
  if (category !== 'duplicate_files') {
    let roots = [];
    try { roots = await (await fetch('/library/roots')).json(); } catch (_) {}
    if (Array.isArray(roots) && roots.length) {
      prefHtml = `
        <p style="color:var(--muted);font-size:12px;margin:0 0 12px;display:flex;align-items:center;gap:8px">
          <span>Prefer keeping copies under</span>
          <select id="dd-root-pref" style="max-width:60%">
            <option value="">No preference (keep best)</option>
            ${roots.map(rt => `<option value="${esc(rt.path)}"${rt.path === curPref ? ' selected' : ''}>${esc(rt.absolute)}</option>`).join('')}
          </select>
        </p>`;
    }
  }
  showRepairModal(`
    <h3 style="margin:0 0 10px;font-size:15px">Auto-delete duplicates?</h3>
    <p style="color:var(--muted);font-size:12px;margin:0 0 12px">
      <span id="dd-summary">${j.groups} duplicate group${j.groups===1?'':'s'} · would delete ${j.would_delete} entries.</span>
      ${category === 'duplicate_files'
        ? 'Keep policy: entry with a cover wins, then oldest-analysed, then lowest id.'
        : 'Keep policy: preferred root wins, then entry with a cover, then oldest-analysed, then lowest id.'}
      Only catalog entries are removed — audio files always stay on disk.
    </p>
    ${prefHtml}
    <div id="dd-plan-rows" class="themed-scroll" style="max-height:55vh;overflow-y:auto;border:1px solid var(--border);border-radius:0;padding:6px">
      ${rowsHtml(plan)}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button onclick="closeRepairModal()" class="btn-sm">Cancel</button>
      <button id="dd-apply" class="btn-sm btn-danger">Delete ${j.would_delete} entries</button>
    </div>
  `);
  const prefSel = document.getElementById('dd-root-pref');
  if (prefSel) prefSel.onchange = async () => {
    const prevPref = curPref;
    curPref = prefSel.value;
    // Persist the choice, then RE-RUN the dry-run — the server owns the plan, and the
    // preview shown here must be exactly what apply will do.
    fetch('/repair/config', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ dedup_preferred_root: curPref }) }).catch(() => {});
    // Freeze BOTH controls for the re-check — an Apply click mid-flight would delete
    // against the NEW pref while the modal still shows the OLD plan.
    const applyBtn = document.getElementById('dd-apply');
    prefSel.disabled = true;
    if (applyBtn) applyBtn.disabled = true;
    const revert = () => {
      // Failed re-check: roll the pref back everywhere — the local value, the picker,
      // AND the persisted config — so what's stored always matches the plan on screen.
      curPref = prevPref;
      prefSel.value = prevPref;
      fetch('/repair/config', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ dedup_preferred_root: curPref }) }).catch(() => {});
    };
    try {
      const rr = await fetch('/repair/dedup', { method:'POST', headers:{'Content-Type':'application/json'}, body: ddBody(true) });
      const jj = await rr.json().catch(() => ({}));
      if (!rr.ok) { revert(); showToast(jj.error || `Dedup re-check failed (${rr.status})`); return; }
      j = jj;
      const rowsEl = document.getElementById('dd-plan-rows');
      if (rowsEl) rowsEl.innerHTML = rowsHtml(j.plan || []);
      const sum = document.getElementById('dd-summary');
      if (sum) sum.textContent = `${j.groups} duplicate group${j.groups===1?'':'s'} · would delete ${j.would_delete} entries.`;
      const ab = document.getElementById('dd-apply');
      if (ab) ab.textContent = `Delete ${j.would_delete} entries`;
    } catch (e) {
      revert();
      showToast('Dedup re-check failed: ' + (e.message || e));
    } finally {
      prefSel.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
    }
  };
  document.getElementById('dd-apply').onclick = async () => {
    closeRepairModal();
    const _spTok = startScanProgress(`Deleting ${j.would_delete} duplicate entr${j.would_delete === 1 ? 'y' : 'ies'}…`, 0);
    try {
      const ar = await tfConfirmFetch('/repair/dedup', { method:'POST', headers:{'Content-Type':'application/json'}, body: ddBody(false), signal: scanSignal(_spTok) });
      const aj = await ar.json().catch(() => ({}));
      if (!ar.ok) { showToast(aj.error || `Dedup failed (${ar.status})`); return; }
      const dmsg = `Deleted ${aj.deleted} entries · ${aj.groups} groups deduped`;
      if (aj.undoable) showEntriesUndoToast(dmsg); else showToast(dmsg);
      await loadCatalog();
      await repairScan();
    } catch (e) {
      if (e?.name !== 'AbortError') showToast(`Dedup failed: ${e.message}`);
    } finally { endScanProgress(_spTok); }
  };
}
// pilot 10057
async function previewTagFilenames() {
  let r;
  try { r = await fetch('/repair/preview-tag-filenames', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }); }
  catch (e) { return showToast('Preview failed: ' + e.message); }
  const j = await r.json();
  const props = j.proposals || [];
  const sk    = j.skipped   || {};
  if (!props.length) {
    return showToast(`Nothing to rewrite · ${sk.already_canonical||0} already canonical · ${sk.various_artists||0} VA · ${sk.empty_tags||0} empty tags`);
  }
  const sampleRows = props.slice(0, 200).map(p =>
    `<div class="tag-rename-row"><span class="trr-before">${esc(p.before)}</span><span class="trr-arrow">→</span><span class="trr-after">${esc(p.after)}</span></div>`
  ).join('');
  const more = props.length > 200 ? `<div style="text-align:center;color:var(--muted);padding:6px">… and ${props.length - 200} more</div>` : '';
  const skipNote = Object.entries(sk).filter(([,v]) => v).map(([k,v]) => `${k.replace(/_/g,' ')}: ${v}`).join(' · ') || 'none';
  showRepairModal(`
    <h3 style="margin:0 0 10px;font-size:15px">Rename these tracks inside Tunefield?</h3>
    <p style="color:var(--muted);font-size:12px;margin:0 0 12px">
      This renames catalog entries only — <strong>your files on disk are not touched</strong>.
      ${props.length} rewrites proposed · skipped: ${esc(skipNote)}.
      Previous names are saved per entry — "Undo all tag rewrites" reverts.
    </p>
    <div class="themed-scroll" style="max-height:55vh;overflow-y:auto;border:1px solid var(--border);border-radius:0;padding:6px;font-size:11px">
      ${sampleRows}${more}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button onclick="closeRepairModal()" class="btn-sm">Cancel</button>
      <button id="trr-apply" class="btn-sm" style="background:var(--accent);color:#fff;border-color:transparent">Apply all ${props.length}</button>
    </div>
  `);
  document.getElementById('trr-apply').onclick = async () => {
    closeRepairModal();
    const _spTok = startScanProgress('Renaming catalog entries (files on disk untouched)…', 0);
    try {
      const ar = await fetch('/repair/apply-tag-filenames', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}', signal: scanSignal(_spTok) });
      const aj = await ar.json();
      showToast(`Applied ${aj.applied} · skipped ${aj.skipped}`);
      await loadCatalog();
      await repairScan();
    } catch (e) {
      if (e?.name !== 'AbortError') showToast(`Apply failed: ${e.message}`);
    } finally { endScanProgress(_spTok); }
  };
}
// pilot 10102
async function undoTagFilenames() {
  if (!confirm('Restore all entries to their original filenames? This will undo every tag-derived rewrite.')) return;
  const _spTok = startScanProgress('Restoring…', 0);
  try {
    const r = await fetch('/repair/undo-tag-filenames', { method:'POST', signal: scanSignal(_spTok) });
    const j = await r.json();
    showToast(j.restored ? `Restored ${j.restored} filenames` : 'Nothing to undo — filenames are already original');
    _purgeMissingCoverCache();
    markFieldStale({ live: false });
    await loadCatalog();
    await repairScan();
  } catch (e) {
    if (e?.name !== 'AbortError') showToast(`Restore failed: ${e.message}`);
  } finally { endScanProgress(_spTok); }
}
// pilot 10118
function showRepairModal(html) {
  let m = document.getElementById('repair-modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'repair-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center';
    m.onclick = e => { if (e.target === m) closeRepairModal(); };
    document.body.appendChild(m);
  }
  m.innerHTML = `<div data-drag style="background:var(--surface);border:1px solid var(--border);border-radius:0;padding:18px;max-width:760px;width:90vw">${html}</div>`;   // first child of html is its title, the drag handle
  m.style.display = 'flex';
}
// pilot 10129
function closeRepairModal() {
  const m = document.getElementById('repair-modal');
  if (m) m.style.display = 'none';
}
// pilot 10219
async function extractCovers() {
  const btn = document.getElementById('extract-covers-btn');
  btn.disabled = true; btn.textContent = '🖼 Extracting…';
  let _spTok;
  try {
    const all = await fetch(`/catalog?cat=${encodeURIComponent(activeCatalog)}`).then(r => r.json());
    const ids = all.map(e => e.id);
    if (!ids.length) { showToast('No tracks in this Field'); return; }
    _spTok = startScanProgress(`Extracting cover art 0/${ids.length}`, ids.length);
    const CH = 25;
    let extracted = 0, skipped = 0, failed = 0;
    for (let i = 0; i < ids.length; i += CH) {
      await bgBreather();   // stay fluid on Field/List (no-op elsewhere)
      if (isScanCancelled(_spTok)) break;
      const res = await fetch(`/catalog/extract-covers?cat=${encodeURIComponent(activeCatalog)}`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ ids: ids.slice(i, i + CH) }), signal: scanSignal(_spTok) });
      const j = await res.json();
      extracted += j.extracted || 0; skipped += j.skipped || 0; failed += j.failed || 0;
      const done = Math.min(ids.length, i + CH);
      updateScanProgress(done, `Extracting cover art ${done}/${ids.length} · ${extracted} found`, _spTok);
    }
    showToast(extracted === 0 && failed === 0
      ? `Nothing to extract — the remaining tracks have no embedded cover art in the file (re-running won't change that)`
      : `Covers: ${extracted} extracted, ${skipped} already had one, ${failed} failed`);
    _purgeMissingCoverCache();
    markFieldStale({ live: false });
    await loadCatalog();
  } catch (e) {
    if (e?.name !== 'AbortError') showToast(`Extract failed: ${e.message}`);
  } finally {
    if (_spTok) endScanProgress(_spTok);
    btn.disabled = false; btn.textContent = '🖼 Covers';
  }
}
// pilot 10261
function keyCoverColor(root, mode) {
  const cam = noteToCamelot(root, mode);
  if (!cam) return { bg: '#3a3a3e', fg: '#f2ece1', label: '' };
  const hue = (parseInt(cam) - 1) * 30;
  const minor = cam.endsWith('A');
  return minor
    ? { bg: `hsl(${hue},48%,34%)`, fg: '#f2ece1', label: `${root} minor` }
    : { bg: `hsl(${hue},62%,56%)`, fg: '#17151a', label: `${root} major` };
}
// pilot 10271
function drawGeneratedCover(e) {
  const { artist, title } = trackArtistTitle(e);
  const h = e.data?.harmony || {};
  const k = keyCoverColor(h.root, h.mode);
  const c = document.createElement('canvas');
  c.width = c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = k.bg;
  x.fillRect(0, 0, 600, 600);
  // Soft corner vignette so a wall of generated covers reads as objects, not swatches.
  const g = x.createRadialGradient(300, 270, 120, 300, 300, 470);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
  x.fillStyle = g; x.fillRect(0, 0, 600, 600);
  x.fillStyle = k.fg;
  x.textAlign = 'center';
  const FONTS = '"Avenir Next","Avenir","Futura","Century Gothic",sans-serif';
  // Title: up to 3 wrapped lines, shrinking to fit long names.
  const wrap = (text, px, maxW, maxLines) => {
    x.font = `700 ${px}px ${FONTS}`;
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (x.measureText(t).width <= maxW || !line) line = t;
      else { lines.push(line); line = w; if (lines.length === maxLines) break; }
    }
    if (line && lines.length < maxLines) lines.push(line);
    else if (lines.length === maxLines) lines[maxLines - 1] += '…';
    return lines;
  };
  let px = 52, lines;
  do { lines = wrap(title || '(untitled)', px, 500, 3); px -= 4; }
  while (px > 28 && lines.length === 3 && lines[2].endsWith('…'));
  px += 4;
  const startY = 300 - ((lines.length - 1) * (px + 10)) / 2 + (artist ? 14 : 0);
  x.font = `700 ${px}px ${FONTS}`;
  lines.forEach((l, i) => x.fillText(l, 300, startY + i * (px + 10)));
  if (artist) {
    x.font = `600 26px ${FONTS}`;
    x.globalAlpha = 0.82;
    const aTxt = artist.toUpperCase();
    x.fillText(aTxt.length > 36 ? aTxt.slice(0, 35) + '…' : aTxt, 300, startY - px - 8);
    x.globalAlpha = 1;
  }
  if (k.label) {
    x.font = `600 20px ${FONTS}`;
    x.globalAlpha = 0.6;
    x.fillText(k.label, 300, 556);
    x.globalAlpha = 1;
  }
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}
// pilot 10325
async function generateCovers(ids) {
  if (!ids?.length) { showToast('No tracks are missing covers here.'); return; }
  const _spTok = startScanProgress(`Generating covers 0/${ids.length}`, ids.length);
  let made = 0, skipped = 0, failed = 0;
  try {
    for (let i = 0; i < ids.length; i++) {
      if (isScanCancelled(_spTok)) break;
      const e = catalog.find(t => t.id === ids[i]);
      if (!e) { failed++; continue; }
      try {
        const blob = await drawGeneratedCover(e);
        const r = await fetch(`/catalog/${e.id}/generated-cover`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' },
          body: blob, signal: scanSignal(_spTok) });
        const j = await r.json();
        if (j.ok && !j.skipped) made++; else if (j.skipped) skipped++; else failed++;
      } catch (err) {
        if (err?.name === 'AbortError') break;
        failed++;
      }
      updateScanProgress(i + 1, `Generating covers ${i + 1}/${ids.length} · ${made} made`, _spTok);
      await bgBreather();
    }
    showToast(`Generated ${made} cover${made === 1 ? '' : 's'}${skipped ? `, ${skipped} already had one` : ''}${failed ? `, ${failed} failed` : ''}`);
    _purgeMissingCoverCache();
    markFieldStale({ live: false });
    await loadCatalog();
    await repairScan();
  } finally {
    endScanProgress(_spTok);
  }
}
// pilot 10396
// The Repair button that rescans just the tracks a finding lists.
function rescanRowsAction(rows) {
  return { label: rows.length === 1 ? 'Rescan this track' : `Rescan these ${rows.length} tracks`,
           run: async () => { await rescanAll(rows); await repairScan(); } };
}
// rows: Repair rows ({id, slug, filename}) to rescan, which may sit in any Field; without
// them, every track in the open Field. Lite: a Repair finding rescans only its own tracks,
// not the whole library (Mark, 28 Oct).
async function rescanAll(rows) {
  const btn      = document.getElementById('rescan-all-btn') || {};   // Lite: the List has no Rescan button; progress shows on the Repair bar
  const duration = document.getElementById('rescan-duration')?.value || '0.5';   // Lite: no scan-length menu; the pilot's default
  const eligible = (rows
    ? rows.map(r => catalog.find(e => e.id === r.id) || { id: r.id, _cat: r.slug, filename: r.filename })
    : catalog.filter(e => e.has_file)).filter(e => !rescanningIds.has(e.id));
  if (!eligible.length) { showToast('Nothing to rescan: no audio file could be found for these tracks.'); return; }

  btn.disabled    = true;
  btn.textContent = `↻ 0/${eligible.length}`;
  const _spTok = startScanProgress(`Rescanning…`, eligible.length);

  let done = 0;
  for (const entry of eligible) {
    if (isScanCancelled(_spTok)) {
      // Release any IDs we never actually scanned so the spinner clears.
      rescanningIds.delete(entry.id);
      break;
    }
    rescanningIds.add(entry.id);
    renderCatalog();
    try {
      const form = new FormData();
      form.append('duration', duration);
      const res  = await fetch(`/catalog/${entry.id}/rescan?cat=${entry._cat||activeCatalog}`, {
        method:'POST', body:form, signal: scanSignal(_spTok)
      });
      const data = await res.json();
      if (!data.error) {
        entry.data          = data;
        entry.analyzed_at   = new Date().toISOString().slice(0,19);
        entry.scan_duration = parseFloat(duration);
      }
    } catch(e) {
      if (e?.name === 'AbortError') { rescanningIds.delete(entry.id); break; }
    }
    rescanningIds.delete(entry.id);
    done++;
    btn.textContent = `↻ ${done}/${eligible.length}`;
    updateScanProgress(done, `${done}/${eligible.length} · ${entry.filename}`, _spTok);
    renderCatalog();
  markFieldStale({ vec: true, live: false });   // feature VALUES changed — same ids, so only analyzed_at moves the sig; the vec caches never see it
    // Each rescan is a full librosa run holding the app-wide lock — the one chunked job
    // that escaped the courtesy net (2026-08-29 verify pass). Same breather as the
    // analyse pump and the repair CH-loops: yields between tracks while the user is
    // on the Field or List tab so their session stays fluid.
    await bgBreather();
  }

  const wasCancelled = isScanCancelled(_spTok);
  endScanProgress(_spTok);
  btn.disabled    = false;
  btn.textContent = '↻ Rescan all';
  if (wasCancelled) showToast(`Rescan cancelled at ${done}/${eligible.length}`);
}
// pilot 13296
function _purgeMissingCoverCache() {
  if (typeof _coverTexCache === 'undefined') return;
  for (const [k, v] of _coverTexCache) if (v === 'none') _coverTexCache.delete(k);
}

// The pilot's two-owner task tokens, cut to one owner with its bar on this tab: long jobs
// (cover extraction, rescans) must show progress where you started them.
let _rp = { tok: null, abort: null, cancelled: false, total: 0 };
function startScanProgress(label, total) {
  if (_rp.tok) _rp.tok.superseded = true;
  try { _rp.abort?.abort(); } catch (_) {}
  const abort = new AbortController();
  _rp = { tok: { abort }, abort, cancelled: false, total: total || 0 };
  document.getElementById('repair-progress').hidden = false;
  updateScanProgress(0, label, _rp.tok);
  return _rp.tok;
}
function updateScanProgress(done, label, tok) {
  if (!tok || tok.superseded || tok !== _rp.tok) return;
  const frac = _rp.total ? done / _rp.total : done;   // callers pass a count with a total, or a 0..1 fraction
  document.getElementById('rp-fill').style.width = (Math.max(0.02, Math.min(1, frac || 0)) * 100).toFixed(1) + '%';
  if (label !== undefined) document.getElementById('rp-label').textContent = label;
}
function endScanProgress(tok) {
  if (!tok || tok !== _rp.tok) return;
  _rp.abort = null;
  document.getElementById('repair-progress').hidden = true;
}
function cancelScan() {
  if (!_rp.abort) return;
  _rp.cancelled = true; _rp.tok.superseded = true;
  try { _rp.abort.abort(); } catch (_) {}
  endScanProgress(_rp.tok);
  showToast('Task cancelled');
}
function scanSignal(tok) { return tok?.abort?.signal; }
function isScanCancelled(tok) { return !!tok?.superseded || (tok === _rp.tok && _rp.cancelled); }

Object.assign(window, { extractGenres, repairSlugs, setRepairField, syncRepairFieldSelect, repairScan, renderRepair, repairToggle, repairAction, ignoreRepairRow, ignoreCategoryAll, unignoreAll, fpcalcMissing, deleteDupRow, previewDedup, previewTagFilenames, undoTagFilenames, showRepairModal, closeRepairModal, extractCovers, keyCoverColor, drawGeneratedCover, generateCovers, rescanAll, _purgeMissingCoverCache, repairRender: renderRepair, cancelRepairTask: cancelScan });
