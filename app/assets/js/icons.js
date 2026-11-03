/* tiny inline-svg factory */
export function svg(name, size = 20) {
  const paths = {
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="7.5" y="5.5" width="3.2" height="13" rx="1.6" fill="currentColor" stroke="none"/><rect x="13.3" y="5.5" width="3.2" height="13" rx="1.6" fill="currentColor" stroke="none"/>',
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
    caret: '<path d="M8 10l4 4 4-4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    broom: '<path d="M6 4l12 12M18 4 6 16" opacity=".55"/><path d="M5 20h14M8 20c1.8-1 2.2-2.6 0.4-4.4L7 14l7-7 3 3-7 7c-1.8 1.8-3.4 1.4-4 3z"/>',
    book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15.5H7.5A2.5 2.5 0 0 0 5 21z"/><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  };
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}
