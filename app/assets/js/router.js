/* Lockin — hash router. Views register themselves; the shell swaps them in. */

const routes = new Map();

export const Router = {
  current: null,

  register(path, view) {
    routes.set(path, view); // view: { mount(el, params), unmount?(el) }
  },

  go(path) {
    location.hash = path;
  },

  parse() {
    const raw = (location.hash || '#/home').replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    const params = {};
    for (const [k, v] of new URLSearchParams(query || '')) params[k] = v;
    return { path: '/' + (path || 'home'), params };
  },

  render() {
    const { path, params } = this.parse();
    const view = routes.get(path) || routes.get('/home');
    const host = document.getElementById('view');
    if (this.current?.unmount) this.current.unmount(host);
    host.textContent = '';
    this.current = view;
    view.mount(host, params);
    document.body.dataset.view = path.slice(1);
    host.scrollTop = 0;
    window.scrollTo(0, 0);
    this.announce(host, path);
  },

  /* A dedicated live region, plus focus on the new screen's heading. The
     heading is the better announcement when it exists; the live region covers
     screens that open with something other than an h1. */
  announce(host, path) {
    const status = document.getElementById('a11y-status');
    const tab = document.querySelector(`.tabbar button[data-nav="#${path}"]`);
    const name = tab?.getAttribute('aria-label')
      || tab?.querySelector('span')?.textContent
      || (path === '/start' ? 'Welcome' : '');
    if (name) document.title = `${name} — Lockin`;

    const heading = host.querySelector('h1');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      if (status) status.textContent = '';
      return;
    }
    /* A view that renders outside #view (a resumed live session) may already
       have moved focus to its own heading. Do not talk over it. */
    const active = document.activeElement;
    if (active && /^H[1-6]$/.test(active.tagName)) {
      if (status) status.textContent = '';
      return;
    }
    if (status && name) status.textContent = `${name} screen`;
  },

  start() {
    addEventListener('hashchange', () => this.render());
    this.render();
  },
};
