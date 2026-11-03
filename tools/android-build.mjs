#!/usr/bin/env node
/* Lockin — cross-platform Android build.
   `npm run android:build` syncs the web app, then calls the Gradle wrapper for
   the current OS. Extra arguments pass through: `npm run android:build --
   assembleRelease`. */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const android = join(ROOT, 'android');
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const task = process.argv.slice(2).find((arg) => !arg.startsWith('-')) || 'assembleDebug';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Lockin → syncing app/ into the Capacitor shell');
run('npx', ['cap', 'sync', 'android'], ROOT);

console.log(`Lockin → ${task}`);
run(wrapper, [task], android);

const apk = join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log(`\nAPK: ${apk}`);
