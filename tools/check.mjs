#!/usr/bin/env node
/* Lockin — repository check.
   Fast, dependency-free sanity checks that run locally and in GitHub Actions.
   It does not replace tests.html; it catches the boring breakages first. */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.gradle', 'assets/public']);

const results = [];
let failed = 0;

function pass(message) {
  results.push(`  ok   ${message}`);
}

function fail(message) {
  failed += 1;
  results.push(`  FAIL ${message}`);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === 'build' || name === 'node_modules') continue;
      walk(path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

function rel(path) {
  return relative(ROOT, path).replaceAll('\\', '/');
}

/* ---------- JavaScript parses as an ES module ---------- */

const jsFiles = [
  ...walk(join(ROOT, 'app')),
  ...walk(join(ROOT, 'extension')),
  ...walk(join(ROOT, 'tools')),
].filter((path) => ['.js', '.mjs'].includes(extname(path)));

let jsBad = 0;
for (const path of jsFiles) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: readFileSync(path, 'utf8'),
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  } catch (err) {
    jsBad += 1;
    fail(`${rel(path)} does not parse\n${String(err.stderr || err.message).trim()}`);
  }
}
if (!jsBad) pass(`${jsFiles.length} JavaScript modules parse`);

/* ---------- relative imports resolve to real files ---------- */

const importSpec = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
let importsChecked = 0;
let importsBad = 0;
for (const path of jsFiles) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(importSpec)) {
    importsChecked += 1;
    const spec = match[1].split('?')[0];
    /* The extension is staged with app/core copied in at pack time. */
    const staged = rel(path).startsWith('extension/') && spec.startsWith('./core/');
    const target = staged
      ? join(ROOT, 'app', spec.slice(2))
      : join(dirname(path), spec);
    if (!existsSync(target)) {
      importsBad += 1;
      fail(`${rel(path)} imports ${spec} — no such file`);
    }
  }
}
if (!importsBad) pass(`${importsChecked} relative imports resolve`);

/* ---------- JSON files parse ---------- */

const jsonFiles = [
  join(ROOT, 'package.json'),
  join(ROOT, 'capacitor.config.json'),
  join(ROOT, 'app/manifest.webmanifest'),
  join(ROOT, 'extension/manifest.json'),
];

let jsonBad = 0;
for (const path of jsonFiles) {
  if (!existsSync(path)) continue;
  try {
    JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    jsonBad += 1;
    fail(`${rel(path)} is not valid JSON: ${err.message}`);
  }
}
if (!jsonBad) pass(`${jsonFiles.filter(existsSync).length} JSON files parse`);

/* ---------- CSS braces balance ---------- */

const cssFiles = walk(join(ROOT, 'app/assets/css')).concat(walk(join(ROOT, 'extension')))
  .filter((path) => extname(path) === '.css');
let cssBad = 0;
for (const path of cssFiles) {
  const css = readFileSync(path, 'utf8');
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  if (open !== close) {
    cssBad += 1;
    fail(`${rel(path)} has ${open} open and ${close} close braces`);
  }
}
if (!cssBad) pass(`${cssFiles.length} CSS files have balanced braces`);

/* ---------- service worker precache points at real files ---------- */

try {
  const sw = readFileSync(join(ROOT, 'app/sw.js'), 'utf8');
  const block = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)?.[1] || '';
  const entries = [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  const missing = entries.filter((entry) => !existsSync(join(ROOT, 'app', entry)));
  if (missing.length) fail(`service worker precache misses: ${missing.join(', ')}`);
  else pass(`service worker precache lists ${entries.length} real files`);
} catch (err) {
  fail(`could not read app/sw.js: ${err.message}`);
}

/* ---------- versions agree ---------- */

try {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const sw = readFileSync(join(ROOT, 'app/sw.js'), 'utf8');
  const gradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8');
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  const expectedCode = maj * 100 + min * 10 + pat;
  const swVersion = /const VERSION = 'lockin\.v([^']+)'/.exec(sw)?.[1];
  const gradleName = /versionName "([^"]+)"/.exec(gradle)?.[1];
  const gradleCode = Number(/versionCode (\d+)/.exec(gradle)?.[1]);

  const problems = [];
  if (!swVersion) problems.push('app/sw.js has no lockin.vX.Y.Z VERSION');
  else if (swVersion !== pkg.version) problems.push(`service worker ${swVersion} != package.json ${pkg.version}`);
  if (lock.version !== pkg.version) problems.push(`package-lock.json ${lock.version} != package.json ${pkg.version}`);
  if (lock.packages?.['']?.version !== pkg.version) problems.push('package-lock.json root package version differs');
  if (!gradleName) problems.push('android/app/build.gradle has no versionName');
  else if (gradleName !== pkg.version) problems.push(`android versionName ${gradleName} != package.json ${pkg.version}`);
  if (!gradleCode) problems.push('android/app/build.gradle has no versionCode');
  else if (gradleCode !== expectedCode) problems.push(`android versionCode ${gradleCode} != expected ${expectedCode} for ${pkg.version}`);

  if (problems.length) fail(problems.join('; '));
  else pass(`version ${pkg.version} agrees across package.json, lock, sw.js and build.gradle (versionCode ${gradleCode})`);
} catch (err) {
  fail(`version check failed: ${err.message}`);
}

/* ---------- no stale Plan view references ---------- */

const textFiles = [
  ...walk(join(ROOT, 'app')),
  ...walk(join(ROOT, 'extension')),
  ...walk(join(ROOT, 'docs')),
  join(ROOT, 'README.md'),
]
  /* Release notes may quote the old `#/plan` redirect they introduced. */
  .filter((path) => !rel(path).startsWith('docs/releases/'))
  .filter((path) => ['.js', '.html', '.md', '.json', '.webmanifest'].includes(extname(path)));

const stale = textFiles.filter((path) => /views\/plan\.js|#\/plan\b/.test(readFileSync(path, 'utf8')));
if (stale.length) fail(`stale Plan references in: ${stale.map(rel).join(', ')}`);
else pass('no stale Plan view or #/plan links');

/* ---------- extension manifest ---------- */

try {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'extension/manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) fail('extension manifest is not MV3');
  else pass('extension manifest is MV3');
  const worker = manifest.background?.service_worker;
  if (!worker || !existsSync(join(ROOT, 'extension', worker))) {
    fail(`extension service worker missing: ${worker || '(none)'}`);
  } else {
    pass(`extension service worker ${worker} exists`);
  }
  const required = ['storage', 'alarms', 'tabs', 'declarativeNetRequest'];
  const missing = required.filter((p) => !(manifest.permissions || []).includes(p));
  if (missing.length) fail(`extension permissions missing: ${missing.join(', ')}`);
  else pass('extension permissions include storage, alarms, tabs and declarativeNetRequest');
} catch (err) {
  fail(`extension manifest check failed: ${err.message}`);
}

/* ---------- report ---------- */

console.log('Lockin check');
console.log(results.join('\n'));
if (failed) {
  console.error(`\n${failed} check${failed === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
