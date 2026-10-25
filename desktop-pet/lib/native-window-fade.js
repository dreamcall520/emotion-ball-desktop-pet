// Native opacity keeps card geometry and pointer targets fixed during edge transitions.
function createNativeWindowFade({ onError = () => {}, duration = 180 } = {}) {
  const states = new WeakMap();
  function cancel(target) {
    const state = target && states.get(target);
    if (state) { clearTimeout(state.timer); states.delete(target); }
  }
  function transition(target, showing, animate, done = () => {}) {
    if (!target || target.isDestroyed()) return;
    const previous = states.get(target);
    if (previous?.showing === showing && (showing ? target.isVisible() && (animate || !previous.timer) : animate && previous.timer)) {
      previous.done = done;
      if (showing) target.showInactive();
      return;
    }
    const opacity = previous?.opacity ?? (target.isVisible() ? 1 : 0);
    cancel(target);
    const state = { showing, opacity, timer: null, done };
    states.set(target, state);
    const finish = () => {
      if (states.get(target) !== state || target.isDestroyed()) return;
      state.done();
      if (states.get(target) !== state || target.isDestroyed()) return;
      if (showing) target.setOpacity?.(1);
      else {
        target.hide();
        if (states.get(target) === state && !target.isDestroyed()) target.setOpacity?.(1);
      }
      state.opacity = showing ? 1 : 0; state.timer = null;
    };
    if (!animate || typeof target.setOpacity !== 'function' || (!showing && !target.isVisible())) {
      if (showing) { target.setOpacity?.(1); target.showInactive(); }
      finish(); return;
    }
    const start = Date.now();
    target.setOpacity(opacity);
    if (showing) target.showInactive();
    const tick = () => {
      if (states.get(target) !== state || target.isDestroyed()) return;
      try {
        const progress = Math.min(1, (Date.now() - start) / duration);
        const eased = 1 - (1 - progress) ** 3;
        state.opacity = opacity + ((showing ? 1 : 0) - opacity) * eased;
        target.setOpacity(state.opacity);
        if (progress === 1) finish(); else state.timer = setTimeout(tick, 16);
      } catch (error) { cancel(target); try { target.hide(); } catch (_) {} onError(error); }
    };
    state.timer = setTimeout(tick, 16);
  }
  return {
    show: (target, animate = false) => transition(target, true, animate),
    hide: (target, { animate = false, onHidden } = {}) => transition(target, false, animate, onHidden),
    cancel
  };
}
module.exports = { createNativeWindowFade };
