## What changed

<!-- One paragraph. The user-visible change first. -->

## Surface

- [ ] Web app
- [ ] Extension
- [ ] Android
- [ ] Docs / tooling

## Verification

<!-- Commands run, browser checks, device checks. Do not claim a build you did not run. -->

- [ ] `npm run check`
- [ ] `app/tests.html` self-check
- [ ] Extension packed and loaded from `dist/extension`
- [ ] Android `assembleDebug` (if native code changed)
- [ ] Screenshots for UI changes

## Honesty check

- [ ] The UI does not claim a capability the platform cannot keep.
- [ ] No secrets, keystores, `google-services.json`, service-account JSON or personal exports are included.
- [ ] Version line is in sync (`package.json`, `app/sw.js`, release tag).

## Notes for the reviewer

<!-- Anything risky, deferred, or worth a second look. -->
