#!/usr/bin/env node
/* Stage a loadable extension in dist/extension.
   Chrome cannot import modules from outside the extension package, so the
   shared pure core and the three UI fonts are copied in at pack time.
   No bundler, no dependencies. */

import { rm, mkdir, cp, readFile, access, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'dist', 'extension');
const CORE = path.join(ROOT, 'app', 'core');
const FONTS = path.join(ROOT, 'app', 'assets', 'fonts');
const FONT_FILES = [
  'fraunces-latin.woff2',
  'hanken-grotesk-latin.woff2',
  'ibm-plex-mono-400.woff2',
  'ibm-plex-mono-600.woff2',
];

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

if (!existsSync(CORE)) {
  console.error('app/core is missing — the extension imports ./core/time.js');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SRC, OUT, { recursive: true });
await cp(CORE, path.join(OUT, 'core'), { recursive: true });
await mkdir(path.join(OUT, 'fonts'), { recursive: true });
for (const file of FONT_FILES) {
  await cp(path.join(FONTS, file), path.join(OUT, 'fonts', file));
}

const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
const refs = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.web_accessible_resources || []).flatMap((r) => r.resources || []),
].filter(Boolean);

for (const ref of refs) {
  if (ref.includes('*')) continue;
  await access(path.join(OUT, ref));
}

const kb = ((await dirSize(OUT)) / 1024).toFixed(0);
console.log(`packed  dist/extension  ·  ${kb} KB  ·  v${manifest.version}`);
console.log('load it: chrome://extensions → Developer mode → Load unpacked → dist/extension');
