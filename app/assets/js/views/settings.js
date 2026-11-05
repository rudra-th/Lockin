/* Lockin — Settings: enforcement, theme, goals, profile, data in/out. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, fmtMin, prettyDate, parseKey } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, hint } from '../ui.js';
import { tryInstall } from '../install.js';
import { examByName } from '../exams.js';
import { group, setrow, toggle, stepper } from '../controls.js';
import { ensureAlarmPermission } from '../alarms.js';
import {
  isNative, nativeStatus, requestNotifications, openNotificationSettings,
  openExactAlarmSettings, openFullScreenIntentSettings, openUsageAccessSettings,
  openAccessibilitySettings, queryUsageToday, queryUsageDaily,
} from '../native.js';
import { accountState, signIn, signOut, deleteCloudData } from '../account.js';
import { syncNow } from '../sync.js';

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

function fmtDur(ms) {
  const mins = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  if (ms > 0 && mins < 1) return '<1m';
  return fmtMin(mins);
}

/* ---------- screen time (Android only) ---------- */

function screenTimeCard() {
  if (!isNative) return null;

  const node = el('div', { class: 'card set-screen' });
  let usageOn = false;
  let rows = [];
  let week = [];
  let loading = true;

  const paint = () => {
    const total = rows.reduce((sum, row) => sum + row.ms, 0);
    const max = Math.max(...rows.map((r) => r.ms), 1);
    const weekMax = Math.max(...week.map((r) => r.ms), 1);

    const rail = el('div', {
      class: 'ctl-rail', role: 'img',
      'aria-label': week.length
        ? `Daily screen time: ${week.map((r) => `${prettyDate(r.day)} ${fmtDur(r.ms)}`).join(', ')}.`
        : 'No screen-time history yet.',
    }, week.length
      ? week.map((row) => {
        const isToday = row.day === week[week.length - 1].day;
        return el('div', {
          class: `ctl-rail-day${isToday ? ' is-today' : ''}`,
          title: `${prettyDate(row.day)} · ${fmtDur(row.ms)}`,
        },
          el('i', { style: `height:${Math.max(3, Math.round((row.ms / weekMax) * 100))}%` }),
          el('span', {}, isToday
            ? 'Today'
            : parseKey(row.day).toLocaleDateString(undefined, { weekday: 'narrow' })));
      })
      : ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter) => el('div', { class: 'ctl-rail-day' },
        el('i', { style: 'height:3%' }), el('span', {}, letter))));

    if (!usageOn) {
      node.replaceChildren(
        el('div', { class: 'ctl-card-head' },
          el('h2', { class: 'blocking-head' }, svg('clock', 14), el('span', {}, 'Screen time')),
          el('span', { class: 'ctl-tag' }, loading ? '…' : 'Off')),
        el('div', { class: 'ctl-empty' },
          el('div', { class: 'ctl-empty-icon' }, svg('clock', 22)),
          el('b', {}, 'Usage access is off'),
          el('p', {}, 'Android only shares per-app foreground time with apps you allow. Lockin reads the app name and the minutes — never page content, text or keystrokes.'),
          el('button', {
            class: 'btn btn-subtle btn-sm',
            onclick: () => openUsageAccessSettings(),
          }, 'Open usage access')),
      );
      return;
    }

    node.replaceChildren(
      el('div', { class: 'ctl-card-head' },
        el('h2', { class: 'blocking-head' }, svg('clock', 14), el('span', {}, 'Screen time')),
        el('button', {
          class: 'iconbtn', 'aria-label': 'Refresh screen time',
          onclick: () => load(),
        }, svg('refresh', 15))),
      el('div', { class: 'ctl-kicker' }, 'Foreground time since midnight'),
      el('div', { class: 'ctl-total' },
        fmtDur(total),
        el('small', {}, total > 0 ? 'on screen' : 'nothing yet')),
      rail,
      rows.length
        ? el('div', { class: 'ctl-apps' },
          rows.slice(0, 6).map((row) => el('div', { class: 'ctl-app' },
            el('span', { class: 'ctl-app-name' }, row.label),
            el('span', { class: 'ctl-app-time' }, fmtDur(row.ms)),
            el('span', { class: 'ctl-app-bar' },
              el('i', { style: `width:${Math.max(2, Math.round((row.ms / max) * 100))}%` })))))
        : el('p', { class: 'muted ctl-first' },
          'No foreground time recorded yet today. Pick up the phone and this fills in.'),
      el('div', { class: 'set-screen-foot' },
        el('p', { class: 'tiny' },
          'Per-app foreground time from Android. It stays on this phone.'),
        el('button', {
          class: 'btn btn-subtle btn-sm',
          onclick: () => Router.go('/control'),
        }, svg('shield', 14), 'Limits & blocking')),
    );
  };

  async function load() {
    const [status, today, daily] = await Promise.all([
      nativeStatus(), queryUsageToday(), queryUsageDaily(7),
    ]);
    usageOn = Boolean(status?.usage);
    rows = today;
    week = daily;
    loading = false;
    paint();
  }

  const onVisible = () => {
    if (!document.contains(node)) {
      removeEventListener('visibilitychange', onVisible);
      return;
    }
    if (!document.hidden) load();
  };
  addEventListener('visibilitychange', onVisible);
  setTimeout(load, 0);

  paint();
  return node;
}

function nativeCard() {
  if (!isNative) return null;

  const exactPill = pill(false, 'Exact', 'Inexact');
  const notifPill = pill(false);
  const fullPill = pill(false, 'On', 'Heads-up');
  const usagePill = pill(false);
  const accessPill = pill(false);
  const exactBtn = el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openExactAlarmSettings() }, 'Settings');
  const fullBtn = el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openFullScreenIntentSettings() }, 'Allow');
  const usageBtn = el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openUsageAccessSettings() }, 'Open');
  const accessBtn = el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openAccessibilitySettings() }, 'Enable');
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
    fullPill.textContent = st.fullScreen ? 'On' : 'Heads-up';
    fullPill.classList.toggle('on', st.fullScreen);
    usagePill.textContent = st.usage ? 'On' : 'Off';
    usagePill.classList.toggle('on', st.usage);
    accessPill.textContent = st.accessibility ? 'On' : 'Off';
    accessPill.classList.toggle('on', st.accessibility);
    notifBtn.textContent = st.notifications ? 'Settings' : 'Allow';
    notifBtn.onclick = st.notifications
      ? () => openNotificationSettings()
      : async () => { await requestNotifications(); refresh(); };
    fullBtn.textContent = st.fullScreen ? 'Settings' : 'Allow';
    accessBtn.textContent = st.accessibility ? 'Settings' : 'Enable';
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
    setrow('Full-screen alarm',
      'On Android 14+, a start alarm can take over the lock screen. If Android denies it, the alarm still arrives as a loud heads-up — never silently.',
      el('div', { class: 'native-ctrl' }, fullPill, fullBtn)),
    setrow('Accessibility service',
      'Lets Lockin see which app comes to the front, so blocking and per-app limits can work. It never reads screen content, text or keystrokes.',
      el('div', { class: 'native-ctrl' }, accessPill, accessBtn)),
    setrow('Usage access',
      'Reads per-app foreground time for the screen-time card below. Lockin can open the setting, but only you can grant it.',
      el('div', { class: 'native-ctrl' }, usagePill, usageBtn)),
    el('p', { class: 'tiny', style: 'margin:12px 0 0' },
      'Lockin reads how long an app was in the foreground. It does not read page content, keystrokes or files.'),
  );
}

/* ---------- Control pointer ---------- */

function deviceCard() {
  if (!isNative) return null;
  return el('div', { class: 'card ctl-pointer' },
    el('h2', { class: 'blocking-head' }, svg('shield', 14), el('span', {}, 'App blocking & strict mode')),
    el('p', { class: 'muted ctl-lede' },
      'Choose which apps are covered during focus, set a daily allowance per app, add short-video and feed presets, and arm the strict kiosk. All of it stays on this phone.'),
    el('button', {
      class: 'btn btn-subtle btn-block',
      onclick: () => Router.go('/control'),
    }, svg('shield', 16), 'Open Control'),
    el('p', { class: 'tiny', style: 'margin:10px 0 0' },
      'Permissions for these features stay one card above, under Android.'),
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
      'Everything lives in this browser’s localStorage. No analytics, no trackers — and no network calls unless you sign in above to mirror a copy to your own cloud.'),
    el('div', { class: 'btn-stack' }, exportBtn, installBtn, replayBtn),
    el('div', { class: 'btn-stack' }, importBtn, wipeBtn),
    input,
  );
}

function agoLabel(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function accountCard() {
  const card = el('div', { class: 'card' });

  function paint() {
    const st = accountState();
    const syncing = st.status === 'syncing';
    card.textContent = '';
    card.append(el('h2', { class: 'acct-head' }, svg('cloud', 14), el('span', {}, 'Account')));

    if (!st.user) {
      card.append(
        el('p', { class: 'muted', style: 'margin:0 0 10px' },
          'Optional — everything already lives on this device. Sign in to mirror a copy to your own private cloud, so phone and browser stay in step. No lock-in. 🔒'),
        el('div', { class: 'btn-stack' },
          el('button', {
            class: `btn btn-primary btn-block${st.signingIn ? ' is-busy' : ''}`,
            disabled: st.signingIn,
            onclick: () => signIn(),
          }, svg('google', 16), st.signingIn ? 'Signing in…' : 'Sign in with Google'),
        ),
        st.error ? el('p', { class: 'acct-error' }, st.error) : null,
      );
      return;
    }

    const statusText = syncing ? '🔄 Syncing…'
      : st.status === 'offline' ? '📴 Offline — will retry'
        : st.status === 'error' ? `⚠️ Sync error — ${st.error || 'will retry'}`
          : st.lastSyncAt ? `☁️ Synced ${agoLabel(st.lastSyncAt)}` : '✨ Signed in';

    card.append(
      el('div', { class: 'acct-id' },
        el('div', { class: `acct-avatar-wrap${syncing ? ' is-syncing' : ''}` },
          st.user.photo
            ? el('img', { class: 'acct-avatar', src: st.user.photo, alt: '' })
            : el('span', { class: 'acct-avatar acct-fallback' }, (st.user.name || st.user.email || '?').slice(0, 1).toUpperCase()),
          st.status === 'idle' && st.lastSyncAt ? el('span', { class: 'acct-badge' }, svg('check', 10)) : null,
        ),
        el('div', { class: 'acct-who' },
          el('b', {}, st.user.name || 'Google account'),
          el('span', {}, st.user.email),
        ),
      ),
      el('div', { class: `acct-status is-${st.status}` },
        el('i', { class: 'acct-dot' }),
        statusText,
      ),
      el('div', { class: 'btn-stack' },
        el('button', {
          class: `btn btn-subtle btn-block${syncing ? ' is-spinning' : ''}`,
          onclick: () => syncNow('manual'),
        }, svg('repeat', 16), 'Sync now'),
        el('button', {
          class: 'btn btn-subtle btn-block',
          onclick: () => signOut().then(() => hint('Signed out — your data stays here.')),
        }, svg('x', 16), 'Sign out'),
        el('button', {
          class: 'btn btn-danger btn-block',
          onclick: () => openSheet('Delete cloud data?', (close) => [
            el('p', { class: 'muted' }, 'Every trace of your data leaves the cloud — tasks, sessions, everything. This device keeps its copy; sign back in and it uploads again.'),
            el('div', { class: 'actions' },
              el('button', {
                class: 'btn btn-primary',
                onclick: () => { close(); deleteCloudData().then(() => hint('Cloud copy deleted.')); },
              }, 'Delete it'),
              el('button', { class: 'btn btn-subtle', onclick: () => close() }, 'Keep'),
            ),
          ]),
        }, svg('trash', 16), 'Delete cloud data'),
      ),
    );
  }

  /* Sync and account events repaint the card while it is alive; once Settings
     unmounts it, the listeners remove themselves so nothing lingers. */
  const repaint = () => {
    if (document.contains(card)) paint();
    else {
      document.removeEventListener('lockin:account', repaint);
      document.removeEventListener('lockin:sync', repaint);
    }
  };
  document.addEventListener('lockin:account', repaint);
  document.addEventListener('lockin:sync', repaint);
  paint();
  return card;
}

const Storetoday = () => new Date().toISOString().slice(0, 10);

function aboutCard() {
  return el('div', { class: 'card aboutcard' },
    el('div', { class: 'about-mark' }, el('i', { class: 'brand-dot' })),
    el('div', { class: 'about-name' }, 'Lockin'),
    el('div', { class: 'tiny' }, 'Focus, strictly. Built for one thing — study. 🎯'),
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
    ...(isNative ? [group('Android', screenTimeCard(), nativeCard(), deviceCard())] : []),
    group('You', profileCard(), lookCard()),
    group('Account', accountCard()),
    group('Your data', dataCard()),
    group('About', aboutCard()),
  ));
}

function mount(host) {
  render(host);
}
