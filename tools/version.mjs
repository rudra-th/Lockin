#!/usr/bin/env node
/* Lockin — single-source version bump.
   `npm run bump -- 1.5.0` updates every place a version lives in one step:

     - package.json and package-lock.json
     - app/sw.js (the service-worker cache name `lockin.vX.Y.Z`)
     - android/app/build.gradle (versionName, and versionCode as M*100+m*10+p)

   tools/check.mjs then verifies all four agree, so a missed spot fails CI
   instead of shipping a stale cache or a mislabeled APK. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const [input] = process.argv.slice(2);
const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(input || '');
if (!semver) {
  console.error('Usage: npm run bump -- <major.minor.patch>   e.g. npm run bump -- 1.5.0');
  process.exit(1);
}
const [, maj, min, pat] = semver;
const code = Number(maj) * 100 + Number(min) * 10 + Number(pat);

/* package.json */
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = input;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

/* package-lock.json (root version + packages[""].version) */
const lockPath = join(ROOT, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
lock.version = input;
if (lock.packages && lock.packages['']) lock.packages[''].version = input;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

/* service worker cache name */
const swPath = join(ROOT, 'app/sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!/const VERSION = 'lockin\.v/.test(sw)) {
  console.error('app/sw.js has no `const VERSION = \'lockin.v…\'` const');
  process.exit(1);
}
writeFileSync(swPath, sw.replace(/const VERSION = 'lockin\.v[^']+';/, `const VERSION = 'lockin.v${input}';`));

/* android shell */
const gradlePath = join(ROOT, 'android/app/build.gradle');
const gradle = readFileSync(gradlePath, 'utf8');
if (!/versionCode \d+/.test(gradle) || !/versionName "/.test(gradle)) {
  console.error('android/app/build.gradle is missing versionCode/versionName');
  process.exit(1);
}
writeFileSync(gradlePath, gradle
  .replace(/versionCode \d+/, `versionCode ${code}`)
  .replace(/versionName "[^"]+"/, `versionName "${input}"`));

/* extension manifest — the store listing version should match the app */
const extPath = join(ROOT, 'extension/manifest.json');
const ext = JSON.parse(readFileSync(extPath, 'utf8'));
ext.version = input;
writeFileSync(extPath, `${JSON.stringify(ext, null, 2)}\n`);

console.log(`Lockin version → ${input}`);
console.log('  package.json + package-lock.json');
console.log(`  app/sw.js → lockin.v${input}`);
console.log(`  android/app/build.gradle → versionCode ${code}, versionName ${input}`);
console.log(`  extension/manifest.json → ${input}`);
