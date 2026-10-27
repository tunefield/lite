// Entry: tabs and boot. Each tab is its own module (handover §5.7).
import { catalog, allCatalogs, loadCatalogMeta, loadCatalog } from './field.js';
import { analyseBoot } from './analyse.js';
import './list.js';

const TABS = ['analyse', 'neural', 'catalog'];   // playlists and repair join as their modules land

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
  if (name !== 'analyse') moveFilters(name);
  for (const p of document.querySelectorAll('.tab-panel')) p.classList.toggle('active', p.id === `tab-${name}`);
  for (const b of document.querySelectorAll('.tab-btn')) b.classList.toggle('active', b.id === `tab-${name}-btn`);
  document.body.classList.remove(...TABS.map(t => `on-tab-${t}`));
  document.body.classList.add(`on-tab-${name}`);
  try { localStorage.setItem('active-tab', name); } catch (_) {}
  const field = document.getElementById('field-empty');
  field.hidden = true;
  window.fieldShow(name === 'neural').then(() => {
    // Never a blank Field: an empty one says so and points at the one thing to do.
    field.hidden = !(name === 'neural' && catalog.length === 0);
  });
  if (name === 'analyse') window.renderLibRoots?.();
  if (name === 'catalog') loadCatalogMeta().then(() => loadCatalog());
}
window.switchTab = switchTab;

await loadCatalogMeta();
const resumeWaiting = await analyseBoot();
// First launch (or an empty library) opens on Add music; otherwise where you left off.
const total = allCatalogs.reduce((t, c) => t + (c.count || 0), 0);
let saved = null;
try { saved = localStorage.getItem('active-tab'); } catch (_) {}
switchTab(resumeWaiting || !total ? 'analyse' : (TABS.includes(saved) ? saved : 'neural'));
