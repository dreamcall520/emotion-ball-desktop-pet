/* The published App UI runs in isolated, same-origin example frames. */
(() => {
  const frames = [...document.querySelectorAll('iframe[data-app-demo]')];
  const system = matchMedia('(prefers-color-scheme: dark)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const visible = new WeakMap();
  let paused = false;
  let taskState = 'processing';
  let pendingTaskState = null;
  const taskFrame = frames.find(frame => frame.closest('#codex') && frame.dataset.demo === 'quota');
  let savedAppearance;
  function theme(frame) {
    const preview = frame.closest('[data-appearance-demo]');
    const choice = preview ? preview.dataset.look : 'light';
    return {
      type: 'qiuqiu-demo-theme',
      appearance: choice === 'light' || choice === 'dark' ? choice : system.matches ? 'dark' : 'light',
      colorMode: preview?.dataset.mode === 'accessible' ? 'accessible' : 'standard',
      uiTheme: preview?.dataset.uiTheme === 'green' ? 'green' : 'blue'
    };
  }
  function send(frame, message) { frame.contentWindow?.postMessage(message, location.origin); }
  function motion(frame) { send(frame, { type: 'qiuqiu-demo-motion', paused: paused || reduced.matches || document.hidden || !visible.get(frame) }); }
  function sync() { frames.forEach(frame => send(frame, theme(frame))); }
  for (const frame of frames) frame.addEventListener('load', () => {
    send(frame, theme(frame));
    motion(frame);
    if (frame === taskFrame) { pendingTaskState = taskState; send(frame, { type: 'qiuqiu-demo-task', state: taskState }); }
    if (savedAppearance && frame.dataset.demo === 'chat') send(frame, { type: 'qiuqiu-demo-avatar', appearance: savedAppearance });
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    const frame = frames.find(item => item.contentWindow === event.source);
    if (!frame || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'qiuqiu-demo-ready') {
      send(frame, theme(frame)); motion(frame);
      if (frame === taskFrame) { pendingTaskState = taskState; send(frame, { type: 'qiuqiu-demo-task', state: taskState }); }
    }
    if (frame === taskFrame && event.data.type === 'qiuqiu-demo-task-state' && ['processing', 'completed', 'viewed'].includes(event.data.state)) {
      if (pendingTaskState && event.data.state !== pendingTaskState) return;
      pendingTaskState = null;
      taskState = event.data.state;
      document.dispatchEvent(new CustomEvent('quota-demo-task-state', { detail: { state: taskState } }));
    }
    if (event.data.type === 'qiuqiu-demo-resize') {
      const height = Math.ceil(Number(event.data.height));
      if (Number.isFinite(height) && height >= 180 && height <= 1800 && Math.abs(frame.height - height) > 1) frame.height = String(height);
    }
    if (event.data.type === 'qiuqiu-demo-avatar' && frame.dataset.demo === 'customize') {
      const appearance = event.data.appearance;
      if (!appearance || !['blob', 'cloud', 'square', 'aurora-cloud'].includes(appearance.shape)) return;
      savedAppearance = appearance;
      frames.filter(item => item.dataset.demo === 'chat').forEach(item => send(item, { type: 'qiuqiu-demo-avatar', appearance }));
    }
  });
  const preview = document.querySelector('[data-appearance-demo]');
  if (preview) new MutationObserver(sync).observe(preview, { attributes: true, attributeFilter: ['data-look', 'data-mode', 'data-ui-theme'] });
  system.addEventListener('change', sync);
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { visible.set(entry.target, entry.isIntersecting); motion(entry.target); }));
  frames.forEach(frame => observer.observe(frame));
  const syncMotion = () => frames.forEach(motion);
  reduced.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  document.addEventListener('website-motion-pause', event => { paused = event.detail?.paused === true; syncMotion(); });
  document.addEventListener('website-task-command', event => {
    if (!['processing', 'completed', 'viewed'].includes(event.detail?.state)) return;
    taskState = event.detail.state;
    pendingTaskState = taskState;
    if (taskFrame) send(taskFrame, { type: 'qiuqiu-demo-task', state: taskState });
  });
  sync();
})();
