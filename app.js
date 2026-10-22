import * as store from './store.js';
import { h, icon, progressPie, formDialog, confirmDialog, actionSheet, openOverlay, toast, confetti, haptic } from './ui.js';
import { onLongPress, enableEdgeSwipeBack, makeSortable, makeSwipeable } from './gestures.js';
import { today, dueLabel, dueState, quickDates } from './dates.js';

const topbar = document.getElementById('topbar');
const main = document.getElementById('app');
const overlayRoot = document.getElementById('overlay-root');
const HINT_KEY = 'todo-app/install-hint-dismissed';

let current = null; // the mounted screen: { key, update }
let addOnOpen = false; // a just-created list opens the quick-add sheet
let homeScrollY = 0; // going back to the lists restores where you were, as iOS does
let afterSwipe = null; // set when an edge swipe already animated the way back
const expanded = new Set(); // items whose subtasks are shown inline

function route() {
  const m = location.hash.match(/^#\/list\/([^/]+)$/);
  if (m) return { view: 'list', id: decodeURIComponent(m[1]) };
  const s = location.hash.match(/^#\/(today|upcoming)$/);
  if (s) return { view: 'smart', id: s[1] };
  return { view: 'home' };
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function render() {
  const r = route();
  if (r.view === 'list' && !store.getList(r.id)) {
    location.replace('#/');
    return;
  }
  const key = r.view === 'home' ? 'home' : `${r.view}:${r.id}`;
  const swiped = afterSwipe;
  afterSwipe = null;
  if (current?.key === key) {
    current.update();
    swiped?.();
    return;
  }

  if (current?.key === 'home') homeScrollY = window.scrollY;
  const swap = () => {
    current = r.view === 'list' ? mountList(r.id) : r.view === 'smart' ? mountSmart(r.id) : mountHome();
    current.key = key;
    current.update();
    window.scrollTo(0, r.view === 'home' ? homeScrollY : 0);
  };

  if (current && !swiped && document.startViewTransition && !reduceMotion.matches && document.visibilityState === 'visible') {
    document.documentElement.dataset.nav = r.view === 'home' ? 'pop' : 'push';
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

function emptyState(emoji, title, text) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, emoji),
    h('p', { class: 'empty-title' }, title),
    h('p', { class: 'empty-text' }, text));
}

// The list's color tile with its emoji, or a progress pie when it has no emoji.
function listTile(list, c, size = '') {
  return h('span', { class: `tile c-${list.color}${size ? ` tile-${size}` : ''}` },
    list.emoji ? h('span', { class: 'tile-emoji' }, list.emoji) : progressPie(c.complete, c.total));
}

// Each screen takes the color of what it shows; the home screen uses the app's own coral.
function setScreenColor(color) {
  const root = document.documentElement;
  if (color) root.style.setProperty('--accent', `var(--c-${color})`);
  else root.style.removeProperty('--accent');
  root.classList.toggle('tinted', !!color);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Up late? 🦉';
  if (hour < 12) return 'Good morning ☀️';
  if (hour < 17) return 'Good afternoon 🌤️';
  if (hour < 22) return 'Good evening 🌙';
  return 'Winding down? 🌙';
}

const COLOR_HEX = { coral: '#ff6b5e', orange: '#ff9f43', sun: '#f7c331', green: '#2fbf71', teal: '#14b8a6', blue: '#3d8bfd', violet: '#8b6cf6', pink: '#f25ca8', slate: '#7c8aa0' };
let poppedItemId = null; // the item just completed, so its ring plays a little pop

// All status changes go through here so finishing a list gets celebrated.
function setStatus(listId, itemId, status, { tapped = false } = {}) {
  const before = store.getList(listId);
  if (!before) return;
  const wasDone = before.items.length > 0 && before.items.every((i) => i.status === 'complete');
  if (status === 'complete') {
    poppedItemId = itemId;
    if (tapped) haptic();
  }
  store.updateItem(listId, itemId, { status });
  const list = store.getList(listId);
  const nowDone = list.items.length > 0 && list.items.every((i) => i.status === 'complete');
  if (nowDone && !wasDone) {
    confetti([COLOR_HEX[list.color], '#ffd166', '#06d6a0', '#ef476f', '#118ab2']);
    toast(`${list.emoji || '🎉'} “${list.name}” is all done!`);
  }
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
  setScreenColor(null);
  topbar.classList.remove('scrolled');
  topbar.replaceChildren(h('div', { class: 'topbar-row' },
    h('div', { class: 'topbar-side' }),
    h('div', { class: 'topbar-title' }, 'Lists'),
    h('div', { class: 'topbar-side end' }, glassButton('more', 'More options', homeMenu)),
  ));

  const largeTitle = h('h1', { class: 'large-title' }, 'Lists');
  const overview = h('p', { class: 'large-sub' });
  const smartTiles = h('div', { class: 'smart-tiles' });
  main.replaceChildren(
    h('p', { class: 'eyebrow' }, greeting()),
    largeTitle,
    overview,
    installHint(),
    smartTiles,
    h('div', { class: 'toolbar' },
      searchField('Search lists and items', (v) => { query = v; fill(); }),
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
      results.replaceChildren(emptyState('🌱', 'A fresh start', 'Tap + to plant your first list.'));
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

    // Searching also finds items in every list.
    if (q) {
      const hits = store.searchItems(query);
      if (hits.length) {
        out.push(h('section', { class: 'item-group search-items' },
          h('h2', { class: 'section-title' }, 'Items', h('span', { class: 'section-count' }, hits.length)),
          h('ul', { class: 'rows items' }, hits.map(({ list, item }) => itemRow(list.id, item, { showList: true })))));
      }
    }

    if (!out.length) out.push(emptyState('🔍', 'No matches', `Nothing matches “${query.trim()}”.`));
    else if (!q) {
      out.push(h('button', { type: 'button', class: 'text-btn new-folder', onclick: newFolder }, icon('folderPlus'), 'New folder'));
    }
    results.replaceChildren(...out);
  }

  return {
    update() {
      sortLabel.textContent = store.LIST_SORTS.find((s) => s.id === store.getState().prefs.listSort).short;
      overview.textContent = homeOverview();
      fillSmartTiles(smartTiles);
      fill();
    },
  };
}

// Reminders-style tiles for the Today and Upcoming views.
function fillSmartTiles(el) {
  const c = store.dueCounts();
  const tile = (id, iconName, label, count, note, warn) => h('button', {
    type: 'button', class: `smart-tile smart-${id}`, onclick: () => { location.hash = `#/${id}`; },
  },
    h('span', { class: 'smart-top' }, h('span', { class: 'smart-icon' }, icon(iconName)), h('span', { class: 'smart-count' }, count)),
    h('span', { class: 'smart-label' }, label),
    note ? h('span', { class: `smart-note${warn ? ' warn' : ''}` }, note) : null);
  el.replaceChildren(
    tile('today', 'star', 'Today', c.today + c.overdue, c.overdue ? `${c.overdue} overdue` : c.today ? 'Due today' : 'All clear', c.overdue > 0),
    tile('upcoming', 'calendar', 'Upcoming', c.upcoming, c.upcoming ? 'Scheduled' : 'Nothing scheduled', false),
  );
}

function homeOverview() {
  const lists = store.getState().lists;
  if (!lists.length) return 'Nothing on your plate yet.';
  const t = { in_progress: 0, open: 0 };
  for (const l of lists) {
    for (const i of l.items) {
      if (i.status === 'in_progress') t.in_progress++;
      if (i.status !== 'complete') t.open++;
    }
  }
  if (!t.open) return 'Everything’s done. Nice work! 🎉';
  const parts = [`${t.open} to do`];
  if (t.in_progress) parts.push(`${t.in_progress} in progress`);
  return `${parts.join(' · ')} across ${plural(lists.length, 'list')}`;
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
  if (c.overdue) parts.push(`${c.overdue} overdue ⚠️`);
  return parts.join(' · ');
}

function listRow(list) {
  const c = store.counts(list);
  // A button rather than a link, so a long press opens our menu instead of Safari's link preview.
  const open = h('button', { type: 'button', class: 'row-main', onclick: () => openList(list.id) },
    listTile(list, c),
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

function lookFields(list) {
  return [
    { name: 'emoji', label: 'Emoji', type: 'emoji', value: list ? list.emoji : '', options: store.EMOJI_CHOICES },
    {
      name: 'color', label: 'Color', type: 'colors', value: list ? list.color : store.nextColor(),
      options: store.LIST_COLORS.map((c) => ({ value: c.id, label: c.label })),
    },
  ];
}

async function newList(folderId) {
  const fields = [{ name: 'name', label: 'Name', placeholder: 'e.g. Groceries', required: true }, ...lookFields(null)];
  if (store.getState().folders.length) {
    fields.push({ name: 'folderId', label: 'Folder', type: 'select', options: folderOptions(), value: folderId || '' });
  }
  const v = await formDialog({ title: 'New list', fields, okLabel: 'Create' });
  if (!v) return;
  const list = store.createList(v.name, v.folderId || folderId || null, { color: v.color, emoji: v.emoji });
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
      { label: 'Edit name, emoji & color', value: 'rename' },
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
  const v = await formDialog({
    title: 'Edit list',
    fields: [{ name: 'name', label: 'Name', value: list.name, required: true }, ...lookFields(list)],
  });
  if (v) store.updateList(id, { name: v.name, emoji: v.emoji, color: v.color });
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

// ================= Today and Upcoming: items with due dates from every list =================

function mountSmart(kind) {
  const isToday = kind === 'today';
  const name = isToday ? 'Today' : 'Upcoming';
  const subtitle = h('p', { class: 'large-sub' });
  const itemsEl = h('div');

  document.title = name;
  setScreenColor(isToday ? 'coral' : 'blue');
  topbar.classList.remove('scrolled');
  topbar.replaceChildren(h('div', { class: 'topbar-row' },
    h('div', { class: 'topbar-side' },
      h('button', { type: 'button', class: 'glass-btn back-btn', onclick: goHome }, icon('back'), h('span', {}, 'Lists'))),
    h('div', { class: 'topbar-title' }, name),
    h('div', { class: 'topbar-side end' }),
  ));
  const largeTitle = h('h1', { class: 'large-title' },
    h('span', { class: `tile tile-lg c-${isToday ? 'coral' : 'blue'}` }, icon(isToday ? 'star' : 'calendar')), name);
  main.replaceChildren(largeTitle, subtitle, itemsEl);
  collapseTitleOnScroll(largeTitle);

  const section = (title, entries, cls = '') => h('section', { class: 'item-group' },
    h('h2', { class: `section-title ${cls}` }, title, h('span', { class: 'section-count' }, entries.length)),
    h('ul', { class: 'rows items' }, entries.map(({ list, item }) => itemRow(list.id, item, { showList: true }))));

  return {
    update() {
      const t = today();
      const all = store.dueItems();
      const out = [];
      if (isToday) {
        const overdue = all.filter(({ item }) => item.due < t && item.status !== 'complete');
        const due = all.filter(({ item }) => item.due === t)
          .sort((a, b) => (a.item.status === 'complete') - (b.item.status === 'complete'));
        const left = due.filter(({ item }) => item.status !== 'complete').length;
        subtitle.textContent = `${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`
          + (overdue.length + left ? ` · ${overdue.length + left} to do` : '');
        if (overdue.length) out.push(section('Overdue', overdue, 'overdue'));
        if (due.length) out.push(section('Due today', due));
        if (!out.length) out.push(emptyState('☀️', 'Nothing due today', 'Enjoy it. Give items a due date and they show up here.'));
      } else {
        const later = all.filter(({ item }) => item.due > t && item.status !== 'complete');
        subtitle.textContent = later.length ? `${plural(later.length, 'item')} scheduled` : 'Nothing scheduled';
        const days = [...new Set(later.map(({ item }) => item.due))];
        for (const day of days) {
          const entries = later.filter(({ item }) => item.due === day);
          const n = Math.round((new Date(`${day}T00:00`) - new Date(`${t}T00:00`)) / 86400000);
          const label = n <= 6 ? dueLabel(day) : new Date(`${day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
          out.push(section(label, entries));
        }
        if (!out.length) out.push(emptyState('🗓️', 'Nothing scheduled', 'Items with a future due date show up here, by day.'));
      }
      itemsEl.replaceChildren(...out);
    },
  };
}

// ================= List screen: items =================

function mountList(id) {
  let query = '';
  const smallTitle = h('div', { class: 'topbar-title' });
  const titleText = h('span');
  const pieSlot = h('span', { class: 'title-tile' });
  const subtitle = h('p', { class: 'large-sub' });
  const progressFill = h('span');
  const progressBar = h('div', { class: 'list-progress', 'aria-hidden': 'true' }, progressFill);
  const doneBanner = h('div', { class: 'done-banner', hidden: true },
    h('span', { class: 'done-emoji', 'aria-hidden': 'true' }, '🎉'),
    h('span', {}, h('strong', {}, 'All done!'), ' Every item here is complete.'));
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
    progressBar,
    doneBanner,
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
      itemsEl.replaceChildren(emptyState(list.emoji || '✨', 'Nothing here yet', 'Tap + and add the first thing.'));
      return;
    }
    const q = query.trim().toLocaleLowerCase();
    const filter = list.statusFilter;
    const visible = list.items.filter((i) => (!filter.length || filter.includes(i.status))
      && (!q || i.text.toLocaleLowerCase().includes(q) || i.notes.toLocaleLowerCase().includes(q)));
    if (!visible.length) {
      itemsEl.replaceChildren(emptyState('🔍', 'Nothing matches', 'Try a different search or status filter.'));
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
      // Any order except the status groups can be rearranged by dragging; doing so switches the list to "My order".
      const canSort = sorted.length > 1;
      const ul = h('ul', { class: 'rows items' }, sorted.map((i) => itemRow(id, i, { sortable: canSort })));
      if (canSort) {
        makeSortable(ul, {
          onStart: haptic,
          onMove: (ids) => {
            const wasManual = store.getList(id).sort === 'manual';
            store.reorderItems(id, ids);
            if (!wasManual) toast('Switched to your own order');
          },
        });
      }
      itemsEl.replaceChildren(ul);
    }
  }

  return {
    update() {
      const list = store.getList(id);
      if (!list) { location.replace('#/'); return; }
      const c = store.counts(list);
      document.title = list.name;
      setScreenColor(list.color);
      titleText.textContent = list.name;
      smallTitle.textContent = list.name;
      pieSlot.replaceChildren(listTile(list, c, 'lg'));
      const folder = list.folderId ? store.getFolder(list.folderId) : null;
      subtitle.textContent = [folder?.name, listSummary(c)].filter(Boolean).join(' · ');
      progressFill.style.width = `${c.total ? Math.round((c.complete / c.total) * 100) : 0}%`;
      progressBar.hidden = !c.total;
      doneBanner.hidden = !(c.total && c.complete === c.total);
      sortLabel.textContent = store.ITEM_SORTS.find((s) => s.id === list.sort).short;
      fillChips(list);
      fillItems();
    },
  };
}

// One item. showList adds the list's name (used in Today, Upcoming and search results).
function itemRow(listId, item, { sortable = false, showList = false } = {}) {
  const status = store.statusInfo(item.status);
  const done = item.status === 'complete';
  const popped = poppedItemId === item.id;
  if (popped) poppedItemId = null;
  const list = store.getList(listId);
  const steps = item.subtasks;
  const stepsDone = steps.filter((s) => s.done).length;
  const open = expanded.has(item.id) && steps.length > 0;
  const toggleSteps = () => {
    if (expanded.has(item.id)) expanded.delete(item.id); else expanded.add(item.id);
    current?.update();
  };

  const meta = h('div', { class: 'item-meta' },
    h('button', {
      type: 'button', class: 'item-status', 'aria-label': `Status: ${status.label}. Tap to change.`,
      onclick: () => pickStatus(listId, item.id),
    }, h('span', { class: 'dot' }), status.label),
    item.due ? h('button', {
      type: 'button', class: `meta-chip due due-${done ? 'done' : dueState(item.due)}`, 'aria-label': `Due ${dueLabel(item.due)}. Tap to change.`,
      onclick: () => pickDue(listId, item.id),
    }, icon('calendar'), dueLabel(item.due)) : null,
    steps.length ? h('button', {
      type: 'button', class: `meta-chip steps${stepsDone === steps.length ? ' all-done' : ''}`, 'aria-expanded': String(open),
      'aria-label': `${stepsDone} of ${steps.length} steps done. Tap to ${open ? 'hide' : 'show'}.`, onclick: toggleSteps,
    }, icon('steps'), `${stepsDone}/${steps.length}`) : null,
    showList && list ? h('button', { type: 'button', class: `meta-chip from-list c-${list.color}`, onclick: () => openList(listId) },
      list.emoji ? `${list.emoji} ` : '', list.name) : null,
  );

  const stepsEl = open ? h('ul', { class: 'steps-inline' },
    steps.map((s) => h('li', { class: s.done ? 'done' : '' },
      h('button', {
        type: 'button', class: `sub-check${s.done ? ' done' : ''}`, 'aria-pressed': String(s.done), 'aria-label': s.text,
        onclick: () => toggleStep(listId, item.id, s.id),
      }, icon('check')),
      h('span', { class: 'sub-label' }, s.text))),
    h('li', { class: 'step-add' }, h('input', {
      type: 'text', class: 'sub-text', placeholder: '+ Add a step', 'aria-label': 'Add a step', maxLength: 300, enterkeyhint: 'enter',
      onkeydown: (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        store.addSubtask(listId, item.id, e.target.value);
        document.querySelector(`[data-id="${CSS.escape(item.id)}"] .step-add input`)?.focus();
      },
    }))) : null;

  const inner = h('div', { class: 'item-inner' },
    h('button', {
      type: 'button', class: 'check', 'aria-label': done ? `Mark “${item.text}” not complete` : `Mark “${item.text}” complete`,
      onclick: () => setStatus(listId, item.id, done ? 'not_started' : 'complete', { tapped: true }),
    }, h('span', { class: 'ring' }, done ? icon('check') : null)),
    h('div', { class: 'item-body' },
      h('button', { type: 'button', class: 'item-main', onclick: () => editItem(listId, item.id) },
        h('span', { class: 'item-text' }, item.text),
        item.notes ? h('span', { class: 'item-notes' }, item.notes) : null),
      meta,
      stepsEl,
    ),
    sortable ? h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip')) : null,
  );

  const row = h('li', { class: `item s-${item.status}${popped ? ' pop' : ''}`, dataset: { id: item.id } },
    h('div', { class: 'swipe-bg', 'aria-hidden': 'true' },
      h('span', { class: 'swipe-act act-right' }, icon(done ? 'back' : 'check'), done ? 'Undo' : 'Done'),
      h('span', { class: 'swipe-act act-left' }, 'Delete', icon('trash'))),
    inner,
  );
  onLongPress(row, () => itemMenu(listId, item.id));
  makeSwipeable(row, inner, {
    onRight: () => setStatus(listId, item.id, done ? 'not_started' : 'complete', { tapped: true }),
    onLeft: () => deleteItem(listId, item.id),
  });
  return row;
}

function deleteItem(listId, itemId) {
  const removed = store.removeItems(listId, (i) => i.id === itemId);
  toast('Item deleted', { actionLabel: 'Undo', onAction: () => store.restoreItems(listId, removed) });
}

function toggleStep(listId, itemId, subId) {
  const steps = store.toggleSubtask(listId, itemId, subId);
  const item = store.getItem(listId, itemId);
  if (steps.length && steps.every((s) => s.done) && item.status !== 'complete') {
    toast('All steps done!', { actionLabel: 'Complete item', onAction: () => setStatus(listId, itemId, 'complete') });
  }
}

async function pickDue(listId, itemId) {
  const item = store.getItem(listId, itemId);
  if (!item) return;
  const choice = await actionSheet({
    title: item.due ? `Due ${dueLabel(item.due)}` : 'Set a due date',
    actions: [
      ...quickDates().map((q) => ({ label: q.label, value: q.value, checked: q.value === item.due })),
      { label: 'Pick a date…', value: '__pick__' },
      item.due ? { label: 'Remove due date', value: '__none__', danger: true } : null,
    ].filter(Boolean),
  });
  if (!choice) return;
  if (choice === '__pick__') {
    const v = await formDialog({ title: 'Due date', fields: [{ name: 'due', label: 'Date', type: 'date', value: item.due || today() }] });
    if (v) store.updateItem(listId, itemId, { due: v.due });
  } else store.updateItem(listId, itemId, { due: choice === '__none__' ? '' : choice });
}

// Move one item to the start or end of the list, in "My order".
function moveItemToEdge(listId, itemId, edge) {
  const list = store.getList(listId);
  const ids = store.sortItems(list.items, list.sort).map((i) => i.id).filter((i) => i !== itemId);
  if (edge === 'top') ids.unshift(itemId); else ids.push(itemId);
  store.reorderItems(listId, ids);
}

// Long-press menu for an item: change status, edit, or delete.
async function itemMenu(listId, itemId) {
  const item = store.getItem(listId, itemId);
  if (!item) return;
  const choice = await actionSheet({
    title: item.text,
    actions: [
      ...store.STATUSES.map((s) => ({ label: s.label, value: s.id, checked: s.id === item.status })),
      { label: item.due ? `Due date: ${dueLabel(item.due)}` : 'Set due date…', value: '__due__' },
      { label: 'Move to top', value: '__top__' },
      { label: 'Move to bottom', value: '__bottom__' },
      { label: 'Edit…', value: '__edit__' },
      { label: 'Delete', value: '__delete__', danger: true },
    ],
  });
  if (!choice) return;
  if (choice === '__top__' || choice === '__bottom__') moveItemToEdge(listId, itemId, choice === '__top__' ? 'top' : 'bottom');
  else if (choice === '__due__') pickDue(listId, itemId);
  else if (choice === '__edit__') editItem(listId, itemId);
  else if (choice === '__delete__') deleteItem(listId, itemId);
  else if (choice !== item.status) setStatus(listId, itemId, choice);
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

  // Due date: quick chips plus the native date picker. It sticks between items, like the status.
  const dueInput = h('input', { type: 'date', class: 'chip date-input', 'aria-label': 'Due date' });
  const dueRow = h('div', { class: 'quick-statuses quick-due', role: 'group', 'aria-label': 'Due date' });
  const fillDue = () => dueRow.replaceChildren(
    h('span', { class: 'quick-due-icon' }, icon('calendar')),
    h('button', { type: 'button', class: `chip${dueInput.value ? '' : ' active'}`, onclick: () => { dueInput.value = ''; fillDue(); input.focus(); } }, 'No date'),
    ...quickDates().map((q) => h('button', {
      type: 'button', class: `chip${dueInput.value === q.value ? ' active' : ''}`,
      onclick: () => { dueInput.value = q.value; fillDue(); input.focus(); },
    }, q.label)),
    dueInput,
  );
  dueInput.addEventListener('change', fillDue);
  fillDue();

  let close;
  const form = h('form', {
    class: 'quick-add', role: 'dialog', 'aria-label': 'Add item',
    onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) { close(); return; }
      store.addItem(listId, text, { status, due: dueInput.value });
      added++;
      const cheers = ['Got it ✓', 'Keep going!', 'On a roll 🔥', 'Nice and tidy ✨', 'Look at you go 🚀'];
      counter.textContent = `${plural(added, 'item')} added · ${cheers[Math.min(added - 1, cheers.length - 1)]}`;
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
    dueRow,
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
  if (choice && choice !== item.status) setStatus(listId, itemId, choice);
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
      { name: 'due', label: 'Due date', type: 'date', value: item.due },
      { name: 'subtasks', label: 'Steps', type: 'subtasks', value: item.subtasks },
      { name: 'notes', label: 'Notes', type: 'textarea', value: item.notes, placeholder: 'Optional' },
    ],
    extraActions: [{ label: 'Delete', value: 'delete', danger: true }],
  });
  if (!v) return;
  if (v._action === 'delete') {
    deleteItem(listId, itemId);
    return;
  }
  const patch = {};
  for (const key of ['text', 'notes', 'due']) if (v[key] !== item[key]) patch[key] = v[key];
  if (JSON.stringify(v.subtasks.map((s) => [s.text, s.done])) !== JSON.stringify(item.subtasks.map((s) => [s.text, s.done]))) {
    patch.subtasks = v.subtasks;
  }
  if (Object.keys(patch).length) store.updateItem(listId, itemId, patch);
  if (v.status !== item.status) setStatus(listId, itemId, v.status);
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
  canStart: () => route().view !== 'home' && !overlayRoot.childElementCount,
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
