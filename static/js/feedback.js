// Feedback: opens the beta Google Form with diagnostics prefilled (and copied as a backup).
// Send/copy/prefill are the pilot's (index.html @ 7c8c0e7); the diagnostics are Lite's (handover §5.6).
import { showToast, allCatalogs, activeCatalog, viewedCatalogs } from './field.js';


// pilot 18570
const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSf__XC9wrViFCPKYuzR2bbw1vrkzUv7G1fEgbZkcWqFpD8BqQ/viewform';
// pilot 18571
const FEEDBACK_EMAIL    = 'mark@tunefield.app';   // mailto fallback if no form URL
// pilot 18578
function tfOpenExternal(url) {
  try {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (_) { try { window.open(url, '_blank', 'noopener'); } catch (__) {} }
}
// pilot 18624
function closeFeedback() { document.getElementById('feedback-modal').style.display = 'none'; }
// pilot 18673
async function copyFeedbackDiag() {
  const txt = document.getElementById('feedback-diag').value;
  try { await navigator.clipboard.writeText(txt); showToast('Diagnostics copied to clipboard'); }
  catch { document.getElementById('feedback-diag').select(); document.execCommand('copy'); showToast('Diagnostics selected — press ⌘/Ctrl-C'); }
}
// pilot 18683
const FEEDBACK_ENTRY_NAME = 'entry.1446201360';
// pilot 18684
const FEEDBACK_ENTRY_DIAG = 'entry.519957083';
// pilot 18685
function feedbackFormUrl(diag) {
  if (!FEEDBACK_FORM_URL) return '';
  // The shortlink can't take query params — prefill needs the resolved /forms/d/e/… URL.
  const base = FEEDBACK_FORM_URL.includes('/forms/d/e/') ? FEEDBACK_FORM_URL : '';
  if (!base) return FEEDBACK_FORM_URL;
  const lic = {};   // Lite has no licence; the Name field stays for the tester to fill
  // Keys are minted with the tester's EMAIL as the licensee label, and the form field it
  // fills is labelled "Name" — so send the local part, not the address itself. Still unique
  // across the beta group, and nobody is surprised by their own email in a Name box.
  const who = lic.unlocked ? String(lic.lic || '').split('@')[0] : '';
  const p = new URLSearchParams({ usp: 'pp_url' });
  if (who)  p.set(FEEDBACK_ENTRY_NAME, who);
  if (diag) p.set(FEEDBACK_ENTRY_DIAG, diag);
  return base + (base.includes('?') ? '&' : '?') + p.toString();
}
// pilot 18700
async function submitFeedback() {
  await copyFeedbackDiag();
  if (FEEDBACK_FORM_URL) {
    const diag = document.getElementById('feedback-diag')?.value || '';
    const url  = feedbackFormUrl(diag);
    tfOpenExternal(url);
    showToast(url === FEEDBACK_FORM_URL
      ? 'Form opened — paste the diagnostics into the last field'
      : 'Form opened — diagnostics already filled in');
  } else {
    // No form configured yet → email fallback with the diagnostics in the body.
    const body = encodeURIComponent('What happened / idea:\n\n\n' + document.getElementById('feedback-diag').value);
    tfOpenExternal(`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Field beta feedback')}&body=${body}`);
    showToast('Opening your email — diagnostics are included');
  }
  closeFeedback();
}

window.__tfLastError = null;
window.addEventListener('error', e => { window.__tfLastError = `${e.message || e.type} @ ${(e.filename || '').split('/').pop()}:${e.lineno || '?'}`; });
window.addEventListener('unhandledrejection', e => { window.__tfLastError = 'promise: ' + String(e.reason?.message || e.reason).slice(0, 200); });

// pilot 18598 (rewritten): what a report needs to be reproducible, and the beta's one number.
async function buildFeedbackContext() {
  let h = {};
  try { h = await (await fetch('/diagnostics')).json(); } catch (_) {}
  const activeCat = allCatalogs.find(c => c.slug === activeCatalog) || {};
  const tab = [...document.body.classList].find(c => c.startsWith('on-tab-'))?.replace('on-tab-', '') || '?';
  return [
    '--- Tunefield Lite diagnostics (do not edit) ---',
    `version: ${h.version || '?'}   macOS: ${h.macos || '?'} (${h.arch || '?'})   python: ${h.python || '?'}`,
    `data: ${h.root_mode || '?'}   tab: ${tab}`,
    `active Field: ${activeCat.name || '?'} (${activeCat.count ?? '?'} tracks)   viewed: ${viewedCatalogs.size} of ${allCatalogs.length}`,
    `minutes to first export: ${h.minutes_to_first_export ?? 'not yet'}`,
    `last error: ${window.__tfLastError || 'none'}`,
    `screen: ${window.innerWidth}×${window.innerHeight}`,
    h.crash_tail ? '--- crash.log (last 50 lines) ---\n' + h.crash_tail : 'crash.log: empty',
  ].join('\n');
}
async function openFeedback() {
  document.getElementById('feedback-modal').style.display = 'flex';
  const ta = document.getElementById('feedback-diag');
  if (ta) { ta.value = 'Collecting diagnostics…'; ta.value = await buildFeedbackContext(); }
}

Object.assign(window, { tfOpenExternal, closeFeedback, copyFeedbackDiag, feedbackFormUrl, submitFeedback, openFeedback });
