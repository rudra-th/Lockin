# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
**Report a vulnerability** flow on the repository's Security tab, or email the
maintainer listed on the GitHub profile. Include:

- the surface (web, extension, Android),
- the version or commit,
- a reproduction, and
- what an attacker could read or change.

You should get an acknowledgement within a few days. Please give a reasonable
window to ship a fix before publishing details.

## Supported versions

| Version | Supported |
|---|---|
| 1.15.x | Yes |
| 1.14.x | Yes |
| < 1.14 | No |

## What Lockin stores

The current web build is local-first: one `localStorage` key
(`lockin.store.v1`) holds tasks, schedules, sessions, target history and
settings. The extension keeps its state under `lockin.ext` in
`chrome.storage.local`, plus the optional phone pairing under `lockin.cloud`.
Neither surface sends data to a server unless you opt into cloud sync with
Google, or paste a pairing code — that one request only reads the public
summary document for the code, and sends no browsing data.

Exports are plain JSON and may contain your study history. Treat them like a
diary; do not attach them to public issues.

## Secrets

Signing keys, `google-services.json`, service-account JSON, `.env` files and
Firebase admin credentials are ignored by git. If one is committed by accident,
rotate it first, then remove it from history. A deleted file in a later commit
is still in the repository's history.

## Cloud sync

Google sign-in and Firestore sync shipped in 1.11.0 and are documented in
[`docs/privacy.md`](docs/privacy.md). The review surface is the Firestore rules
(including `list` denial), the random space code, token handling in the
extension, and the fact that v1 stores plaintext records by design — the rules
are the lock. The Firebase web config is public by design: it identifies the
project, it does not grant access.
