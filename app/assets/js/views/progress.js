/* Lockin — Progress: the record, promoted out of Settings to its own screen. */

import { Router } from '../router.js';
import { el } from '../util.js';
import { svg } from '../icons.js';
import { progressCards } from './stats.js';

export function initProgress(Router) {
  Router.register('/progress', { mount });
}

function mount(host) {
  document.body.dataset.mode = '';
  host.append(el('section', { class: 'view-anim' },
    el('button', {
      class: 'backrow', type: 'button',
      onclick: () => Router.go('/home'),
    }, svg('chevL', 16), 'Home'),
    el('header', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Progress'),
        el('div', { class: 'sub' }, 'The record, not a scoreboard.'),
      ),
    ),
    ...progressCards(),
  ));
}
