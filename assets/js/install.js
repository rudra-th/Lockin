/* Lockin — PWA install prompt plumbing (kept separate: no cycles). */

let deferredPrompt = null;

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.dispatchEvent(new CustomEvent('lockin:installable'));
});

export function tryInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  deferredPrompt = null;
  return 'prompted';
}
