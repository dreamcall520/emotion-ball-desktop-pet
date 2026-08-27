const { getMotion, sampleMotion, positionForMotion } = require('./interaction-motion');

// 窗口位移与身体姿态共用一个时钟；旧回调只认识自己的状态对象。
function createWindowMotion({ getWindow, getWorkArea, now = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout, sendFrame }) {
  let current = null;

  function stop({ restore = true, notify = true } = {}) {
    const state = current;
    if (!state) return;
    current = null;
    try { cancel(state.timer); } catch (_) { /* 宿主已关闭 */ }
    try {
      if (state.window.isDestroyed()) return;
      if (restore) state.window.setPosition(state.bounds.x, state.bounds.y, false);
    } catch (_) { /* 关闭期间无法再移动 */ }
    if (notify) {
      try {
        if (!state.window.isDestroyed()) sendFrame({ token: state.token, action: state.action,
          frame: sampleMotion(state.action, getMotion(state.action).durationMs) });
      } catch (_) { /* 渲染进程可能已退出 */ }
    }
  }

  function start(request) {
    if (!request || !Number.isSafeInteger(request.token) || request.token <= 0 || !getMotion(request.action)) return false;
    try {
      const window = getWindow();
      if (!window || window.isDestroyed() || !window.isVisible()) return false;
      stop();
      const bounds = { ...window.getBounds() };
      const workArea = { ...getWorkArea(bounds) };
      const startedAt = now();
      if (!Number.isFinite(startedAt) || !positionForMotion(bounds, workArea, { x: 0, y: 0 })) return false;
      const state = { window, bounds, workArea, startedAt, token: request.token, action: request.action, timer: null };
      current = state;
      const next = () => {
        if (current !== state) return;
        try {
          if (window.isDestroyed()) { stop({ restore: false, notify: false }); return; }
          if (!window.isVisible()) { stop(); return; }
          const elapsed = now() - state.startedAt;
          if (!Number.isFinite(elapsed)) { stop(); return; }
          const frame = sampleMotion(state.action, elapsed);
          if (frame.done) { stop(); return; }
          const position = positionForMotion(state.bounds, state.workArea, frame.window);
          window.setPosition(position.x, position.y, false);
          sendFrame({ token: state.token, action: state.action, frame });
          if (current === state) state.timer = schedule(next, 16);
        } catch (_) {
          if (current === state) stop();
        }
      };
      next();
      return current === state;
    } catch (_) {
      stop();
      return false;
    }
  }

  return { start, stop };
}

module.exports = { createWindowMotion };
