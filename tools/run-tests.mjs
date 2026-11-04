#!/usr/bin/env node
/* Lockin — Node test runner for the shared self-check suite.
   Runs the pure-logic groups of app/assets/js/tests.mjs (the browser page in
   app/tests.html adds the five DOM-factory asserts, which need a document).
   Exits 1 on any failure so CI and `npm test` can gate on it. */

/* Browser globals stubbed before any app import: store.js touches
   localStorage and `self` at import time, and util.js creates a <template>
   the moment it is parsed. The stubs are inert for pure-logic asserts. */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(String(k), String(v)); },
  removeItem: (k) => { mem.delete(k); },
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.self = { addEventListener() {} };
globalThis.document = {
  dispatchEvent() {},
  createElement: () => ({ content: {} }),
};
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class {
    constructor(type, params) { this.type = type; this.detail = params?.detail; }
  };
}

const { runSelfCheck } = await import('../app/assets/js/tests.mjs');

let pass = 0;
const failures = [];
await runSelfCheck({
  group: (name) => { if (name) console.log(name); },
  ok: () => { pass += 1; },
  bad: (name, err) => {
    failures.push(`  ✗ ${name} — ${err && err.message ? err.message : err}`);
  },
});

failures.forEach((line) => console.error(line));
const total = pass + failures.length;
console.log(`npm test: ${pass}/${total} passed${failures.length ? ` · ${failures.length} FAILED` : ' · all good'}`);
process.exit(failures.length ? 1 : 0);
