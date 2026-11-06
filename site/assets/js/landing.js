/* Lockin — landing page behaviour.
   The page reads without this file. With it, the hero wordmark gives way and
   the phone rises into a pinned stage: Plan, Start, Lock and Review run on the
   scroll, and the session clock is driven by the same gesture. */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- retire the old root service worker ---------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.()
    .then((regs) => {
      for (const reg of regs) {
        try {
          if (new URL(reg.scope).pathname === '/') reg.unregister();
        } catch (_) { /* an opaque scope is not ours */ }
      }
    })
    .catch(() => { /* service workers are a bonus */ });
}

/* An installed copy of the old root app should keep opening the product. */
if (matchMedia('(display-mode: standalone)').matches && location.pathname === '/') {
  location.replace('/app/');
}

/* ---------- reveal on scroll ---------- */

const revealGroups = [
  '.hero-top',
  '.story-head',
  '.section-head',
  '.rules-head',
  '.trial-copy',
  '.faq-head',
  '.footer-top',
];

const revealNodes = [];
for (const selector of revealGroups) {
  document.querySelectorAll(selector).forEach((group) => {
    [...group.children].forEach((node, index) => {
      node.style.setProperty('--d', `${Math.min(index * 70, 280)}ms`);
      revealNodes.push(node);
    });
  });
}

document.querySelectorAll('.control-panel, .control-fine, .rule, .trial-card, .qa, .download-inner > *, .footer-mark')
  .forEach((node, index) => {
    node.style.setProperty('--d', `${Math.min((index % 4) * 60, 180)}ms`);
    revealNodes.push(node);
  });

revealNodes.forEach((node) => node.classList.add('reveal'));

if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -7% 0px', threshold: 0.08 });
  revealNodes.forEach((node) => io.observe(node));
} else {
  revealNodes.forEach((node) => node.classList.add('is-in'));
}

/* ---------- the scroll story ---------- */

const hero = document.querySelector('.hero');
const word = document.querySelector('.hero-word');
const storyInner = document.querySelector('.story-inner');
const stage = document.querySelector('.story-stage');
const phoneStage = document.querySelector('.phone-stage');
const phone = document.getElementById('story-phone');
const steps = [...document.querySelectorAll('.step')];
const screens = [...document.querySelectorAll('.screen')];
const tabs = [...document.querySelectorAll('.ph-tab')];
const sessionRing = document.querySelector('[data-session-ring]');
const sessionClock = document.querySelector('[data-session-clock]');

const screenOrder = ['plan', 'start', 'lock', 'review'];
const RING = 540.35;
let activeStep = -1;
let clockValue = -1;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smooth = (t) => t * t * (3 - 2 * t);

function setActive(index) {
  steps.forEach((step, i) => step.classList.toggle('is-active', i === index));
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screen === screenOrder[index]));
  tabs.forEach((tab) => tab.classList.toggle('is-on', tab.dataset.tab === screenOrder[index]));
}

function update() {
  const vh = window.innerHeight;
  const isMobile = window.matchMedia('(max-width: 900px)').matches;

  /* the monument loses a little weight as the first screen leaves */
  if (word && hero && !reduceMotion) {
    const heroRect = hero.getBoundingClientRect();
    const p = clamp01(-heroRect.top / (vh * 0.9));
    word.style.transform = `translate3d(0, ${(-p * 20).toFixed(2)}px, 0) scale(${(1 - p * 0.07).toFixed(4)})`;
    word.style.opacity = String(1 - p * 0.4);
  }

  if (!storyInner || !phone) return;

  /* the phone comes up from below as the story enters */
  const storyRect = storyInner.getBoundingClientRect();
  const rise = reduceMotion ? 1 : smooth(clamp01((vh * 0.82 - storyRect.top) / (vh * 0.62)));
  if (phoneStage) {
    phoneStage.style.transform = `translate3d(0, ${((1 - rise) * 72).toFixed(2)}px, 0) scale(${(0.97 + rise * 0.03).toFixed(4)})`;
    phoneStage.style.opacity = String(0.4 + rise * 0.6);
  } else if (phone) {
    phone.style.transform = `translate3d(0, ${((1 - rise) * 64).toFixed(2)}%, 0) scale(${(0.94 + rise * 0.06).toFixed(4)})`;
    phone.style.opacity = String(0.3 + rise * 0.7);
  }

  /* The stage is pinned for the length of .story-inner. Its progress drives
     which screen is showing, so the phone and the caption can never drift. */
  const pinTop = isMobile ? 57 : 82;
  const stageHeight = stage ? stage.offsetHeight : vh;
  const travel = Math.max(1, storyInner.offsetHeight - stageHeight);
  const progress = clamp01((pinTop - storyRect.top) / travel);
  const next = Math.min(steps.length - 1, Math.floor(progress * steps.length));

  if (next !== activeStep) {
    activeStep = next;
    setActive(next);
  }

  /* the scroll runs the 45 minute session while the Start screen is up */
  if (sessionRing) {
    const local = clamp01(progress * steps.length - 1);
    const seconds = Math.max(0, Math.round(45 * 60 * (1 - local)));
    if (seconds !== clockValue) {
      clockValue = seconds;
      sessionRing.style.strokeDashoffset = String(RING * (1 - local));
      if (sessionClock) {
        sessionClock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }
    }
  }
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    update();
    ticking = false;
  });
}

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });
update();

/* ---------- figures count once ---------- */

function countUp(node) {
  const target = Number(node.dataset.count) || 0;
  if (!target) { node.textContent = '0'; return; }
  const began = performance.now();
  function step(now) {
    const t = Math.min(1, (now - began) / 900);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

const counters = [...document.querySelectorAll('[data-count]')];
if ('IntersectionObserver' in window && !reduceMotion) {
  const countObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      countUp(entry.target);
      countObserver.unobserve(entry.target);
    }
  }, { threshold: 0.6 });
  counters.forEach((node) => countObserver.observe(node));
} else {
  counters.forEach((node) => { node.textContent = node.dataset.count; });
}

/* ---------- OS-aware downloads ---------- */

const ua = navigator.userAgent || '';
const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const os = /Android/i.test(ua) ? 'android'
  : /iPhone|iPad|iPod/i.test(ua) || touchMac ? 'ios'
    : 'desktop';

document.documentElement.dataset.os = os;

const primary = document.getElementById('download-primary');
const secondary = document.getElementById('download-extension');
const lede = document.getElementById('download-lede');
const note = document.getElementById('download-note');

if (primary && secondary) {
  if (os === 'android') {
    primary.href = '/downloads/lockin.apk';
    primary.textContent = 'Download for Android';
    primary.setAttribute('download', '');
    secondary.href = '/app/?trial=1';
    secondary.textContent = 'Open the browser trial instead';
    secondary.removeAttribute('download');
    if (lede) lede.textContent = 'The full instrument: exact alarms, app blocking, screen time and the strict kiosk. This is the build the browser cannot replace.';
    if (note) note.textContent = 'Android may ask you to allow installs from this browser once. The APK is signed and installs directly.';
  } else if (os === 'ios') {
    primary.href = '/app/?trial=1';
    primary.textContent = 'Open the browser trial';
    primary.removeAttribute('download');
    secondary.href = '/downloads/lockin.apk';
    secondary.textContent = 'Android app (APK)';
    secondary.setAttribute('download', '');
    if (lede) lede.textContent = 'iPhone can run the whole trial in the browser. App blocking, screen time and the strict kiosk are Android-only, so that build is the one to install on an Android phone.';
    if (note) note.textContent = 'The trial needs no install. The APK is for an Android phone.';
  } else {
    primary.href = '/downloads/lockin-extension.zip';
    primary.textContent = 'Get the Chrome extension';
    primary.setAttribute('download', '');
    secondary.href = '/downloads/lockin.apk';
    secondary.textContent = 'Download the Android app';
    secondary.setAttribute('download', '');
    if (lede) lede.textContent = 'On a laptop, the extension is the quick win: block sites, cap daily minutes and cut Shorts and Reels at the URL. The Android build is the full study clock.';
    if (note) note.textContent = 'Chrome and Edge: unzip the extension, then load it from chrome://extensions with Developer mode on.';
  }
}

/* ---------- version and sizes from the pack step ---------- */

fetch('/downloads/site.json', { cache: 'no-store' })
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (!data) return;
    document.querySelectorAll('[data-dl-version]').forEach((node) => {
      node.textContent = data.version ? `v${data.version}` : 'latest';
    });
    const apk = document.querySelector('[data-dl-apk-size]');
    const zip = document.querySelector('[data-dl-zip-size]');
    if (apk && data.apkBytes) apk.textContent = bytes(data.apkBytes);
    if (zip && data.zipBytes) zip.textContent = bytes(data.zipBytes);
  })
  .catch(() => { /* the links still work; labels stay at latest */ });

function bytes(n) {
  const mb = Number(n) / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.max(1, Math.round(Number(n) / 1024))} KB`;
}

/* ---------- years ---------- */

const year = new Date().getFullYear();
for (const id of ['year', 'footer-year']) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(year);
}
