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
    this.announce(path);
  },

  /* One dedicated live region instead of aria-live on the whole view: screen
     readers hear "Settings screen", not every timer repaint. */
  announce(path) {
    const status = document.getElementById('a11y-status');
    if (!status) return;
    const tab = document.querySelector(`.tabbar button[data-nav="#${path}"]`);
    const name = tab?.getAttribute('aria-label')
      || tab?.querySelector('span')?.textContent
      || (path === '/start' ? 'Welcome' : '');
    if (!name) return;
    status.textContent = `${name} screen`;
    document.title = `${name} — Lockin`;
  },

  start() {
    addEventListener('hashchange', () => this.render());
    this.render();
  },
};
