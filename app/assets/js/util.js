/* Lockin — DOM helpers plus the shared pure core, re-exported so every
   existing import keeps working. The core itself lives in /app/core. */

export * from '../../core/time.js';
export * from '../../core/goal.js';
export * from '../../core/session.js';
export * from '../../core/schedule.js';
export * from '../../core/week.js';
export * from '../../core/notify.js';

/* ---------- dom ---------- */

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

/**
 * el('div', {class: 'card', onclick: fn}, el('h2', {}, 'Title'))
 * Children may be strings, nodes, or our own svg() markup strings
 * (parsed through a template — never arbitrary user data).
 *
 * SVG tags must be created in the SVG namespace; document.createElement()
 * would hand back an inert HTMLUnknownElement and the shape would never paint.
 */
const _tpl = document.createElement('template');
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'circle', 'rect', 'text', 'title', 'path', 'g', 'line',
  'polyline', 'polygon', 'ellipse', 'defs', 'use', 'mask', 'clipPath',
  'linearGradient', 'radialGradient', 'stop',
]);

export function el(tag, attrs = {}, ...children) {
  const isSvg = SVG_TAGS.has(tag);
  const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') {
      if (isSvg) node.setAttribute('class', v);
      else node.className = v;
    } else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (!isSvg && k in node && k !== 'list' && k !== 'type' && k !== 'value') {
      try { node[k] = v; } catch (_) { node.setAttribute(k, v); }
    } else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === '') continue;
    if (c.nodeType) { node.append(c); continue; }
    const s = String(c).trim();
    if (s.startsWith('<svg') && s.endsWith('</svg>')) {
      _tpl.innerHTML = s;
      node.append(_tpl.content);
      continue;
    }
    node.append(document.createTextNode(String(c)));
  }
  return node;
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
