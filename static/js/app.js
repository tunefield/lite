// Entry: tabs and boot. Each tab is its own module (handover §5.7).
import { catalog, allCatalogs, loadCatalogMeta, loadCatalog } from './field.js';
import { analyseBoot } from './analyse.js';
import './list.js';
import './export.js';
import './feedback.js';
import './queue.js';
import './tools.js';
import './repair.js';

const TABS = ['analyse', 'neural', 'playlists', 'catalog', 'repair'];

// One filter bar and one key wheel serve both the Field (in its FILTERS / KEY drawers) and the
// List (in its sidebar); they move to whichever is showing. Replaces the pilot's
// moveFilterBarToActiveTab and its sidebar-grid machinery.
function moveFilters(name) {
  const bar = document.querySelector('.filter-bar'), wheel = document.getElementById('camelot-pane');
  const inField = name === 'neural';
  document.getElementById(inField ? 'filters-drawer-body' : 'list-filter-slot').appendChild(bar);
  (inField ? document.getElementById('key-drawer-body') : bar).appendChild(wheel);
  wheel.classList.toggle('in-neural-slot', inField);
}

function switchTab(name) {
  if (!TABS.includes(name)) name = 'analyse';
  if (name === 'neural' || name === 'catalog') moveFilters(name);
  for (const p of document.querySelectorAll('.tab-panel')) p.classList.toggle('active', p.id === `tab-${name}`);
  for (const b of document.querySelectorAll('.tab-btn')) b.classList.toggle('active', b.id === `tab-${name}-btn`);
  document.body.classList.remove(...TABS.map(t => `on-tab-${t}`));
  document.body.classList.add(`on-tab-${name}`);
  try { localStorage.setItem('active-tab', name); } catch (_) {}
  const field = document.getElementById('field-empty');
  field.hidden = true;
  if (name === 'neural') refreshSets();   // the set panel only draws while visible
  window.fieldShow(name === 'neural').then(() => {
    // Never a blank Field: an empty one says so and points at the one thing to do.
    field.hidden = !(name === 'neural' && catalog.length === 0);
  });
  if (name === 'analyse') window.renderLibRoots?.();
  if (name === 'catalog') loadCatalogMeta().then(() => loadCatalog());
  if (name === 'playlists') refreshSets().then(() => window.renderPlaylistsTab());
  if (name === 'repair') loadCatalogMeta().then(() => { window.syncRepairFieldSelect(); window.repairRender(); });
}
window.switchTab = switchTab;

const refreshSets = () => window.refreshPlaylistPanel();

// The transport is authored inside the Field but lives on the body, so it survives tab
// switches (pilot initSidePanel).
const tp = document.getElementById('neural-transport');
if (tp) document.body.appendChild(tp);
window.syncTransportPos();
window.addEventListener('resize', () => window.syncTransportPos());
document.body.classList.add('sp-open');
window.setPlaylistTrailMode(1, false);   // pilot applySavedLayout: Pathway button + body classes reflect "show all"
window._syncEdgeToggles?.();
// pilot 8431, Lite's popups only: a click outside closes the column and Field pickers.
document.addEventListener('click', e => {
  const cp = document.getElementById('col-picker');
  if (cp?.style.display === 'block' && !cp.contains(e.target) && !e.target.closest('[id$=col-btn]')) window.closeColPicker();
  const fp = document.getElementById('field-picker');
  if (fp?.style.display === 'block' && !fp.contains(e.target) && !e.target.closest('[id$=field-btn]')) window.closeFieldPicker?.();
});
window.renderPlaybackRangeUI();
// The List's filter panel remembers whether it was folded (pilot toggleFilterFold writes this).
try { document.body.classList.toggle('list-filters-collapsed', localStorage.getItem('list-filters-collapsed') === '1'); } catch (_) {}

await loadCatalogMeta();
await refreshSets();
const resumeWaiting = await analyseBoot();
// First launch (or an empty library) opens on Add music; otherwise where you left off.
const total = allCatalogs.reduce((t, c) => t + (c.count || 0), 0);
let saved = null;
try { saved = localStorage.getItem('active-tab'); } catch (_) {}
switchTab(resumeWaiting || !total ? 'analyse' : (TABS.includes(saved) ? saved : 'neural'));
