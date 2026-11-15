// USB stick (1.1.0, U1): Settings' list of connected sticks, with "Put Tunefield on this stick",
// "Update" or "Repair" for each, and the run's progress. The rules live in usb_install.py;
// the server offers only what it may do, and says why not otherwise.
import { esc, showToast } from './field.js';
import { tfConfirmFetch } from './analyse.js';

const FS = { msdos: 'FAT32', exfat: 'exFAT', apfs: 'APFS', hfs: 'Mac OS Extended' };
const PHASE = { prepare: 'Getting ready', copy: 'Copying the app', verify: 'Checking the copy',
                swap: 'Swapping in the new app', cleanup: 'Tidying up' };
let _usbPoll = null, _usbVersion = '';

const _size = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB';
const _name = p => p.split('/').pop();

async function usbRefresh() {
  const el = document.getElementById('usb-sticks');
  if (!el || _usbPoll) return;                     // a run draws its own progress
  const job = await fetch('/usb/job').then(r => r.ok ? r.json() : null).catch(() => null);
  if (job && !job.done) { usbWatch(); return; }    // Settings reopened mid-run
  const j = await fetch('/usb/sticks').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!j) { el.innerHTML = '<span class="ea-none">Could not look for sticks.</span>'; return; }
  _usbVersion = j.version;
  if (j.refusal) { el.innerHTML = `<span class="ea-none">${esc(j.refusal)}</span>`; return; }
  const rows = [];
  for (const s of j.sticks) {
    const stick = `${esc(s.name)} <span class="ea-none">· ${esc(FS[s.fs] || s.fs || 'disk')} · ${_size(s.free)} free</span>`;
    const offers = s.installs.length ? s.installs : [s.fresh];
    for (const o of offers) {
      const what = !s.installs.length ? 'No Tunefield yet'
        : `${o.folder === s.volume ? 'Top of the stick' : esc(_name(o.folder))} · `
          + (o.version ? `Tunefield ${esc(o.version)}${o.version === j.version ? ' (up to date)' : ''}` : 'app missing');
      const label = { install: 'Put Tunefield on this stick', update: `Update to ${esc(j.version)}`, repair: 'Repair' }[o.action];
      const act = o.refusal || !label ? `<span class="ea-none" style="grid-column:1/-1">${esc(o.refusal || '')}</span>`
        : `<button class="btn-sm" data-folder="${esc(o.folder)}" data-action="${o.action}" data-stick="${esc(s.name)}">${label}</button>`;
      rows.push(`<div class="ea-row"><span class="ea-kind">${stick}</span><span class="ea-path">${what}</span>${act}</div>`);
    }
  }
  el.innerHTML = (rows.join('') || '<span class="ea-none">No stick connected. Plug one in, then look again.</span>')
    + '<div><button class="btn-sm" id="usb-look">Look again</button></div>';
  el.querySelector('#usb-look').onclick = usbRefresh;
  el.querySelectorAll('button[data-folder]').forEach(b =>
    b.onclick = () => usbRun(b.dataset.folder, b.dataset.action, b.dataset.stick));
}

async function usbRun(folder, action, stick) {
  const v = esc(_usbVersion), where = esc(_name(folder)), on = esc(stick);
  const ask = {
    install: ['Put Tunefield on ' + on, `Tunefield ${v} goes into a folder called <b>${where}</b> on ${on}. Your library on the stick will live there too. Nothing else on the stick is touched.`, 'Put it on the stick'],
    update: ['Update ' + on, `The app in <b>${where}</b> is replaced by Tunefield ${v}. Your library and everything else on the stick stay as they are.`, 'Update'],
    repair: ['Repair ' + on, `The app in <b>${where}</b> is copied fresh. Your library and everything else on the stick stay as they are.`, 'Repair'],
  }[action];
  const ok = await window.tfDialog({ title: ask[0], ok: ask[2],
    html: `<p>${ask[1]}</p><p>It takes a minute or two. Leave the stick plugged in until it says it's done.</p>` });
  if (!ok) return;
  const r = await tfConfirmFetch('/usb/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                               body: JSON.stringify({ folder, action }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { showToast(j.refusal || j.error || 'Could not start.', { duration: 7000 }); usbRefresh(); return; }
  usbWatch();
}

function usbWatch() {
  const el = document.getElementById('usb-sticks');
  const tick = async () => {
    const j = await fetch('/usb/job').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!j) return;
    if (!j.done) {
      el.innerHTML = `<div class="ea-row"><span class="ea-kind">${esc(PHASE[j.phase] || 'Working')}…</span>
        <progress max="100" value="${j.phase === 'copy' ? j.pct : j.phase === 'prepare' ? 0 : 100}" style="width:100%"></progress>
        <span class="ea-none">${j.phase === 'copy' ? j.pct + '%' : ''}</span></div>
        <span class="ea-none">Leave the stick plugged in.</span>`;
      return;
    }
    clearInterval(_usbPoll); _usbPoll = null;
    usbRefresh();
    window.tfDialog({ title: j.ok ? 'Done' : 'Stopped', html: `<p>${esc(j.message)}</p>`, ok: 'OK', cancel: '' });
  };
  _usbPoll = setInterval(tick, 700);
  tick();
}

// Add music's hint, for a stick user who opened the download only to update a stick: shown
// whenever this copy can put itself on one (the Mac app, not a copy running from a stick).
document.addEventListener('DOMContentLoaded', async () => {
  const j = await fetch('/usb/sticks').then(r => r.ok ? r.json() : null).catch(() => null);
  const h = document.getElementById('usb-hint');
  if (h && j && !j.refusal) h.hidden = false;
}, { once: true });

Object.assign(window, { usbRefresh });
