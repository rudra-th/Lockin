/* Lockin — share card.
 *
 * The card is drawn locally with Canvas, at 2x and with the app's own type:
 * Fraunces for the numbers, Hanken Grotesk for sentences, IBM Plex Mono for
 * the small tracked labels. Today's card is a square; the weekly card is 4:5.
 *
 * Sharing goes native first (the Android WebView cannot hand a File to
 * navigator.share), then the Web Share API with files, then a download plus a
 * copied caption. Nothing is uploaded.
 */

import { Store } from './store.js';
import { el, fmtMin, todayKey, addDays, parseKey, weekSummary } from './util.js';
import { svg } from './icons.js';
import { openSheet, hint } from './ui.js';
import { isNative, shareImage } from './native.js';

/* Logical pixels; the export doubles them so text stays sharp on a phone. */
const EXPORT = 2;
const W = 1080;
const H = 1080;
const WEEK_W = 1080;
const WEEK_H = 1350;
const PAD = 84;

const LIME = '#c6f24e';
const BG = '#08090c';
const TX = '#eef0e6';
const MUTED = '#a7ac9e';
const DIM = '#7f857a';

const SERIF = 'Fraunces, Georgia, serif';
const SANS = '"Hanken Grotesk", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", monospace';

const GITHUB = 'M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function shareCaption(mins) {
  return `I focused for ${fmtMin(mins)} today with Lockin! https://lockin.surge.sh`;
}

/* ---------- canvas helpers ---------- */

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/* Canvas has no letter-spacing everywhere, so tracked labels draw per glyph. */
function trackedWidth(ctx, text, spacing = 2) {
  const chars = Array.from(text);
  let width = 0;
  for (const ch of chars) width += ctx.measureText(ch).width;
  return width + spacing * Math.max(0, chars.length - 1);
}

function tracked(ctx, text, x, y, spacing = 2, align = 'left') {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((sum, w) => sum + w, 0)
    + spacing * Math.max(0, chars.length - 1);
  let cursor = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const previous = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => {
    ctx.fillText(ch, cursor, y);
    cursor += widths[i] + spacing;
  });
  ctx.textAlign = previous;
}

/* Shrink a single line until it fits its column, never below a readable size. */
function fitSize(ctx, text, { max, size, weight = 500, family = SERIF, floor = 16 }) {
  let next = size;
  ctx.font = `${weight} ${next}px ${family}`;
  while (next > floor && ctx.measureText(text).width > max) {
    next -= 2;
    ctx.font = `${weight} ${next}px ${family}`;
  }
  return next;
}

function makeBoard(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * EXPORT);
  canvas.height = Math.round(h * EXPORT);
  const ctx = canvas.getContext('2d');
  ctx.scale(EXPORT, EXPORT);
  return { canvas, ctx };
}

function paintBase(ctx, w, h) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  /* One lime glow held in the top-right corner, like light on a desk. */
  const glow = ctx.createRadialGradient(w * 0.88, h * 0.02, 0, w * 0.88, h * 0.02, w * 0.9);
  glow.addColorStop(0, 'rgba(198,242,78,0.19)');
  glow.addColorStop(0.42, 'rgba(198,242,78,0.05)');
  glow.addColorStop(1, 'rgba(198,242,78,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  /* A quiet lift from the bottom so the frame does not sit on flat black. */
  const lift = ctx.createLinearGradient(0, h * 0.62, 0, h);
  lift.addColorStop(0, 'rgba(255,255,255,0)');
  lift.addColorStop(1, 'rgba(255,255,255,0.022)');
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.075)';
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, w - 48, h - 48, 44);
  ctx.stroke();
}

function drawHeader(ctx, logo, rightText, width) {
  const x = PAD;
  const y = 78;
  const size = 52;

  if (logo) {
    ctx.save();
    roundRect(ctx, x, y, size, size, 16);
    ctx.clip();
    ctx.drawImage(logo, x, y, size, size);
    ctx.restore();
  } else {
    ctx.fillStyle = LIME;
    roundRect(ctx, x, y, size, size, 16);
    ctx.fill();
    ctx.fillStyle = BG;
    ctx.font = `600 32px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('L', x + size / 2, y + size / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  ctx.fillStyle = TX;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `500 36px ${SERIF}`;
  ctx.fillText('Lockin.', x + size + 16, y + size / 2 + 1);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = MUTED;
  ctx.font = `500 19px ${MONO}`;
  tracked(ctx, rightText, width - PAD, y + size / 2 + 7, 2.6, 'right');
}

function drawCredit(ctx, x, y, align = 'right') {
  const label = 'made by Rudra';
  ctx.font = `500 17px ${MONO}`;
  const total = ctx.measureText(label).width + 27;
  const start = align === 'right' ? x - total : x;

  try {
    const path = new Path2D(GITHUB);
    ctx.save();
    ctx.translate(start, y - 15);
    ctx.scale(17 / 24, 17 / 24);
    ctx.fillStyle = DIM;
    ctx.fill(path);
    ctx.restore();
  } catch (_) {
    /* no Path2D: the words still carry the credit */
  }

  ctx.fillStyle = DIM;
  ctx.textAlign = 'left';
  ctx.font = `500 17px ${MONO}`;
  ctx.fillText(label, start + 27, y);
}

/* ---------- today's card (1:1) ---------- */

async function drawCard({ mins, goal, name, credit, logo, week }) {
  const { canvas, ctx } = makeBoard(W, H);
  const now = new Date();
  const goalMin = Math.max(1, Math.round(goal || mins || 1));
  const focus = Math.max(0, Math.round(mins || 0));
  const ratio = focus / goalMin;
  const pct = Math.min(1, Math.max(0, ratio));
  const over = focus - goalMin;

  paintBase(ctx, W, H);
  drawHeader(
    ctx,
    logo,
    `${DAYS[now.getDay()]} · ${String(now.getDate()).padStart(2, '0')} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`,
    W,
  );

  /* eyebrow */
  ctx.fillStyle = LIME;
  ctx.font = `600 22px ${MONO}`;
  tracked(ctx, 'FOCUSED TODAY', PAD, 292, 4.6);

  /* the number */
  const number = fmtMin(focus);
  const numberSize = fitSize(ctx, number, { max: 548, size: 196, weight: 500 });
  ctx.fillStyle = TX;
  ctx.font = `500 ${numberSize}px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText(number, PAD - 6, 470);

  /* what it counts against */
  ctx.fillStyle = MUTED;
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(`against a ${fmtMin(goalMin)} target`, PAD, 528);

  /* the ring, right of the number */
  const cx = 837;
  const cy = 362;
  const r = 140;
  ctx.lineCap = 'round';

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  if (pct > 0) {
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = TX;
  ctx.font = `500 78px ${SERIF}`;
  ctx.fillText(`${Math.round(ratio * 100)}%`, cx, cy + 14);
  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, 'OF TARGET', cx, cy + 58, 3, 'center');

  /* progress rail */
  const railY = 596;
  const railW = W - PAD * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  roundRect(ctx, PAD, railY, railW, 12, 6);
  ctx.fill();

  if (pct > 0) {
    ctx.fillStyle = LIME;
    roundRect(ctx, PAD, railY, Math.max(12, railW * pct), 12, 6);
    ctx.fill();
  }

  /* status pill — the words replace the old arrow badge */
  const pillText = over > 0
    ? `+${fmtMin(over)} over target`
    : over === 0
      ? 'target met'
      : `${fmtMin(-over)} to go`;
  ctx.font = `500 20px ${MONO}`;
  const pillW = trackedWidth(ctx, pillText, 2.2) + 56;
  const pillY = 636;
  const pillH = 52;

  ctx.fillStyle = 'rgba(198,242,78,0.10)';
  roundRect(ctx, PAD, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(198,242,78,0.32)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, PAD, pillY, pillW, pillH, pillH / 2);
  ctx.stroke();

  ctx.fillStyle = LIME;
  ctx.textAlign = 'left';
  tracked(ctx, pillText, PAD + 28, pillY + 33, 2.2);

  /* divider */
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, 748);
  ctx.lineTo(W - PAD, 748);
  ctx.stroke();

  /* last seven days, small and true */
  const chartLeft = PAD;
  const chartRight = 620;
  const chartBottom = 930;
  const maxBar = 104;
  const rows = week?.days || [];
  const scale = Math.max(
    1,
    ...rows.map((row) => Math.max(row.mins, row.goal)),
  );

  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, 'LAST SEVEN DAYS', chartLeft, 800, 3.4);

  if (rows.length) {
    const step = (chartRight - chartLeft) / rows.length;
    const barW = 36;

    /* a hairline baseline, so the bars sit on something */
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartLeft, chartBottom + 0.5);
    ctx.lineTo(chartRight, chartBottom + 0.5);
    ctx.stroke();

    rows.forEach((row, i) => {
      const x = chartLeft + step * (i + 0.5) - barW / 2;
      const height = row.mins ? Math.max(6, (row.mins / scale) * maxBar) : 3;
      const today = i === rows.length - 1;

      ctx.fillStyle = row.met
        ? LIME
        : today
          ? 'rgba(198,242,78,0.52)'
          : row.mins
            ? 'rgba(238,240,230,0.30)'
            : 'rgba(255,255,255,0.08)';
      roundRect(ctx, x, chartBottom - height, barW, height, 8);
      ctx.fill();

      ctx.fillStyle = today ? TX : DIM;
      ctx.font = `${today ? 600 : 500} 15px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(shortDay(row.day), x + barW / 2, chartBottom + 30);
    });
  }

  /* who it belongs to */
  ctx.textAlign = 'right';
  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, 'FOCUSED BY', W - PAD, 800, 3.4, 'right');

  const who = (name || 'A Lockin student').trim().slice(0, 40) || 'A Lockin student';
  const whoSize = fitSize(ctx, who, { max: 330, size: 44, weight: 500 });
  ctx.fillStyle = TX;
  ctx.font = `500 ${whoSize}px ${SERIF}`;
  ctx.fillText(who, W - PAD, 852);

  /* footer */
  ctx.textAlign = 'left';
  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, 'lockin.surge.sh', PAD, 1006, 1.8);

  if (credit) drawCredit(ctx, W - PAD, 1006, 'right');

  return canvas;
}

/* ---------- the week card (4:5) ---------- */

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
  const { canvas, ctx } = makeBoard(WEEK_W, WEEK_H);
  const first = summary.days[0].day;
  const last = summary.days[summary.days.length - 1].day;
  const range = `${parseKey(first).getDate()} ${MONTHS[parseKey(first).getMonth()]} – `
    + `${parseKey(last).getDate()} ${MONTHS[parseKey(last).getMonth()]} ${parseKey(last).getFullYear()}`;

  paintBase(ctx, WEEK_W, WEEK_H);
  drawHeader(ctx, logo, range, WEEK_W);

  /* eyebrow */
  ctx.fillStyle = LIME;
  ctx.font = `600 22px ${MONO}`;
  tracked(ctx, 'THIS WEEK', PAD, 292, 4.6);

  /* total */
  const totalText = fmtMin(summary.total);
  const totalSize = fitSize(ctx, totalText, { max: 700, size: 156, weight: 500 });
  ctx.fillStyle = TX;
  ctx.font = `500 ${totalSize}px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText(totalText, PAD - 6, 470);

  ctx.fillStyle = MUTED;
  ctx.font = `400 30px ${SANS}`;
  const run = summary.streak > 0
    ? ` · ${summary.streak}-day streak`
    : '';
  ctx.fillText(`${summary.targetDays} of 7 days on target${run}`, PAD, 528);

  /* seven bars against their own target */
  const chartTop = 610;
  const chartBottom = 980;
  const chartW = WEEK_W - PAD * 2;
  const step = chartW / 7;
  const barW = 56;
  const max = Math.max(60, ...summary.days.map((d) => Math.max(d.mins, d.goal)));
  const span = chartBottom - chartTop;

  /* a hairline baseline under the bars */
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, chartBottom + 0.5);
  ctx.lineTo(WEEK_W - PAD, chartBottom + 0.5);
  ctx.stroke();

  summary.days.forEach((row, i) => {
    const x = PAD + i * step + step / 2 - barW / 2;
    const height = row.mins ? Math.max(8, (row.mins / max) * span) : 4;
    const today = i === summary.days.length - 1;

    ctx.fillStyle = row.met
      ? LIME
      : today
        ? 'rgba(198,242,78,0.52)'
        : row.mins
          ? 'rgba(238,240,230,0.30)'
          : 'rgba(255,255,255,0.08)';
    roundRect(ctx, x, chartBottom - height, barW, height, 10);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = today ? TX : DIM;
    ctx.font = `${today ? 600 : 500} 19px ${MONO}`;
    ctx.fillText(shortDay(row.day), x + barW / 2, chartBottom + 42);

    ctx.fillStyle = DIM;
    ctx.font = `400 17px ${MONO}`;
    ctx.fillText(row.mins ? fmtMin(row.mins) : '—', x + barW / 2, chartBottom + 74);
  });

  /* three facts, one line */
  const col = [PAD, 430, 760];
  ctx.textAlign = 'left';
  ctx.fillStyle = LIME;
  ctx.font = `600 16px ${MONO}`;
  tracked(ctx, 'BEST DAY', col[0], 1100, 3.2);
  tracked(ctx, 'FINISHED', col[1], 1100, 3.2);
  tracked(ctx, 'DAILY AVERAGE', col[2], 1100, 3.2);

  ctx.fillStyle = TX;
  ctx.font = `500 34px ${SERIF}`;
  ctx.fillText(`${shortDay(summary.best.day)} · ${fmtMin(summary.best.mins)}`, col[0], 1148);

  const task = (summary.topTask || '—').trim();
  const taskSize = fitSize(ctx, task, {
    max: 290, size: 30, weight: 400, family: SANS, floor: 20,
  });
  ctx.font = `400 ${taskSize}px ${SANS}`;
  ctx.fillText(task, col[1], 1146);

  ctx.font = `500 34px ${SERIF}`;
  ctx.fillText(`${fmtMin(summary.average)}/day`, col[2], 1148);

  /* footer */
  const logoY = 1210;
  if (logo) {
    ctx.save();
    roundRect(ctx, PAD, logoY, 44, 44, 14);
    ctx.clip();
    ctx.drawImage(logo, PAD, logoY, 44, 44);
    ctx.restore();
  } else {
    ctx.fillStyle = LIME;
    roundRect(ctx, PAD, logoY, 44, 44, 14);
    ctx.fill();
    ctx.fillStyle = BG;
    ctx.font = `600 28px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('L', PAD + 22, logoY + 23);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  ctx.fillStyle = TX;
  ctx.font = `500 32px ${SERIF}`;
  ctx.fillText('Lockin.', PAD + 60, 1242);

  ctx.textAlign = 'right';
  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, 'FOCUSED BY', WEEK_W - PAD, 1204, 3.2, 'right');

  const who = (name || 'A Lockin student').trim().slice(0, 40) || 'A Lockin student';
  const whoSize = fitSize(ctx, who, { max: 330, size: 38, weight: 500, floor: 22 });
  ctx.fillStyle = TX;
  ctx.font = `500 ${whoSize}px ${SERIF}`;
  ctx.fillText(who, WEEK_W - PAD, 1246);

  ctx.textAlign = 'left';
  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, 'lockin.surge.sh', PAD, 1300, 1.8);

  if (credit) drawCredit(ctx, WEEK_W - PAD, 1300, 'right');

  return canvas;
}

export function weekCaption(summary) {
  return `${fmtMin(summary.total)} focused this week, ${summary.targetDays}/7 days on target with Lockin! https://lockin.surge.sh`;
}

/* ---------- building the files ---------- */

async function fontsReady() {
  if (!document.fonts?.ready) return;
  try {
    await Promise.all([
      document.fonts.load('500 100px Fraunces'),
      document.fonts.load('600 20px "IBM Plex Mono"'),
      document.fonts.load('400 30px "Hanken Grotesk"'),
      document.fonts.load('500 15px "IBM Plex Mono"'),
    ]);
    await document.fonts.ready;
  } catch (_) {
    /* fall back to the system stack */
  }
}

function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL('../icons/icon-192.png', import.meta.url).href;
  });
}

async function toFile(canvas, name) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return {
    canvas,
    blob,
    file: blob ? new File([blob], name, { type: 'image/png' }) : null,
  };
}

async function makeFile(options) {
  await fontsReady();
  const logo = await loadLogo();
  const week = currentWeekSummary();
  const day = todayKey();
  const canvas = await drawCard({ ...options, logo, week });
  return toFile(canvas, `lockin-${day}.png`);
}

async function makeWeekFile(options) {
  await fontsReady();
  const logo = await loadLogo();
  const day = todayKey();
  const canvas = await drawWeekCard({ ...options, logo });
  return toFile(canvas, `lockin-week-${day}.png`);
}

function download(blob, day) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `lockin-${day}.png` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- sharing ---------- */

/**
 * Hand the card to the best available share surface.
 * Returns 'shared' | 'caption' | 'saved' | 'cancelled' | 'failed'.
 */
async function sharePhoto({ made, caption, title, name }) {
  if (isNative) {
    try {
      /* The WebView has no file sharing; the bridge writes the PNG to cache
         and opens the system chooser with a FileProvider URI. */
      const dataURL = made.canvas.toDataURL('image/png');
      if (await shareImage({ dataURL, name, text: caption })) return 'shared';
    } catch (_) {
      /* fall through to the web paths */
    }
  }

  if (made.file && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const files = { files: [made.file] };
    const canFiles = typeof navigator.canShare !== 'function' || navigator.canShare(files);
    if (canFiles) {
      try {
        await navigator.share({ ...files, text: caption, title });
        return 'shared';
      } catch (err) {
        if (err?.name === 'AbortError') return 'cancelled';
      }
    }
    /* Some platforms only share text. Share the caption rather than nothing. */
    try {
      await navigator.share({ text: caption, title });
      return 'caption';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  if (made.blob) {
    download(made.blob, name.replace(/^lockin-/, '').replace(/\.png$/, ''));
    try { await navigator.clipboard.writeText(caption); } catch (_) { /* shown below */ }
    return 'saved';
  }

  return 'failed';
}

const SHARE_MESSAGE = {
  shared: '',
  caption: 'Shared the caption only. Use Save image for the picture.',
  saved: 'Image saved and caption copied — attach it in any app.',
  cancelled: '',
  failed: 'Could not build the image on this device.',
};

function previewUrlFor(made) {
  if (made.blob) return URL.createObjectURL(made.blob);
  return made.canvas.toDataURL('image/png');
}

/* ---------- the sheets ---------- */

/** Open the preview sheet; the image is built only when this is called. */
export function openShareSheet({ mins, goal } = {}) {
  const focusMin = Math.max(0, Math.round(mins ?? Store.focusMinutesOn(todayKey())));
  const target = Math.max(1, Math.round(goal ?? Store.goalToday() ?? focusMin));
  let credit = true;
  let building = null;
  let previewUrl = null;

  const preview = el('img', {
    class: 'share-preview share-preview-square',
    alt: 'Your focus card preview',
  });
  const status = el('p', { class: 'share-status', role: 'status' }, '');
  const caption = shareCaption(focusMin);

  const build = () => {
    building = makeFile({
      mins: focusMin,
      goal: target,
      name: Store.state.profile.name || '',
      credit,
    }).then((made) => {
      const next = previewUrlFor(made);
      preview.src = next;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = next;
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
        status.textContent = SHARE_MESSAGE[await sharePhoto({
          made,
          caption,
          title: 'My focus today',
          name: `lockin-${todayKey()}.png`,
        })];
      } catch (_) {
        status.textContent = 'Sharing did not open. Try Save image.';
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
      build();
    },
  });
  creditBtn.classList.add('is-on');

  openSheet('Share today', () => [
    el('p', { class: 'muted', style: 'margin:0 0 10px' },
      `A square card for the ${fmtMin(focusMin)} you focused today — drawn on this device, never uploaded.`),
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
  let previewUrl = null;

  const preview = el('img', {
    class: 'share-preview share-preview-week',
    alt: 'Your weekly focus card preview',
  });
  const status = el('p', { class: 'share-status', role: 'status' }, '');
  const caption = weekCaption(summary);

  const build = () => {
    building = makeWeekFile({
      summary,
      name: Store.state.profile.name || '',
      credit,
    }).then((made) => {
      const next = previewUrlFor(made);
      preview.src = next;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = next;
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
        status.textContent = SHARE_MESSAGE[await sharePhoto({
          made,
          caption,
          title: 'My week in focus',
          name: `lockin-week-${todayKey()}.png`,
        })];
      } catch (_) {
        status.textContent = 'Sharing did not open. Try Save image.';
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
      `Seven days, ${fmtMin(summary.total)} focused, ${summary.targetDays} on target. Drawn on this device, never uploaded.`),
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
