// Data access. Inside the desktop app every call goes to the Rust core
// (crates/notes-core). In a plain browser (for previews and UI tests) a small
// localStorage store with the same behaviour stands in.

const tauri = window.__TAURI__?.core;

function tauriStore(invoke) {
  return {
    listFolders: () => invoke('list_folders'),
    createFolder: (name, parentId = null) => invoke('create_folder', { name, parentId }),
    renameFolder: (id, name) => invoke('rename_folder', { id, name }),
    deleteFolder: (id) => invoke('delete_folder', { id }),
    listNotes: (scope) => invoke('list_notes', { scope }),
    search: (query) => invoke('search', { query }),
    getNote: (id) => invoke('get_note', { id }),
    createNote: (folderId) => invoke('create_note', { folderId }),
    updateNote: (id, body, plaintext) => invoke('update_note', { id, body, plaintext }),
    setPinned: (id, pinned) => invoke('set_pinned', { id, pinned }),
    moveNote: (id, folderId) => invoke('move_note', { id, folderId }),
    trashNote: (id) => invoke('trash_note', { id }),
    restoreNote: (id) => invoke('restore_note', { id }),
    purgeNote: (id) => invoke('purge_note', { id }),
    emptyTrash: () => invoke('empty_trash'),
    listTags: () => invoke('list_tags'),
  };
}

// ---- browser stand-in ----

const KEY = 'margin-preview-v1';
const DAY = 86400000;

export function titleAndSnippet(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return [(lines[0] || '').slice(0, 200), lines.slice(1).join(' ').slice(0, 200)];
}

export function extractTags(text) {
  const tags = [];
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const t = m[2].toLowerCase();
    if (/\p{L}/u.test(t) && !tags.includes(t)) tags.push(t);
  }
  return tags;
}

function memoryStore() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* preview only */ } };
  const now = () => Date.now();
  const id = () => crypto.randomUUID();
  const summary = ({ body, plaintext, tags, ...s }) => s;
  const live = () => db.notes.filter((n) => n.deleted_at == null);
  const sortNotes = (a, b) => (b.pinned - a.pinned) || (b.modified - a.modified);
  const find = (nid) => {
    const n = db.notes.find((x) => x.id === nid);
    if (!n) throw new Error(`not found: ${nid}`);
    return n;
  };
  const descendants = (fid) => [fid, ...db.folders.filter((f) => f.parent_id === fid).flatMap((f) => descendants(f.id))];
  const cutoff = now() - 30 * DAY;
  db.notes = db.notes.filter((n) => n.deleted_at == null || n.deleted_at >= cutoff);

  return {
    async listFolders() {
      const count = (fid) => live().filter((n) => n.folder_id === fid).length;
      return [...db.folders]
        .sort((a, b) => (a.id !== 'notes') - (b.id !== 'notes') || a.name.localeCompare(b.name))
        .map((f) => ({ ...f, note_count: count(f.id) }));
    },
    async createFolder(name, parentId = null) {
      const base = name.trim() || 'New Folder';
      let candidate = base;
      for (let n = 2; db.folders.some((f) => f.parent_id === parentId && f.name.toLowerCase() === candidate.toLowerCase()); n++) candidate = `${base} ${n}`;
      const f = { id: id(), name: candidate, parent_id: parentId };
      db.folders.push(f); save();
      return { ...f, note_count: 0 };
    },
    async renameFolder(fid, name) {
      if (!name.trim()) throw new Error('folder name cannot be empty');
      db.folders.find((f) => f.id === fid).name = name.trim(); save();
    },
    async deleteFolder(fid) {
      if (fid === 'notes') throw new Error('the Notes folder cannot be deleted');
      const ids = descendants(fid);
      for (const n of db.notes) {
        if (!ids.includes(n.folder_id)) continue;
        if (n.deleted_at == null) { n.deleted_at = now(); n.pinned = false; }
        n.folder_id = 'notes';
      }
      db.folders = db.folders.filter((f) => !ids.includes(f.id)); save();
    },
    async listNotes(scope) {
      if (scope.kind === 'trash') return db.notes.filter((n) => n.deleted_at != null).sort((a, b) => b.deleted_at - a.deleted_at).map(summary);
      let notes = live();
      if (scope.kind === 'folder') notes = notes.filter((n) => n.folder_id === scope.value);
      if (scope.kind === 'tag') notes = notes.filter((n) => n.tags.includes(scope.value));
      return notes.sort(sortNotes).map(summary);
    },
    async search(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      return live()
        .filter((n) => { const words = n.plaintext.toLowerCase().split(/[^\p{L}\p{N}]+/u); return terms.every((t) => words.some((w) => w.startsWith(t))); })
        .sort(sortNotes).map(summary);
    },
    async getNote(nid) { const { plaintext, tags, ...n } = find(nid); return n; },
    async createNote(folderId) {
      const t = now();
      const n = { id: id(), folder_id: folderId, title: '', snippet: '', created: t, modified: t, pinned: false, deleted_at: null, has_checklist: false, body: '', plaintext: '', tags: [] };
      db.notes.push(n); save();
      return this.getNote(n.id);
    },
    async updateNote(nid, body, plaintext) {
      const n = find(nid);
      [n.title, n.snippet] = titleAndSnippet(plaintext);
      Object.assign(n, { body, plaintext, tags: extractTags(plaintext), has_checklist: body.includes('class="checklist"'), modified: now() });
      save();
      return summary(n);
    },
    async setPinned(nid, pinned) { find(nid).pinned = pinned; save(); },
    async moveNote(nid, folderId) { find(nid).folder_id = folderId; find(nid).modified = now(); save(); },
    async trashNote(nid) { Object.assign(find(nid), { deleted_at: now(), pinned: false }); save(); },
    async restoreNote(nid) { find(nid).deleted_at = null; save(); },
    async purgeNote(nid) { db.notes = db.notes.filter((n) => n.id !== nid); save(); },
    async emptyTrash() { const before = db.notes.length; db.notes = live(); save(); return before - db.notes.length; },
    async listTags() {
      const counts = {};
      for (const n of live()) for (const t of n.tags) counts[t] = (counts[t] || 0) + 1;
      return Object.keys(counts).sort().map((name) => ({ name, count: counts[name] }));
    },
  };
}

// Sample content so a browser preview isn't empty.
function seed() {
  const t = Date.now();
  const mk = (folder, body, ago, extra = {}) => {
    const div = document.createElement('div');
    div.innerHTML = body;
    const plaintext = htmlToText(div);
    const [title, snippet] = titleAndSnippet(plaintext);
    return { id: crypto.randomUUID(), folder_id: folder, title, snippet, created: t - ago - DAY, modified: t - ago, pinned: false, deleted_at: null, has_checklist: body.includes('class="checklist"'), body, plaintext, tags: extractTags(plaintext), ...extra };
  };
  return {
    folders: [
      { id: 'notes', name: 'Notes', parent_id: null },
      { id: 'work', name: 'Work', parent_id: null },
      { id: 'recipes', name: 'Recipes', parent_id: null },
    ],
    notes: [
      mk('notes', '<h1>Weekend plans</h1><ul class="checklist"><li data-checked="true">Book the cabin</li><li>Pick up hiking boots</li><li>Charge the camera</li></ul><p>Leave Friday around 4 pm. #trips</p>', 20 * 60000, { pinned: true }),
      mk('work', '<h1>Q4 planning</h1><h2>Goals</h2><ul><li>Ship the new onboarding flow</li><li>Cut page load time in half</li></ul><p>Review with the team on Thursday. #work</p>', 3 * 3600000),
      mk('recipes', '<h1>Lemon pasta</h1><p>Serves 2</p><table><tbody><tr><td>Spaghetti</td><td>200 g</td></tr><tr><td>Lemons</td><td>2</td></tr><tr><td>Parmesan</td><td>60 g</td></tr></tbody></table><p>Zest first, then juice. #cooking</p>', 2 * DAY),
      mk('notes', '<h1>Books to read</h1><ol><li>The Left Hand of Darkness</li><li>Piranesi</li><li>Project Hail Mary</li></ol>', 9 * DAY),
      mk('work', '<h1>Interview questions</h1><p>Ask about the last project they were proud of, and what they would change about it.</p>', 40 * DAY),
    ],
  };
}

/** innerText-like conversion that also works on detached elements. */
export function htmlToText(el) {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3) { out.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'BR') { out.push('\n'); return; }
    const block = /^(P|DIV|H1|H2|H3|LI|PRE|TR|UL|OL|TABLE)$/.test(tag);
    if (block) out.push('\n');
    node.childNodes.forEach(walk);
    if (tag === 'TD' || tag === 'TH') out.push('\t');
    if (block) out.push('\n');
  };
  el.childNodes.forEach(walk);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export const store = tauri ? tauriStore(tauri.invoke) : memoryStore();
export const isDesktop = Boolean(tauri);
