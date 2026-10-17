// Margin's own line icons (24x24, stroke-based).
const P = {
  folder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  allNotes: '<path d="M3 8a2 2 0 0 1 2-2h3.5l1.8 2H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M6 4h3l1.5 1.6"/>',
  trashFolder: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l1 12h9l1-12"/><path d="M10 11v5M14 11v5"/>',
  compose: '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.5 3.5a2 2 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  format: '<path d="M3 18l4.5-12L12 18M4.8 13.5h5.4"/><path d="M14.5 12.2c.5-1 1.5-1.6 2.8-1.6 1.8 0 2.7 1 2.7 2.8V18m0-3.6c-3.6-.2-5.8.4-5.8 2 0 1 .8 1.6 2 1.6 1.9 0 3.8-1.2 3.8-3.6"/>',
  checklist: '<circle cx="5.5" cy="7" r="2.5"/><path d="M4.4 7l.9.9 1.6-1.8"/><circle cx="5.5" cy="16.5" r="2.5"/><path d="M11 7h10M11 16.5h10"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15"/>',
  pin: '<path d="M9 3.5h6l-1 5 3.5 3.5h-11L10 8.5z"/><path d="M12 12v8.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  plusCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
  tag: '<path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2L20.5 12 12 20.5z"/><circle cx="8" cy="8" r="1.3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  sharedFolder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="svg-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

/** Fills every element carrying data-icon="name". */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  }
}
