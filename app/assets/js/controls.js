/* Lockin — small settings controls shared by Settings and Schedule.
   One place for the row, toggle and stepper so both screens stay identical. */

import { el } from './util.js';
import { svg } from './icons.js';

let rowSeq = 0;

/* A control inside a setrow is almost always icon-only or a bare switch. Give
   it the row's title as its accessible name, so a screen reader hears
   "Strict Mode, switch, off" instead of "button, switch, off". */
function nameControl(control, id, title) {
  if (!control || control.nodeType !== 1) return;

  const labelled = control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby');

  if (control.classList.contains('stepper') || control.classList.contains('segmented')) {
    control.setAttribute('role', 'group');
    control.setAttribute('aria-labelledby', id);
    const value = control.querySelector('.stepper-val');
    if (value) {
      value.setAttribute('aria-live', 'polite');
      value.setAttribute('aria-atomic', 'true');
    }
    control.querySelectorAll('button').forEach((b) => {
      const dir = b.dataset.step === '1' ? 'Increase' : b.dataset.step === '-1' ? 'Decrease' : '';
      b.setAttribute('aria-label', dir ? `${dir} ${title}` : `${title}: ${b.textContent.trim()}`);
    });
    return;
  }

  if (control.tagName === 'BUTTON') {
    if (!labelled) control.setAttribute('aria-labelledby', id);
    return;
  }

  /* A wrapper of one or more buttons (permission rows, segmented groups). */
  const buttons = [...(control.querySelectorAll?.('button') || [])];
  if (!buttons.length) return;
  if (!labelled) {
    control.setAttribute('role', 'group');
    control.setAttribute('aria-labelledby', id);
  }
  buttons.forEach((b) => {
    if (!b.hasAttribute('aria-label') && !b.hasAttribute('aria-labelledby')) {
      b.setAttribute('aria-label', `${title}: ${b.textContent.trim()}`);
    }
  });
}

export function group(label, ...cards) {
  return el('section', { class: 'setgroup', 'aria-label': label },
    el('div', { class: 'setgroup-label', 'aria-hidden': 'true' }, label),
    ...cards
  );
}

export function setrow(title, desc, control) {
  const id = `setrow-${++rowSeq}`;
  const row = el('div', { class: 'setrow' },
    el('div', { class: 'txt' }, el('b', { id }, title), el('span', {}, desc)),
    control
  );
  nameControl(control, id, title);
  return row;
}

export function toggle(get, setfn) {
  const b = el('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(get()),
    onclick: () => {
      setfn();
      b.setAttribute('aria-checked', String(get()));
    },
  });
  return b;
}

export function stepper(get, setfn, opts) {
  const { lo, hi, step = 1, suffix = '', fmt = null } = opts;
  const show = (v) => (fmt ? fmt(v) : `${v}${suffix}`);
  const wrap = el('div', { class: 'stepper' });
  const val = el('span', { class: 'stepper-val' }, show(get()));
  const redraw = () => { val.textContent = show(get()); };
  const mk = (d, label) => el('button', {
    class: 'iconbtn stepper-btn', 'data-step': String(d), 'aria-label': label,
    innerHTML: svg(d > 0 ? 'plus' : 'minus', 15),
    onclick: () => { setfn(Math.max(lo, Math.min(hi, get() + d * step))); redraw(); },
  });
  wrap.append(mk(-1, 'Decrease'), val, mk(+1, 'Increase'));
  return wrap;
}
