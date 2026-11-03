/* Lockin — Settings: enforcement, theme, goals, profile, data in/out. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, fmtMin } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, hint } from '../ui.js';
import { tryInstall } from '../install.js';
import { examByName } from '../exams.js';
import { group, setrow, toggle, stepper } from '../controls.js';
import { ensureAlarmPermission } from '../alarms.js';
import {
  isNative, nativeStatus, requestNotifications, openNotificationSettings,
  openExactAlarmSettings, openUsageAccessSettings, queryUsage,
} from '../native.js';

export function initSettings(Router) {
  Router.register('/settings', { mount, unmount: null });
}

function enforcementCard() {
  const s = Store.state.settings;
  return el('div', { class: 'card' },
    el('h2', {}, 'Enforcement'),
    setrow('Strict Mode',
      `Leaving a focus session for more than ${10}s is a slip in the honesty log. Under ${10}s is forgiven — 3 free rescues a day.`,
      toggle(() => s.strict, () => Store.set((st) => { st.settings.strict = !st.settings.strict; }))),
    setrow('Earned exit',
      'After this much real focus, ending the session is neutral — no slip, no broken streak. Off means every early end counts.',
      stepper(() => Store.state.settings.exitGraceMin,
        (v) => Store.set((st) => { st.settings.exitGraceMin = v; }),
        { lo: 0, hi: 60, step: 5, fmt: (v) => (v === 0 ? 'Off' : fmtMin(v)) })),
    setrow('Keep screen awake',
      'Screen Wake Lock during focus sessions — the phone stays awake while you study.',
      toggle(() => s.wakelock, () => Store.set((st) => { st.settings.wakelock = !st.settings.wakelock; }))),
    setrow('Notifications',
      'A system notification and a buzz when a round completes (asks your browser for permission first time).',
      toggle(() => s.notifs, () => {
        Store.set((st) => { st.settings.notifs = !st.settings.notifs; });
        if (Store.state.settings.notifs && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      })),
    setrow('Daily focus goal', 'The ring you fill each day. Set it in hours and minutes.', stepper(
      () => Store.state.settings.goalMin,
      (v) => Store.set((st) => { st.settings.goalMin = v; }),
      { lo: 15, hi: 600, step: 15, fmt: fmtMin })),
    setrow('Minimum for a clean day', 'Days with less real focus than this never count as clean, even without slips.',
      stepper(() => Store.state.settings.minClean,
        (v) => Store.set((st) => { st.settings.minClean = v; }),
        { lo: 5, hi: 120, step: 5, fmt: fmtMin })),
  );
}

function pomoCard() {
  return el('div', { class: 'card' },
    el('h2', {}, 'Pomodoro'),
    setrow('Focus round length', 'Used by the ×3 Pomodoro chain.', stepper(
      () => Store.state.settings.pomo.focus,
      (v) => Store.set((st) => { st.settings.pomo.focus = v; }),
      { lo: 15, hi: 90, step: 5, suffix: 'm' })),
    setrow('Short break', 'After odd rounds.', stepper(
      () => Store.state.settings.pomo.short,
      (v) => Store.set((st) => { st.settings.pomo.short = v; }),
      { lo: 3, hi: 15, step: 1, suffix: 'm' })),
    setrow('Long break', 'After even rounds.', stepper(
      () => Store.state.settings.pomo.long,
      (v) => Store.set((st) => { st.settings.pomo.long = v; }),
      { lo: 10, hi: 45, step: 5, suffix: 'm' })),
  );
}

function alarmsCard() {
  const s = Store.state.settings;
  return el('div', { class: 'card' },
    el('h2', {}, 'Schedule alarms'),
    setrow('Ring at block start',
      'A full-screen alarm, a system notification and a chime when a scheduled block begins.',
      toggle(() => s.scheduleAlarms, () => {
        Store.set((st) => { st.settings.scheduleAlarms = !st.settings.scheduleAlarms; });
        if (Store.state.settings.scheduleAlarms) ensureAlarmPermission();
      })),
    setrow('Default reminder',
      'New blocks remind you this many minutes before they start. Each block can override it.',
      stepper(() => Store.state.settings.remindDefault,
        (v) => Store.set((st) => { st.settings.remindDefault = v; }),
        { lo: 0, hi: 30, step: 5, fmt: (v) => (v === 0 ? 'Off' : `${v} min before`) })),
    setrow('Alarm sound',
      'Three soft notes at the start, one at the reminder.',
      toggle(() => s.alarmSound, () => Store.set((st) => { st.settings.alarmSound = !st.settings.alarmSound; }))),
    setrow('Vibrate',
      'A short pattern on phones that support it.',
      toggle(() => s.alarmVibrate, () => Store.set((st) => { st.settings.alarmVibrate = !st.settings.alarmVibrate; }))),
    el('p', { class: 'tiny', style: 'margin:12px 0 0' },
      'The web build rings while Lockin is open. The Android build adds exact alarms that ring when it is closed.'),
  );
}

/* ---------- Android shell (only rendered inside the APK) ---------- */

function pill(on, onText = 'On', offText = 'Off') {
  return el('span', { class: `native-pill${on ? ' on' : ''}` }, on ? onText : offText);
}

function nativeCard() {
  if (!isNative) return null;

  const exactPill = pill(false, 'Exact', 'Inexact');
  const notifPill = pill(false);
  const usagePill = pill(false);
  const exactBtn = el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openExactAlarmSettings() }, 'Settings');
  const usageBtn = el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openUsageAccessSettings() }, 'Open');
  const notifBtn = el('button', { class: 'btn btn-subtle btn-sm' }, 'Allow');

  const refresh = async () => {
    if (!document.contains(exactPill)) {
      removeEventListener('visibilitychange', onVisible);
      return;
    }
    const st = await nativeStatus();
    if (!st) return;
    exactPill.textContent = st.exact ? 'Exact' : 'Inexact';
    exactPill.classList.toggle('on', st.exact);
    notifPill.textContent = st.notifications ? 'On' : 'Off';
    notifPill.classList.toggle('on', st.notifications);
    usagePill.textContent = st.usage ? 'On' : 'Off';
    usagePill.classList.toggle('on', st.usage);
    notifBtn.textContent = st.notifications ? 'Settings' : 'Allow';
    notifBtn.onclick = st.notifications
      ? () => openNotificationSettings()
      : async () => { await requestNotifications(); refresh(); };
  };

  const onVisible = () => { if (!document.hidden) refresh(); };
  addEventListener('visibilitychange', onVisible);
  setTimeout(refresh, 0); // the card is appended right after this returns

  return el('div', { class: 'card' },
    el('h2', {}, 'Android'),
    setrow('Alarms & reminders',
      'Exact alarms ring at the scheduled minute even when Lockin is closed. Without this permission Android may delay them.',
      el('div', { class: 'native-ctrl' }, exactPill, exactBtn)),
    setrow('Notifications',
      'The alarm and reminder arrive as notifications. Android asks once.',
      el('div', { class: 'native-ctrl' }, notifPill, notifBtn)),
    setrow('Usage access',
      'Reads per-app foreground time for the screen-time panel. Lockin can open the setting, but only you can grant it.',
      el('div', { class: 'native-ctrl' }, usagePill, usageBtn)),
    el('p', { class: 'tiny', style: 'margin:12px 0 0' },
      'Lockin reads how long an app was in the foreground. It does not read page content, keystrokes or files.'),
  );
}

function screenTimeCard() {
  if (!isNative) return null;

  const out = el('div', { class: 'native-usage' });
  const btn = el('button', {
    class: 'btn btn-subtle btn-block',
    onclick: async () => {
      btn.disabled = true;
      btn.textContent = 'Reading usage…';
      renderUsage(await queryUsage(7));
      btn.disabled = false;
      btn.textContent = 'Refresh 7-day screen time';
    },
  }, svg('clock', 16), 'Scan 7-day screen time');

  function renderUsage(rows) {
    out.replaceChildren();
    if (!rows.length) {
      out.append(el('p', { class: 'muted', style: 'margin:0' },
        'Nothing to show yet. Grant usage access above, then scan.'));
      return;
    }
    const total = rows.reduce((sum, row) => sum + row.ms, 0);
    const max = Math.max(...rows.map((row) => row.ms), 1);
    out.append(el('div', { class: 'native-total' },
      el('span', {}, 'Last 7 days'),
      el('b', {}, fmtMin(Math.round(total / 60000)))));
    for (const row of rows.slice(0, 8)) {
      out.append(el('div', { class: 'native-usage-row' },
        el('b', {}, row.label),
        el('span', {}, row.ms < 60000 ? '<1m' : fmtMin(Math.round(row.ms / 60000))),
        el('div', { class: 'native-usage-bar' },
          el('i', { style: `width:${Math.max(2, Math.round((row.ms / max) * 100))}%` }))));
    }
  }

  return el('div', { class: 'card' },
    el('h2', {}, 'Screen time'),
    el('p', { class: 'muted', style: 'margin:0 0 12px' },
      'Per-app foreground time from Android’s usage access. It stays on this device.'),
    btn,
    out,
  );
}

function lookCard() {
  const s = Store.state.settings;
  const seg = el('div', { class: 'segmented' },
    ['system', 'dark', 'light'].map((t) => el('button', {
      class: 'seg-btn', dataset: { theme: t },
      'aria-pressed': String(s.theme === t),
      onclick: () => { Store.set((st) => { st.settings.theme = t; }); sync(); },
    }, t)));
  function sync() {
    [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.theme === Store.state.settings.theme)));
  }
  return el('div', { class: 'card' },
    el('h2', {}, 'Appearance'),
    setrow('Theme', 'Follows your OS by default.', seg),
  );
}

/* ---------- profile (name, exam and date from the opening film) ---------- */

function profileCard() {
  const p = Store.state.profile || { name: '', exam: '', examDate: '' };
  const nameInp = el('input', { class: 'inp', maxlength: 24, value: p.name, autocomplete: 'off', spellcheck: 'false' });
  const examInp = el('input', { class: 'inp', maxlength: 28, value: p.exam, autocomplete: 'off', spellcheck: 'false' });
  const dateInp = el('input', { class: 'inp', type: 'date', value: p.examDate || '' });
  const save = el('button', {
    class: 'btn btn-subtle btn-block', style: 'margin-top:8px',
    onclick: () => {
      const exam = examInp.value.trim();
      const cat = examByName(exam);
      Store.setProfile(nameInp.value, exam, dateInp.value,
        cat ? cat.id : (exam ? 'custom' : ''));
      hint('Profile saved.');
    },
  }, svg('check', 16), 'Save profile');
  return el('div', { class: 'card' },
    el('h2', {}, 'Profile'),
    el('p', { class: 'muted', style: 'margin:0 0 12px' }, 'Your name, exam and rough date personalize Home, the session screens and your stats.'),
    el('div', { class: 'fields' },
      el('label', { class: 'field' }, el('span', {}, 'Name'), nameInp),
      el('label', { class: 'field' }, el('span', {}, 'Target exam'), examInp),
      el('label', { class: 'field' }, el('span', {}, 'Approx. exam date'), dateInp),
    ),
    save,
  );
}

function dataCard() {
  const input = el('input', {
    type: 'file', accept: 'application/json,.json',
    style: 'display:none',
    onchange: (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      file.text()
        .then((txt) => Store.importJSON(txt))
        .then(() => hint('Backup restored.'))
        .catch(() => hint('That file is not a Lockin backup.'));
      ev.target.value = '';
    },
  });

  const exportBtn = el('button', {
    class: 'btn btn-subtle btn-block', onclick: () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `lockin-backup-${Storetoday()}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      hint('Backup downloaded.');
    },
  }, svg('copy', 16), 'Export backup (JSON)');

  const importBtn = el('button', { class: 'btn btn-subtle btn-block', onclick: () => input.click() }, svg('book', 16), 'Restore backup');
  const replayBtn = el('button', {
    class: 'btn btn-subtle btn-block',
    onclick: () => { Router.go('/start?replay=1'); },
  }, svg('play', 16), 'Rerun the opening walkthrough');

  const wipeBtn = el('button', {
    class: 'btn btn-danger btn-block',
    onclick: () => openSheet('Delete everything?', (close) => [
      el('p', { class: 'muted' }, 'Tasks, sessions, streaks — gone for good. Export a backup first if any of it matters.'),
      el('div', { class: 'actions' },
        el('button', {
          class: 'btn btn-primary',
          onclick: () => { Store.reset(); close(); Router.go('/start'); hint('Cleared.'); },
        }, 'Wipe it'),
        el('button', { class: 'btn btn-subtle', onclick: () => close() }, 'Keep'),
      ),
    ]),
  }, svg('trash', 16), 'Erase all data');

  const installBtn = el('button', {
    class: 'btn btn-subtle btn-block', style: 'display:none',
    id: 'install-btn',
    onclick: () => { tryInstall(); },
  }, svg('copy', 16), 'Install Lockin');
  document.addEventListener('lockin:installable', () => { installBtn.style.display = ''; }, { once: true });
  if (window.matchMedia('(display-mode: standalone)').matches) installBtn.style.display = 'none';

  return el('div', { class: 'card' },
    el('h2', {}, 'Data & privacy'),
    el('p', { class: 'muted', style: 'margin:0 0 4px' },
      'Everything lives in this browser’s localStorage. No account, no analytics, no network calls beyond this page.'),
    el('div', { class: 'btn-stack' }, exportBtn, installBtn, replayBtn),
    el('div', { class: 'btn-stack' }, importBtn, wipeBtn),
    input,
  );
}

const Storetoday = () => new Date().toISOString().slice(0, 10);

function aboutCard() {
  return el('div', { class: 'card aboutcard' },
    el('div', { class: 'about-mark' }, el('i', { class: 'brand-dot' })),
    el('div', { class: 'about-name' }, 'Lockin'),
    el('div', { class: 'tiny' }, 'Focus, strictly. Built for one thing — study.'),
    el('div', { class: 'tiny', style: 'margin-top:4px' },
      el('a', { href: 'https://lockin.surge.sh', style: 'color:var(--tx-2)' }, 'lockin.surge.sh')),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:12px' },
      el('a', { class: 'chip', href: 'tests.html', style: 'text-decoration:none' }, 'Run the self-check'),
    ),
  );
}

function render(host) {
  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Settings'),
        el('div', { class: 'sub' }, 'Every lever, in the open.'),
      ),
    ),
    group('Focus', enforcementCard(), pomoCard()),
    group('Schedule', alarmsCard()),
    ...(isNative ? [group('Android', nativeCard(), screenTimeCard())] : []),
    group('You', profileCard(), lookCard()),
    group('Your data', dataCard()),
    group('About', aboutCard()),
  ));
}

function mount(host) {
  render(host);
}
