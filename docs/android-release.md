# Android release build

One-time keystore setup, then a repeatable two-command release. The web app
needs none of this — it deploys as files.

## One-time: create the release keystore

Run this once, on the machine that will sign releases. Keep the answers and
both passwords in a password manager — **losing the keystore means a new app
identity on Google Play** (new listing, lost install base).

```powershell
keytool -genkeypair -v `
  -keystore android\app\lockin-release.jks `
  -alias lockin -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` ships with the JDK (`where.exe keytool` finds it if `JAVA_HOME` is
set). It asks for two passwords (keystore and key — use the same strong one
for both) and a distinguished name; only the organisation field matters for
Play.

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
cd android
.\gradlew.bat assembleRelease
```

The signed APK lands at `android/app/build/outputs/apk/release/app-release.apk`.
Copy it to `dist/lockin-<version>-release.apk` for distribution:

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item android\app\build\outputs\apk\release\app-release.apk dist\lockin-1.5.0-release.apk
```

For Play Store upload prefer the bundle:

```powershell
.\gradlew.bat bundleRelease   # → app-release.aab
```

## Fail-fast behaviour

`assembleRelease`/`bundleRelease` refuse to run — naming the missing piece —
when `android/keystore.properties` is absent, one of the four values is
empty, or the keystore file itself can't be found. Debug builds
(`assembleDebug`) never touch signing and always work.

## Verify what you built

```powershell
& "$env:ANDROID_HOME\build-tools\<version>\apksigner.bat" verify --print-certs dist\lockin-1.5.0-release.apk
```

The certificate fingerprint shown here is the one Play ties to the app
identity — record it in the password manager next to the keystore.
