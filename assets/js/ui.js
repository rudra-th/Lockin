/* Lockin — shared UI widgets: bottom sheet + transient hint. */

import { el } from './util.js';
import { svg } from './icons.js';

/* ---------- bottom sheet ---------- */

let sheetEl = null;
let backdropEl = null;

export function openSheet(title, makeBody) {
  closeSheet(true);
  backdropEl = el('div', { class: 'backdrop', onclick: () => closeSheet() });
  const closeBtn = el('button', {
    class: 'iconbtn', 'aria-label': 'Close', innerHTML: svg('x', 16), onclick: () => closeSheet(),
  });
  const headRow = el('div', { class: 'row', style: 'margin:2px 4px 10px' },
    el('h3', {}, title), el('div', { class: 'sp' }), closeBtn
  );
  sheetEl = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    el('div', { class: 'grab' }),
    headRow
  );
  const parts = makeBody(() => closeSheet());
  (Array.isArray(parts) ? parts : [parts]).forEach((n) => n && sheetEl.append(n));
  document.body.append(backdropEl, sheetEl);
  requestAnimationFrame(() => {
    backdropEl.classList.add('show');
    sheetEl.classList.add('show');
  });
}

export function closeSheet(instant = false) {
  if (sheetEl) {
    const s = sheetEl;
    sheetEl = null;
    if (instant) s.remove();
    else { s.classList.remove('show'); setTimeout(() => s.remove(), 320); }
  }
  if (backdropEl) {
    const b = backdropEl;
    backdropEl = null;
    if (instant) b.remove();
    else { b.classList.remove('show'); setTimeout(() => b.remove(), 320); }
  }
}

/* ---------- transient hint pill ---------- */

let hintEl = null;
let hintTimer = null;

export function hint(text) {
  if (hintEl) hintEl.remove();
  hintEl = el('div', { class: 'hint', role: 'status' }, text);
  document.body.append(hintEl);
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (hintEl) { hintEl.remove(); hintEl = null; }
  }, 2600);
}
