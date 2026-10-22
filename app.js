import * as store from './store.js';
import { h, icon, progressPie, formDialog, confirmDialog, actionSheet, openOverlay, toast } from './ui.js';
import { onLongPress, enableEdgeSwipeBack } from './gestures.js';

const topbar = document.getElementById('topbar');
const main = document.getElementById('app');
const overlayRoot = document.getElementById('overlay-root');
const HINT_KEY = 'todo-app/install-hint-dismissed';

let current = null; // the mounted screen: { key, update }
let addOnOpen = false; // a just-created list opens the quick-add sheet
let homeScrollY = 0; // going back to the lists restores where you were, as iOS does
let afterSwipe = null; // set when an edge swipe already animated the way back

function route() {
  const m = location.hash.match(/^#\/list\/([^/]+)$/);
  return m ? { view: 'list', id: decodeURIComponent(m[1]) } : { view: 'home' };
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function render() {
  const r = route();
  if (r.view === 'list' && !store.getList(r.id)) {
    location.replace('#/');
    return;
  }
  const key = r.view === 'list' ? `list:${r.id}` : 'home';
  const swiped = afterSwipe;
  afterSwipe = null;
  if (current?.key === key) {
    current.update();
    swiped?.();
    return;
  }

  if (current?.key === 'home') homeScrollY = window.scrollY;
  const swap = () => {
    current = r.view === 'list' ? mountList(r.id) : mountHome();
    current.key = key;
    current.update();
    window.scrollTo(0, r.view === 'home' ? homeScrollY : 0);
  };

  if (current && !swiped && document.startViewTransition && !reduceMotion.matches && document.visibilityState === 'visible') {
    document.documentElement.dataset.nav = r.view === 'list' ? 'push' : 'pop';
    document.startViewTransition(swap);
  } else {
    swap();
    swiped?.();
  }
}

function goHome() {
  location.hash = '#/';
}

function openList(id) {
  location.hash = listHref(id);
}

const listHref = (id) => `#/list/${encodeURIComponent(id)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function glassButton(name, label, onclick) {
  return h('button', { type: 'button', class: 'glass-btn', 'aria-label': label, title: label, onclick }, icon(name));
}

function iconButton(name, label, onclick) {
  return h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, onclick }, icon(name));
}

function emptyState(title, text) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), h('p', { class: 'empty-text' }, text));
}

function folderOptions() {
  return [{ value: '', label: 'No folder' }, ...store.sortedFolders().map((f) => ({ value: f.id, label: f.name }))];
}

function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

// Shows the small centered title in the top bar once the large title scrolls out of view, as iOS does.
let titleObserver = null;
function collapseTitleOnScroll(largeTitle) {
  titleObserver?.disconnect(); // the previous screen's title is gone
  if (!('IntersectionObserver' in window)) return;
  titleObserver = new IntersectionObserver(([entry]) => {
    topbar.classList.toggle('scrolled', !entry.isIntersecting);
  }, { rootMargin: '-56px 0px 0px 0px' });
  titleObserver.observe(largeTitle);
}

function searchField(placeholder, oninput) {
  return h('label', { class: 'search' },
    icon('search'),
    h('input', { type: 'search', placeholder, 'aria-label': placeholder, oninput: (e) => oninput(e.target.value) }));
}

// ================= Home: folders and lists =================

function mountHome() {
  let query = '';
  const sortLabel = h('span');
  const results = h('div');

  document.title = 'To Do';
  topbar.classList.remove('scrolled');
  topbar.replaceChildren(h('div', { class: 'topbar-row' },
    h('div', { class: 'topbar-side' }),
    h('div', { class: 'topbar-title' }, 'Lists'),
    h('div', { class: 'topbar-side end' }, glassButton('more', 'More options', homeMenu)),
  ));

  const largeTitle = h('h1', { class: 'large-title' }, 'Lists');
  main.replaceChildren(
    largeTitle,
    installHint(),
    h('div', { class: 'toolbar' },
      searchField('Search lists', (v) => { query = v; fill(); }),
      h('button', { type: 'button', class: 'chip', onclick: pickListSort, 'aria-label': 'Sort lists' }, icon('sort'), sortLabel),
    ),
    results,
    h('button', { type: 'button', class: 'fab', 'aria-label': 'New list', title: 'New list', onclick: () => newList(null) }, icon('plus')),
  );
  collapseTitleOnScroll(largeTitle);

  function fill() {
    const state = store.getState();
    const sort = state.prefs.listSort;
    const q = query.trim().toLocaleLowerCase();
    const matches = (l) => !q || l.name.toLocaleLowerCase().includes(q);

    if (!state.lists.length && !state.folders.length) {
      results.replaceChildren(emptyState('No lists yet', 'Tap + to make your first list.'));
      return;
    }

    const out = [];
    const unfiled = store.sortLists(state.lists.filter((l) => !l.folderId && matches(l)), sort);
    if (unfiled.length) out.push(h('ul', { class: 'rows' }, unfiled.map(listRow)));

    for (const f of store.sortedFolders()) {
      const inFolder = state.lists.filter((l) => l.folderId === f.id);
      const folderMatches = q && f.name.toLocaleLowerCase().includes(q);
      const shown = store.sortLists(folderMatches ? inFolder : inFolder.filter(matches), sort);
      if (q && !folderMatches && !shown.length) continue;
      const open = q ? true : !f.collapsed;
      out.push(h('section', { class: 'folder' },
        folderHeader(f, inFolder.length, open),
        open ? (shown.length
          ? h('ul', { class: 'rows' }, shown.map(listRow))
          : h('p', { class: 'folder-empty' }, 'No lists in this folder yet')) : null));
    }

    if (!out.length) out.push(emptyState('No matches', `Nothing named “${query.trim()}”.`));
    else if (!q) {
      out.push(h('button', { type: 'button', class: 'text-btn new-folder', onclick: newFolder }, icon('folderPlus'), 'New folder'));
    }
    results.replaceChildren(...out);
  }

  return {
    update() {
      sortLabel.textContent = store.LIST_SORTS.find((s) => s.id === store.getState().prefs.listSort).short;
      fill();
    },
  };
}

function installHint() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(HINT_KEY) === '1'; } catch { /* private mode */ }
  if (dismissed || isStandalone()) return null;
  const el = h('div', { class: 'hint' },
    h('p', {}, h('strong', {}, 'Install it first. '),
      'In Safari tap Share, then “Add to Home Screen”. The Home Screen app keeps its own copy of your lists, separate from this tab.'),
    h('button', {
      type: 'button', class: 'hint-close', 'aria-label': 'Dismiss',
      onclick: () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ } el.remove(); },
    }, '×'),
  );
  return el;
}

function folderHeader(folder, count, open) {
  return h('div', { class: 'folder-header' },
    h('button', {
      type: 'button', class: 'folder-toggle', 'aria-expanded': String(open),
      onclick: () => store.updateFolder(folder.id, { collapsed: !folder.collapsed }),
    },
      icon('folder'),
      h('span', { class: 'folder-name' }, folder.name),
      h('span', { class: 'folder-count' }, count),
      h('span', { class: `chev${open ? ' open' : ''}` }, icon('chevron')),
    ),
    iconButton('more', `Options for folder ${folder.name}`, () => folderMenu(folder.id)),
  );
}

function listSummary(c) {
  if (!c.total) return 'No items';
  const parts = [`${c.complete}/${c.total} done`];
  if (c.in_progress) parts.push(`${c.in_progress} in progress`);
  if (c.on_hold) parts.push(`${c.on_hold} on hold`);
  return parts.join(' · ');
}

function listRow(list) {
  const c = store.counts(list);
  // A button rather than a link, so a long press opens our menu instead of Safari's link preview.
  const open = h('button', { type: 'button', class: 'row-main', onclick: () => openList(list.id) },
    progressPie(c.complete, c.total),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, list.name),
      h('span', { class: 'row-sub' }, listSummary(c)),
    ),
    h('span', { class: 'row-count' }, c.total - c.complete || ''),
  );
  const row = h('li', { class: 'row' }, open, iconButton('more', `Options for ${list.name}`, () => listMenu(list.id)));
  onLongPress(open, () => listMenu(list.id));
  return row;
}

async function homeMenu() {
  const choice = await actionSheet({
    title: 'Your lists are saved only on this device',
    actions: [
      { label: 'New list', value: 'list' },
      { label: 'New folder', value: 'folder' },
      { label: 'Back up (export)', value: 'export' },
      { label: 'Restore from backup', value: 'import' },
    ],
  });
  if (choice === 'list') newList(null);
  else if (choice === 'folder') newFolder();
  else if (choice === 'export') exportBackup();
  else if (choice === 'import') importBackup();
}

async function pickListSort() {
  const currentSort = store.getState().prefs.listSort;
  const choice = await actionSheet({
    title: 'Sort lists by',
    actions: store.LIST_SORTS.map((s) => ({ label: s.label, value: s.id, checked: s.id === currentSort })),
  });
  if (choice) store.setPref('listSort', choice);
}

// ---- Folder actions ----

async function newFolder() {
  const v = await formDialog({
    title: 'New folder', okLabel: 'Create',
    fields: [{ name: 'name', label: 'Name', placeholder: 'e.g. Work', required: true }],
  });
  return v ? store.createFolder(v.name) : null;
}

async function folderMenu(id) {
  const folder = store.getFolder(id);
  if (!folder) return;
  const choice = await actionSheet({
    title: folder.name,
    actions: [
      { label: 'New list in this folder', value: 'new' },
      { label: 'Rename folder', value: 'rename' },
      { label: 'Delete folder', value: 'delete', danger: true },
    ],
  });
  if (choice === 'new') newList(id);
  else if (choice === 'rename') {
    const v = await formDialog({ title: 'Rename folder', fields: [{ name: 'name', label: 'Name', value: folder.name, required: true }] });
    if (v) store.updateFolder(id, { name: v.name });
  } else if (choice === 'delete') deleteFolder(id);
}

async function deleteFolder(id) {
  const folder = store.getFolder(id);
  const n = store.getState().lists.filter((l) => l.folderId === id).length;
  if (!n) {
    if (await confirmDialog({ title: `Delete “${folder.name}”?`, message: 'The folder is empty.', okLabel: 'Delete', danger: true })) {
      store.deleteFolder(id);
    }
    return;
  }
  const choice = await actionSheet({
    title: `“${folder.name}” has ${plural(n, 'list')}`,
    actions: [
      { label: 'Delete folder, keep its lists', value: 'keep' },
      { label: `Delete folder and its ${plural(n, 'list')}`, value: 'all', danger: true },
    ],
  });
  if (choice === 'keep') {
    store.deleteFolder(id);
    toast(`Lists moved out of “${folder.name}”`);
  } else if (choice === 'all') {
    const ok = await confirmDialog({
      title: `Delete ${plural(n, 'list')}?`,
      message: `Every list in “${folder.name}” and all their items will be deleted. This can't be undone.`,
      okLabel: 'Delete all', danger: true,
    });
    if (ok) store.deleteFolder(id, { deleteLists: true });
  }
}

// ---- List actions (used on both screens) ----

async function newList(folderId) {
  const fields = [{ name: 'name', label: 'Name', placeholder: 'e.g. Groceries', required: true }];
  if (store.getState().folders.length) {
    fields.push({ name: 'folderId', label: 'Folder', type: 'select', options: folderOptions(), value: folderId || '' });
  }
  const v = await formDialog({ title: 'New list', fields, okLabel: 'Create' });
  if (!v) return;
  const list = store.createList(v.name, v.folderId || folderId || null);
  addOnOpen = true;
  openList(list.id);
}

async function listMenu(id) {
  const list = store.getList(id);
  if (!list) return;
  const done = list.items.filter((i) => i.status === 'complete').length;
  const choice = await actionSheet({
    title: list.name,
    actions: [
      { label: 'Rename list', value: 'rename' },
      { label: 'Move to folder', value: 'move' },
      done ? { label: `Clear ${plural(done, 'completed item')}`, value: 'clear' } : null,
      { label: 'Delete list', value: 'delete', danger: true },
    ].filter(Boolean),
  });
  if (choice === 'rename') renameList(id);
  else if (choice === 'move') moveList(id);
  else if (choice === 'clear') clearCompleted(id);
  else if (choice === 'delete') deleteList(id);
}

async function renameList(id) {
  const list = store.getList(id);
  const v = await formDialog({ title: 'Rename list', fields: [{ name: 'name', label: 'Name', value: list.name, required: true }] });
  if (v) store.updateList(id, { name: v.name });
}

async function moveList(id) {
  const list = store.getList(id);
  const choice = await actionSheet({
    title: `Move “${list.name}” to`,
    actions: [
      { label: 'No folder', value: '', checked: !list.folderId },
      ...store.sortedFolders().map((f) => ({ label: f.name, value: f.id, checked: list.folderId === f.id })),
      { label: 'New folder…', value: '__new__' },
    ],
  });
  if (choice === null) return;
  if (choice === '__new__') {
    const folder = await newFolder();
    if (!folder) return;
    store.updateList(id, { folderId: folder.id });
    toast(`Moved to “${folder.name}”`);
    return;
  }
  store.updateList(id, { folderId: choice || null });
  toast(choice ? `Moved to “${store.getFolder(choice).name}”` : 'Moved out of its folder');
}

function clearCompleted(id) {
  const removed = store.removeItems(id, (i) => i.status === 'complete');
  toast(`Cleared ${plural(removed.length, 'item')}`, { actionLabel: 'Undo', onAction: () => store.restoreItems(id, removed) });
}

async function deleteList(id) {
  const list = store.getList(id);
  const n = list.items.length;
  const ok = await confirmDialog({
    title: `Delete “${list.name}”?`,
    message: n ? `Its ${plural(n, 'item')} will be deleted too. This can't be undone.` : "This can't be undone.",
    okLabel: 'Delete', danger: true,
  });
  if (!ok) return;
  if (route().view === 'list') location.replace('#/');
  store.deleteList(id);
}

// ================= List screen: items =================

function mountList(id) {
  let query = '';
  const smallTitle = h('div', { class: 'topbar-title' });
  const titleText = h('span');
  const pieSlot = h('span', { class: 'title-pie' });
  const subtitle = h('p', { class: 'large-sub' });
  const sortLabel = h('span');
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' });
  const itemsEl = h('div');

  topbar.classList.remove('scrolled');
  topbar.replaceChildren(h('div', { class: 'topbar-row' },
    h('div', { class: 'topbar-side' },
      h('button', { type: 'button', class: 'glass-btn back-btn', onclick: goHome }, icon('back'), h('span', {}, 'Lists'))),
    smallTitle,
    h('div', { class: 'topbar-side end' }, glassButton('more', 'List options', () => listMenu(id))),
  ));

  const largeTitle = h('h1', { class: 'large-title' },
    pieSlot,
    h('button', { type: 'button', class: 'title-btn', onclick: () => renameList(id), title: 'Rename list' }, titleText));

  main.replaceChildren(
    largeTitle,
    subtitle,
    h('div', { class: 'toolbar' },
      searchField('Search items', (v) => { query = v; fillItems(); }),
      h('button', { type: 'button', class: 'chip', onclick: () => pickItemSort(id), 'aria-label': 'Sort items' }, icon('sort'), sortLabel),
    ),
    chips,
    itemsEl,
    h('button', { type: 'button', class: 'fab', 'aria-label': 'Add item', title: 'Add item', onclick: () => quickAdd(id, () => query) }, icon('plus')),
  );
  collapseTitleOnScroll(largeTitle);

  if (addOnOpen) {
    addOnOpen = false;
    quickAdd(id, () => query);
  }

  function fillChips(list) {
    const c = store.counts(list);
    const selected = new Set(list.statusFilter);
    const chip = (label, count, active, onclick, statusId) => h('button', {
      type: 'button', class: `chip${active ? ' active' : ''}`, 'aria-pressed': String(active), onclick,
    }, statusId ? h('span', { class: `dot s-${statusId}` }) : null, label, h('span', { class: 'count' }, count));

    chips.replaceChildren(
      chip('All', c.total, selected.size === 0, () => store.updateList(id, { statusFilter: [] })),
      ...store.STATUSES.map((s) => chip(s.label, c[s.id], selected.has(s.id), () => {
        const next = new Set(selected);
        if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
        const filter = store.STATUSES.map((x) => x.id).filter((x) => next.has(x));
        store.updateList(id, { statusFilter: filter.length === store.STATUSES.length ? [] : filter });
      }, s.id)),
    );
  }

  function fillItems() {
    const list = store.getList(id);
    if (!list) return;
    if (!list.items.length) {
      itemsEl.replaceChildren(emptyState('No items yet', 'Tap + to add one.'));
      return;
    }
    const q = query.trim().toLocaleLowerCase();
    const filter = list.statusFilter;
    const visible = list.items.filter((i) => (!filter.length || filter.includes(i.status))
      && (!q || i.text.toLocaleLowerCase().includes(q) || i.notes.toLocaleLowerCase().includes(q)));
    if (!visible.length) {
      itemsEl.replaceChildren(emptyState('Nothing matches', 'Try a different search or status filter.'));
      return;
    }
    const sorted = store.sortItems(visible, list.sort);
    if (list.sort === 'status') {
      itemsEl.replaceChildren(...store.STATUS_GROUP_ORDER.map((sid) => {
        const group = sorted.filter((i) => i.status === sid);
        if (!group.length) return null;
        return h('section', { class: 'item-group' },
          h('h2', { class: `section-title s-${sid}` }, store.statusInfo(sid).label, h('span', { class: 'section-count' }, group.length)),
          h('ul', { class: 'rows items' }, group.map((i) => itemRow(id, i))));
      }).filter(Boolean));
    } else {
      itemsEl.replaceChildren(h('ul', { class: 'rows items' }, sorted.map((i) => itemRow(id, i))));
    }
  }

  return {
    update() {
      const list = store.getList(id);
      if (!list) { location.replace('#/'); return; }
      const c = store.counts(list);
      document.title = list.name;
      titleText.textContent = list.name;
      smallTitle.textContent = list.name;
      pieSlot.replaceChildren(progressPie(c.complete, c.total));
      const folder = list.folderId ? store.getFolder(list.folderId) : null;
      subtitle.textContent = [folder?.name, listSummary(c)].filter(Boolean).join(' · ');
      sortLabel.textContent = store.ITEM_SORTS.find((s) => s.id === list.sort).short;
      fillChips(list);
      fillItems();
    },
  };
}

function itemRow(listId, item) {
  const status = store.statusInfo(item.status);
  const done = item.status === 'complete';
  const row = h('li', { class: `item s-${item.status}` },
    h('button', {
      type: 'button', class: 'check', 'aria-label': done ? `Mark “${item.text}” not complete` : `Mark “${item.text}” complete`,
      onclick: () => store.updateItem(listId, item.id, { status: done ? 'not_started' : 'complete' }),
    }, h('span', { class: 'ring' }, done ? icon('check') : null)),
    h('div', { class: 'item-body' },
      h('button', { type: 'button', class: 'item-main', onclick: () => editItem(listId, item.id) },
        h('span', { class: 'item-text' }, item.text),
        item.notes ? h('span', { class: 'item-notes' }, item.notes) : null),
      h('button', {
        type: 'button', class: 'item-status', 'aria-label': `Status: ${status.label}. Tap to change.`,
        onclick: () => pickStatus(listId, item.id),
      }, h('span', { class: 'dot' }), status.label),
    ),
  );
  onLongPress(row, () => itemMenu(listId, item.id));
  return row;
}

// Long-press menu for an item: change status, edit, or delete.
async function itemMenu(listId, itemId) {
  const item = store.getItem(listId, itemId);
  if (!item) return;
  const choice = await actionSheet({
    title: item.text,
    actions: [
      ...store.STATUSES.map((s) => ({ label: s.label, value: s.id, checked: s.id === item.status })),
      { label: 'Edit…', value: '__edit__' },
      { label: 'Delete', value: '__delete__', danger: true },
    ],
  });
  if (!choice) return;
  if (choice === '__edit__') editItem(listId, itemId);
  else if (choice === '__delete__') {
    const removed = store.removeItems(listId, (i) => i.id === itemId);
    toast('Item deleted', { actionLabel: 'Undo', onAction: () => store.restoreItems(listId, removed) });
  } else if (choice !== item.status) store.updateItem(listId, itemId, { status: choice });
}

// Todoist-style quick add: a bottom sheet that stays open so you can add several items in a row.
function quickAdd(listId, getQuery) {
  let status = 'not_started';
  let added = 0;
  const input = h('input', {
    type: 'text', class: 'quick-input', placeholder: 'New item', 'aria-label': 'New item',
    autocomplete: 'off', enterkeyhint: 'enter', maxLength: 500,
  });
  const counter = h('span', { class: 'quick-count' });
  const statusRow = h('div', { class: 'quick-statuses', role: 'radiogroup', 'aria-label': 'Status' });
  const fillStatuses = () => statusRow.replaceChildren(...store.STATUSES.map((s) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(s.id === status),
    class: `chip s-${s.id}${s.id === status ? ' active' : ''}`,
    onclick: () => { status = s.id; fillStatuses(); input.focus(); },
  }, h('span', { class: 'dot' }), s.label)));
  fillStatuses();

  let close;
  const form = h('form', {
    class: 'quick-add', role: 'dialog', 'aria-label': 'Add item',
    onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) { close(); return; }
      const item = store.addItem(listId, text);
      if (item && status !== 'not_started') store.updateItem(listId, item.id, { status });
      added++;
      counter.textContent = `${plural(added, 'item')} added`;
      input.value = '';
      input.focus();
      const list = store.getList(listId);
      const q = getQuery().trim().toLocaleLowerCase();
      if (list.statusFilter.length && !list.statusFilter.includes(status)) toast('Added. Your status filter is hiding it.');
      else if (q && !text.toLocaleLowerCase().includes(q)) toast('Added. Your search is hiding it.');
    },
  },
    input,
    statusRow,
    h('div', { class: 'quick-actions' },
      counter,
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Done'),
      h('button', { type: 'submit', class: 'btn btn-primary quick-submit', 'aria-label': 'Add' }, icon('plus'), 'Add'),
    ),
  );
  close = openOverlay(form, { kind: 'sheet', onDismiss: () => close() });
  input.focus();
}

async function pickStatus(listId, itemId) {
  const item = store.getItem(listId, itemId);
  if (!item) return;
  const choice = await actionSheet({
    title: item.text,
    actions: store.STATUSES.map((s) => ({ label: s.label, value: s.id, checked: s.id === item.status })),
  });
  if (choice && choice !== item.status) store.updateItem(listId, itemId, { status: choice });
}

async function pickItemSort(listId) {
  const list = store.getList(listId);
  const choice = await actionSheet({
    title: 'Sort items by',
    actions: store.ITEM_SORTS.map((s) => ({ label: s.label, value: s.id, checked: s.id === list.sort })),
  });
  if (choice) store.updateList(listId, { sort: choice });
}

async function editItem(listId, itemId) {
  const item = store.getItem(listId, itemId);
  if (!item) return;
  const v = await formDialog({
    title: 'Edit item',
    fields: [
      { name: 'text', label: 'Item', value: item.text, required: true },
      { name: 'status', label: 'Status', type: 'select', value: item.status, options: store.STATUSES.map((s) => ({ value: s.id, label: s.label })) },
      { name: 'notes', label: 'Notes', type: 'textarea', value: item.notes, placeholder: 'Optional' },
    ],
    extraActions: [{ label: 'Delete', value: 'delete', danger: true }],
  });
  if (!v) return;
  if (v._action === 'delete') {
    const removed = store.removeItems(listId, (i) => i.id === itemId);
    toast('Item deleted', { actionLabel: 'Undo', onAction: () => store.restoreItems(listId, removed) });
    return;
  }
  const patch = {};
  for (const key of ['text', 'status', 'notes']) if (v[key] !== item[key]) patch[key] = v[key];
  if (Object.keys(patch).length) store.updateItem(listId, itemId, patch);
}

// ================= Backup =================

async function exportBackup() {
  const name = `todo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([store.exportJSON()], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'To-do backup' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function importBackup() {
  document.querySelectorAll('input.backup-picker').forEach((el) => el.remove());
  const input = h('input', { type: 'file', accept: '.json,application/json', class: 'backup-picker' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    let parsed;
    try {
      parsed = store.parseBackup(await file.text());
    } catch {
      toast("That file isn't a to-do backup.");
      return;
    }
    const itemCount = parsed.lists.reduce((n, l) => n + l.items.length, 0);
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `It has ${plural(parsed.lists.length, 'list')}, ${plural(parsed.folders.length, 'folder')} and ${plural(itemCount, 'item')}. Everything currently in the app will be replaced.`,
      okLabel: 'Restore', danger: true,
    });
    if (!ok) return;
    location.replace('#/');
    store.replaceAll(parsed);
    toast('Backup restored');
  });
  document.body.append(input);
  input.click();
}

// ================= Start =================

store.setSaveErrorHandler(() => toast("Couldn't save. Your device storage may be full."));
store.subscribe(() => current?.update());
window.addEventListener('hashchange', render);
render();

enableEdgeSwipeBack({
  layers: () => [topbar, main],
  canStart: () => route().view === 'list' && !overlayRoot.childElementCount,
  onBack: (resetLayers) => {
    afterSwipe = resetLayers;
    goHome();
  },
});

// iOS only shows :active press styles when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });

// Ask iOS not to clear this app's storage when space runs low.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
