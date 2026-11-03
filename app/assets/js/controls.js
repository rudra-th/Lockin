/* Lockin — small settings controls shared by Settings and Schedule.
   One place for the row, toggle and stepper so both screens stay identical. */

import { el } from './util.js';
import { svg } from './icons.js';

export function group(label, ...cards) {
  return el('section', { class: 'setgroup' },
    el('div', { class: 'setgroup-label' }, label),
    ...cards
  );
}

export function setrow(title, desc, control) {
  return el('div', { class: 'setrow' },
    el('div', { class: 'txt' }, el('b', {}, title), el('span', {}, desc)),
    control
  );
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
    class: 'iconbtn stepper-btn', 'aria-label': label, innerHTML: svg(d > 0 ? 'plus' : 'minus', 15),
    onclick: () => { setfn(Math.max(lo, Math.min(hi, get() + d * step))); redraw(); },
  });
  wrap.append(mk(-1, 'Decrease'), val, mk(+1, 'Increase'));
  return wrap;
}
