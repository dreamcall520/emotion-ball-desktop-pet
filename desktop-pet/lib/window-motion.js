const InteractionMotion = require('./interaction-motion');
const CompanionMotion = require('./companion-motion');
const { positionForMotion } = InteractionMotion;
const getMotion = action => CompanionMotion.getMotion(action) || InteractionMotion.getMotion(action);
const sampleMotion = (action, elapsed, side) => CompanionMotion.getMotion(action)
  ? CompanionMotion.sample(action, elapsed, side) : InteractionMotion.sampleMotion(action, elapsed);

// 窗口位移与身体姿态共用一个时钟；旧回调只认识自己的状态对象。
function createWindowMotion({ getWindow, getWorkArea, getDisplayId = () => null, now = () => performance.now(),
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
        if (!state.window.isDestroyed()) sendFrame({ token: state.token, action: state.action, side: state.side,
          frame: sampleMotion(state.action, getMotion(state.action).durationMs, state.side) });
      } catch (_) { /* 渲染进程可能已退出 */ }
    }
  }

  // 只刷新仍属于原显示器且可完整归位的工作区；不重启时间线或计时器。
  // 返回 false 时由宿主走原来的停止、归位和显示器恢复路径。
  function refreshWorkArea() {
    const state = current;
    if (!state) return false;
    try {
      const window = state.window;
      if (window !== getWindow() || window.isDestroyed() || !window.isVisible()) return false;
      const bounds = window.getBounds();
      if (bounds.width !== state.bounds.width || bounds.height !== state.bounds.height ||
        getDisplayId(state.bounds) !== state.displayId || getDisplayId(bounds) !== state.displayId) return false;
      const workArea = { ...getWorkArea(state.bounds) };
      const anchor = positionForMotion(state.bounds, workArea, { x: 0, y: 0 });
      if (!anchor || anchor.x !== state.bounds.x || anchor.y !== state.bounds.y) return false;
      const position = positionForMotion(state.bounds, workArea, state.offset);
      state.workArea = workArea;
      // 当前帧立即按新区夹紧；后续帧仍从原始锚点取样并使用新区。
      if (position.x !== bounds.x || position.y !== bounds.y) window.setPosition(position.x, position.y, false);
      return current === state;
    } catch (_) {
      return false;
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
      const state = { window, bounds, workArea, displayId: getDisplayId(bounds), startedAt,
        lastFrameAt: startedAt, visualElapsed: 0, side: request.side === 'left' ? 'left' : 'right',
        reducedMotion: request.reducedMotion === true && Boolean(CompanionMotion.getMotion(request.action)),
        token: request.token, action: request.action, timer: null, offset: { x: 0, y: 0 } };
      current = state;
      const next = () => {
        if (current !== state) return;
        try {
          if (window.isDestroyed()) { stop({ restore: false, notify: false }); return; }
          if (!window.isVisible()) { stop(); return; }
          const frameAt = now();
          let elapsed = frameAt - state.startedAt;
          if (!Number.isFinite(elapsed)) { stop(); return; }
          const maxFrameMs = getMotion(state.action).maxFrameMs;
          if (maxFrameMs && !state.reducedMotion) {
            state.visualElapsed += Math.min(maxFrameMs, Math.max(0, frameAt - state.lastFrameAt));
            elapsed = state.visualElapsed;
          }
          state.lastFrameAt = frameAt;
          const frame = state.reducedMotion
            ? { ...CompanionMotion.neutralFrame(), done: elapsed >= getMotion(state.action).durationMs,
              durationMs: getMotion(state.action).durationMs }
            : sampleMotion(state.action, elapsed, state.side);
          if (frame.done) { stop(); return; }
          const position = positionForMotion(state.bounds, state.workArea, frame.window);
          state.offset = { ...frame.window };
          window.setPosition(position.x, position.y, false);
          sendFrame({ token: state.token, action: state.action, side: state.side, frame });
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

  return { start, stop, refreshWorkArea };
}

module.exports = { createWindowMotion };
