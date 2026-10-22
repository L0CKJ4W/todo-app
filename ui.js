// Small DOM helpers: element builder, icons, dialogs, action sheets and toasts.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [key, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (key === 'class') el.className = v;
    else if (key === 'value') value = v; // set after children so <select> has its options
    else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
    else if (key in el && typeof v !== 'string') el[key] = v;
    else el.setAttribute(key, v === true ? '' : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  if (value !== undefined) el.value = value;
  return el;
}

const ICONS = {
  more: '<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 11v6M9 14h6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  sort: '<path d="M7 4v16M3.5 7.5L7 4l3.5 3.5M17 20V4M13.5 16.5L17 20l3.5-3.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
};

// Things-style progress pie: a ring with a filled wedge for the share of items done.
export function progressPie(done, total) {
  const span = document.createElement('span');
  span.className = 'pie';
  span.setAttribute('aria-hidden', 'true');
  const frac = total ? done / total : 0;
  if (total && done === total) {
    span.classList.add('pie-full');
    span.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return span;
  }
  // The wedge is a thick stroke on a small circle; dasharray sets how much of it shows.
  const r = 4.5;
  const c = 2 * Math.PI * r;
  span.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" stroke-width="1.75"/>`
    + `<circle cx="12" cy="12" r="${r}" fill="none" stroke="currentColor" stroke-width="${r * 2}" stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 12 12)"/></svg>`;
  return span;
}

export function icon(name) {
  const span = document.createElement('span');
  span.className = `icon icon-${name}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---- Overlays ----

const stack = [];

export function openOverlay(panel, { kind, onDismiss }) {
  const backdrop = h('div', { class: `overlay overlay-${kind}` }, panel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) onDismiss(); });
  document.getElementById('overlay-root').append(backdrop);
  const entry = { onDismiss };
  stack.push(entry);

  // iOS Safari doesn't shrink the page for the keyboard, so fit the overlay to the visible area
  // to keep bottom sheets above the keyboard.
  const vv = window.visualViewport;
  const fit = () => {
    backdrop.style.top = `${vv.offsetTop}px`;
    backdrop.style.height = `${vv.height}px`;
  };
  if (vv) {
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
  }

  backdrop.getBoundingClientRect(); // so the fade-in transition runs
  backdrop.classList.add('open');
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (vv) {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    }
    backdrop.remove();
  };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].onDismiss();
});

// fields: [{ name, label, type: 'text' | 'textarea' | 'select', value, placeholder, required, options }]
// Resolves to { ...values, _action } or null when cancelled.
export function formDialog({ title, fields, okLabel = 'Save', extraActions = [] }) {
  return new Promise((resolve) => {
    const inputs = {};
    const rows = fields.map((f) => {
      let input;
      if (f.type === 'select') {
        input = h('select', { class: 'field', value: f.value ?? '' },
          f.options.map((o) => h('option', { value: o.value }, o.label)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { class: 'field', rows: 3, placeholder: f.placeholder || '', value: f.value ?? '' });
      } else {
        input = h('input', { type: 'text', class: 'field', placeholder: f.placeholder || '', value: f.value ?? '', autocomplete: 'off', maxLength: 500 });
      }
      input.addEventListener('input', () => input.classList.remove('invalid'));
      inputs[f.name] = input;
      return h('label', { class: 'form-row' }, h('span', { class: 'form-label' }, f.label), input);
    });

    const collect = () => {
      const out = {};
      for (const f of fields) out[f.name] = f.type === 'select' ? inputs[f.name].value : inputs[f.name].value.trim();
      return out;
    };
    let close;
    const finish = (value) => { close(); resolve(value); };

    const form = h('form', {
      class: 'dialog', role: 'dialog', 'aria-label': title,
      onsubmit: (e) => {
        e.preventDefault();
        const out = collect();
        const missing = fields.find((f) => f.required && !out[f.name]);
        if (missing) {
          inputs[missing.name].classList.add('invalid');
          inputs[missing.name].focus();
          return;
        }
        finish({ ...out, _action: 'save' });
      },
    },
      h('h2', { class: 'dialog-title' }, title),
      rows,
      h('div', { class: 'dialog-actions' },
        extraActions.map((a) => h('button', {
          type: 'button', class: `btn btn-extra${a.danger ? ' btn-danger' : ''}`,
          onclick: () => finish({ ...collect(), _action: a.value }),
        }, a.label)),
        h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, okLabel),
      ),
    );
    close = openOverlay(form, { kind: 'dialog', onDismiss: () => finish(null) });

    const first = fields.find((f) => f.type !== 'select');
    if (first) inputs[first.name].focus();
  });
}

export function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let close;
    const finish = (v) => { close(); resolve(v); };
    const ok = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, onclick: () => finish(true) }, okLabel);
    const panel = h('div', { class: 'dialog', role: 'alertdialog', 'aria-label': title },
      h('h2', { class: 'dialog-title' }, title),
      message ? h('p', { class: 'dialog-message' }, message) : null,
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => finish(false) }, 'Cancel'),
        ok,
      ),
    );
    close = openOverlay(panel, { kind: 'dialog', onDismiss: () => finish(false) });
    ok.focus();
  });
}

// actions: [{ label, value, danger, checked }]. Resolves to the chosen value, or null when cancelled.
export function actionSheet({ title, actions }) {
  return new Promise((resolve) => {
    let close;
    const finish = (v) => { close(); resolve(v); };
    const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title || 'Options' },
      h('div', { class: 'sheet-group sheet-scroll' },
        title ? h('div', { class: 'sheet-title' }, title) : null,
        actions.map((a) => h('button', {
          type: 'button', class: `sheet-btn${a.danger ? ' danger' : ''}`,
          'aria-current': a.checked ? 'true' : null,
          onclick: () => finish(a.value),
        }, h('span', {}, a.label), a.checked ? icon('check') : null)),
      ),
      h('div', { class: 'sheet-group' },
        h('button', { type: 'button', class: 'sheet-btn sheet-cancel', onclick: () => finish(null) }, 'Cancel')),
    );
    close = openOverlay(panel, { kind: 'sheet', onDismiss: () => finish(null) });
  });
}

// ---- Toast ----

let toastEl = null;
let toastTimer = 0;

export function toast(message, { actionLabel, onAction } = {}) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', {}, message),
    actionLabel ? h('button', {
      type: 'button', class: 'toast-action',
      onclick: () => { el.remove(); clearTimeout(toastTimer); onAction(); },
    }, actionLabel) : null,
  );
  document.body.append(el);
  toastEl = el;
  toastTimer = setTimeout(() => el.remove(), actionLabel ? 5000 : 2500);
}
