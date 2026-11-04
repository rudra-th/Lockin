# Android release build

One-time keystore setup, then a repeatable two-command release. The web app
needs none of this — it deploys as files.

Lockin is distributed **directly** — the APK file itself, shared however you
like (GitHub Releases, a drive link, a cable). No Play Store. The keystore
still matters for one reason: **updates**. Android only installs an update
over an existing app when both APKs carry the same signature. One keystore,
kept forever, guarantees every APK you ever build — on any machine — installs
cleanly over the last one.

## One-time: create the release keystore

Run this once, on the machine that will sign releases. Keep the answers and
both passwords in a password manager — **losing the keystore means every
future APK has a different signature, and nobody (including you) can update
an installed copy; they would have to uninstall and reinstall, losing data.**

```powershell
keytool -genkeypair -v `
  -keystore android\app\lockin-release.jks `
  -alias lockin -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` ships with the JDK (`where.exe keytool` finds it if `JAVA_HOME` is
set). It asks for two passwords (keystore and key — use the same strong one
for both) and a distinguished name; your name is enough there.

Back up `lockin-release.jks` somewhere off this machine (the `.gitignore`
keeps it out of git on purpose).

## One-time: fill in the properties

```powershell
Copy-Item android\keystore.properties.example android\keystore.properties
```

Then edit `android/keystore.properties`:

```properties
storeFile=lockin-release.jks
storePassword=<the keystore password>
keyAlias=lockin
keyPassword=<the key password>
```

`storeFile` is relative to `android/app/` (an absolute path also works).
This file is gitignored — it exists only on machines that sign releases.

## Every release

```powershell
npm run bump -- 1.5.0        # version agrees across package.json, sw.js, build.gradle
npm run android:build -- assembleRelease
```

The signed APK lands at `android/app/build/outputs/apk/release/app-release.apk`.
Copy it to `dist/lockin-<version>-release.apk` for distribution:

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item android\app\build\outputs\apk\release\app-release.apk dist\lockin-1.5.0-release.apk
```

That file is the release: attach it to a GitHub Release, drop it on a drive,
or copy it straight to a phone. Installers get Android's standard
"unknown apps" prompt on first install — expected for direct distribution.

## Fail-fast behaviour

`assembleRelease`/`bundleRelease` refuse to run — naming the missing piece —
when `android/keystore.properties` is absent, one of the four values is
empty, or the keystore file itself can't be found. Debug builds
(`assembleDebug`) never touch signing and always work.

## Verify what you built

```powershell
& "$env:ANDROID_HOME\build-tools\<version>\apksigner.bat" verify --print-certs dist\lockin-1.5.0-release.apk
```

The certificate fingerprint shown here is the app's identity for updates —
record it in the password manager next to the keystore.
