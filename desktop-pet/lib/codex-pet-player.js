(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CodexPetPlayer = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const FRAME_WIDTH = 192, FRAME_HEIGHT = 208, COLUMNS = 8;
  // Codex's original per-frame timing; unused columns are deliberately skipped.
  const durations = [
    [280,110,110,140,140,320], [120,120,120,120,120,120,120,220],
    [120,120,120,120,120,120,120,220], [140,140,140,280],
    [140,140,140,140,280], [140,140,140,140,140,140,140,240],
    [150,150,150,150,150,260], [120,120,120,120,120,220],
    [150,150,150,150,150,280]
  ];
  const ids = ['idle','run-right','run-left','wave','jump','fail','waiting','running','checking'];
  const names = ['待机','向右跑','向左跑','挥手','跳跃','失败','等待','处理中','检查'];
  const ACTIONS = Object.freeze(ids.map((id, row) => Object.freeze({ id, row, name: names[row],
    frameDurations: Object.freeze(durations[row]), durationMs: durations[row].reduce((sum, ms) => sum + ms, 0) })));

  function validDescriptor(value) {
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 256 ||
        typeof value.name !== 'string' || value.name.length > 200 ||
        !((value.version === 1 && value.rows === 9) || (value.version === 2 && value.rows === 11)) ||
        typeof value.imageURL !== 'string') return false;
    // Only the main process resolves local paths. Never download a sprite URL.
    return /^file:\/\/\//i.test(value.imageURL) || /^data:image\/(?:png|webp);base64,[a-z0-9+/=]+$/i.test(value.imageURL);
  }

  function create(container, options) {
    options = options || {};
    if (!validDescriptor(options.descriptor)) throw new TypeError('Invalid Codex pet descriptor');
    const document = container.ownerDocument;
    const view = document.defaultView;
    const canvas = document.createElement('canvas');
    canvas.className = 'codex-pet-sprite';
    canvas.width = FRAME_WIDTH; canvas.height = FRAME_HEIGHT;
    canvas.setAttribute('role', 'img');
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    canvas.style.maxWidth = '100%'; canvas.style.maxHeight = '100%';
    canvas.style.objectFit = 'contain';
    container.appendChild(canvas);
    const context = canvas.getContext('2d');
    const media = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    let image = null, descriptor = null, loaded = false, destroyed = false, paused = false;
    let action = ACTIONS[0], frame = 0, elapsed = 0, previous = null, request = null;

    function stop() {
      if (request !== null) view.cancelAnimationFrame(request);
      request = null; previous = null;
    }
    function paint() {
      if (destroyed || !loaded) return;
      context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      context.drawImage(image, frame * FRAME_WIDTH, action.row * FRAME_HEIGHT,
        FRAME_WIDTH, FRAME_HEIGHT, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      canvas.dataset.codexAction = action.id;
      canvas.dataset.codexFrame = String(frame);
      options.onFrame?.(action.id, frame);
    }
    function canPlay() { return !destroyed && loaded && !paused && !document.hidden && !media?.matches; }
    function tick(now) {
      request = null;
      if (!canPlay()) { previous = null; return; }
      if (previous !== null) elapsed += Math.max(0, now - previous);
      previous = now;
      // A slow frame advances within one cycle instead of creating a backlog.
      elapsed %= action.durationMs;
      let changed = false;
      while (elapsed >= action.frameDurations[frame]) {
        elapsed -= action.frameDurations[frame];
        frame = (frame + 1) % action.frameDurations.length;
        changed = true;
      }
      if (changed) paint();
      request = view.requestAnimationFrame(tick);
    }
    function syncPlayback() {
      stop();
      if (media?.matches) { frame = elapsed = 0; paint(); }
      if (canPlay()) request = view.requestAnimationFrame(tick);
    }
    function setPet(next) {
      if (destroyed) return false;
      if (!validDescriptor(next)) throw new TypeError('Invalid Codex pet descriptor');
      stop();
      if (image) image.onload = image.onerror = null;
      descriptor = { ...next }; loaded = false; frame = elapsed = 0;
      context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      canvas.dataset.codexPetId = descriptor.id;
      canvas.dataset.codexReady = 'loading';
      canvas.setAttribute('aria-label', descriptor.name);
      const nextImage = new view.Image();
      image = nextImage;
      function failed() {
        if (destroyed || image !== nextImage) return;
        loaded = false; stop(); canvas.dataset.codexReady = 'error';
        options.onError?.(new Error('Codex pet sprite could not be loaded'));
      }
      nextImage.onerror = failed;
      nextImage.onload = function () {
        if (destroyed || image !== nextImage) return;
        if (nextImage.naturalWidth !== FRAME_WIDTH * COLUMNS ||
            nextImage.naturalHeight !== FRAME_HEIGHT * descriptor.rows) { failed(); return; }
        loaded = true; canvas.dataset.codexReady = 'ready'; paint(); syncPlayback();
      };
      nextImage.src = descriptor.imageURL;
      return true;
    }
    function setAction(id) {
      if (destroyed) return false;
      const next = ACTIONS.find(item => item.id === id || item.row === id);
      if (!next) return false;
      if (next === action) return true;
      action = next; frame = elapsed = 0; paint(); syncPlayback();
      return true;
    }
    function setSize(value) {
      if (destroyed || !Number.isFinite(value) || value <= 0 || value > 2048) return false;
      canvas.style.width = `${value * FRAME_WIDTH / FRAME_HEIGHT}px`;
      canvas.style.height = `${value}px`;
      return true;
    }
    function setOpacity(value) {
      if (destroyed || !Number.isFinite(value) || value < 0 || value > 1) return false;
      canvas.style.opacity = String(value);
      return true;
    }
    function pause(value = true) {
      if (destroyed) return;
      const next = Boolean(value);
      if (paused === next) return;
      paused = next; syncPlayback();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; stop();
      document.removeEventListener('visibilitychange', syncPlayback);
      media?.removeEventListener?.('change', syncPlayback);
      image.onload = image.onerror = null;
      image = null; canvas.remove();
    }
    document.addEventListener('visibilitychange', syncPlayback);
    media?.addEventListener?.('change', syncPlayback);
    setSize(options.size ?? 120); setOpacity(options.opacity ?? 1); setPet(options.descriptor);
    return { element: canvas, setPet, setAction, setSize, setOpacity, pause, destroy };
  }

  return Object.freeze({ ACTIONS, FRAME_WIDTH, FRAME_HEIGHT, COLUMNS, validDescriptor, create });
}));
