function createActivityMonitor({
  screen, powerMonitor, getWindow, onSample,
  onError = () => {}, clock = () => performance.now()
}) {
  let timer = null;
  let paused = false;
  let lastIdleAt = -Infinity;
  let idleSeconds = null;
  let lastPacket = null;
  let lastErrorAt = -Infinity;

  function report(error) {
    const now = clock();
    if (now - lastErrorAt < 60000) return;
    lastErrorAt = now;
    onError(error);
  }

  function sampleNow(force = false) {
    if (paused) return;
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const now = clock();
    const idleDue = force || now - lastIdleAt >= 1000;
    if (idleDue) {
      lastIdleAt = now;
      try {
        const value = powerMonitor.getSystemIdleTime();
        idleSeconds = Number.isFinite(value) && value >= 0 ? value : null;
      } catch (error) {
        idleSeconds = null;
        report(error);
      }
    }
    try {
      const cursor = screen.getCursorScreenPoint();
      const petBounds = win.getBounds();
      const petDisplay = screen.getDisplayMatching(petBounds);
      const sameDisplay = screen.getDisplayNearestPoint(cursor).id === petDisplay.id;
      const workArea = { ...petDisplay.workArea };
      const packet = { cursor, petBounds, workArea, sameDisplay, idleSeconds, locked: false };
      const changed = !lastPacket || JSON.stringify(packet) !== JSON.stringify(lastPacket);
      if (changed || idleDue) {
        lastPacket = packet;
        onSample(packet);
      }
    } catch (error) {
      report(error);
    }
  }

  return {
    sampleNow,
    start() {
      if (timer) return;
      sampleNow(true);
      timer = setInterval(sampleNow, 125);
      timer.unref?.();
    },
    pause() {
      paused = true;
      onSample({ ...(lastPacket || {}), idleSeconds: null, locked: true });
    },
    resume() {
      paused = false;
      sampleNow(true);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    }
  };
}

function createPowerGuard({ pause, resume }) {
  const blockers = { locked: false, suspended: false };
  const isPaused = () => blockers.locked || blockers.suspended;

  function setBlocked(reason, enabled) {
    const wasPaused = isPaused();
    blockers[reason] = Boolean(enabled);
    const paused = isPaused();
    if (paused === wasPaused) return;
    if (paused) pause();
    else resume();
  }

  return {
    setLocked(enabled) { setBlocked('locked', enabled); },
    setSuspended(enabled) { setBlocked('suspended', enabled); },
    isPaused
  };
}

module.exports = { createActivityMonitor, createPowerGuard };
