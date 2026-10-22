// Touch gestures that make the web app behave like a native iOS app.

// Press and hold (or right-click) runs fn and swallows the tap that would follow.
// Adds a "pressed" class while the finger is down, like a native cell highlight.
export function onLongPress(el, fn, { delay = 450 } = {}) {
  let timer = 0;
  let fired = false;
  let startX = 0;
  let startY = 0;
  const cancel = () => {
    clearTimeout(timer);
    el.classList.remove('pressed');
  };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest?.('.drag-handle')) return;
    fired = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    el.classList.add('pressed');
    timer = setTimeout(() => {
      fired = true;
      el.classList.remove('pressed');
      fn();
    }, delay);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (Math.hypot(t.clientX - startX, t.clientY - startY) > 8) cancel();
  }, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('click', (e) => {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!fired) fn();
  });
}

// Swipe a row sideways, as in Mail and Reminders: right runs onRight, left runs onLeft.
// `inner` slides; the row's .swipe-bg shows the action underneath and lights up once
// the swipe is far enough to count.
export function makeSwipeable(row, inner, { onRight, onLeft }) {
  const ARM = 90;
  let start = null;
  let active = false;
  let dx = 0;
  let swallowClick = false;

  const setSide = (side) => {
    row.classList.toggle('swipe-right', side === 'right');
    row.classList.toggle('swipe-left', side === 'left');
  };

  row.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    // Leave the left edge to swipe-back and the grip to dragging.
    if (e.touches.length !== 1 || t.clientX < 32 || e.target.closest('.drag-handle, input, textarea')) return;
    start = { x: t.clientX, y: t.clientY };
    active = false;
    dx = 0;
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    const mx = t.clientX - start.x;
    const my = t.clientY - start.y;
    if (!active) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { start = null; return; }
      if (Math.abs(mx) < 12) return;
      if ((mx > 0 && !onRight) || (mx < 0 && !onLeft)) { start = null; return; }
      active = true;
      row.classList.add('swiping-row', 'pressed-off');
    }
    e.preventDefault();
    const sign = Math.sign(mx);
    const abs = Math.abs(mx);
    dx = sign * (abs < 160 ? abs : 160 + (abs - 160) * 0.3); // rubber-band past 160px
    inner.style.transition = 'none';
    inner.style.transform = `translateX(${dx}px)`;
    setSide(dx > 0 ? 'right' : 'left');
    row.classList.toggle('armed', Math.abs(dx) > ARM);
  }, { passive: false });

  const end = () => {
    if (!start) return;
    start = null;
    if (!active) return;
    active = false;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 350);
    const armed = Math.abs(dx) > ARM;
    inner.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.85, 0.25, 1)';
    const reset = () => {
      inner.style.transform = '';
      setTimeout(() => row.classList.remove('swiping-row', 'armed', 'swipe-left', 'swipe-right', 'pressed-off'), 250);
    };
    if (armed && dx < 0) {
      inner.style.transform = 'translateX(-110%)';
      setTimeout(() => { onLeft(); reset(); }, 200);
    } else if (armed && dx > 0) {
      reset();
      onRight(); // inside the touch event, so the iOS haptic can fire
    } else {
      reset();
    }
  };
  row.addEventListener('touchend', end);
  row.addEventListener('touchcancel', end);
  row.addEventListener('click', (e) => {
    if (!swallowClick) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// Drag rows by their .drag-handle to reorder them. Rows are the list's direct children and carry
// data-id. The dragged row follows the finger, the others slide out of its way, and the page
// scrolls when you drag near the top or bottom. onMove(ids) gets the new order of all rows.
export function makeSortable(listEl, { onStart, onMove }) {
  listEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || e.button !== 0) return;
    const row = handle.closest('[data-id]');
    if (!row || row.parentElement !== listEl) return;
    e.preventDefault();

    const rows = [...listEl.children];
    const from = rows.indexOf(row);
    const rects = rows.map((r) => r.getBoundingClientRect());
    const height = rects[from].height;
    const startY = e.clientY;
    const startScroll = window.scrollY;
    let pointerY = e.clientY;
    let to = from;
    let frame = 0;

    try { handle.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    row.classList.add('dragging');
    listEl.classList.add('sorting');
    onStart?.();

    const layout = () => {
      const dy = pointerY - startY + (window.scrollY - startScroll);
      row.style.transform = `translateY(${dy}px) scale(1.02)`;
      // Positions are compared in the coordinates captured at the start of the drag.
      const center = rects[from].top + height / 2 + dy;
      to = from;
      for (let i = 0; i < from; i++) {
        if (center < rects[i].top + rects[i].height / 2) { to = i; break; }
      }
      for (let i = rows.length - 1; i > from; i--) {
        if (center > rects[i].top + rects[i].height / 2) { to = i; break; }
      }
      rows.forEach((r, i) => {
        if (i === from) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -height;
        if (from > to && i >= to && i < from) shift = height;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    // Scroll the page while the finger rests near the top or bottom edge.
    const autoScroll = () => {
      const edge = 90;
      let speed = 0;
      if (pointerY < edge) speed = -Math.ceil((edge - pointerY) / 8);
      else if (pointerY > window.innerHeight - edge) speed = Math.ceil((pointerY - (window.innerHeight - edge)) / 8);
      if (speed) {
        window.scrollBy(0, speed);
        layout();
      }
      frame = requestAnimationFrame(autoScroll);
    };
    frame = requestAnimationFrame(autoScroll);

    const move = (ev) => {
      pointerY = ev.clientY;
      layout();
    };
    const end = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      listEl.classList.remove('sorting');
      row.classList.remove('dragging');
      if (to !== from) {
        const ids = rows.map((r) => r.dataset.id);
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        onMove(ids); // re-renders the list, so the moved rows are replaced
      } else {
        for (const r of rows) r.style.transform = '';
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

// Swipe in from the left edge to go back. iOS gives Home Screen web apps no back gesture of their own.
// layers: elements that slide with the finger. canStart: whether a swipe may begin now. onBack: navigate back.
export function enableEdgeSwipeBack({ layers, canStart, onBack }) {
  const EDGE = 28;
  let start = null;
  let dragging = false;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;

  const setX = (x, animate) => {
    for (const el of layers()) {
      el.style.transition = animate ? 'transform 0.28s cubic-bezier(0.2, 0.85, 0.25, 1)' : 'none';
      el.style.transform = x ? `translateX(${x}px)` : '';
      el.classList.toggle('swipe-layer', x > 0);
    }
  };

  const finish = () => {
    start = null;
    dragging = false;
    document.documentElement.classList.remove('swiping');
  };

  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || t.clientX > EDGE || !canStart()) return;
    start = { x: t.clientX, y: t.clientY };
    dragging = false;
    lastX = t.clientX;
    lastT = e.timeStamp;
    velocity = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // vertical scroll
      if (dx < 10) return;
      dragging = true;
      document.documentElement.classList.add('swiping');
    }
    e.preventDefault(); // keep the page from scrolling while dragging sideways
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = (t.clientX - lastX) / dt;
    lastX = t.clientX;
    lastT = e.timeStamp;
    setX(Math.max(0, dx), false);
  }, { passive: false });

  const release = () => {
    if (!start) return;
    if (!dragging) { finish(); return; }
    const dx = lastX - start.x;
    const width = window.innerWidth;
    if (dx > width * 0.35 || velocity > 0.45) {
      setX(width, true);
      setTimeout(() => {
        finish();
        onBack(() => setX(0, false)); // the caller resets the layers once the new screen is in place
      }, 260);
    } else {
      setX(0, true);
      start = null;
      dragging = false;
      // Keep the + button hidden until the screen has slid back into place.
      setTimeout(() => { if (!start) document.documentElement.classList.remove('swiping'); }, 280);
    }
  };
  document.addEventListener('touchend', release);
  document.addEventListener('touchcancel', release);
}
