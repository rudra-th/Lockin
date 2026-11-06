#!/usr/bin/env node
/* Stage the public site in dist/site for Surge.

   One origin, two products:
     /        the landing page from site/
     /app/    the real app from app/, so it keeps relative paths and its own
              service-worker scope under /app/
     /screenshots/, /downloads/  the assets the landing page links to

   No bundler and no dependencies. The root /sw.js is the retire worker that
   releases visitors still controlled by the 1.11.x root-scope service worker. */

import { rm, mkdir, cp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const APP = path.join(ROOT, 'app');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'site');

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

async function newest(names, pattern) {
  /* Compare dotted versions numerically: string order puts "1.5.0" above
     "1.13.0", which once shipped a stale APK. */
  const parts = (name) => {
    const found = /(\d+(?:\.\d+)+)/.exec(name);
    return found ? found[1].split('.').map(Number) : [0];
  };
  const compare = (a, b) => {
    const pa = parts(a);
    const pb = parts(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff) return diff;
    }
    return String(a).localeCompare(String(b));
  };
  const match = names
    .filter((name) => pattern.test(name))
    .sort(compare);
  if (match.length) return match[match.length - 1];
  return null;
}

async function artifact(exact, pattern, what) {
  const preferred = path.join(DIST, exact);
  if (existsSync(preferred)) return preferred;
  const fallback = await newest(await readdir(DIST), pattern);
  if (fallback) return path.join(DIST, fallback);
  console.error(`missing ${what}: build it first (expected dist/${exact})`);
  process.exit(1);
}

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

for (const required of [SITE, APP, SHOTS]) {
  if (!existsSync(required)) {
    console.error(`missing ${path.relative(ROOT, required)} — cannot pack the site`);
    process.exit(1);
  }
}

const apk = await artifact(
  `lockin-${pkg.version}-release.apk`,
  /^lockin-[\d.]+-release\.apk$/,
  'signed Android release',
);
const zip = await artifact(
  `lockin-extension-v${pkg.version}.zip`,
  /^lockin-extension-v[\d.]+\.zip$/,
  'extension zip',
);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await cp(SITE, OUT, { recursive: true });
await cp(APP, path.join(OUT, 'app'), { recursive: true });
await cp(SHOTS, path.join(OUT, 'screenshots'), {
  recursive: true,
  filter: (src) => !src.endsWith('.md') && !src.endsWith('.json'),
});

await mkdir(path.join(OUT, 'downloads'), { recursive: true });
await cp(apk, path.join(OUT, 'downloads', 'lockin.apk'));
await cp(zip, path.join(OUT, 'downloads', 'lockin-extension.zip'));

const apkBytes = (await stat(apk)).size;
const zipBytes = (await stat(zip)).size;

await writeFile(
  path.join(OUT, 'downloads', 'site.json'),
  `${JSON.stringify({
    name: 'Lockin',
    version: pkg.version,
    builtAt: new Date().toISOString(),
    apk: '/downloads/lockin.apk',
    zip: '/downloads/lockin-extension.zip',
    apkBytes,
    zipBytes,
  }, null, 2)}\n`,
);

/* Surge reads CNAME and serves that hostname; keep one copy at the root. */
const cname = path.join(APP, 'CNAME');
if (existsSync(cname)) await cp(cname, path.join(OUT, 'CNAME'));

const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;
const kb = ((await dirSize(OUT)) / 1024).toFixed(0);
console.log(`packed  dist/site  ·  ${kb} KB  ·  v${pkg.version}`);
console.log(`  app     ${path.basename(apk)}  ${mb(apkBytes)}`);
console.log(`  ext     ${path.basename(zip)}  ${mb(zipBytes)}`);
console.log('deploy: npx --yes surge ./dist/site lockin.surge.sh');
