(() => {
  const root = document.documentElement;
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  let appearance = 'system';
  const refreshAppearance = () => {
    const resolved = appearance === 'system' ? (system?.matches ? 'dark' : 'light') : appearance;
    root.dataset.appearance = resolved;
    root.dataset.accessibleAppearance = resolved;
  };
  const apply = (value, preference, theme) => {
    root.dataset.uiTheme = theme === 'blue' ? 'blue' : 'green';
    const blueStyle = document.getElementById?.('blue-style');
    if (blueStyle) blueStyle.disabled = root.dataset.uiTheme !== 'blue';
    root.dataset.colorMode = value === 'accessible' ? 'accessible' : 'standard';
    appearance = ['light', 'dark'].includes(preference) ? preference : 'system';
    refreshAppearance();
  };
  apply('standard');
  const api = [window.petDesktop, window.petQuotaLabel, window.qiuqiuChat, window.qiuqiuAbout, window.qiuqiuApiUsage, window.qiuqiuApiUsageLabel,
    window.petBubble, window.edgeNotice, window.petThought, window.qiuNotes, window.petCustomizer, window.petCodexDetails].find(candidate => candidate?.onColorMode);
  if (!api) return;
  const unsubscribe = api.onColorMode(apply);
  system?.addEventListener('change', refreshAppearance);
  window.addEventListener('beforeunload', () => {
    unsubscribe();
    system?.removeEventListener('change', refreshAppearance);
  }, { once: true });
})();
