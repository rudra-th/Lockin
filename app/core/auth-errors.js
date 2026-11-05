/* Lockin — Google sign-in error translation.
   Firebase, the native Google sheet and Android's Credential Manager all
   report failures in their own dialect. This module turns every one of them
   into one calm sentence a student can act on. Pure, so the self-check suite
   can pin the copy. */

const MESSAGES = {
  'auth/popup-blocked':
    'Your browser blocked the sign-in window. Allow pop-ups for Lockin, or try again — Lockin falls back to a full-page sign-in.',
  'auth/unauthorized-domain':
    'This web address is not allowed to use Google sign-in. Add it in Firebase → Authentication → Settings → Authorized domains.',
  'auth/operation-not-allowed':
    'Google sign-in is turned off for this Firebase project. Enable the Google provider in Firebase → Authentication → Sign-in method.',
  'auth/configuration-not-found':
    'Firebase could not find the Google sign-in configuration. Enable the Google provider in Firebase → Authentication → Sign-in method.',
  'auth/operation-not-supported-in-this-environment':
    'Google sign-in needs a secure page (https or localhost). Open Lockin at its real address and try again.',
  'auth/network-request-failed':
    'Google could not be reached. Check the connection and try again.',
  'auth/invalid-credential':
    'Google returned a sign-in Lockin could not accept. Try again; if it keeps happening, install the latest Lockin build.',
  'auth/invalid-id-token':
    'Google returned a token Firebase rejected. Try again; if it keeps happening, install the latest Lockin build.',
  'auth/invalid-api-key':
    'The Firebase API key in this build is not valid. Update Lockin to the latest version.',
  'auth/api-key-not-valid':
    'The Firebase API key in this build is not valid. Update Lockin to the latest version.',
  'auth/account-exists-with-different-credential':
    'That email already has a Lockin account with a different sign-in method. Use the same Google account you used before.',
  'auth/too-many-requests':
    'Too many sign-in attempts. Wait a minute, then try again.',
  'auth/user-disabled':
    'This Google account is disabled. Use a different account or contact Google support.',
  'auth/internal-error':
    'Google sign-in hit an internal error. Try again in a moment.',
  'auth/timeout':
    'Google sign-in took too long. Check the connection and try again.',
  'lockin/native-auth-missing':
    'This build is missing the native Google sign-in plugin. Install the latest Lockin APK.',
  'lockin/no-id-token':
    'Google signed in but returned no ID token. Make sure the Google provider is enabled in Firebase, then try again.',
  'lockin/unsupported':
    'Google sign-in is not available in this build. Install the latest Lockin app.',
};

/* Cancel codes from Firebase, Google Play services and Android activities. */
const CANCELS = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
  'auth/canceled',
  '12501',
  'sign_in_cancelled',
  'signin_cancelled',
  'activity_canceled',
  'activity cancelled',
  'canceled',
  'cancelled',
  '16',
]);

/** The short code the SDK put on the error, lower-cased and trimmed. */
export function errorCodeOf(err) {
  if (!err) return '';
  return String(err.code || err.errorCode || err.name || '').trim().toLowerCase();
}

/** True when the failure means "the person changed their mind". */
export function isCancel(err) {
  const code = errorCodeOf(err);
  if (CANCELS.has(code)) return true;
  const raw = String(err?.message || '').toLowerCase();
  return raw.includes('cancel') || raw.includes('dismiss');
}

function isDeveloperError(err) {
  const code = errorCodeOf(err);
  if (code === '10' || code === 'developer_error' || code === 'auth/developer-error') return true;
  const raw = String(err?.message || '');
  return raw.includes('DEVELOPER_ERROR') || raw.includes('10:');
}

function isNetwork(err) {
  const code = errorCodeOf(err);
  if (code === 'auth/network-request-failed' || code === 'network_error') return true;
  return /network|offline|failed to fetch|connection/i.test(String(err?.message || ''));
}

/**
 * One sentence for the account card. Cancellations return '' so a changed
 * mind never paints an error. `native` adds release-build guidance for the
 * classic DEVELOPER_ERROR certificate mismatch.
 */
export function authErrorMessage(err, { native = false } = {}) {
  if (!err) return '';
  if (isCancel(err)) return '';
  const code = errorCodeOf(err);
  if (MESSAGES[code]) return MESSAGES[code];

  if (isDeveloperError(err)) {
    return native
      ? 'Google rejected this app’s signing certificate. Install the release build (its certificate is registered) or add this build’s SHA-1 in Firebase → Project settings → Your apps.'
      : 'Google rejected the sign-in request. Check that the Google provider and this web address are configured in Firebase.';
  }
  if (isNetwork(err)) return MESSAGES['auth/network-request-failed'];

  /* Capacitor gives some native plugin failures a numeric code but a very
     readable message; prefer that over the bare number. */
  const raw = String(err?.message || '').trim();
  if (raw && !/^\d+$/.test(raw)) {
    return raw.length > 180 ? `${raw.slice(0, 177)}…` : raw;
  }
  return 'Google sign-in failed. Try again in a moment.';
}
