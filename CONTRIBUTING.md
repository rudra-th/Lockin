# Contributing to Lockin

Lockin is a small, dependency-light project. The web app has no build step; the
extension is staged by a script; Android is a Capacitor shell around the same
web app. Keep changes in that spirit.

## Before you start

- Read [`docs/architecture.md`](docs/architecture.md) for the surfaces and the
  shared core.
- Read [`docs/privacy.md`](docs/privacy.md) before touching storage, sync or
  analytics.
- Read [`docs/permissions.md`](docs/permissions.md) before adding a platform
  capability.
- For UI or motion work, match the existing design language: true-black canvas,
  one lime accent, serif for moments, mono for figures, flat surfaces, honest
  borders.

## Run the web app

```bash
python serve.py          # http://localhost:4173, serving app/
```

Any static server works. The service worker needs a secure context; `localhost`
counts.

## Run the checks

```bash
npm install
npm run check            # JS parse, JSON, CSS braces, SW precache, versions
```

Open `app/tests.html` in a browser for the pure-logic self-check. It runs
against an in-memory copy and never touches real data.

## Pack the extension

```bash
npm run pack:extension
```

Load `dist/extension` via `chrome://extensions` → Developer mode → **Load
unpacked**. Never load `extension/` directly: Chrome cannot resolve imports
outside the extension folder, and the pack step copies `app/core/` and fonts.

## Build Android

Prerequisites: Android Studio (JDK 21) and an Android SDK with platform 36.

```bash
npm install
npm run android:build      # cap sync android + gradlew assembleDebug
```

The script picks `gradlew.bat` on Windows and `./gradlew` elsewhere. Pass a
different task through: `npm run android:build -- assembleRelease`.

If Gradle cannot find the JDK/SDK, set them for the shell:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
Launcher art comes from `npm run android:icons` (Windows, System.Drawing).
`android/local.properties` and all build output are ignored. See
[`docs/android.md`](docs/android.md) for the native bridge and permission tiers.

## Repository layout

```text
app/          web app (source of truth for sessions)
  core/       pure logic shared by every surface
extension/    Chrome MV3 blocking + active-tab time
android/      Capacitor shell (generated project + native bridge)
tools/        pack, check, icon generation
docs/         architecture, privacy, permissions, Android, releases
```

## Code rules

- **Pure logic goes in `app/core/`.** No DOM, no storage, no browser APIs.
  Re-export it through `app/assets/js/util.js` so the web app and extension use
  one copy.
- **The web app is the source of truth for a session.** The extension stays a
  smaller instrument: blocking and active-Chrome-tab time only.
- **No new dependency in the web app.** Vanilla ES modules, self-hosted fonts,
  no bundler. The Android shell may use Capacitor and AndroidX.
- **Honesty is a feature.** Do not make a claim the platform cannot keep. If the
  web cannot ring while closed, say so in the UI and docs.
- **No secrets, no personal data.** Never commit keystores, `google-services.json`,
  service-account JSON, exported user backups or `.env` files.
- **Keep the version line in sync.** `package.json`, `app/sw.js` and the release
  tag must agree. `npm run check` verifies the first two.

## Commits and pull requests

- One focused change per commit. Present tense, imperative subject
  (`Add schedule reminders`, not `Added`).
- Describe the user-visible change and the verification you ran.
- UI changes: include a before/after screenshot or a short screen recording.
- Platform changes: state the permission and the fallback when it is denied.
- Do not commit generated `dist/` output; release assets are attached to a
  GitHub Release instead.

## Release process

1. Update `CHANGELOG.md` and the status line in `README.md`.
2. Bump `package.json` and the `VERSION` constant in `app/sw.js`.
3. Run `npm run check` and the browser self-check.
4. Pack the extension and smoke-test `dist/extension`.
5. Commit, tag `vX.Y.Z`, push `main` and the tag.
6. Create a GitHub Release from the tag and attach the extension zip.
