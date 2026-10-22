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
    if (e.touches.length !== 1) return;
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
