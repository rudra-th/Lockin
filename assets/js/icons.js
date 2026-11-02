/* tiny inline-svg factory */
export function svg(name, size = 20) {
  const paths = {
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chevL: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    chevR: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13"/>',
    check: '<path d="M4.5 12.5 10 18 19.5 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
    lock: '<rect x="6" y="10.5" width="12" height="9.5" rx="3"/><path d="M9 10.5V8a3 3 0 0 1 6 0v2.5"/>',
    flame: '<path d="M12 3s5.5 4.2 5.5 9a5.5 5.5 0 0 1-11 0c0-2 1-3.6 2-4.8 0 1.8.9 2.8 2 2.8 0-3.5 1.5-5.8 1.5-7z"/>',
    sound: '<path d="M4 10v4h3l4 3.5v-11L7 10z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 7a8 8 0 0 1 0 10"/>',
    mute: '<path d="M4 10v4h3l4 3.5v-11L7 10z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    caret: '<path d="M8 10l4 4 4-4"/>',
    broom: '<path d="M6 4l12 12M18 4 6 16" opacity=".55"/><path d="M5 20h14M8 20c1.8-1 2.2-2.6 0.4-4.4L7 14l7-7 3 3-7 7c-1.8 1.8-3.4 1.4-4 3z"/>',
    book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15.5H7.5A2.5 2.5 0 0 0 5 21z"/><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19"/>',
  };
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}
