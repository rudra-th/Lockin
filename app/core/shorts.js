/* Lockin core — short-video surfaces. Pure: no chrome, no storage, no clock.
   The worker turns these into declarativeNetRequest rules; the tests and the
   blocked page use the same list, so "a Short" means one thing everywhere.

   Android cannot see a path inside an app without reading screen content, so
   the phone side blocks the whole app instead. This matcher is web-only. */

/** One entry per feed. `paths` are prefixes; a boundary must follow. */
export const SHORTS_SURFACES = Object.freeze([
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts',
    host: 'youtube.com',
    paths: ['/shorts'],
  },
  {
    id: 'instagram-reels',
    label: 'Instagram Reels',
    host: 'instagram.com',
    paths: ['/reel', '/reels'],
  },
  {
    id: 'facebook-reels',
    label: 'Facebook Reels',
    host: 'facebook.com',
    paths: ['/reel', '/reels'],
  },
  {
    id: 'snapchat-spotlight',
    label: 'Snapchat Spotlight',
    host: 'snapchat.com',
    paths: ['/spotlight'],
  },
]);

function hostMatches(hostname, host) {
  return hostname === host || hostname.endsWith(`.${host}`);
}

function pathMatches(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The short-video surface a URL belongs to, or null.
 * `https://m.youtube.com/shorts/abc` → the YouTube entry.
 * `https://youtube.com/@name/shorts` → null (that is a channel page).
 */
export function shortSurface(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.toLowerCase();
  for (const surface of SHORTS_SURFACES) {
    if (!hostMatches(host, surface.host)) continue;
    if (surface.paths.some((prefix) => pathMatches(path, prefix))) return surface;
  }
  return null;
}

export function isShortsUrl(raw) {
  return shortSurface(raw) !== null;
}

/** Domain from a redirect URL, for the blocked page copy. */
export function surfaceForDomain(domain) {
  const host = String(domain || '').toLowerCase().replace(/^www\./, '');
  return SHORTS_SURFACES.find((s) => hostMatches(host, s.host)) || null;
}

/**
 * declarativeNetRequest urlFilters. DNR matches paths case-insensitively and
 * `||host/path` is a prefix, so `/reel` already covers `/reels`. Dedupe so the
 * ruleset stays small and rule ids stay predictable.
 */
export function shortsFilters() {
  const seen = new Set();
  const out = [];
  for (const surface of SHORTS_SURFACES) {
    for (const path of surface.paths) {
      const filter = `||${surface.host}${path}`;
      if (seen.has(filter)) continue;
      seen.add(filter);
      out.push({ filter, surface: surface.id, host: surface.host });
    }
  }
  return out;
}
