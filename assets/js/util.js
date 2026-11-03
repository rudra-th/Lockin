/* Lockin — small shared helpers. Everything meaningful lives in the view modules. */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

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
 */
const _tpl = document.createElement('template');
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list' && k !== 'type' && k !== 'value') {
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

/* ---------- time ---------- */

/** slot index (0..47, 30-min grid) → "HH:MM" */
export function slotsToT(slot) {
  const m = Math.max(0, Math.min(48 * 30, slot * 30));
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

/** "HH:MM" → slot index; clamps to [0, 48] */
export function tToSlots(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return Math.max(0, Math.min(48, Math.round((h * 60 + (m || 0)) / 30)));
}

/** seconds → "mm:ss" / "h:mm:ss" (ceiling, for countdowns) */
export function fmtClock(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** seconds elapsed → "00:00" / "1:02:05" (floor — for the up-counting stopwatch) */
export function fmtWatch(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** minutes → "1h 25m" / "42m" */
export function fmtMin(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${pad2(m)}m` : `${h}h`;
}

/* ---------- dates ---------- */

/** local date → "YYYY-MM-DD" (no UTC drift) */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey() {
  return dateKey();
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function weekdayShort(key) {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'short' });
}

export function prettyDate(key) {
  const d = parseKey(key);
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** whole calendar days from today to key — 0 means today, negative means past */
export function daysUntil(key, from = new Date()) {
  if (!key) return null;
  const target = parseKey(key);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target - today) / 86400000);
}

/* ---------- enforcement math (pure — see tests.html) ---------- */

/**
 * Decide what an away-episode means during a strict session.
 * awaySec     : how long the page was hidden
 * usedRescues : rescues already spent today
 * graceSec    : accident window (default 10)
 * cap         : free rescues per day (default 3)
 */
export function decideAway({ awaySec = 0, usedRescues = 0, graceSec = 10, cap = 3 }) {
  if (awaySec <= graceSec && usedRescues < cap) return 'rescue';
  return 'slip';
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
