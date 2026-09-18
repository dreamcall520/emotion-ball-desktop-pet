const EDGE_DISTANCE = 16;
const TUCK_DELAY = 650;
const HOVER_MARGIN = 8;

function contains(bounds, point, margin = 0) {
  return Boolean(bounds && point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= bounds.x - margin && point.x < bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin && point.y < bounds.y + bounds.height + margin);
}

// 原生方窗始终在工作区内；只由页面平移半个球身，不向相邻屏幕泄露内容。
function createEdgeTuck({ getWindow, getWorkArea, onChange = () => {},
  getRetentionBounds = () => [], schedule = setTimeout, cancel = clearTimeout }) {
  let mode = 'free', side = null, dragging = false, paused = false, disposed = false;
  let pinned = false, timer = null, revision = 0, ignored = null, lastCursor = null;

  function getPresentation() {
    return { mode, side, dragging, suppressed: mode === 'tucked' || mode === 'hidden' || paused };
  }
  function window() {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  }
  function cancelTuck() {
    revision++;
    if (timer !== null) cancel(timer);
    timer = null;
  }
  function setIgnored(value) {
    if (ignored === value) return;
    ignored = value;
    window()?.setIgnoreMouseEvents?.(value, { forward: true });
  }
  function visibleHalf() {
    const bounds = window()?.getBounds();
    if (!bounds) return null;
    return { ...bounds, x: bounds.x + (side === 'right' ? bounds.width / 2 : 0), width: bounds.width / 2 };
  }
  function publish() {
    if (disposed) return;
    if (mode === 'tucked' && !dragging) setIgnored(!contains(visibleHalf(), lastCursor));
    else setIgnored(false);
    onChange(getPresentation());
  }
  function placeAtEdge() {
    const win = window();
    if (!win) return;
    const bounds = win.getBounds(), area = getWorkArea(bounds);
    if (!area) return;
    const x = side === 'left' ? area.x : side === 'right' ? area.x + area.width - bounds.width : bounds.x;
    win.setPosition(Math.round(Math.min(Math.max(x, area.x), Math.max(area.x, area.x + area.width - bounds.width))),
      Math.round(Math.min(Math.max(bounds.y, area.y), Math.max(area.y, area.y + area.height - bounds.height))), false);
  }
  function dock(nextSide) {
    if (disposed || !['left', 'right'].includes(nextSide)) return false;
    cancelTuck(); dragging = false; pinned = false;
    side = nextSide; mode = 'tucked'; placeAtEdge(); publish();
    return true;
  }
  function restore() {
    if (disposed) return;
    cancelTuck(); dragging = false; pinned = false; side = null; mode = 'free';
    placeAtEdge(); publish();
  }
  function sampleCursor(point) {
    lastCursor = point;
    if (disposed || paused || dragging || !side || mode === 'hidden') return;
    if (mode === 'tucked') {
      const hovered = contains(visibleHalf(), point);
      setIgnored(!hovered);
      if (hovered) { cancelTuck(); mode = 'peeked'; publish(); }
      return;
    }
    const retained = pinned || contains(window()?.getBounds(), point, HOVER_MARGIN) ||
      getRetentionBounds().some(bounds => contains(bounds, point, HOVER_MARGIN));
    if (retained) { cancelTuck(); return; }
    if (timer !== null) return;
    const token = ++revision;
    timer = schedule(() => {
      if (token !== revision || disposed || paused || dragging || pinned || mode !== 'peeked') return;
      timer = null; mode = 'tucked'; publish();
    }, TUCK_DELAY);
  }
  return {
    getPresentation, publish, dock, restore, sampleCursor,
    beginDrag() {
      if (disposed || paused || mode === 'hidden') return;
      cancelTuck(); dragging = true;
      if (side) mode = 'peeked';
      publish();
    },
    endDrag(moved) {
      if (disposed || !dragging) return;
      dragging = false;
      if (moved) {
        const bounds = window()?.getBounds(), area = bounds && getWorkArea(bounds);
        if (area && bounds.x - area.x <= EDGE_DISTANCE) return dock('left');
        if (area && area.x + area.width - bounds.x - bounds.width <= EDGE_DISTANCE) return dock('right');
        side = null; mode = 'free';
      }
      publish();
      sampleCursor(lastCursor);
    },
    hide() {
      if (disposed) return;
      cancelTuck(); dragging = false; pinned = false; mode = 'hidden'; publish();
    },
    pin(value) { pinned = Boolean(value); cancelTuck(); if (!pinned) sampleCursor(lastCursor); },
    recover() {
      if (disposed) return;
      cancelTuck(); dragging = false; pinned = false;
      if (side && mode !== 'hidden') mode = 'tucked';
      placeAtEdge(); publish();
    },
    suspend() {
      if (disposed) return;
      cancelTuck(); dragging = false; pinned = false; paused = true;
      if (side && mode !== 'hidden') mode = 'tucked';
      placeAtEdge(); publish();
    },
    resume() { if (!disposed) { paused = false; publish(); } },
    dispose() { cancelTuck(); setIgnored(false); disposed = true; }
  };
}

module.exports = { createEdgeTuck };
