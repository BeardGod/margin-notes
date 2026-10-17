import { store, htmlToText } from './store.js';
import { icon, hydrateIcons } from './icons.js';
import { sanitize } from './sanitize.js';

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'), folderList: $('folder-list'), tagGrid: $('tag-grid'), tagsTitle: $('tags-title'),
  noteList: $('note-list'), listHeading: $('list-heading'), editor: $('editor'), noteDate: $('note-date'),
  emptyEditor: $('empty-editor'), trashBanner: $('trash-banner'), search: $('search'),
  formatPopover: $('format-popover'), menu: $('context-menu'), scrim: $('scrim'),
  searchMobile: $('search-mobile'), dialog: $('dialog'),
};

const state = {
  folders: [], tags: [], trashCount: 0,
  scope: { kind: 'folder', value: 'notes' },
  query: '',
  notes: [],
  selectedId: null,
  current: null, // full note being edited
  view: 'list',
};

const DAY = 86400000;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- layout ----------

const phone = window.matchMedia('(max-width: 699px)');
const compact = window.matchMedia('(max-width: 999px)');

/** On phones one pane shows at a time: folders, list or editor. */
function setPane(pane) {
  els.app.dataset.pane = pane;
  showFolders(pane === 'folders' && compact.matches);
}

function showFolders(open) {
  els.app.classList.toggle('show-folders', open);
  els.scrim.hidden = !open || !compact.matches;
}

/** In-app replacement for confirm(), which mobile web views don't all support. */
function ask(text, okLabel = 'Delete') {
  return new Promise((resolve) => {
    $('dialog-text').textContent = text;
    $('dialog-ok').textContent = okLabel;
    els.dialog.hidden = false;
    $('dialog-ok').focus();
    const done = (answer) => {
      els.dialog.hidden = true;
      $('dialog-ok').onclick = $('dialog-cancel').onclick = els.dialog.onkeydown = null;
      resolve(answer);
    };
    $('dialog-ok').onclick = () => done(true);
    $('dialog-cancel').onclick = () => done(false);
    els.dialog.onkeydown = (e) => { if (e.key === 'Escape') done(false); };
  });
}

// ---------- dates ----------

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

function groupLabel(t, now = Date.now()) {
  const today = startOfDay(now);
  if (t >= today) return 'Today';
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 7 * DAY) return 'Previous 7 Days';
  if (t >= today - 30 * DAY) return 'Previous 30 Days';
  const d = new Date(t);
  if (d.getFullYear() === new Date(now).getFullYear()) return d.toLocaleString(undefined, { month: 'long' });
  return String(d.getFullYear());
}

function shortDate(t) {
  const today = startOfDay(Date.now());
  if (t >= today) return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 7 * DAY) return new Date(t).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
}

function longDate(t) {
  const d = new Date(t);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// ---------- loading ----------

async function refreshSidebar() {
  [state.folders, state.tags, state.trashCount] = await Promise.all([
    store.listFolders(), store.listTags(), store.listNotes({ kind: 'trash' }).then((n) => n.length),
  ]);
  renderSidebar();
}

async function refreshList({ keepSelection = true } = {}) {
  state.notes = state.query ? await store.search(state.query) : await store.listNotes(state.scope);
  if (!keepSelection || !state.notes.some((n) => n.id === state.selectedId)) {
    await selectNote(state.notes[0]?.id ?? null);
  }
  renderList();
}

// ---------- sidebar ----------

function folderDepth(f) {
  let depth = 0;
  for (let p = f.parent_id; p; p = state.folders.find((x) => x.id === p)?.parent_id) depth++;
  return depth;
}

function orderedFolders() {
  const out = [];
  const add = (parent) => state.folders.filter((f) => (f.parent_id ?? null) === parent).forEach((f) => { out.push(f); add(f.id); });
  add(null);
  return out;
}

function renderSidebar() {
  const sel = state.query ? null : state.scope;
  const isSel = (kind, value) => sel && sel.kind === kind && (value === undefined || sel.value === value);
  const total = state.folders.reduce((n, f) => n + f.note_count, 0);
  const rows = [];
  if (state.folders.length > 1) {
    rows.push(`<li class="folder-row ${isSel('all') ? 'selected' : ''}" data-scope="all">${icon('allNotes')}<span class="name">All Notes</span><span class="count">${total}</span></li>`);
  }
  for (const f of orderedFolders()) {
    const depth = folderDepth(f);
    rows.push(`<li class="folder-row ${depth === 1 ? 'child' : depth > 1 ? 'grandchild' : ''} ${isSel('folder', f.id) ? 'selected' : ''}" data-scope="folder" data-id="${f.id}">${icon('folder')}<span class="name">${esc(f.name)}</span><span class="count">${f.note_count}</span></li>`);
  }
  if (state.trashCount) {
    rows.push(`<li class="folder-row ${isSel('trash') ? 'selected' : ''}" data-scope="trash">${icon('trashFolder')}<span class="name">Recently Deleted</span><span class="count">${state.trashCount}</span></li>`);
  }
  els.folderList.innerHTML = rows.join('');
  els.tagsTitle.hidden = state.tags.length === 0;
  els.tagGrid.innerHTML = state.tags
    .map((t) => `<button class="tag-pill ${isSel('tag', t.name) ? 'selected' : ''}" data-tag="${esc(t.name)}">#${esc(t.name)}</button>`)
    .join('');
}

async function setScope(scope) {
  await flushSave();
  state.scope = scope;
  state.query = '';
  els.search.value = els.searchMobile.value = '';
  renderSidebar();
  setPane('list');
  await refreshList({ keepSelection: false });
}

// ---------- note list ----------

function scopeTitle() {
  if (state.query) return 'Results';
  switch (state.scope.kind) {
    case 'all': return 'All Notes';
    case 'trash': return 'Recently Deleted';
    case 'tag': return `#${state.scope.value}`;
    default: return state.folders.find((f) => f.id === state.scope.value)?.name ?? 'Notes';
  }
}

function showsFolder() {
  return state.query || state.scope.kind === 'all' || state.scope.kind === 'tag';
}

function renderList() {
  const n = state.notes.length;
  const trash = state.scope.kind === 'trash' && !state.query;
  els.listHeading.innerHTML = `${esc(scopeTitle())}<span class="sub">${n} ${n === 1 ? 'note' : 'notes'}${trash && n ? ' · <button class="empty-trash" id="empty-trash">Delete All</button>' : ''}</span>`;
  els.noteList.classList.toggle('gallery', state.view === 'gallery');

  if (!n) {
    els.noteList.innerHTML = `<div class="list-empty">${state.query ? 'No results' : trash ? 'No recently deleted notes' : 'No notes'}</div>`;
    return;
  }
  const groups = [];
  const push = (label, note) => {
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, notes: [] }));
    g.notes.push(note);
  };
  for (const note of state.notes) push(note.pinned && !trash ? 'Pinned' : groupLabel(trash ? note.deleted_at : note.modified), note);

  const folderName = (id) => state.folders.find((f) => f.id === id)?.name ?? 'Notes';
  const html = [];
  for (const g of groups) {
    html.push(`<div class="group-title">${g.label}</div>`);
    for (const note of g.notes) {
      const title = esc(note.title || 'New Note');
      const sel = note.id === state.selectedId ? 'selected' : '';
      if (state.view === 'gallery') {
        html.push(`<div class="card ${sel}" data-id="${note.id}"><div class="card-thumb"><b>${title}</b>${esc(note.snippet)}</div><div class="card-title">${title}</div><div class="card-date">${shortDate(note.modified)}</div></div>`);
      } else {
        html.push(`<div class="note-row ${sel}" data-id="${note.id}" draggable="true">
          <div class="note-title">${title}</div>
          <div class="note-meta"><span class="when">${shortDate(note.modified)}</span><span class="snippet">${esc(note.snippet || 'No additional text')}</span></div>
          ${showsFolder() ? `<div class="note-folder">${icon('folder')}${esc(folderName(note.folder_id))}</div>` : ''}
        </div>`);
      }
    }
  }
  els.noteList.innerHTML = html.join('');
}

// ---------- editor ----------

let saveTimer = null;
let dirty = false;

function isEmptyNote() {
  return !els.editor.innerText.trim() && !els.editor.querySelector('table, ul.checklist li');
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!dirty || !state.current) return;
  dirty = false;
  const body = sanitize(els.editor.innerHTML);
  const summary = await store.updateNote(state.current.id, body, htmlToText(els.editor));
  state.current = { ...state.current, ...summary, body };
  const i = state.notes.findIndex((n) => n.id === summary.id);
  if (i >= 0) state.notes[i] = summary;
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await flushSave();
    // Edited notes move to the top of their group, like a fresh modification.
    state.notes.sort((a, b) => (b.pinned - a.pinned) || (b.modified - a.modified));
    renderList();
    const tagsBefore = state.tags.map((t) => t.name).join();
    state.tags = await store.listTags();
    if (state.tags.map((t) => t.name).join() !== tagsBefore) renderSidebar();
    if (state.current) els.noteDate.textContent = longDate(state.current.modified);
  }, 400);
}

/** Leaving a note: save it, and drop it if nothing was ever written. */
async function leaveCurrent() {
  if (!state.current) return;
  await flushSave();
  const prev = state.current;
  if (prev.deleted_at == null && isEmptyNote()) {
    await store.purgeNote(prev.id);
    state.notes = state.notes.filter((n) => n.id !== prev.id);
    await refreshSidebar();
  }
}

async function selectNote(id) {
  if (state.current?.id === id) return;
  await leaveCurrent();
  state.selectedId = id;
  state.current = id ? await store.getNote(id) : null;
  renderEditor();
  for (const el of els.noteList.querySelectorAll('[data-id]')) el.classList.toggle('selected', el.dataset.id === id);
}

function renderEditor() {
  const note = state.current;
  els.emptyEditor.hidden = Boolean(note);
  els.editor.hidden = !note;
  els.noteDate.textContent = note ? longDate(note.modified) : '';
  const trashed = Boolean(note && note.deleted_at != null);
  els.trashBanner.hidden = !trashed;
  els.editor.contentEditable = String(Boolean(note) && !trashed);
  els.editor.innerHTML = note ? sanitize(note.body) || '<h1><br></h1>' : '';
  $('pin').classList.toggle('active', Boolean(note?.pinned));
  for (const b of ['format', 'checklist', 'table', 'pin', 'delete-note']) $(b).disabled = !note || (trashed && b !== 'delete-note');
}

async function newNote() {
  await flushSave();
  if (state.scope.kind === 'trash' || state.query) await setScope({ kind: 'folder', value: 'notes' });
  const folderId = state.scope.kind === 'folder' ? state.scope.value : 'notes';
  const note = await store.createNote(folderId);
  await leaveCurrent();
  state.notes.unshift(note);
  state.current = null;
  state.selectedId = null;
  await selectNote(note.id);
  renderList();
  if (state.view === 'gallery' && !phone.matches) els.app.classList.add('editing');
  setPane('editor');
  els.editor.innerHTML = '<h1><br></h1>';
  placeCaret(els.editor.firstChild);
  refreshSidebar();
}

function placeCaret(node, atEnd = false) {
  els.editor.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(!atEnd);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------- formatting ----------

function currentBlock(tagPattern) {
  let n = window.getSelection()?.anchorNode;
  while (n && n !== els.editor) {
    if (n.nodeType === 1 && tagPattern.test(n.tagName)) return n;
    n = n.parentNode;
  }
  return null;
}

function setBlock(tag) {
  els.editor.focus();
  const list = currentBlock(/^(UL|OL)$/);
  if (list) document.execCommand(list.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
  document.execCommand('formatBlock', false, tag);
  scheduleSave();
}

/** kind: bullet | dash | number | checklist. Applying the active kind again removes the list. */
function toggleList(kind) {
  els.editor.focus();
  const cls = kind === 'dash' ? 'dashed' : kind === 'checklist' ? 'checklist' : '';
  const existing = currentBlock(/^(UL|OL)$/);
  const existingKind = existing && (existing.tagName === 'OL' ? 'number' : existing.classList.contains('checklist') ? 'checklist' : existing.classList.contains('dashed') ? 'dash' : 'bullet');
  if (existing && existingKind === kind) {
    document.execCommand(existing.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
    scheduleSave();
    return;
  }
  if (existing && (existing.tagName === 'OL') === (kind === 'number')) {
    existing.className = cls;
    if (kind !== 'checklist') existing.querySelectorAll('li').forEach((li) => li.removeAttribute('data-checked'));
    scheduleSave();
    return;
  }
  if (existing) document.execCommand(existing.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
  const heading = currentBlock(/^(H1|H2|H3|PRE)$/);
  if (heading) document.execCommand('formatBlock', false, 'p');
  document.execCommand(kind === 'number' ? 'insertOrderedList' : 'insertUnorderedList');
  const list = currentBlock(/^(UL|OL)$/);
  if (list) list.className = cls;
  scheduleSave();
}

function insertTable() {
  els.editor.focus();
  const cells = '<td><br></td><td><br></td><td><br></td>';
  document.execCommand('insertHTML', false, `<table><tbody><tr>${cells}</tr><tr>${cells}</tr></tbody></table><p><br></p>`);
  scheduleSave();
}

function moveInTable(cell, back) {
  const all = [...cell.closest('table').querySelectorAll('td, th')];
  let i = all.indexOf(cell) + (back ? -1 : 1);
  if (i >= all.length) {
    const row = cell.closest('tr').cloneNode(true);
    row.querySelectorAll('td, th').forEach((c) => { c.innerHTML = '<br>'; });
    cell.closest('tbody, table').appendChild(row);
    i = all.length;
    scheduleSave();
  }
  const target = [...cell.closest('table').querySelectorAll('td, th')][Math.max(0, i)];
  if (target) placeCaret(target, true);
}

// ---------- popovers & context menu ----------

function openAt(el, x, y) {
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  el.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}

function closePopovers() {
  els.formatPopover.hidden = true;
  els.menu.hidden = true;
}

function showMenu(x, y, items) {
  els.menu.innerHTML = '';
  for (const it of items) {
    if (it === '-') { els.menu.append(document.createElement('hr')); continue; }
    if (it.label && !it.run) { const d = document.createElement('div'); d.className = 'submenu-label'; d.textContent = it.label; els.menu.append(d); continue; }
    const b = document.createElement('button');
    b.textContent = it.text;
    b.disabled = Boolean(it.disabled);
    b.addEventListener('click', async () => { closePopovers(); await it.run(); });
    els.menu.append(b);
  }
  openAt(els.menu, x, y);
}

async function noteMenu(note, x, y) {
  await selectNote(note.id);
  if (note.deleted_at != null) {
    showMenu(x, y, [
      { text: 'Recover', run: () => restoreNote(note.id) },
      { text: 'Delete Permanently', run: () => purgeNote(note.id) },
    ]);
    return;
  }
  const moves = state.folders.filter((f) => f.id !== note.folder_id).map((f) => ({ text: f.name, run: () => moveNote(note.id, f.id) }));
  showMenu(x, y, [
    { text: note.pinned ? 'Unpin Note' : 'Pin Note', run: () => togglePin(note.id) },
    { text: 'Delete', run: () => trashNote(note.id) },
    ...(moves.length ? ['-', { label: 'Move to' }, ...moves] : []),
  ]);
}

function folderMenu(folderId, x, y) {
  const isDefault = folderId === 'notes';
  showMenu(x, y, [
    { text: 'New Note', run: async () => { await setScope({ kind: 'folder', value: folderId }); await newNote(); } },
    { text: 'New Subfolder', run: () => createFolder(folderId) },
    '-',
    { text: 'Rename Folder', disabled: isDefault, run: () => renameFolderInline(folderId) },
    { text: 'Delete Folder', disabled: isDefault, run: () => deleteFolder(folderId) },
  ]);
}

// ---------- actions ----------

async function togglePin(id = state.selectedId) {
  const note = state.notes.find((n) => n.id === id) ?? state.current;
  if (!note || note.deleted_at != null) return;
  await store.setPinned(id, !note.pinned);
  if (state.current?.id === id) state.current.pinned = !note.pinned;
  $('pin').classList.toggle('active', Boolean(state.current?.pinned));
  await refreshList();
}

async function trashNote(id = state.selectedId) {
  if (!id) return;
  await flushSave();
  const idx = state.notes.findIndex((n) => n.id === id);
  const inTrash = state.notes[idx]?.deleted_at != null;
  if (inTrash) {
    if (!(await ask('Delete this note permanently? This can’t be undone.'))) return;
    await store.purgeNote(id);
  } else {
    await store.trashNote(id);
  }
  state.current = null;
  state.notes.splice(idx, 1);
  const next = state.notes[Math.min(idx, state.notes.length - 1)]?.id ?? null;
  state.selectedId = null;
  await selectNote(next);
  renderList();
  refreshSidebar();
}

async function purgeNote(id) { await trashNote(id); }

async function restoreNote(id = state.selectedId) {
  await store.restoreNote(id);
  state.current = null;
  await refreshSidebar();
  await refreshList({ keepSelection: false });
}

async function moveNote(id, folderId) {
  await flushSave();
  await store.moveNote(id, folderId);
  if (state.current?.id === id) state.current.folder_id = folderId;
  await refreshSidebar();
  await refreshList();
}

async function createFolder(parentId = null) {
  const f = await store.createFolder('New Folder', parentId);
  await refreshSidebar();
  renameFolderInline(f.id);
}

function renameFolderInline(id) {
  const row = els.folderList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const nameEl = row.querySelector('.name');
  const input = document.createElement('input');
  input.value = nameEl.textContent;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) await store.renameFolder(id, input.value);
    await refreshSidebar();
    if (state.scope.kind === 'folder' && state.scope.value === id) renderList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

async function deleteFolder(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  const msg = f.note_count
    ? `Delete “${f.name}”? Its ${f.note_count} ${f.note_count === 1 ? 'note' : 'notes'} will move to Recently Deleted.`
    : `Delete “${f.name}”?`;
  if (!(await ask(msg))) return;
  await store.deleteFolder(id);
  if (state.scope.kind === 'folder' && state.scope.value === id) state.scope = { kind: 'folder', value: 'notes' };
  state.current = null;
  await refreshSidebar();
  await refreshList({ keepSelection: false });
}

function setView(view) {
  state.view = view;
  els.app.classList.toggle('gallery', view === 'gallery');
  els.app.classList.remove('editing');
  $('view-list').classList.toggle('active', view === 'list');
  $('view-gallery').classList.toggle('active', view === 'gallery');
  try { localStorage.setItem('margin-view', view); } catch { /* optional */ }
  renderList();
}

// ---------- events ----------

function wire() {
  els.folderList.addEventListener('click', (e) => {
    const row = e.target.closest('.folder-row');
    if (!row || e.target.tagName === 'INPUT') return;
    setScope(row.dataset.scope === 'folder' ? { kind: 'folder', value: row.dataset.id } : { kind: row.dataset.scope });
  });
  els.folderList.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.folder-row[data-id]');
    if (row && row.dataset.id !== 'notes') renameFolderInline(row.dataset.id);
  });
  els.folderList.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.folder-row[data-id]');
    if (!row) return;
    e.preventDefault();
    folderMenu(row.dataset.id, e.clientX, e.clientY);
  });
  // Drag a note onto a folder to move it.
  els.folderList.addEventListener('dragover', (e) => {
    const row = e.target.closest('.folder-row[data-id]');
    if (!row) return;
    e.preventDefault();
    els.folderList.querySelectorAll('.drop-target').forEach((r) => r.classList.remove('drop-target'));
    row.classList.add('drop-target');
  });
  els.folderList.addEventListener('dragleave', (e) => e.target.closest?.('.folder-row')?.classList.remove('drop-target'));
  els.folderList.addEventListener('drop', (e) => {
    const row = e.target.closest('.folder-row[data-id]');
    row?.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/x-margin-note');
    if (row && id) { e.preventDefault(); moveNote(id, row.dataset.id); }
  });
  els.noteList.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) e.dataTransfer.setData('text/x-margin-note', row.dataset.id);
  });

  els.tagGrid.addEventListener('click', (e) => {
    const pill = e.target.closest('.tag-pill');
    if (pill) setScope({ kind: 'tag', value: pill.dataset.tag });
  });

  els.noteList.addEventListener('click', (e) => {
    if (e.target.id === 'empty-trash') return;
    const row = e.target.closest('[data-id]');
    if (!row) return;
    selectNote(row.dataset.id);
    if (phone.matches) setPane('editor');
  });
  els.noteList.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.card');
    if (card) { els.app.classList.add('editing'); selectNote(card.dataset.id).then(() => els.editor.focus()); }
  });
  els.noteList.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    e.preventDefault();
    const note = state.notes.find((n) => n.id === row.dataset.id);
    if (note) noteMenu(note, e.clientX, e.clientY);
  });
  els.noteList.addEventListener('keydown', (e) => {
    const i = state.notes.findIndex((n) => n.id === state.selectedId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = state.notes[Math.max(0, Math.min(state.notes.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) selectNote(next.id).then(() => els.noteList.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }));
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); trashNote(); }
    if (e.key === 'Enter' && state.current) { e.preventDefault(); placeCaret(els.editor, true); }
  });
  els.listHeading.addEventListener('click', async (e) => {
    if (e.target.id !== 'empty-trash') return;
    if (!(await ask('Permanently delete all notes in Recently Deleted? This can’t be undone.', 'Delete All'))) return;
    await store.emptyTrash();
    state.current = null;
    await refreshSidebar();
    await refreshList({ keepSelection: false });
  });

  els.editor.addEventListener('input', scheduleSave);
  els.editor.addEventListener('mousedown', (e) => {
    const li = e.target.closest?.('ul.checklist > li');
    if (!li || els.editor.contentEditable !== 'true') return;
    // Clicks on the circle (left of the text) toggle the item.
    if (e.clientX < li.getBoundingClientRect().left) {
      e.preventDefault();
      li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
      if (li.dataset.checked === 'false') li.removeAttribute('data-checked');
      scheduleSave();
    }
  });
  els.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const cell = currentBlock(/^(TD|TH)$/);
      if (cell) { e.preventDefault(); moveInTable(cell, e.shiftKey); return; }
      if (currentBlock(/^LI$/)) { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); scheduleSave(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const li = currentBlock(/^LI$/);
      // A new checklist item always starts unchecked.
      if (li?.parentElement?.classList.contains('checklist')) {
        requestAnimationFrame(() => currentBlock(/^LI$/)?.removeAttribute('data-checked'));
      }
      // The title line flows into body text, as a fresh note would.
      if (currentBlock(/^H1$/) && els.editor.firstElementChild === currentBlock(/^H1$/)) {
        requestAnimationFrame(() => { if (currentBlock(/^H1$/)) document.execCommand('formatBlock', false, 'p'); });
      }
    }
  });
  els.editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) document.execCommand('insertHTML', false, sanitize(html));
    else document.execCommand('insertText', false, text);
  });
  els.editor.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  });

  $('compose').addEventListener('click', newNote);
  $('back-folders').addEventListener('click', () => (phone.matches ? setPane('folders') : showFolders(true)));
  $('back-list').addEventListener('click', async () => { await leaveCurrent(); state.current = null; state.selectedId = null; setPane('list'); renderList(); });
  els.scrim.addEventListener('click', () => showFolders(false));
  // Folder taps on a narrow screen close the slide-over panel.
  els.sidebar = $('sidebar');
  els.sidebar.addEventListener('click', (e) => { if (e.target.closest('.folder-row, .tag-pill') && compact.matches && !phone.matches) showFolders(false); });
  compact.addEventListener('change', () => showFolders(false));
  $('delete-note').addEventListener('click', () => trashNote());
  $('pin').addEventListener('click', () => togglePin());
  $('checklist').addEventListener('click', () => toggleList('checklist'));
  $('table').addEventListener('click', insertTable);
  $('restore-note').addEventListener('click', () => restoreNote());
  $('new-folder').addEventListener('click', () => createFolder());
  $('view-list').addEventListener('click', () => setView('list'));
  $('view-gallery').addEventListener('click', () => setView('gallery'));
  $('format').addEventListener('mousedown', (e) => e.preventDefault());
  $('format').addEventListener('click', (e) => {
    if (!els.formatPopover.hidden) { closePopovers(); return; }
    const r = e.currentTarget.getBoundingClientRect();
    openAt(els.formatPopover, r.left - 8, r.bottom + 6);
  });
  els.formatPopover.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor selection
  els.formatPopover.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.block) setBlock(b.dataset.block);
    if (b.dataset.list) toggleList(b.dataset.list);
    if (b.dataset.cmd) { document.execCommand(b.dataset.cmd); scheduleSave(); return; }
    closePopovers();
  });

  let searchTimer;
  const onSearch = (e) => {
    const value = e.target.value;
    els.search.value = els.searchMobile.value = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await flushSave();
      state.query = value.trim();
      renderSidebar();
      await refreshList({ keepSelection: false });
    }, 150);
  };
  els.search.addEventListener('input', onSearch);
  els.searchMobile.addEventListener('input', onSearch);
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { els.search.value = ''; els.search.dispatchEvent(new Event('input')); els.noteList.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); els.noteList.focus(); }
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.popover, .menu, #format')) closePopovers();
  });
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      closePopovers();
      if (els.app.classList.contains('editing')) { els.app.classList.remove('editing'); renderList(); }
    }
    if (!ctrl) return;
    const editing = document.activeElement === els.editor && els.editor.contentEditable === 'true';
    const shortcuts = {
      'n': () => newNote(),
      'shift+n': () => createFolder(),
      'f': () => { els.search.focus(); els.search.select(); },
      'shift+l': () => editing && toggleList('checklist'),
      'alt+t': () => editing && insertTable(),
      'shift+t': () => editing && setBlock('h1'),
      'shift+h': () => editing && setBlock('h2'),
      'shift+j': () => editing && setBlock('h3'),
      'shift+b': () => editing && setBlock('p'),
      'shift+m': () => editing && setBlock('pre'),
      'shift+7': () => editing && toggleList('number'),
      'shift+8': () => editing && toggleList('bullet'),
    };
    const combo = `${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.shiftKey && /^digit\d$/i.test(e.code) ? e.code.slice(5) : k}`;
    if (shortcuts[combo]) { e.preventDefault(); shortcuts[combo](); }
  });
  window.addEventListener('beforeunload', () => { flushSave(); });
  window.addEventListener('blur', () => { flushSave(); });
}

async function start() {
  hydrateIcons();
  wire();
  let view = 'list';
  try { view = localStorage.getItem('margin-view') || 'list'; } catch { /* optional */ }
  setPane(phone.matches ? 'list' : 'editor');
  await refreshSidebar();
  setView(view);
  await refreshList({ keepSelection: false });
}

start();
