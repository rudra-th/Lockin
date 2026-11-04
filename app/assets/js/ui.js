/* Lockin — shared UI widgets: bottom sheet + transient hint. */

import { el } from './util.js';
import { svg } from './icons.js';

/* ---------- bottom sheet ---------- */

let sheetEl = null;
let backdropEl = null;
let sheetKeys = null;        // keydown handler while a sheet is open
let sheetReturnFocus = null; // element to hand focus back to on close

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function sheetFocusables() {
  return [...sheetEl.querySelectorAll(FOCUSABLE)]
    .filter((n) => !n.disabled && n.getClientRects().length > 0);
}

export function openSheet(title, makeBody) {
  closeSheet(true);
  backdropEl = el('div', { class: 'backdrop', onclick: () => closeSheet() });
  const closeBtn = el('button', {
    class: 'iconbtn', 'aria-label': 'Close', innerHTML: svg('x', 16), onclick: () => closeSheet(),
  });
  const headRow = el('div', { class: 'row', style: 'margin:2px 4px 10px' },
    el('h3', {}, title), el('div', { class: 'sp' }), closeBtn
  );
  sheetEl = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'grab' }),
    headRow
  );
  const parts = makeBody(() => closeSheet());
  (Array.isArray(parts) ? parts : [parts]).forEach((n) => n && sheetEl.append(n));
  document.body.append(backdropEl, sheetEl);

  /* Modal behavior: Escape closes, Tab stays inside, focus enters on open
     and returns to whoever opened it on close. */
  sheetReturnFocus = document.activeElement;
  const first = sheetFocusables()[0];
  if (first) first.focus();
  sheetKeys = (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      closeSheet();
      return;
    }
    if (ev.key !== 'Tab' || !sheetEl) return;
    const items = sheetFocusables();
    if (!items.length) return;
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (!sheetEl.contains(document.activeElement)) {
      ev.preventDefault();
      firstItem.focus();
    } else if (ev.shiftKey && document.activeElement === firstItem) {
      ev.preventDefault();
      lastItem.focus();
    } else if (!ev.shiftKey && document.activeElement === lastItem) {
      ev.preventDefault();
      firstItem.focus();
    }
  };
  document.addEventListener('keydown', sheetKeys);

  requestAnimationFrame(() => {
    backdropEl.classList.add('show');
    sheetEl.classList.add('show');
  });
}

export function closeSheet(instant = false) {
  if (sheetKeys) {
    document.removeEventListener('keydown', sheetKeys);
    sheetKeys = null;
  }
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
  if (sheetReturnFocus) {
    sheetReturnFocus.focus(); // a detached opener simply ignores focus()
    sheetReturnFocus = null;
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

/* ---------- daily goal meter ---------- */

export function goalMeter({ label = 'Daily target' } = {}) {
  return el('div', {
    class: 'goal-meter', role: 'progressbar',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
  },
    el('div', { class: 'gm-top' },
      el('span', { class: 'gm-label' }, label),
      el('span', { class: 'gm-val' },
        el('b', { class: 'gm-num' }, '0'),
        el('span', { class: 'gm-goal' }, ' / 0 min'))),
    el('div', { class: 'gm-track' }, el('i', { class: 'gm-fill' })),
    el('div', { class: 'gm-foot' },
      el('span', { class: 'gm-pct' }, '0% of target'),
      el('span', { class: 'gm-left' }, '—'))
  );
}

export function updateGoalMeter(root, { total = 0, goal = 0 } = {}) {
  if (!root) return;
  const g = Math.max(1, Math.round(goal || 0));
  const done = Math.max(0, Math.floor(total || 0));
  const pct = Math.min(100, Math.round((done / g) * 100));
  root.setAttribute('aria-valuenow', String(pct));
  root.classList.toggle('is-met', pct >= 100);
  const num = root.querySelector('.gm-num');
  const goalEl = root.querySelector('.gm-goal');
  const fill = root.querySelector('.gm-fill');
  const pctEl = root.querySelector('.gm-pct');
  const leftEl = root.querySelector('.gm-left');
  if (num) num.textContent = String(done);
  if (goalEl) goalEl.textContent = ` / ${g} min`;
  if (fill) fill.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = pct >= 100 ? 'Target met' : `${pct}% of target`;
  if (leftEl) leftEl.textContent = pct >= 100 ? 'Everything counts now' : `${g - done} min to go`;
}
