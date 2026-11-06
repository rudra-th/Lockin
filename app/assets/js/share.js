/* Lockin — share card.
 *
 * One PNG, drawn locally with Canvas: the date, today's focus time, a ring
 * filled against the daily target, the student's name and the Lockin mark.
 * Shared through the Web Share API when the platform supports files, with a
 * download + copied caption as the honest fallback. Nothing is uploaded.
 */

import { Store } from './store.js';
import { el, fmtMin, todayKey, addDays, parseKey, weekSummary } from './util.js';
import { svg } from './icons.js';
import { openSheet, hint } from './ui.js';

const W = 1080;
const H = 1350;
const PAD = 88;
const LIME = '#c6f24e';
const BG = '#08090c';
const TX = '#eef0e6';
const MUTED = '#a7ac9e';
const DIM = '#7f857a';
const LINE = 'rgba(255,255,255,0.12)';
const GITHUB = 'M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function shareCaption(mins) {
  return `I focused for ${fmtMin(mins)} today with Lockin! https://lockin.surge.sh`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL('../icons/icon-192.png', import.meta.url).href;
  });
}

function drawCredit(ctx, x, y) {
  ctx.fillStyle = DIM;
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  /* Octocat mark, scaled from its 24-unit viewBox. */
  try {
    const p = new Path2D(GITHUB);
    ctx.save();
    ctx.translate(x, y - 11);
    ctx.scale(20 / 24, 20 / 24);
    ctx.fillStyle = DIM;
    ctx.fill(p);
    ctx.restore();
    ctx.fillText('made by Rudra', x + 30, y);
  } catch (_) {
    ctx.fillText('made by Rudra', x, y);
  }
}

async function drawCard({ mins, goal, name, credit, logo }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const now = new Date();
  const goalMin = Math.max(1, goal || mins || 1);
  const pct = Math.min(1, mins / goalMin);
  const over = mins > goalMin;

  /* backdrop */
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 80, 30, 0, W - 80, 30, 760);
  glow.addColorStop(0, 'rgba(198,242,78,0.16)');
  glow.addColorStop(0.55, 'rgba(198,242,78,0.04)');
  glow.addColorStop(1, 'rgba(198,242,78,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, 36, 36, W - 72, H - 72, 34);
  ctx.stroke();

  /* date + eyebrow */
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = '500 24px "IBM Plex Mono", monospace';
  ctx.fillText(`${DAYS[now.getDay()]} · ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`, PAD, 150);

  ctx.fillStyle = LIME;
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('FOCUSED TODAY', PAD, 262);

  /* the number */
  ctx.fillStyle = TX;
  ctx.font = '400 148px Fraunces, Georgia, serif';
  ctx.fillText(fmtMin(mins), PAD, 408);

  /* target ring */
  const cx = W / 2;
  const cy = 790;
  const r = 206;
  ctx.lineCap = 'round';
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = LIME;
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = TX;
  ctx.font = '400 92px Fraunces, Georgia, serif';
  ctx.fillText(`${Math.round((mins / goalMin) * 100)}%`, cx, cy + 16);
  ctx.fillStyle = MUTED;
  ctx.font = '500 22px "IBM Plex Mono", monospace';
  ctx.fillText('OF DAILY TARGET', cx, cy + 62);
  ctx.fillStyle = DIM;
  ctx.font = '400 26px "Hanken Grotesk", system-ui, sans-serif';
  ctx.fillText(`${fmtMin(goalMin)} target`, cx, cy + 120);

  /* over-target arrow badge */
  if (over) {
    const bx = cx + r * 0.72;
    const by = cy - r * 0.72;
    ctx.fillStyle = LIME;
    ctx.beginPath();
    ctx.arc(bx, by, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = BG;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 16, by + 16);
    ctx.lineTo(bx + 16, by - 16);
    ctx.moveTo(bx - 4, by - 16);
    ctx.lineTo(bx + 16, by - 16);
    ctx.lineTo(bx + 16, by + 4);
    ctx.stroke();

    ctx.fillStyle = LIME;
    ctx.font = '600 24px "IBM Plex Mono", monospace';
    ctx.fillText(`+${fmtMin(mins - goalMin)} over target`, cx, cy + r + 72);
  } else {
    ctx.fillStyle = LIME;
    ctx.font = '600 24px "IBM Plex Mono", monospace';
    ctx.fillText('Target met', cx, cy + r + 72);
  }

  /* footer: app mark left, student right */
  const baseY = 1188;
  if (logo) {
    ctx.save();
    roundRect(ctx, PAD, baseY - 56, 72, 72, 20);
    ctx.clip();
    ctx.drawImage(logo, PAD, baseY - 56, 72, 72);
    ctx.restore();
  } else {
    ctx.fillStyle = LIME;
    roundRect(ctx, PAD, baseY - 56, 72, 72, 20);
    ctx.fill();
    ctx.fillStyle = BG;
    ctx.font = '700 42px Fraunces, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('L', PAD + 36, baseY - 2);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = TX;
  ctx.font = '400 44px Fraunces, Georgia, serif';
  ctx.fillText('Lockin.', PAD + 92, baseY - 8);
  ctx.fillStyle = DIM;
  ctx.font = '500 19px "IBM Plex Mono", monospace';
  ctx.fillText('lockin.surge.sh', PAD + 94, baseY + 22);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText('FOCUSED BY', W - PAD, baseY - 40);
  ctx.fillStyle = TX;
  ctx.font = '400 44px Fraunces, Georgia, serif';
  const line = (name || 'A Lockin student').slice(0, 22);
  ctx.fillText(line, W - PAD, baseY + 4);

  if (credit) drawCredit(ctx, PAD, H - 78);

  return canvas;
}

function topTaskTitle(days) {
  const done = Store.state.tasks
    .filter((t) => t.doneAt && days.includes(t.date))
    .sort((a, b) => b.doneAt - a.doneAt);
  return done[0]?.title || null;
}

export function currentWeekSummary() {
  const end = todayKey();
  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(addDays(end, -i));
  return weekSummary(end, {
    minutesOn: (day) => Store.focusMinutesOn(day),
    goalOn: (day) => Store.goalFor(day),
    streak: Store.goalStreak(end),
    topTask: topTaskTitle(days),
  });
}

function shortDay(day) {
  return DAYS[parseKey(day).getDay()].slice(0, 2);
}

async function drawWeekCard({ summary, name, credit, logo }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const first = summary.days[0].day;
  const last = summary.days[summary.days.length - 1].day;
  const range = `${parseKey(first).getDate()} ${MONTHS[parseKey(first).getMonth()]} – `
    + `${parseKey(last).getDate()} ${MONTHS[parseKey(last).getMonth()]} ${parseKey(last).getFullYear()}`;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 80, 30, 0, W - 80, 30, 760);
  glow.addColorStop(0, 'rgba(198,242,78,0.16)');
  glow.addColorStop(0.55, 'rgba(198,242,78,0.04)');
  glow.addColorStop(1, 'rgba(198,242,78,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, 36, 36, W - 72, H - 72, 34);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = '500 24px "IBM Plex Mono", monospace';
  ctx.fillText(range, PAD, 150);

  ctx.fillStyle = LIME;
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('THIS WEEK', PAD, 262);

  ctx.fillStyle = TX;
  ctx.font = '400 132px Fraunces, Georgia, serif';
  ctx.fillText(fmtMin(summary.total), PAD, 408);

  ctx.fillStyle = MUTED;
  ctx.font = '500 24px "IBM Plex Mono", monospace';
  const streakText = summary.streak > 0 ? ` · ${summary.streak}-day streak` : '';
  ctx.fillText(`${summary.targetDays} of 7 days on target${streakText}`, PAD, 458);

  /* bars */
  const chartTop = 540;
  const chartBottom = 1000;
  const chartW = W - PAD * 2;
  const step = chartW / 7;
  const max = Math.max(60, ...summary.days.map((d) => Math.max(d.mins, d.goal))) * 1.08;
  summary.days.forEach((row, i) => {
    const x = PAD + i * step + step / 2;
    const h = row.mins ? Math.max(8, (row.mins / max) * (chartBottom - chartTop)) : 4;
    const goalY = chartBottom - (row.goal / max) * (chartBottom - chartTop);
    const barW = Math.min(64, step * 0.52);

    ctx.fillStyle = row.met ? LIME : row.mins ? 'rgba(167,172,158,0.42)' : 'rgba(255,255,255,0.08)';
    roundRect(ctx, x - barW / 2, chartBottom - h, barW, h, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(238,240,230,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - step * 0.36, goalY);
    ctx.lineTo(x + step * 0.36, goalY);
    ctx.stroke();

    ctx.fillStyle = i === 6 ? TX : DIM;
    ctx.font = '500 20px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(shortDay(row.day), x, chartBottom + 42);
    ctx.fillStyle = DIM;
    ctx.font = '400 18px "IBM Plex Mono", monospace';
    ctx.fillText(row.mins ? fmtMin(row.mins) : '—', x, chartBottom + 74);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = LIME;
  ctx.font = '600 20px "IBM Plex Mono", monospace';
  ctx.fillText('BEST DAY', PAD, 1108);
  ctx.fillStyle = TX;
  ctx.font = '400 34px Fraunces, Georgia, serif';
  ctx.fillText(`${shortDay(summary.best.day)} · ${fmtMin(summary.best.mins)}`, PAD, 1150);

  if (summary.topTask) {
    ctx.fillStyle = LIME;
    ctx.font = '600 20px "IBM Plex Mono", monospace';
    ctx.fillText('FINISHED', PAD + 330, 1108);
    ctx.fillStyle = TX;
    ctx.font = '400 30px Hanken Grotesk, system-ui, sans-serif';
    ctx.fillText(summary.topTask.slice(0, 30), PAD + 330, 1148);
  }

  /* footer: app mark left, student right */
  const baseY = 1248;
  if (logo) {
    ctx.save();
    roundRect(ctx, PAD, baseY - 56, 72, 72, 20);
    ctx.clip();
    ctx.drawImage(logo, PAD, baseY - 56, 72, 72);
    ctx.restore();
  } else {
    ctx.fillStyle = LIME;
    roundRect(ctx, PAD, baseY - 56, 72, 72, 20);
    ctx.fill();
    ctx.fillStyle = BG;
    ctx.font = '700 42px Fraunces, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('L', PAD + 36, baseY - 2);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = TX;
  ctx.font = '400 44px Fraunces, Georgia, serif';
  ctx.fillText('Lockin.', PAD + 92, baseY - 8);
  ctx.fillStyle = DIM;
  ctx.font = '500 19px "IBM Plex Mono", monospace';
  ctx.fillText('lockin.surge.sh', PAD + 94, baseY + 22);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText('FOCUSED BY', W - PAD, baseY - 40);
  ctx.fillStyle = TX;
  ctx.font = '400 44px Fraunces, Georgia, serif';
  ctx.fillText((name || 'A Lockin student').slice(0, 22), W - PAD, baseY + 4);

  if (credit) drawCredit(ctx, PAD, H - 78);

  return canvas;
}

export function weekCaption(summary) {
  return `${fmtMin(summary.total)} focused this week, ${summary.targetDays}/7 days on target with Lockin! https://lockin.surge.sh`;
}

async function makeWeekFile(options) {
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) { /* system fallback */ }
  }
  const logo = await loadLogo();
  const canvas = await drawWeekCard({ ...options, logo });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const day = todayKey();
  return {
    canvas,
    blob,
    file: blob ? new File([blob], `lockin-week-${day}.png`, { type: 'image/png' }) : null,
  };
}

async function makeFile(options) {
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) { /* system fallback */ }
  }
  const logo = await loadLogo();
  const canvas = await drawCard({ ...options, logo });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const day = todayKey();
  return {
    canvas,
    blob,
    file: blob ? new File([blob], `lockin-${day}.png`, { type: 'image/png' }) : null,
  };
}

function download(blob, day) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `lockin-${day}.png` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Open the preview sheet; the image is built only when this is called. */
export function openShareSheet({ mins, goal } = {}) {
  const focusMin = Math.max(0, Math.round(mins ?? Store.focusMinutesOn(todayKey())));
  const target = Math.max(1, Math.round(goal ?? Store.goalToday() ?? focusMin));
  let credit = true;
  let building = null;

  const preview = el('img', { class: 'share-preview', alt: 'Your focus card preview' });
  const status = el('p', { class: 'share-status', role: 'status' }, '');
  const caption = shareCaption(focusMin);

  const build = () => {
    building = makeFile({
      mins: focusMin,
      goal: target,
      name: Store.state.profile.name || '',
      credit,
    }).then((made) => {
      preview.src = made.canvas.toDataURL('image/png');
      return made;
    });
    return building;
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      hint('Caption copied');
    } catch (_) {
      status.textContent = caption;
    }
  };

  const shareBtn = el('button', {
    class: 'btn btn-primary btn-block', type: 'button',
    onclick: async () => {
      shareBtn.disabled = true;
      status.textContent = 'Building your card…';
      try {
        const made = await build();
        if (navigator.share && made.file && navigator.canShare?.({ files: [made.file] })) {
          await navigator.share({ files: [made.file], text: caption, title: 'My focus today' });
          status.textContent = '';
        } else if (made.blob) {
          download(made.blob, todayKey());
          try { await navigator.clipboard.writeText(caption); } catch (_) { /* caption is above */ }
          status.textContent = 'Image saved. Caption copied — attach it in WhatsApp or any app.';
        } else {
          status.textContent = 'Could not build the image on this device.';
        }
      } catch (err) {
        if (err?.name !== 'AbortError') status.textContent = 'Sharing did not open. Try Save image.';
      } finally {
        shareBtn.disabled = false;
      }
    },
  }, svg('share', 16), 'Share image');

  const saveBtn = el('button', {
    class: 'btn btn-subtle btn-block', type: 'button',
    onclick: async () => {
      saveBtn.disabled = true;
      status.textContent = 'Building your card…';
      try {
        const made = await build();
        if (!made.blob) { status.textContent = 'Could not build the image on this device.'; return; }
        download(made.blob, todayKey());
        status.textContent = 'Saved to your downloads.';
      } finally {
        saveBtn.disabled = false;
      }
    },
  }, 'Save image');

  const creditBtn = el('button', {
    class: 'switch', role: 'switch', 'aria-checked': 'true',
    'aria-label': 'Show made by Rudra on the image',
    onclick: () => {
      credit = !credit;
      creditBtn.setAttribute('aria-checked', String(credit));
      creditBtn.classList.toggle('is-on', credit);
      build(); // rebuild the preview with or without the credit
    },
  });
  creditBtn.classList.add('is-on');

  openSheet('Share today', () => [
    el('p', { class: 'muted', style: 'margin:0 0 10px' },
      `A card for the ${fmtMin(focusMin)} you focused today — saved on this device, not uploaded.`),
    preview,
    el('div', { class: 'share-credit' },
      el('div', { class: 'grow' },
        el('b', {}, 'Made by Rudra'),
        el('span', {}, 'Hide this from the image')),
      creditBtn),
    el('div', { class: 'btn-stack' }, shareBtn, saveBtn),
    el('button', { class: 'btn btn-subtle btn-block', type: 'button', onclick: copyCaption },
      svg('copy', 15), 'Copy the caption'),
    status,
    el('p', { class: 'share-caption' }, caption),
  ]);

  build().catch(() => { status.textContent = 'Could not build the preview.'; });
}

/** Open the seven-day card. Same renderer, same local-only promise. */
export function openWeekShare() {
  const summary = currentWeekSummary();
  let credit = true;
  let building = null;

  const preview = el('img', { class: 'share-preview', alt: 'Your weekly focus card preview' });
  const status = el('p', { class: 'share-status', role: 'status' }, '');
  const caption = weekCaption(summary);

  const build = () => {
    building = makeWeekFile({
      summary,
      name: Store.state.profile.name || '',
      credit,
    }).then((made) => {
      preview.src = made.canvas.toDataURL('image/png');
      return made;
    });
    return building;
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      hint('Caption copied');
    } catch (_) {
      status.textContent = caption;
    }
  };

  const shareBtn = el('button', {
    class: 'btn btn-primary btn-block', type: 'button',
    onclick: async () => {
      shareBtn.disabled = true;
      status.textContent = 'Building your card…';
      try {
        const made = await build();
        if (navigator.share && made.file && navigator.canShare?.({ files: [made.file] })) {
          await navigator.share({ files: [made.file], text: caption, title: 'My week in focus' });
          status.textContent = '';
        } else if (made.blob) {
          download(made.blob, `week-${todayKey()}`);
          try { await navigator.clipboard.writeText(caption); } catch (_) { /* caption is above */ }
          status.textContent = 'Image saved. Caption copied — attach it in WhatsApp or any app.';
        } else {
          status.textContent = 'Could not build the image on this device.';
        }
      } catch (err) {
        if (err?.name !== 'AbortError') status.textContent = 'Sharing did not open. Try Save image.';
      } finally {
        shareBtn.disabled = false;
      }
    },
  }, svg('share', 16), 'Share image');

  const saveBtn = el('button', {
    class: 'btn btn-subtle btn-block', type: 'button',
    onclick: async () => {
      saveBtn.disabled = true;
      status.textContent = 'Building your card…';
      try {
        const made = await build();
        if (!made.blob) { status.textContent = 'Could not build the image on this device.'; return; }
        download(made.blob, `week-${todayKey()}`);
        status.textContent = 'Saved to your downloads.';
      } finally {
        saveBtn.disabled = false;
      }
    },
  }, 'Save image');

  const creditBtn = el('button', {
    class: 'switch', role: 'switch', 'aria-checked': 'true',
    'aria-label': 'Show made by Rudra on the image',
    onclick: () => {
      credit = !credit;
      creditBtn.setAttribute('aria-checked', String(credit));
      creditBtn.classList.toggle('is-on', credit);
      build();
    },
  });
  creditBtn.classList.add('is-on');

  openSheet('Share the week', () => [
    el('p', { class: 'muted', style: 'margin:0 0 10px' },
      `Seven days, ${fmtMin(summary.total)} focused, ${summary.targetDays} on target. Saved on this device, not uploaded.`),
    preview,
    el('div', { class: 'share-credit' },
      el('div', { class: 'grow' },
        el('b', {}, 'Made by Rudra'),
        el('span', {}, 'Hide this from the image')),
      creditBtn),
    el('div', { class: 'btn-stack' }, shareBtn, saveBtn),
    el('button', { class: 'btn btn-subtle btn-block', type: 'button', onclick: copyCaption },
      svg('copy', 15), 'Copy the caption'),
    status,
    el('p', { class: 'share-caption' }, caption),
  ]);

  build().catch(() => { status.textContent = 'Could not build the preview.'; });
}

