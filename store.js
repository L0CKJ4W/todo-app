// Data store: folders, lists and items, saved in this device's localStorage only.
// Nothing here talks to a server.

const KEY = 'todo-app/v1';

export const STATUSES = [
  { id: 'not_started', label: 'Not started' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'complete', label: 'Complete' },
];
const STATUS_IDS = new Set(STATUSES.map((s) => s.id));
// Order used when sorting by status: active work first, finished work last.
const STATUS_RANK = { in_progress: 0, not_started: 1, on_hold: 2, complete: 3 };
export const STATUS_GROUP_ORDER = ['in_progress', 'not_started', 'on_hold', 'complete'];

export const ITEM_SORTS = [
  { id: 'added', label: 'Date added (oldest first)', short: 'Oldest' },
  { id: 'newest', label: 'Date added (newest first)', short: 'Newest' },
  { id: 'updated', label: 'Recently changed', short: 'Changed' },
  { id: 'name', label: 'Name (A–Z)', short: 'A–Z' },
  { id: 'status', label: 'Status (grouped)', short: 'Status' },
];

// Each list gets a color and an emoji, like the colored capsules in Structured.
export const LIST_COLORS = [
  { id: 'coral', label: 'Coral' },
  { id: 'orange', label: 'Orange' },
  { id: 'sun', label: 'Sunflower' },
  { id: 'green', label: 'Green' },
  { id: 'teal', label: 'Teal' },
  { id: 'blue', label: 'Blue' },
  { id: 'violet', label: 'Violet' },
  { id: 'pink', label: 'Pink' },
  { id: 'slate', label: 'Slate' },
];
const COLOR_IDS = new Set(LIST_COLORS.map((c) => c.id));

export const EMOJI_CHOICES = ['📋', '✅', '🛒', '🏠', '💼', '💡', '🎯', '📚', '🏋️', '🍳', '✈️', '🎁',
  '💰', '🧹', '🌱', '🎮', '🎨', '🐾', '❤️', '🔧', '📅', '🎵', '🚗', '⭐'];

// Stable fallback color for lists made before colors existed.
function colorFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return LIST_COLORS[hash % LIST_COLORS.length].id;
}

const cleanEmoji = (v) => (typeof v === 'string' && v.trim().length <= 16 ? v.trim() : '');

export const LIST_SORTS = [
  { id: 'name', label: 'Name (A–Z)', short: 'A–Z' },
  { id: 'newest', label: 'Newest first', short: 'Newest' },
  { id: 'oldest', label: 'Oldest first', short: 'Oldest' },
  { id: 'remaining', label: 'Most left to do', short: 'To do' },
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const listeners = new Set();
let onSaveError = () => {};
let state = load();

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function empty() {
  return { version: 1, folders: [], lists: [], prefs: { listSort: 'name' } };
}

// Validates and fills in anything missing, so a hand-edited or older backup can't break the app.
export function parseBackup(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object' || !Array.isArray(data.lists)) {
    throw new Error('Not a to-do backup');
  }
  const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
  const time = (v) => (Number.isFinite(v) ? v : Date.now());
  const hasId = (x) => x && typeof x === 'object' && typeof x.id === 'string';

  const folders = (Array.isArray(data.folders) ? data.folders : []).filter(hasId).map((f) => ({
    id: f.id,
    name: str(f.name, 'Folder'),
    collapsed: !!f.collapsed,
    createdAt: time(f.createdAt),
  }));
  const folderIds = new Set(folders.map((f) => f.id));

  const lists = data.lists.filter(hasId).map((l) => ({
    id: l.id,
    name: str(l.name, 'List'),
    folderId: folderIds.has(l.folderId) ? l.folderId : null,
    color: COLOR_IDS.has(l.color) ? l.color : colorFor(l.id),
    emoji: cleanEmoji(l.emoji),
    createdAt: time(l.createdAt),
    sort: ITEM_SORTS.some((s) => s.id === l.sort) ? l.sort : 'added',
    statusFilter: Array.isArray(l.statusFilter) ? l.statusFilter.filter((s) => STATUS_IDS.has(s)) : [],
    items: (Array.isArray(l.items) ? l.items : []).filter(hasId).map((i) => ({
      id: i.id,
      text: str(i.text),
      notes: str(i.notes),
      status: STATUS_IDS.has(i.status) ? i.status : 'not_started',
      createdAt: time(i.createdAt),
      updatedAt: time(i.updatedAt),
    })),
  }));

  const listSort = LIST_SORTS.some((s) => s.id === data.prefs?.listSort) ? data.prefs.listSort : 'name';
  return { version: 1, folders, lists, prefs: { listSort } };
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    return raw ? parseBackup(raw) : empty();
  } catch {
    // Keep the unreadable copy instead of overwriting it on the next save.
    try { if (raw) localStorage.setItem(`${KEY}.unreadable-${Date.now()}`, raw); } catch { /* storage full */ }
    return empty();
  }
}

function commit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    onSaveError(err);
  }
  for (const fn of listeners) fn();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSaveErrorHandler(fn) {
  onSaveError = fn;
}

// Another tab of the app changed the data.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  state = load();
  for (const fn of listeners) fn();
});

// ---- Reading ----

export const getState = () => state;
export const getList = (id) => state.lists.find((l) => l.id === id) || null;
export const getFolder = (id) => state.folders.find((f) => f.id === id) || null;
export const getItem = (listId, itemId) => getList(listId)?.items.find((i) => i.id === itemId) || null;
export const statusInfo = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];

export function sortedFolders() {
  return [...state.folders].sort((a, b) => collator.compare(a.name, b.name));
}

export function counts(list) {
  const c = { total: list.items.length, not_started: 0, in_progress: 0, on_hold: 0, complete: 0 };
  for (const i of list.items) c[i.status]++;
  return c;
}

export function sortLists(lists, sort) {
  const byName = (a, b) => collator.compare(a.name, b.name);
  const out = [...lists];
  switch (sort) {
    case 'newest': return out.sort((a, b) => b.createdAt - a.createdAt);
    case 'oldest': return out.sort((a, b) => a.createdAt - b.createdAt);
    case 'remaining': {
      const left = (l) => l.items.filter((i) => i.status !== 'complete').length;
      return out.sort((a, b) => left(b) - left(a) || byName(a, b));
    }
    default: return out.sort(byName);
  }
}

export function sortItems(items, sort) {
  const out = [...items];
  switch (sort) {
    case 'newest': return out.sort((a, b) => b.createdAt - a.createdAt);
    case 'updated': return out.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'name': return out.sort((a, b) => collator.compare(a.text, b.text));
    case 'status': return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.createdAt - b.createdAt);
    default: return out.sort((a, b) => a.createdAt - b.createdAt);
  }
}

// ---- Folders ----

export function createFolder(name) {
  const folder = { id: uid(), name, collapsed: false, createdAt: Date.now() };
  state.folders.push(folder);
  commit();
  return folder;
}

export function updateFolder(id, patch) {
  const folder = getFolder(id);
  if (!folder) return;
  Object.assign(folder, patch);
  commit();
}

export function deleteFolder(id, { deleteLists = false } = {}) {
  state.folders = state.folders.filter((f) => f.id !== id);
  if (deleteLists) state.lists = state.lists.filter((l) => l.folderId !== id);
  else for (const l of state.lists) if (l.folderId === id) l.folderId = null;
  commit();
}

// ---- Lists ----

// The next color in the palette, so new lists don't all look the same.
export function nextColor() {
  return LIST_COLORS[state.lists.length % LIST_COLORS.length].id;
}

export function createList(name, folderId = null, { color, emoji } = {}) {
  const list = {
    id: uid(), name, folderId: getFolder(folderId) ? folderId : null,
    color: COLOR_IDS.has(color) ? color : nextColor(), emoji: cleanEmoji(emoji),
    createdAt: Date.now(), sort: 'added', statusFilter: [], items: [],
  };
  state.lists.push(list);
  commit();
  return list;
}

export function updateList(id, patch) {
  const list = getList(id);
  if (!list) return;
  if ('color' in patch && !COLOR_IDS.has(patch.color)) delete patch.color;
  if ('emoji' in patch) patch.emoji = cleanEmoji(patch.emoji);
  Object.assign(list, patch);
  commit();
}

export function deleteList(id) {
  state.lists = state.lists.filter((l) => l.id !== id);
  commit();
}

// ---- Items ----

export function addItem(listId, text) {
  const list = getList(listId);
  if (!list) return null;
  const now = Date.now();
  const item = { id: uid(), text, notes: '', status: 'not_started', createdAt: now, updatedAt: now };
  list.items.push(item);
  commit();
  return item;
}

export function updateItem(listId, itemId, patch) {
  const item = getItem(listId, itemId);
  if (!item) return;
  Object.assign(item, patch, { updatedAt: Date.now() });
  commit();
}

// Removes matching items and returns them with their positions, so they can be put back (undo).
export function removeItems(listId, predicate) {
  const list = getList(listId);
  if (!list) return [];
  const removed = [];
  list.items = list.items.filter((item, index) => {
    if (!predicate(item)) return true;
    removed.push({ item, index });
    return false;
  });
  if (removed.length) commit();
  return removed;
}

export function restoreItems(listId, removed) {
  const list = getList(listId);
  if (!list || !removed.length) return;
  for (const { item, index } of [...removed].sort((a, b) => a.index - b.index)) {
    list.items.splice(Math.min(index, list.items.length), 0, item);
  }
  commit();
}

// ---- Prefs and backup ----

export function setPref(key, value) {
  state.prefs[key] = value;
  commit();
}

export function exportJSON() {
  return JSON.stringify({ app: 'todo-app', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export function replaceAll(next) {
  state = parseBackup(next);
  commit();
}
