'use strict';
function createQuotaCardResize({ onError = () => {}, onSettled = () => {} } = {}) {
  const requested = new WeakMap(), pending = new WeakMap();
  function cancel(win) { clearTimeout(pending.get(win)); pending.delete(win); }
  return {
    apply(win, bounds, { animate = false, reducedMotion = false, immediate = false, transitionBounds = null } = {}) {
      const previous = requested.get(win);
      if (previous && ['x', 'y', 'width', 'height'].every(key => previous[key] === bounds[key])) return false;
      cancel(win); requested.set(win, { ...bounds });
      // Leave room for the renderer's unscaled glass boundary to close first.
      const closing = previous && animate && !reducedMotion && !immediate && win.isVisible() && bounds.width <= previous.width && bounds.height <= previous.height && (bounds.width < previous.width || bounds.height < previous.height);
      const guarded = previous && animate && !reducedMotion && !immediate && win.isVisible() && transitionBounds;
      if (guarded) {
        try { win.setBounds(transitionBounds, false); } catch (error) { requested.delete(win); throw error; }
      }
      if (closing || guarded) {
        const timer = setTimeout(() => {
          pending.delete(win);
          if (win.isDestroyed()) return;
          try { win.setBounds(bounds, false); onSettled(); }
          catch (error) { requested.delete(win); try { onError(error); } catch (_) {} }
        }, 200);
        timer.unref?.(); pending.set(win, timer); return true;
      }
      try { win.setBounds(bounds, false); }
      catch (error) { requested.delete(win); throw error; }
      return true;
    },
    forget(win) { if (win) { cancel(win); requested.delete(win); } }
  };
}
module.exports = { createQuotaCardResize };
