#!/usr/bin/env node
/* Lockin - design floor check.
   Guards the rules the 2026-11-07 audit established:
     - no horizontal overflow at 375 or 390
     - no visible text below 12px
     - every control reaches an effective 44px target
   It drives a real headless browser (Chrome, Edge or Chromium) over the
   DevTools protocol, because a CSS scan cannot tell a decorative 22px glyph
   from a control that is hit-expanded to 44px with a pseudo-element.

   Usage:
     npm run design:check
     npm run design:check -- --require-browser   (CI: fail if no browser)

   Zero dependencies: Node's built-in http server and WebSocket. */

import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = join(ROOT, 'app');
const WIDTHS = [390, 375];
const ROUTES = ['home', 'plan', 'focus', 'control', 'progress', 'settings'];
const VIEW_FOR = { plan: 'schedule' };
const requireBrowser = process.argv.includes('--require-browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.apk': 'application/vnd.android.package-archive',
};

/* ---------- a tiny static server for app/ ---------- */

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(APP, path);
    if (!file.startsWith(APP)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'service-worker-allowed': '/',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ---------- browser discovery ---------- */

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  /* CI images usually put the browser on PATH but not where we guessed. */
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'msedge']) {
    try {
      const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim().split(/\r?\n/)[0];
      if (out && existsSync(out)) return out;
    } catch { /* not on PATH */ }
  }
  return null;
}

/* ---------- a very small CDP client ---------- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* ---------- the audit itself, run inside the page ---------- */

const AUDIT_FN = String.raw`
window.__lockinAudit = async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TARGET = '#view button, #view a[href], #view [role=button], #view [role=switch], #view input[type=checkbox], .tabbar button';
  const visible = (n) => {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const label = (n) => String(n.className || n.tagName).split(/\s+/).slice(0, 2).join('.').slice(0, 30);

  await document.fonts.ready;
  await sleep(120);

  const W = window.innerWidth;
  const overflow = Math.max(
    document.documentElement.scrollWidth, document.body.scrollWidth,
  ) - W;

  const tiny = [];
  for (const n of document.querySelectorAll('#view *')) {
    if (n.children.length) continue;
    if (!n.textContent.trim()) continue;
    if (n.closest('[aria-hidden="true"], svg')) continue;
    if (!visible(n)) continue;
    const fs = parseFloat(getComputedStyle(n).fontSize);
    if (fs < 11.99) tiny.push({ cls: label(n), fs: Math.round(fs * 100) / 100, text: n.textContent.trim().slice(0, 24) });
  }

  const bring = async (n) => {
    n.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(50);
    const r = n.getBoundingClientRect();
    const view = document.getElementById('view');
    if (view && (r.top < 70 || r.bottom > window.innerHeight - 120)) {
      const delta = r.top < 70 ? r.top - 90 : r.bottom - (window.innerHeight - 140);
      view.scrollTo({ top: view.scrollTop + delta, behavior: 'instant' });
      await sleep(50);
    }
  };

  const small = [];
  for (const n of document.querySelectorAll(TARGET)) {
    if (!visible(n)) continue;
    await bring(n);
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const reach = (dx, dy) => {
      let d = 0;
      for (let k = 2; k <= 24; k += 2) {
        const px = cx + dx * k;
        const py = cy + dy * k;
        if (px < 1 || py < 1 || px > window.innerWidth - 1 || py > window.innerHeight - 1) break;
        const hit = document.elementFromPoint(px, py);
        if (hit && (hit === n || n.contains(hit))) d = k;
        else break;
      }
      return d;
    };
    const left = reach(-1, 0);
    const right = reach(1, 0);
    const up = reach(0, -1);
    const down = reach(0, 1);
    const ew = r.width + left + right;
    const eh = r.height + up + down;
    if (ew < 43.5 || eh < 43.5) {
      small.push({
        cls: label(n),
        text: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 20),
        w: Math.round(r.width), h: Math.round(r.height),
        ew: Math.round(ew), eh: Math.round(eh),
      });
    }
  }

  return { overflow: Math.round(overflow), tiny, small };
};

window.__lockinFilm = async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scenes = [];
  const collect = async (name) => {
    const a = await window.__lockinAudit();
    const step = document.querySelector('.film-step');
    scenes.push({
      scene: step ? step.textContent.trim() : name,
      title: (document.querySelector('.film-title') || {}).textContent || '',
      ...a,
    });
  };
  await sleep(300);
  await collect('01');
  for (let i = 0; i < 10; i++) {
    if (document.body.dataset.view !== 'start') break;
    let primary = [...document.querySelectorAll('#view .btn-primary')]
      .filter((n) => n.offsetParent !== null && !n.disabled);
    if (!primary.length) {
      const card = document.querySelector('#view .exam-card');
      if (card) { card.click(); await sleep(250); }
      primary = [...document.querySelectorAll('#view .btn-primary')]
        .filter((n) => n.offsetParent !== null && !n.disabled);
    }
    if (!primary.length) break;
    primary[primary.length - 1].click();
    await sleep(650);
    await collect(String(i + 2).padStart(2, '0'));
  }
  return scenes;
};
`;

/* ---------- main ---------- */

const results = [];
let failed = 0;
const pass = (m) => results.push(`  ok   ${m}`);
const fail = (m) => { failed += 1; results.push(`  FAIL ${m}`); };

function browserArgs(profile) {
  return [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--disable-extensions',
    '--mute-audio',
    'about:blank',
  ];
}

async function main() {
  const exe = findBrowser();
  if (!exe) {
    const message = 'design check skipped - no Chrome, Edge or Chromium found (set CHROME_PATH)';
    if (requireBrowser) {
      fail(message);
      return;
    }
    console.log(message);
    return;
  }

  const { server, port } = await serve();
  const profile = await mkdtemp(join(tmpdir(), 'lockin-design-'));
  const browser = spawn(exe, browserArgs(profile), { stdio: 'ignore', windowsHide: true });

  let cdp;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    await waitFor(() => existsSync(portFile), 'browser to start');
    const [debugPort, wsPath] = (await readFile(portFile, 'utf8')).trim().split('\n');
    cdp = new CDP(new WebSocket(`ws://127.0.0.1:${debugPort}${wsPath.trim()}`));
    await new Promise((resolve, reject) => {
      cdp.ws.addEventListener('open', resolve, { once: true });
      cdp.ws.addEventListener('error', reject, { once: true });
    });

    const open = async (contextId) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId: contextId });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      }, sessionId);
      return { targetId, sessionId };
    };

    const evaluate = async (sessionId, expression) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'page exception');
      return res.result.value;
    };

    const metrics = (sessionId, width) => cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height: 844, deviceScaleFactor: 2, mobile: true,
    }, sessionId);

    const goto = async (sessionId, url, route) => {
      await cdp.send('Page.navigate', { url }, sessionId);
      await waitFor(async () => evaluate(sessionId, 'document.readyState === "complete"'), 'load');
      if (route) {
        await waitFor(
          async () => evaluate(sessionId, `document.body.dataset.view === ${JSON.stringify(VIEW_FOR[route] || route)}`),
          `route ${route}`,
        );
      }
      await evaluate(sessionId, AUDIT_FN + 'true');
      await sleep(450);
    };

    /* 1. the opening film, in a clean storage context at 390 */
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    const film = await open(browserContextId);
    await metrics(film.sessionId, 390);
    const base = `http://127.0.0.1:${port}/`;
    await goto(film.sessionId, `${base}#/start`);
    const scenes = await evaluate(film.sessionId, 'window.__lockinFilm()');
    const finish = await evaluate(film.sessionId, 'document.body.dataset.view');
    if (finish !== 'home') fail(`film did not finish on Home (ended on ${finish})`);
    for (const s of scenes) {
      const name = `film ${s.scene}${s.title ? ` "${s.title.slice(0, 28)}"` : ''}`;
      if (s.overflow > 0) fail(`${name}: ${s.overflow}px horizontal overflow`);
      if (s.tiny.length) fail(`${name}: ${s.tiny.length} text node(s) < 12px - ${s.tiny.map((t) => `${t.cls} ${t.fs}px "${t.text}"`).join(', ').slice(0, 200)}`);
      if (s.small.length) fail(`${name}: ${s.small.length} control(s) < 44px - ${s.small.map((t) => `${t.cls} ${t.w}x${t.h} (effective ${t.ew}x${t.eh})`).join(', ').slice(0, 200)}`);
      if (!s.overflow && !s.tiny.length && !s.small.length) pass(`${name}: floors held`);
    }
    await cdp.send('Target.disposeBrowserContext', { browserContextId });

    /* 2. the six routes, trial data, at each width */
    const main = await open();
    await goto(main.sessionId, `${base}?trial=1#/home`, 'home');
    for (const width of WIDTHS) {
      await metrics(main.sessionId, width);
      for (const route of ROUTES) {
        await evaluate(main.sessionId, `location.hash = '#/${route}'`);
        await waitFor(
          async () => evaluate(main.sessionId, `document.body.dataset.view === ${JSON.stringify(VIEW_FOR[route] || route)}`),
          `${route} at ${width}`,
        );
        await sleep(420);
        const r = await evaluate(main.sessionId, 'window.__lockinAudit()');
        const name = `${width}px ${route}`;
        if (r.overflow > 0) fail(`${name}: ${r.overflow}px horizontal overflow`);
        if (r.tiny.length) fail(`${name}: ${r.tiny.length} text node(s) < 12px - ${r.tiny.map((t) => `${t.cls} ${t.fs}px "${t.text}"`).join(', ').slice(0, 200)}`);
        if (r.small.length) fail(`${name}: ${r.small.length} control(s) < 44px - ${r.small.map((t) => `${t.cls} ${t.w}x${t.h} (effective ${t.ew}x${t.eh})`).join(', ').slice(0, 200)}`);
        if (!r.overflow && !r.tiny.length && !r.small.length) pass(`${name}: floors held`);
      }
    }
  } finally {
    try { await cdp?.send('Browser.close'); } catch { /* already closing */ }
    try { browser.kill(); } catch { /* gone */ }
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main()
  .catch((error) => fail(error.message))
  .finally(() => {
    console.log('design floors');
    for (const line of results) console.log(line);
    if (failed) {
      console.log(`\n${failed} design floor failure(s)`);
      process.exit(1);
    }
    const checked = results.filter((l) => l.includes('floors held')).length;
    console.log(`\n${checked} viewport checks passed`);
  });
