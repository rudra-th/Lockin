/* Lockin — landing page behaviour.
   Everything here is progressive: the page reads without it, and the live
   pieces (the 50 second ring, the screen switcher, the stage slider) are real
   interactions rather than decoration.

   Version 1.12.0: the product moved under /app/ and the trial opened at
   /app/?trial=1; downloads live at /downloads/. */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- the root service worker, once ----------
   The previous release served the app from /. If a visitor still has that
   worker, retire it so the landing page is what they see next. The kill-switch
   at /sw.js does the same from inside the worker; this covers the page side. */

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

/* An installed copy of the old root app should keep opening the product,
   not the marketing page. */
if (matchMedia('(display-mode: standalone)').matches && location.pathname === '/') {
  location.replace('/app/');
}

/* ---------- reveal on scroll ---------- */

const reveals = [...document.querySelectorAll('.reveal')];
if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  reveals.forEach((node) => io.observe(node));
} else {
  reveals.forEach((node) => node.classList.add('is-in'));
}

/* ---------- the hero ring ---------- */

const ring = document.getElementById('hero-ring');
const clock = document.getElementById('hero-clock');
const bar = document.getElementById('hero-bar');
const startBtn = document.getElementById('hero-start');
const statusEl = document.getElementById('hero-status');
const DURATION = 50_000;
const CIRC = 2 * Math.PI * 268;

let remaining = DURATION;
let running = false;
let startedAt = 0;
let base = DURATION;
let frame = 0;

function paintTimer() {
  const safe = Math.max(0, remaining);
  const secs = Math.ceil(safe / 1000);
  if (clock) clock.textContent = `00:${String(secs).padStart(2, '0')}`;
  if (bar) bar.style.width = `${(safe / DURATION) * 100}%`;
  if (ring) {
    ring.style.strokeDasharray = String(CIRC);
    ring.style.strokeDashoffset = String(CIRC * (1 - safe / DURATION));
  }
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function tick(now) {
  if (!running) return;
  remaining = base - (now - startedAt);
  if (remaining <= 0) {
    remaining = 0;
    running = false;
    paintTimer();
    if (startBtn) startBtn.textContent = 'Go again';
    setStatus('Done — that was 50 seconds');
    return;
  }
  paintTimer();
  frame = requestAnimationFrame(tick);
}

function startTimer() {
  if (running) {
    running = false;
    cancelAnimationFrame(frame);
    base = remaining;
    if (startBtn) startBtn.textContent = 'Resume';
    setStatus('Paused');
    return;
  }
  if (remaining <= 0) remaining = DURATION;
  base = remaining;
  startedAt = performance.now();
  running = true;
  if (startBtn) startBtn.textContent = 'Pause';
  setStatus('Focusing — the ring is the clock');
  paintTimer();
  frame = requestAnimationFrame(tick);
}

if (startBtn && ring && clock && bar) {
  paintTimer();
  startBtn.addEventListener('click', startTimer);
}

/* ---------- real screens, one at a time ---------- */

const views = {
  today: 'Today: minutes banked, the daily target, the current streak and the clean-day verdict.',
  week: 'The week: seven bars against the goal line, then every clean day for thirteen weeks.',
  session: 'The session: a wall-clock ring, the daily target, attached tasks and one honest way out.',
  rules: 'The rules: strict, earned exit, clean-day floor, Pomodoro and the alarm defaults.',
};

const showTabs = [...document.querySelectorAll('.show-tab')];
const showFrames = [...document.querySelectorAll('.show-frame')];
const showFact = document.getElementById('showcase-fact');

function showView(name) {
  showTabs.forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
  });
  showFrames.forEach((frame) => frame.classList.toggle('is-active', frame.dataset.frame === name));
  if (showFact && views[name]) showFact.textContent = views[name];
}

showTabs.forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));

/* ---------- how it works ---------- */

const stages = [
  { clause: 'Put the week on the record.' },
  { clause: 'One hold arms the room.' },
  { clause: 'Strict mode covers the apps.' },
  { clause: 'The log tells the truth.' },
];

const howRange = document.getElementById('how-range');
const howClause = document.getElementById('how-clause');
const howFrames = [...document.querySelectorAll('.how-frame')];
const howLabels = [...document.querySelectorAll('[data-stage-btn]')];

function setStage(n) {
  const index = Math.max(0, Math.min(stages.length - 1, Number(n) || 0));
  howFrames.forEach((frame) => frame.classList.toggle('is-active', Number(frame.dataset.stage) === index));
  howLabels.forEach((btn) => btn.classList.toggle('is-active', Number(btn.dataset.stageBtn) === index));
  if (howRange) howRange.value = String(index);
  if (howClause) howClause.textContent = stages[index].clause;
}

if (howRange) {
  howRange.addEventListener('input', () => setStage(howRange.value));
  howLabels.forEach((btn) => btn.addEventListener('click', () => setStage(btn.dataset.stageBtn)));
  setStage(0);
}

/* ---------- the proof figures count once ---------- */

function countUp(node) {
  const target = Number(node.dataset.count) || 0;
  if (!target) { node.textContent = '0'; return; }
  const began = performance.now();
  const length = 900;
  function step(now) {
    const t = Math.min(1, (now - began) / length);
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
  }, { threshold: 0.5 });
  counters.forEach((node) => countObserver.observe(node));
} else {
  counters.forEach((node) => { node.textContent = node.dataset.count; });
}

/* ---------- one open FAQ card at a time ---------- */

const faqCards = [...document.querySelectorAll('.faq-card')];
faqCards.forEach((card) => {
  card.addEventListener('toggle', () => {
    if (!card.open) return;
    faqCards.forEach((other) => { if (other !== card) other.open = false; });
  });
});

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

/* ---------- a little scroll drift on the ring ---------- */

const arc = document.querySelector('.hero-arc');
if (arc && !reduceMotion) {
  let scheduled = false;
  addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      const shift = Math.min(64, window.scrollY * 0.07);
      arc.style.transform = `translateY(${shift.toFixed(2)}px)`;
      scheduled = false;
    });
  }, { passive: true });
}

/* ---------- footer year ---------- */

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());
