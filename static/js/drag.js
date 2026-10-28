// Movable popups (Mark, 28 Oct): any card marked data-drag can be dragged by its first child,
// the title row. Buttons and fields in that row keep working. A moved card stays where it was
// put until the page reloads, and is pulled back on screen if the window shrinks.
const SKIP = 'button, input, select, textarea, a, label, [contenteditable]';
const MARGIN = 40;   // always leave this much of the title row inside the window

function place(box, left, top) {
  const w = box.offsetWidth;
  left = Math.min(Math.max(left, MARGIN - w), innerWidth - MARGIN);
  top = Math.min(Math.max(top, 0), innerHeight - MARGIN);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

document.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const box = e.target.closest('[data-drag]');
  const handle = box?.firstElementChild;
  if (!handle?.contains(e.target) || e.target.closest(SKIP)) return;
  e.preventDefault();   // no text selection while dragging
  // Take the card out of whatever centred or anchored it (flex overlay, translate(-50%),
  // right:) and pin it where it is now, at its current size.
  const r = box.getBoundingClientRect();
  Object.assign(box.style, { position: 'fixed', margin: '0', right: 'auto', bottom: 'auto',
                             transform: 'none', width: r.width + 'px' });
  place(box, r.left, r.top);
  box.dataset.moved = '1';
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  handle.setPointerCapture(e.pointerId);
  const move = ev => place(box, ev.clientX - dx, ev.clientY - dy);
  const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
});

// Put a moved card back where its own CSS places it (for popups that should reopen there).
window.dragReset = box => {
  for (const p of ['position', 'margin', 'right', 'bottom', 'transform', 'width', 'left', 'top']) box.style.removeProperty(p);
  delete box.dataset.moved;
};

addEventListener('resize', () => {
  for (const box of document.querySelectorAll('[data-drag][data-moved]')) { const r = box.getBoundingClientRect(); place(box, r.left, r.top); }
});
