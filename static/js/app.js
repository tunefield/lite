// Entry: tabs and boot. Each tab is its own module (handover §5.7).
import { catalog, allCatalogs, loadCatalogMeta } from './field.js';
import { analyseBoot } from './analyse.js';

const TABS = ['analyse', 'neural'];   // playlists, catalog, repair join as their modules land

function switchTab(name) {
  if (!TABS.includes(name)) name = 'analyse';
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
}
window.switchTab = switchTab;

await loadCatalogMeta();
const resumeWaiting = await analyseBoot();
// First launch (or an empty library) opens on Add music; otherwise where you left off.
const total = allCatalogs.reduce((t, c) => t + (c.count || 0), 0);
let saved = null;
try { saved = localStorage.getItem('active-tab'); } catch (_) {}
switchTab(resumeWaiting || !total ? 'analyse' : (TABS.includes(saved) ? saved : 'neural'));
