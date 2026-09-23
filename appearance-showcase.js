/* Local, deterministic style preview. No account, network or app settings. */
(() => {
  const root = document.querySelector('[data-appearance-demo]');
  if (!root) return;
  const system = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'accessible', look = 'dark';
  const descriptions = {
    accessible: '色弱友好：实底、高对比文字与蓝黄提示，状态不只靠颜色区分。',
    standard: '标准配色：保留柔和的玻璃质感，额度状态同样有文字提示。'
  };
  function render() {
    root.dataset.mode = mode;
    root.dataset.look = look === 'system' ? (system.matches ? 'dark' : 'light') : look;
    root.querySelectorAll('[data-ap-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.apMode === mode)));
    root.querySelectorAll('[data-ap-look]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.apLook === look)));
    const value = Number(root.querySelector('[data-ap-state]').value);
    const severity = value === 0 ? '已用尽' : value <= 10 ? '紧张' : value <= 20 ? '偏低' : '充足';
    root.dataset.level = value > 20 ? 'normal' : 'warning';
    root.querySelector('[data-ap-value]').textContent = `${value}%`;
    root.querySelector('[data-ap-severity]').textContent = severity;
    root.querySelector('progress').value = value;
    root.querySelector('[data-ap-notice]').textContent = `5 小时剩余 ${value}% · ${severity}`;
    root.querySelector('[data-ap-description]').textContent = descriptions[mode] + (look === 'system' ? ` 当前跟随系统${system.matches ? '深' : '浅'}色。` : '');
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.apMode) mode = button.dataset.apMode;
    if (button.dataset.apLook) look = button.dataset.apLook;
    render();
  });
  root.querySelector('select').addEventListener('change', render);
  system.addEventListener('change', render);
  document.addEventListener('website-motion-pause', event => {
    root.dataset.paused = String(Boolean(event.detail?.paused));
  });
  render();
})();
