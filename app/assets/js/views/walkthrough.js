/* Lockin — the opening film.
   First run is one continuous piece: the name, the exam, the rough date, the
   daily target, then the room. Full-bleed scenes, one idea at a time.
   Rerunnable from Settings (personalization is skipped when the profile is
   already known). */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, daysUntil } from '../util.js';
import { svg } from '../icons.js';
import { hint, accountAvatar } from '../ui.js';
import {
  isNative, nativeStatus, requestNotifications, openNotificationSettings,
  openExactAlarmSettings, openUsageAccessSettings, openFullScreenIntentSettings,
  openAccessibilitySettings,
} from '../native.js';
import { accountState, signIn } from '../account.js';
import {
  PRIMARY_EXAMS, MORE_EXAMS, MONTHS, examById, examByName, examDateFor,
  expectedYear, formatExamMonth,
} from '../exams.js';

export function initWalkthrough(Router) {
  Router.register('/start', { mount, unmount });
}

/* ---------- first-run state ---------- */

const state = {
  name: '', exam: '', examId: '', examDate: '',
  month: 4, year: new Date().getFullYear(), hours: 2,
};

let scenes = [];
let idx = 0;
let sceneCleanup = null;

function readProfile() {
  const p = Store.state.profile || {};
  const cat = examById(p.examId) || examByName(p.exam);
  const baseMonth = cat ? cat.month : 4;
  let month = baseMonth;
  let year = expectedYear(baseMonth, cat ? cat.day : 1);

  if (p.examDate) {
    const d = new Date(`${p.examDate}T12:00:00`);
    if (!Number.isNaN(d.getTime())) { month = d.getMonth(); year = d.getFullYear(); }
  }
  state.name = p.name || '';
  state.exam = p.exam || '';
  state.examId = cat ? cat.id : (p.exam ? 'custom' : '');
  state.examDate = p.examDate || '';
  state.month = month;
  state.year = year;
  const goalHours = Math.round((Store.state.settings.goalMin || 120) / 60);
  state.hours = Math.max(1, Math.min(8, goalHours || 2));
}

function currentExam() {
  return examById(state.examId);
}

function chosenDate() {
  return examDateFor(currentExam(), state.month, state.year);
}

function syncProfile() {
  Store.setProfile(state.name, state.exam, state.examDate || '', state.examId);
}

/* ---------- navigation ---------- */

function go(n) {
  idx = Math.max(0, Math.min(scenes.length - 1, n));
  render();
  const host = document.getElementById('view');
  if (host) host.scrollTop = 0;
}

function finish() {
  Store.set((s) => { s.flags.onboarded = true; });
  document.body.dataset.mode = '';
  Router.go('/home');
  hint(state.name ? `Locked in, ${state.name}. Add a task, then start the clock.` : 'Locked in. Add a task, then start the clock.');
}

/* ---------- tiny building blocks ---------- */

function kicker(text) {
  return el('div', { class: 'film-kicker' }, text);
}

function title(...parts) {
  return el('h1', { class: 'film-title', tabindex: '-1' }, ...parts);
}

function lede(text) {
  return el('p', { class: 'film-lede' }, text);
}

function primary(label, onclick) {
  return el('button', { class: 'btn btn-primary btn-block', onclick }, label);
}

function ghost(label, onclick) {
  return el('button', { class: 'film-ghost', onclick }, label);
}

function readout(main, sub) {
  return el('div', { class: 'film-readout' },
    el('span', { class: 'readout-main' }, main),
    sub ? el('span', { class: 'readout-sub' }, sub) : null,
  );
}

/* ---------- scenes ---------- */

function introScene() {
  return [
    kicker('A study clock, built for focus'),
    title('Study has ', el('em', {}, 'a shape.')),
    lede('Set a daily target. Then run it in Study Mode — the clock stays awake, the target stays in front of you, and the app remembers when you leave.'),
    el('div', { class: 'film-meta' },
      el('span', {}, 'Focus'), el('i'), el('span', {}, 'Daily tasks'), el('i'), el('span', {}, 'Honest stats')),
  ];
}

function nameScene() {
  const input = el('input', {
    class: 'film-input', id: 'film-name', value: state.name,
    placeholder: 'Your name', maxlength: 24, autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Your name',
    oninput: (ev) => { state.name = ev.target.value; },
    onkeydown: (ev) => { if (ev.key === 'Enter') { syncProfile(); go(idx + 1); } },
  });

  const panel = el('div', { class: 'film-account', hidden: true });
  const toggle = el('button', {
    class: 'film-ghost film-account-toggle', type: 'button',
    'aria-expanded': 'false',
    onclick: () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) paintAccount();
    },
  }, 'Already have an account?');

  function adoptName(name) {
    if (!name || state.name.trim()) return;
    state.name = name;
    input.value = name;
  }

  function paintAccount() {
    const st = accountState();
    panel.replaceChildren();
    if (st.user) {
      adoptName(st.user.name);
      panel.append(
        el('div', { class: 'film-signed' },
          el('span', { class: 'film-signed-check' }, svg('check', 14)),
          el('span', { class: 'grow' },
            el('b', {}, st.user.name || 'Signed in'),
            el('small', {}, st.user.email || 'Google account')),
        ),
        el('p', { class: 'tiny', style: 'margin:2px 0 0' },
          'Your name is filled in. Continue when you are ready.'),
      );
      return;
    }
    panel.append(
      el('button', {
        class: `btn btn-subtle btn-block${st.signingIn ? ' is-busy' : ''}`,
        type: 'button',
        disabled: st.signingIn,
        onclick: () => signIn(),
      }, svg('google', 16), st.signingIn ? 'Opening Google…' : 'Sign in with Google'),
      el('p', { class: 'tiny', style: 'margin:8px 0 0' },
        'New here? Google creates the account on the first sign-in. Everything still works without one.'),
    );
    if (st.error) panel.insertBefore(el('p', { class: 'acct-error' }, st.error), panel.children[1]);
  }

  const onAccount = () => paintAccount();
  document.addEventListener('lockin:account', onAccount);
  sceneCleanup = () => document.removeEventListener('lockin:account', onAccount);
  paintAccount();

  return [
    kicker('First, the name'),
    title('What should we ', el('em', {}, 'call you?')),
    lede('It personalizes the greeting, the session screens and your stats. It stays on this device — a Google account is optional.'),
    el('label', { class: 'film-field' }, input),
    toggle,
    panel,
  ];
}

function accountScene() {
  const panel = el('div', { class: 'film-account is-open' });

  function paint() {
    const st = accountState();
    panel.replaceChildren();
    if (st.user) {
      panel.append(
        el('div', { class: 'film-signed' },
          accountAvatar(st.user),
          el('span', { class: 'grow' },
            el('b', {}, st.user.name || 'Signed in'),
            el('small', {}, st.user.email || 'Google account')),
          el('span', { class: 'film-signed-check' }, svg('check', 14)),
        ),
        el('p', { class: 'tiny', style: 'margin:2px 0 0' },
          'Progress now mirrors to your own private cloud. Finish the walkthrough and it starts syncing.'),
      );
      return;
    }
    panel.append(
      el('button', {
        class: `btn btn-subtle btn-block${st.signingIn ? ' is-busy' : ''}`,
        type: 'button',
        disabled: st.signingIn,
        onclick: () => signIn(),
      }, svg('google', 16), st.signingIn ? 'Opening Google…' : 'Create account / Sign in with Google'),
      el('p', { class: 'tiny', style: 'margin:8px 0 0' },
        'Same button for both: Google creates the account on the first sign-in, and returns you to it on the next phone.'),
      el('button', {
        class: 'film-ghost', type: 'button',
        onclick: () => go(idx + 1),
      }, 'Not now — keep it on this device'),
    );
    if (st.error) panel.insertBefore(el('p', { class: 'acct-error' }, st.error), panel.children[1]);
  }

  const onAccount = () => paint();
  document.addEventListener('lockin:account', onAccount);
  sceneCleanup = () => document.removeEventListener('lockin:account', onAccount);
  paint();

  return [
    kicker('Optional cloud'),
    title('Keep your streak ', el('em', {}, 'on every device.')),
    lede('Mirror tasks, sessions, stats and settings to your own private cloud. Nothing uploads until you sign in, and signing out never deletes what is on this phone.'),
    panel,
  ];
}

function examScene() {
  const cards = new Map();
  const primaryWrap = el('div', { class: 'exam-grid' });
  const moreWrap = el('div', { class: 'exam-grid exam-more-grid' });
  moreWrap.hidden = !MORE_EXAMS.includes(state.examId);
  const moreBtn = el('button', {
    class: 'exam-more-toggle', 'aria-expanded': String(!moreWrap.hidden),
    onclick: () => {
      moreWrap.hidden = !moreWrap.hidden;
      moreBtn.setAttribute('aria-expanded', String(!moreWrap.hidden));
      moreBtn.querySelector('span').textContent = moreWrap.hidden ? 'More exams' : 'Fewer exams';
    },
  }, el('span', {}, 'More exams'), el('i', { innerHTML: svg('caret', 15) }));

  const customInput = el('input', {
    class: 'film-input', value: examById(state.examId) ? '' : state.exam,
    placeholder: 'Type the exam', maxlength: 28, autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Your exam',
    oninput: (ev) => {
      state.exam = ev.target.value;
      state.examDate = state.exam ? examDateFor(null, state.month, state.year) : '';
      syncContinue();
    },
    onkeydown: (ev) => { if (ev.key === 'Enter' && state.exam) { syncProfile(); go(idx + 1); } },
  });
  const customWrap = el('div', { class: 'exam-custom' }, customInput);
  customWrap.hidden = state.examId !== 'custom';

  const nextBtn = primary('Continue', () => {
    if (!state.exam.trim()) { hint('Pick an exam, or type your own.'); return; }
    state.exam = state.exam.trim();
    syncProfile();
    go(idx + 1);
  });
  nextBtn.disabled = !state.exam;

  function syncContinue() {
    nextBtn.disabled = !state.exam.trim();
  }

  function paint() {
    for (const [id, btn] of cards) {
      btn.classList.toggle('is-on', state.examId === id);
      btn.setAttribute('aria-pressed', String(state.examId === id));
    }
    customWrap.hidden = state.examId !== 'custom';
  }

  function card(id) {
    const ex = examById(id);
    const b = el('button', {
      class: 'exam-card', 'aria-pressed': 'false', dataset: { exam: id },
      onclick: () => {
        state.examId = id;
        state.exam = ex.name;
        state.month = ex.month;
        state.year = expectedYear(ex.month, ex.day);
        state.examDate = examDateFor(ex, state.month, state.year);
        paint();
        syncContinue();
        moreWrap.hidden = !MORE_EXAMS.includes(id);
        moreBtn.setAttribute('aria-expanded', String(!moreWrap.hidden));
        moreBtn.querySelector('span').textContent = moreWrap.hidden ? 'More exams' : 'Fewer exams';
      },
    }, el('b', {}, ex.name), el('span', {}, ex.window));
    cards.set(id, b);
    return b;
  }

  PRIMARY_EXAMS.forEach((id) => primaryWrap.append(card(id)));
  MORE_EXAMS.forEach((id) => moreWrap.append(card(id)));

  const other = el('button', {
    class: `exam-other${state.examId === 'custom' ? ' is-on' : ''}`,
    'aria-pressed': String(state.examId === 'custom'),
    onclick: () => {
      state.examId = 'custom';
      state.exam = customInput.value.trim();
      state.examDate = state.exam ? examDateFor(null, state.month, state.year) : '';
      [...cards.values()].forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); });
      other.classList.add('is-on');
      other.setAttribute('aria-pressed', 'true');
      customWrap.hidden = false;
      customInput.focus({ preventScroll: true });
      syncContinue();
    },
  }, el('span', {}, 'Something else'), el('span', { class: 'other-arrow' }, '↗'));

  paint();

  return [
    kicker('The target'),
    title('What are you ', el('em', {}, 'aiming at?')),
    lede('Pick the exam. Home keeps the countdown — no date knowledge beyond the rough month.'),
    primaryWrap,
    moreBtn,
    moreWrap,
    other,
    customWrap,
    el('div', { class: 'film-spacer' }),
    nextBtn,
  ];
}

function dateScene() {
  const monthRow = el('div', { class: 'month-grid' });
  const yearRow = el('div', { class: 'year-row' });
  const approx = el('div', { class: 'film-readout date-readout' });
  let monthBtns = [];
  let yearBtns = [];

  function examDay() {
    const ex = currentExam();
    return ex ? ex.day : 1;
  }

  function yearOptions() {
    const base = expectedYear(state.month, examDay());
    const set = new Set([base, base + 1, base + 2, base + 3, state.year]);
    return [...set].sort((a, b) => a - b).slice(0, 5);
  }

  function paint() {
    monthBtns.forEach((b, m) => {
      b.classList.toggle('is-on', m === state.month);
      b.setAttribute('aria-pressed', String(m === state.month));
    });
    yearBtns.forEach((b) => {
      const y = Number(b.dataset.year);
      b.classList.toggle('is-on', y === state.year);
      b.setAttribute('aria-pressed', String(y === state.year));
    });
    const key = chosenDate();
    const d = daysUntil(key);
    approx.textContent = '';
    approx.append(
      el('span', { class: 'readout-main' }, formatExamMonth(key)),
      el('span', { class: 'readout-sub' }, d === 0 ? 'today' : d === 1 ? '1 day away' : `${d} days away`),
    );
    state.examDate = key;
  }

  function rebuildYears() {
    yearRow.textContent = '';
    yearBtns = yearOptions().map((y) => {
      const b = el('button', {
        class: 'year', 'aria-pressed': 'false', dataset: { year: String(y) },
        onclick: () => { state.year = y; paint(); },
      }, String(y));
      yearRow.append(b);
      return b;
    });
    paint();
  }

  MONTHS.forEach((name, m) => {
    const b = el('button', {
      class: 'month', 'aria-pressed': 'false',
      onclick: () => {
        state.month = m;
        const base = expectedYear(m, examDay());
        if (state.year < base) state.year = base;
        rebuildYears();
      },
    }, name);
    monthBtns.push(b);
    monthRow.append(b);
  });

  rebuildYears();

  return [
    kicker(`The date · ${state.exam || 'your exam'}`),
    title('When is it, ', el('em', {}, 'roughly?')),
    lede('An approximate month is enough. Lockin counts whole days — no exact date needed.'),
    monthRow,
    el('div', { class: 'film-sublabel' }, 'Target year'),
    yearRow,
    approx,
    el('div', { class: 'film-spacer' }),
    primary('Continue', () => {
      state.examDate = chosenDate();
      syncProfile();
      go(idx + 1);
    }),
  ];
}

function hoursScene() {
  const row = el('div', { class: 'hour-grid' });
  const read = readout('', '');
  const btns = [];

  function paint() {
    btns.forEach((b) => {
      const h = Number(b.dataset.hours);
      b.classList.toggle('is-on', h === state.hours);
      b.setAttribute('aria-pressed', String(h === state.hours));
    });
    read.textContent = '';
    read.append(
      el('span', { class: 'readout-main' }, `${state.hours}h`),
      el('span', { class: 'readout-sub' }, state.hours === 1 ? 'a gentle bar' : 'a real bar, not a fantasy'),
    );
  }

  for (let h = 1; h <= 8; h += 1) {
    const b = el('button', {
      class: 'hour', 'aria-pressed': 'false', dataset: { hours: String(h) },
      onclick: () => { state.hours = h; paint(); },
    }, el('b', {}, String(h)), el('span', {}, 'h'));
    btns.push(b);
    row.append(b);
  }
  paint();

  return [
    kicker('The daily bar'),
    title('How much is ', el('em', {}, 'a good day?')),
    lede('Not the perfect day. The one you would actually repeat tomorrow. You can change this any time in Settings.'),
    row,
    read,
    el('div', { class: 'film-spacer' }),
    primary('Continue', () => {
      Store.setGoal(state.hours * 60);
      syncProfile();
      go(idx + 1);
    }),
  ];
}

function roomScene() {
  return [
    kicker('The room'),
    title('A room, ', el('em', {}, 'not a trap.')),
    el('div', { class: 'film-facts' },
      el('div', { class: 'fact' }, el('b', {}, '20s'), el('span', {}, 'to undo a mis-start')),
      el('div', { class: 'fact' }, el('b', {}, '1.4s'), el('span', {}, 'hold to leave')),
      el('div', { class: 'fact' }, el('b', {}, '100%'), el('span', {}, 'minutes that stay yours')),
    ),
    lede('Every session opens full-screen with the screen awake. Hold the ring to begin, hold the end control to leave. Stop inside the first 20 seconds and nothing is written; after that every minute stays yours. No punishments, no logs.'),
  ];
}

/* ---------- permissions ---------- */

function permissionRow(icon, name, desc) {
  const pill = el('span', { class: 'film-perm-pill', hidden: true }, 'On');
  const btn = el('button', { class: 'btn btn-subtle btn-sm', disabled: true }, 'Check');
  const row = el('div', { class: 'film-perm' },
    el('span', { class: 'film-perm-icon', innerHTML: svg(icon, 18) }),
    el('div', { class: 'film-perm-txt' },
      el('b', {}, name),
      el('span', {}, desc),
    ),
    el('div', { class: 'film-perm-act' }, pill, btn),
  );
  return { row, pill, btn };
}

function paintPerm(item, { on = false, blocked = false, label = 'Allow', blockedLabel = 'Blocked', action = 'Settings', onClick = null } = {}) {
  item.pill.hidden = !on && !blocked;
  item.pill.textContent = blocked ? blockedLabel : 'On';
  item.pill.classList.toggle('on', on);
  item.btn.hidden = on;
  item.btn.textContent = blocked ? action : label;
  item.btn.disabled = false;
  item.btn.onclick = onClick;
}

function permissionsScene() {
  const native = isNative;
  const notif = permissionRow('bell', 'Notifications', 'Block starts, warnings and end-of-round alerts.');
  const exact = permissionRow('clock', 'Alarms & reminders', 'Ring at the exact minute, even when closed.');
  const full = permissionRow('phone', 'Full-screen alarm', 'Take over the lock screen on Android 14+.');
  const access = permissionRow('shield', 'Accessibility service', 'Know which app is in front, so blocking works.');
  const usage = permissionRow('grid', 'Usage access', 'A private screen-time card and daily limits.');
  const list = el('div', { class: 'film-perms' },
    notif.row,
    native ? exact.row : null,
    native ? full.row : null,
    native ? access.row : null,
    native ? usage.row : null,
  );

  let notifDenied = false;

  function paintWeb() {
    if (!('Notification' in window)) {
      paintPerm(notif, {
        blocked: true, blockedLabel: 'Unavailable', action: 'Why?',
        onClick: () => hint('This browser does not support notifications.'),
      });
      return;
    }
    if (!window.isSecureContext) {
      paintPerm(notif, {
        blocked: true, blockedLabel: 'Needs HTTPS', action: 'Why?',
        onClick: () => hint('Notifications need HTTPS or localhost.'),
      });
      return;
    }
    const permission = Notification.permission;
    if (permission === 'granted') {
      paintPerm(notif, { on: true });
    } else if (permission === 'denied') {
      paintPerm(notif, {
        blocked: true, action: 'Help',
        onClick: () => hint('Allow notifications for this site in your browser settings.'),
      });
    } else {
      paintPerm(notif, {
        label: 'Allow',
        onClick: async () => {
          notif.btn.disabled = true;
          try { await Notification.requestPermission(); } catch (_) { /* denied is a valid answer */ }
          paintWeb();
        },
      });
    }
  }

  async function askNativeNotifications() {
    notif.btn.disabled = true;
    try { await requestNotifications(); } catch (_) { /* denied is a valid answer */ }
    const status = await nativeStatus();
    notifDenied = !status?.notifications;
    paintNative();
  }

  async function paintNative() {
    const status = await nativeStatus();
    if (!status) {
      for (const [item, open] of [
        [notif, openNotificationSettings], [exact, openExactAlarmSettings],
        [full, openFullScreenIntentSettings], [access, openAccessibilitySettings],
        [usage, openUsageAccessSettings],
      ]) {
        paintPerm(item, {
          blocked: true, blockedLabel: 'Unavailable', action: 'Settings',
          onClick: () => open(),
        });
      }
      return;
    }
    if (status.notifications) {
      paintPerm(notif, { on: true });
    } else if (notifDenied) {
      paintPerm(notif, {
        blocked: true, action: 'Settings',
        onClick: () => openNotificationSettings(),
      });
    } else {
      paintPerm(notif, { label: 'Allow', onClick: askNativeNotifications });
    }
    if (status.exact) paintPerm(exact, { on: true });
    else paintPerm(exact, { label: 'Open', onClick: () => openExactAlarmSettings() });
    if (status.fullScreen) paintPerm(full, { on: true });
    else paintPerm(full, { label: 'Allow', onClick: () => openFullScreenIntentSettings() });
    if (status.accessibility) paintPerm(access, { on: true });
    else paintPerm(access, {
      label: 'Enable', action: 'Enable',
      onClick: () => openAccessibilitySettings(),
    });
    if (status.usage) paintPerm(usage, { on: true });
    else paintPerm(usage, { label: 'Open', onClick: () => openUsageAccessSettings() });
  }

  const refresh = async () => {
    if (!document.contains(list)) {
      if (sceneCleanup) { sceneCleanup(); sceneCleanup = null; }
      return;
    }
    if (native) await paintNative();
    else paintWeb();
  };
  const onVisible = () => { if (!document.hidden) refresh(); };
  addEventListener('visibilitychange', onVisible);
  sceneCleanup = () => removeEventListener('visibilitychange', onVisible);
  setTimeout(refresh, 0);

  return [
    kicker('Stay on time'),
    title('Let Lockin ', el('em', {}, 'reach you.')),
    lede(native
      ? 'Notifications, exact alarms, full-screen alarms, accessibility and usage access. All optional — change any in Settings → Android.'
      : 'Notifications are optional. They arrive while Lockin is open; a closed tab cannot ring.'),
    list,
    el('p', { class: 'film-fine' }, native
      ? 'Nothing here leaves the phone. Strict kiosk is an optional extra: set it up later from Control with one computer command.'
      : 'Android adds exact alarms that ring when the app is closed. On the web, the alarm needs a live Lockin tab.'),
  ];
}

/* ---------- render ---------- */

const RENDERERS = {
  intro: introScene, name: nameScene, exam: examScene,
  date: dateScene, hours: hoursScene, account: accountScene,
  strict: roomScene, permissions: permissionsScene,
};

function buildScenes(replay) {
  const hasProfile = !!(state.name && state.exam && state.examDate);
  const full = ['intro', 'name', 'exam', 'date', 'hours', 'account', 'strict', 'permissions'];
  return replay && hasProfile ? ['intro', 'account', 'strict', 'permissions'] : full;
}

function sceneFooter(kind) {
  if (kind === 'intro') {
    return [
      primary('Begin', () => go(idx + 1)),
      ghost('Skip the tour', finish),
    ];
  }
  if (kind === 'name') {
    return [
      primary('Continue', () => { syncProfile(); go(idx + 1); }),
      ghost('Back', () => go(idx - 1)),
    ];
  }
  if (kind === 'account') {
    return [
      primary('Continue', () => go(idx + 1)),
      ghost('Back', () => go(idx - 1)),
    ];
  }
  if (kind === 'strict') {
    return [
      primary('Continue', () => go(idx + 1)),
      ghost('Back', () => go(idx - 1)),
    ];
  }
  if (kind === 'permissions') {
    return [
      primary('Start using Lockin', finish),
      ghost('Back', () => go(idx - 1)),
    ];
  }
  return [];
}

function render() {
  if (sceneCleanup) { sceneCleanup(); sceneCleanup = null; }
  document.body.dataset.mode = 'onboard';
  const host = document.getElementById('view');
  host.textContent = '';

  const kind = scenes[idx];
  const bodyParts = RENDERERS[kind]();
  const footParts = sceneFooter(kind);

  const top = el('header', { class: 'film-top' },
    el('div', { class: 'film-bar' },
      idx > 0
        ? el('button', {
            class: 'film-back', 'aria-label': 'Back', innerHTML: svg('chevL', 18),
            onclick: () => go(idx - 1),
          })
        : el('div', { class: 'film-brand' }, el('i', { class: 'brand-dot' }), 'Lockin'),
      el('span', { class: 'film-step' }, `${String(idx + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`),
    ),
    el('div', { class: 'film-track' }, el('i', { style: `width:${((idx + 1) / scenes.length) * 100}%` })),
  );

  const scene = el('div', { class: 'film-scene' }, ...bodyParts);
  const body = el('div', { class: 'film-body' }, scene);
  const foot = footParts.length ? el('footer', { class: 'film-foot' }, ...footParts) : null;

  host.append(el('section', { class: 'film' }, top, body, foot));

  /* A scene change replaces the buttons that had focus. Move focus to the new
     heading so a keyboard or screen-reader user lands at the top of the scene
     instead of on the body. */
  const heading = host.querySelector('.film-title');
  if (heading) heading.focus({ preventScroll: true });
}

/* ---------- mounting ---------- */

function mount(host, params) {
  const replay = params?.replay === '1';
  if (Store.state.flags.onboarded && !replay) {
    Router.go('/home');
    return;
  }
  readProfile();
  scenes = buildScenes(replay);
  idx = 0;
  render();
}

function unmount() {
  if (sceneCleanup) { sceneCleanup(); sceneCleanup = null; }
  document.body.dataset.mode = '';
}
