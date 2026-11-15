// USB stick (1.1.0, U1): Settings' list of connected sticks, with "Put Tunefield on this stick",
// "Update" or "Repair" for each, and the run's progress. The rules live in usb_install.py;
// the server offers only what it may do, and says why not otherwise.
import { esc, showToast } from './field.js';
import { tfConfirmFetch } from './analyse.js';

const FS = { msdos: 'FAT32', exfat: 'exFAT', apfs: 'APFS', hfs: 'Mac OS Extended' };
const PHASE = { prepare: 'Getting ready', backup: 'Backing up the library', copy: 'Copying the app',
                verify: 'Checking the copy', swap: 'Swapping in the new app', cleanup: 'Tidying up',
                restore: 'Bringing the library back' };
let _usbPoll = null, _usbVersion = '';

const _size = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB';
const _name = p => p.split('/').pop();
const _when = iso => (iso || '').slice(0, 16).replace('T', ' ');
const _lib = b => `${b.tracks} tracks in ${b.fields} Field${b.fields === 1 ? '' : 's'}, ${b.sets} set${b.sets === 1 ? '' : 's'}`;
let _usbOffers = {};

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
    rows.push(`<div class="usb-head"><b>${esc(s.name)}</b> <span class="ea-none">· ${esc(FS[s.fs] || s.fs || 'disk')} · ${_size(s.free)} free</span></div>`);
    const offers = s.installs.length ? s.installs : [s.fresh];
    for (const o of offers) {
      const what = !s.installs.length ? 'No Tunefield yet'
        : `${o.folder === s.volume ? 'Top of the stick' : esc(_name(o.folder))} · `
          + (o.version ? `Tunefield ${esc(o.version)}${o.version === j.version ? ' (up to date)' : ''}` : 'app missing');
      const label = { install: 'Put Tunefield on this stick', update: `Update to ${esc(j.version)}`, repair: 'Repair' }[o.action];
      const act = o.refusal || !label ? ''
        : `<button class="btn-sm" data-folder="${esc(o.folder)}" data-action="${o.action}" data-stick="${esc(s.name)}">${label}</button>`;
      rows.push(`<div class="usb-row"><span class="ea-path" title="${esc(o.folder)}">${what}</span>${act}</div>`
        + (o.refusal ? `<div class="usb-why">${esc(o.refusal)}</div>` : ''));
      _usbOffers[o.folder] = o;
      // The stick's library backup, when the library there is gone or much smaller: always
      // offered, never automatic (U1 safety net). A fresh install asks inside its own dialog.
      if (o.restore && s.installs.length && (!o.refusal || o.action === 'newer'))
        rows.push(`<div class="usb-row"><span class="ea-path">Backup from ${esc(_when(o.restore.made_at))}: ${esc(_lib(o.restore))}</span>
          <button class="btn-sm" data-folder="${esc(o.folder)}" data-action="restore" data-stick="${esc(s.name)}">Bring library back</button></div>`);
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
  const o = _usbOffers[folder] || {}, b = o.restore;
  if (action === 'restore') {
    const ok = await window.tfDialog({ title: 'Bring the library back on ' + on, ok: 'Bring it back',
      html: `<p>The backup from ${esc(_when(b.made_at))} holds ${esc(_lib(b))}, with ratings, tags and settings (the Pro key included).</p>
             <p>The library in <b>${where}</b> now has ${b.now_tracks} tracks. It is kept in a folder beside it, not deleted.</p>` });
    if (ok) _usbStart(folder, action);
    return;
  }
  const choice = action === 'install' && b
    ? `<p>This stick has a backup of a library from ${esc(_when(b.made_at))}: ${esc(_lib(b))}.</p>
       <label style="display:block"><input type="radio" name="usb-r" data-field="back" checked> Bring that library back</label>
       <label style="display:block"><input type="radio" name="usb-r" data-field="fresh"> Start with an empty library (the backup is put aside)</label>` : '';
  const ask = {
    install: ['Put Tunefield on ' + on, `Tunefield ${v} goes into a folder called <b>${where}</b> on ${on}. Your library on the stick will live there too. Nothing else on the stick is touched.`, 'Put it on the stick'],
    update: ['Update ' + on, `The app in <b>${where}</b> is replaced by Tunefield ${v}. Your library and everything else on the stick stay as they are.`, 'Update'],
    repair: ['Repair ' + on, `The app in <b>${where}</b> is copied fresh. Your library and everything else on the stick stay as they are.`, 'Repair'],
  }[action];
  const ok = await window.tfDialog({ title: ask[0], ok: ask[2],
    html: `<p>${ask[1]}</p>${choice}<p>It takes a minute or two. Leave the stick plugged in until it says it's done.</p>` });
  if (!ok) return;
  _usbStart(folder, action, b && action === 'install' ? !!ok.back : undefined);
}

async function _usbStart(folder, action, restore) {
  const r = await tfConfirmFetch('/usb/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                               body: JSON.stringify({ folder, action, restore }) });
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
      el.innerHTML = `<div class="usb-row"><span>${esc(PHASE[j.phase] || 'Working')}…${j.phase === 'copy' ? ' ' + j.pct + '%' : ''}</span></div>
        <progress max="100" value="${j.phase === 'copy' ? j.pct : j.phase === 'prepare' ? 0 : 100}" style="width:100%"></progress>
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

// ── On a copy running from a stick: the library's backup (stick_backup.py) ──────────────
async function backupRefresh() {
  const j = await fetch('/backup/status').then(r => r.ok ? r.json() : null).catch(() => null);
  const row = document.getElementById('backup-settings-row');
  if (!row || !j?.on_stick) return j;
  row.hidden = false;
  const why = { space: 'skipped: not enough space on the stick', toobig: 'skipped: the library is too big for it',
                failed: 'could not be written', shrunk: 'kept as it was: the library here is much smaller' }[j.last?.status];
  document.getElementById('backup-settings-state').textContent = j.backup
    ? `Saved ${_when(j.backup.made_at)} on this stick (${j.backup.tracks} tracks)` + (why ? `; last try ${why}` : '')
    : (why ? `Not saved yet: ${why}` : 'Not saved yet. Tunefield saves one shortly after it starts.');
  return j;
}

// At launch on a stick: say once that a requested restore happened, or offer the backup when
// the library here is gone or much smaller. Never automatic, and "Ask me later" decides nothing.
async function backupBoot() {
  const j = await backupRefresh();
  if (!j?.on_stick) return;
  if (j.restored) {
    showToast(j.restored.ok ? 'The library is back from the stick\'s backup.' + (j.restored.kept ? ` What was here before is kept in ${j.restored.kept}.` : '')
                            : 'The library could not be brought back: ' + j.restored.error, { duration: 9000 });
    return;
  }
  const b = j.offer;
  if (!b) return;
  const ok = await window.tfDialog({ title: 'Bring your library back?', ok: 'Continue', cancel: 'Ask me later',
    html: `<p>This stick has a backup of your library from ${esc(_when(b.made_at))}: ${esc(_lib(b))}, with ratings, tags and settings (the Pro key included). The library here now has ${b.now_tracks} tracks.</p>
      <label style="display:block"><input type="radio" name="bk-r" data-field="back" checked> Bring it back. Tunefield closes; open it again and the library is there. What is here now is kept in a folder beside it.</label>
      <label style="display:block"><input type="radio" name="bk-r" data-field="fresh"> Start fresh. The backup is put aside and not offered again.</label>` });
  if (!ok) return;
  const r = await tfConfirmFetch('/backup/choose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                     body: JSON.stringify({ choice: ok.back ? 'restore' : 'fresh' }) });
  const k = await r.json().catch(() => ({}));
  if (!r.ok) { showToast(k.error || 'That did not work.', { duration: 7000 }); return; }
  if (k.quitting) window.tfDialog({ title: 'Tunefield is closing', ok: 'OK', cancel: '',
    html: '<p>Open Tunefield again: your library is brought back as it starts.</p>' });
  else backupRefresh();
}

// Add music's hint, for a stick user who opened the download only to update a stick: shown
// whenever this copy can put itself on one (the Mac app, not a copy running from a stick).
document.addEventListener('DOMContentLoaded', async () => {
  const j = await fetch('/usb/sticks').then(r => r.ok ? r.json() : null).catch(() => null);
  const h = document.getElementById('usb-hint');
  if (h && j && !j.refusal) h.hidden = false;
  backupBoot();
}, { once: true });

Object.assign(window, { usbRefresh, backupRefresh });
