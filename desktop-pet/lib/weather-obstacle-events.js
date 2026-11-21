// Only windows that actually affect weather placement may request a layout.
// Native hide/show bursts are one operation, so flush them once after the event.
function createWeatherObstacleWatcher({ getRelevantWindows, reposition, isCurrent = () => true }) {
  const tracked = new WeakSet(); let queued = false, closed = false;
  function queue() {
    if (queued || closed || !isCurrent()) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!closed && isCurrent()) reposition(); });
  }
  return {
    track(win) {
      if (!win || tracked.has(win)) return;
      tracked.add(win);
      let wasRelevant = getRelevantWindows().includes(win);
      for (const event of ['move', 'resize', 'show', 'hide', 'closed']) win.on(event, () => {
        if (closed || !isCurrent()) return;
        const relevant = getRelevantWindows().includes(win);
        if (relevant || event === 'closed' && wasRelevant) queue();
        wasRelevant = relevant;
      });
    },
    close() { closed = true; }
  };
}
module.exports = { createWeatherObstacleWatcher };
