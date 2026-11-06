/* Lockin — Settings: enforcement, theme, goals, profile, data in/out. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, fmtMin, nudgeAtHM } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, hint, accountAvatar } from '../ui.js';
import { tryInstall } from '../install.js';
import { examByName } from '../exams.js';
import { setrow, toggle, stepper } from '../controls.js';
import { progressCards } from './stats.js';
import { ensureAlarmPermission } from '../alarms.js';
import {
  isNative, nativeStatus, requestNotifications, openNotificationSettings,
  openExactAlarmSettings, openFullScreenIntentSettings, openUsageAccessSettings,
  openAccessibilitySettings, requestWidgetPin,
} from '../native.js';
import { accountState, signIn, signOut, deleteCloudData } from '../account.js';
import { syncNow } from '../sync.js';
import { ensurePairCode, rotatePairCode } from '../summary.js';
import { isTrial, resetTrial } from '../trial.js';

export function initSettings(Router) {
  Router.register('/settings', { mount, unmount: null });
  /* Old #/stats bookmarks and links land in the Progress section. */
  Router.register('/stats', {
    mount: () => { Router.go('/settings?section=progress'); },
    unmount: null,
  });
}

/* Settings is grouped the way it is used: what a session does, what the phone
   does, what the record shows, and who owns the data. */
const SECTIONS = [
  { id: 'study', label: 'Study', icon: 'book', blurb: 'Target, rounds and alarms', short: 'Target & alarms' },
  { id: 'device', label: 'Device', icon: 'phone', blurb: 'Screen, alerts and Android access', short: 'Screen & alerts' },
  { id: 'progress', label: 'Progress', icon: 'chart', blurb: 'Today, the week and the record', short: 'The record' },
  { id: 'you', label: 'You', icon: 'user', blurb: 'Profile, account, data and credits', short: 'Profile & data' },
];

function targetCard() {
  return el('div', { class: 'card' },
    el('h2', {}, 'Daily target'),
    setrow('Focus target',
      'The ring you fill each day. A day counts when it reaches the target that was set on that day.',
      stepper(
        () => Store.goalToday(),
        (v) => Store.setGoal(v),
        { lo: 15, hi: 600, step: 15, fmt: fmtMin })),
    el('p', { class: 'tiny', style: 'margin:10px 0 0' },
      'Changing the target applies from today onward — past days keep the bar they were measured against.'),
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

function deviceBasicsCard() {
  const s = Store.state.settings;
  return el('div', { class: 'card' },
    el('h2', {}, 'Screen & alerts'),
    setrow('Keep screen awake',
      'Screen Wake Lock during focus sessions — the phone stays awake while you study.',
      toggle(() => s.wakelock, () => Store.set((st) => { st.settings.wakelock = !st.settings.wakelock; }))),
    setrow('Session notifications',
      'A system notification and a buzz when a round completes (asks your browser for permission first time).',
      toggle(() => s.notifs, () => {
        Store.set((st) => { st.settings.notifs = !st.settings.notifs; });
        if (Store.state.settings.notifs && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      })),
    setrow('Daily target check-in',
      'One quiet nudge a day telling you how much is left to hit today’s target. It never counts a miss — it just shows the gap.',
      toggle(() => s.nudge, () => {
        Store.set((st) => { st.settings.nudge = !st.settings.nudge; });
        if (Store.state.settings.nudge) ensureAlarmPermission();
      })),
    setrow('Check-in time',
      'When the daily nudge arrives. Only fires while there is still a target left to reach.',
      stepper(
        () => Store.state.settings.nudgeAt,
        (v) => Store.set((st) => { st.settings.nudgeAt = v; }),
        { lo: 0, hi: 23 * 60 + 30, step: 30, fmt: (v) => nudgeAtHM(v) })),
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
      'New blocks remind you this many minutes before they start — with how much is left to today’s target. Each block can override it.',
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

/* ---------- screen time lives in Control ---------- */

function screenTimeCard() {
  if (!isNative) return null;

  return el('div', { class: 'card ctl-pointer' },
    el('div', { class: 'ctl-card-head' },
      el('h2', { class: 'blocking-head' }, svg('clock', 16), el('span', {}, 'Screen time')),
      el('span', { class: 'ctl-tag' }, 'In Control')),
    el('p', { class: 'muted ctl-lede' },
      'Your week chart, today’s total and most-used apps now live in Control — next to the limits that act on them.'),
    el('button', {
      class: 'btn btn-subtle btn-block',
      onclick: () => Router.go('/control'),
    }, svg('chart', 17), 'Open Control'));
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

  const widgetBtn = el('button', {
    class: 'btn btn-subtle btn-sm',
    onclick: async () => {
      const res = await requestWidgetPin();
      if (res.requested) hint('Place the widget wherever you want it');
      else hint('Long-press the home screen → Widgets → Lockin, or add the Focus tile from Quick Settings');
    },
  }, 'Pin widget');

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
    setrow('Home screen',
      'Today’s minutes against the target, the streak and the next block — as a widget. The Quick Settings tile opens Focus setup; it never starts a session on its own.',
      el('div', { class: 'native-ctrl' }, widgetBtn)),
    el('p', { class: 'tiny', style: 'margin:12px 0 0' },
      'Lockin reads how long an app was in the foreground. It does not read page content, keystrokes or files.'),
  );
}

/* ---------- Control pointer ---------- */

function deviceCard() {
  if (!isNative) return null;
  return el('div', { class: 'card ctl-pointer' },
    el('h2', { class: 'blocking-head' }, svg('shield', 14), el('span', {}, 'App blocking & kiosk')),
    el('p', { class: 'muted ctl-lede' },
      'Choose which apps are covered during focus, set a daily allowance per app, add short-video and feed presets, and arm the optional kiosk. All of it stays on this phone.'),
    el('button', {
      class: 'btn btn-subtle btn-block',
      onclick: () => Router.go('/control'),
    }, svg('shield', 16), 'Open Control'),
    el('p', { class: 'tiny', style: 'margin:10px 0 0' },
      'Permissions for these features stay one card above, under Android.'),
  );
}

/* The browser build has no usage or accessibility access; say that plainly
   instead of showing empty Android controls. */
function webDeviceCard() {
  return el('div', { class: 'card ctl-pointer' },
    el('h2', { class: 'blocking-head' }, svg('phone', 14), el('span', {}, 'Only available on the Android app')),
    el('p', { class: 'muted ctl-lede' },
      'Screen time, usage access, per-app limits and the strict kiosk need Android’s own services. A browser cannot read another app’s foreground time or cover it. This tab still runs every focus session, schedule and progress view.'),
    el('div', { class: 'btn-stack' },
      el('a', {
        class: 'btn btn-primary btn-block',
        href: '/downloads/lockin.apk', download: '',
      }, svg('phone', 16), 'Download for Android'),
      el('button', {
        class: 'btn btn-subtle btn-block',
        onclick: () => Router.go('/control'),
      }, svg('shield', 16), 'See what Control unlocks'),
    ),
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
  const replayBtn = isTrial ? null : el('button', {
    class: 'btn btn-subtle btn-block',
    onclick: () => { Router.go('/start?replay=1'); },
  }, svg('play', 16), 'Rerun the opening walkthrough');

  const wipeBtn = el('button', {
    class: 'btn btn-danger btn-block',
    onclick: () => openSheet(isTrial ? 'Reset the demo?' : 'Delete everything?', (close) => [
      el('p', { class: 'muted' }, isTrial
        ? 'The seeded week comes back exactly as it started. Nothing outside this trial store is touched.'
        : 'Tasks, sessions, streaks — gone for good. Export a backup first if any of it matters.'),
      el('div', { class: 'actions' },
        el('button', {
          class: 'btn btn-primary',
          onclick: () => {
            close();
            if (isTrial) { resetTrial(); return; }
            Store.reset(); Router.go('/start'); hint('Cleared.');
          },
        }, isTrial ? 'Reset it' : 'Wipe it'),
        el('button', { class: 'btn btn-subtle', onclick: () => close() }, 'Keep'),
      ),
    ]),
  }, svg('trash', 16), isTrial ? 'Reset the demo week' : 'Erase all data');

  const installBtn = isTrial ? null : el('button', {
    class: 'btn btn-subtle btn-block', style: 'display:none',
    id: 'install-btn',
    onclick: () => { tryInstall(); },
  }, svg('copy', 16), 'Install Lockin');
  if (installBtn) {
    document.addEventListener('lockin:installable', () => { installBtn.style.display = ''; }, { once: true });
    if (window.matchMedia('(display-mode: standalone)').matches) installBtn.style.display = 'none';
  }

  return el('div', { class: 'card' },
    el('h2', {}, 'Data & privacy'),
    el('p', { class: 'muted', style: 'margin:0 0 4px' },
      isTrial
        ? 'This trial keeps a separate copy in this browser’s localStorage. Your real Lockin store is not read or written.'
        : 'Everything lives in this browser’s localStorage. Sign in above to mirror a copy to your own private cloud.'),
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

function pairingBlock() {
  const code = ensurePairCode();
  const codeEl = el('code', {}, code);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      hint('Pairing code copied');
    } catch (_) {
      hint('Select the code and copy it');
    }
  };
  return el('div', { class: 'pairing' },
    el('div', { class: 'pairing-head' }, svg('phone', 14), el('span', {}, 'Browser extension')),
    el('p', { class: 'muted', style: 'margin:0 0 8px' },
      'Paste this code into the Lockin Chrome extension to see your phone’s screen time and focus minutes next to the browser’s.'),
    el('div', { class: 'pairing-code' },
      codeEl,
      el('button', {
        class: 'iconbtn', type: 'button', 'aria-label': 'Copy pairing code',
        onclick: copy,
      }, svg('copy', 15)),
    ),
    el('button', {
      class: 'btn btn-subtle btn-block', style: 'margin-top:8px',
      onclick: async () => {
        await rotatePairCode();
        codeEl.textContent = Store.state.settings.pairCode;
        hint('New code — paste it in the extension');
      },
    }, svg('repeat', 15), 'Replace the code'),
  );
}

function accountCard() {
  const card = el('div', { class: 'card' });

  function paint() {
    const st = accountState();
    const syncing = st.status === 'syncing';
    card.textContent = '';
    card.append(el('h2', { class: 'acct-head' }, svg('cloud', 14), el('span', {}, 'Account')));

    /* The trial account is local by design: no Firebase, no sign-out. */
    if (st.trial) {
      card.append(
        el('div', { class: 'acct-id' },
          el('div', { class: 'acct-avatar-wrap' },
            el('span', { class: 'acct-avatar acct-fallback' }, 'T'),
          ),
          el('div', { class: 'acct-who' },
            el('b', {}, st.user.name),
            el('span', {}, st.user.email),
          ),
        ),
        el('div', { class: 'acct-status is-idle' },
          el('i', { class: 'acct-dot' }),
          'Demo account — local only',
        ),
        el('p', { class: 'muted', style: 'margin:10px 0 0' },
          'This trial is signed in as Test Account. It is a demo profile with a seeded week, it never contacts Google or Firebase, and its data lives in a separate browser store. Your real Lockin data is untouched.'),
        el('div', { class: 'btn-stack' },
          el('button', {
            class: 'btn btn-subtle btn-block',
            onclick: () => resetTrial(),
          }, svg('repeat', 16), 'Reset the demo week'),
        ),
      );
      return;
    }

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
          accountAvatar(st.user),
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
      pairingBlock(),
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
    el('div', { class: 'about-credit' },
      el('span', {}, 'Made by '),
      el('a', {
        class: 'about-author',
        href: 'https://github.com/rudra-th',
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': 'Made by Rudra — open GitHub profile',
      }, svg('github', 16), el('span', {}, 'Rudra')),
    ),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:12px' },
      el('a', { class: 'chip', href: 'tests.html', style: 'text-decoration:none' }, 'Run the self-check'),
    ),
  );
}

function sectionHead(meta) {
  return el('div', { class: 'setpanel-head' },
    el('div', { class: 'setpanel-eyebrow' }, svg(meta.icon, 13), el('span', {}, meta.label)),
    el('p', {}, meta.blurb),
  );
}

function sectionNav(active, onPick) {
  const nav = el('nav', { class: 'setnav', 'aria-label': 'Settings sections' });
  SECTIONS.forEach((meta) => {
    nav.append(el('button', {
      type: 'button',
      class: 'setnav-btn',
      dataset: { section: meta.id },
      'aria-pressed': String(meta.id === active),
      'aria-controls': `setpanel-${meta.id}`,
      onclick: () => onPick(meta.id),
    },
      el('span', { class: 'setnav-icon' }, svg(meta.icon, 17)),
      el('span', { class: 'setnav-txt' },
        el('b', {}, meta.label),
        el('small', {}, meta.short)),
    ));
  });
  return nav;
}

function render(host, params = {}) {
  const initial = SECTIONS.some((s) => s.id === params.section) ? params.section : 'study';
  const cards = {
    study: [targetCard(), pomoCard(), alarmsCard()],
    device: [
      deviceBasicsCard(),
      ...(isNative ? [screenTimeCard(), nativeCard(), deviceCard()] : [webDeviceCard()]),
    ],
    progress: progressCards(),
    you: [profileCard(), lookCard(), accountCard(), dataCard(), aboutCard()],
  };

  const panels = new Map();
  SECTIONS.forEach((meta) => {
    panels.set(meta.id, el('section', {
      class: 'setpanel',
      id: `setpanel-${meta.id}`,
      'aria-label': meta.label,
      hidden: meta.id !== initial,
    }, sectionHead(meta), ...cards[meta.id]));
  });

  const nav = sectionNav(initial, activate);
  const scrollHost = host; // #view scrolls, not the window

  function activate(id) {
    panels.forEach((panel, key) => { panel.hidden = key !== id; });
    nav.querySelectorAll('.setnav-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.section === id));
    });
    history.replaceState(null, '', `#/settings?section=${id}`);
    scrollHost.scrollTop = 0;
    const status = document.getElementById('a11y-status');
    if (status) {
      const meta = SECTIONS.find((s) => s.id === id);
      status.textContent = `${meta ? meta.label : id} settings section`;
    }
  }

  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Settings'),
        el('div', { class: 'sub' }, 'Every lever, grouped the way you use it.'),
      ),
    ),
    nav,
    [...panels.values()],
  ));
}

function mount(host, params) {
  render(host, params);
}
