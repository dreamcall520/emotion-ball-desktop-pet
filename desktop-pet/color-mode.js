(() => {
  const root = document.documentElement;
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  let appearance = 'system';
  const refreshAppearance = () => {
    root.dataset.accessibleAppearance = appearance === 'system' ? (system?.matches ? 'dark' : 'light') : appearance;
  };
  const apply = (value, preference) => {
    root.dataset.colorMode = value === 'accessible' ? 'accessible' : 'standard';
    appearance = ['light', 'dark'].includes(preference) ? preference : 'system';
    refreshAppearance();
  };
  apply('standard');
  const api = [window.petDesktop, window.petQuotaLabel, window.qiuqiuChat,
    window.petBubble, window.edgeNotice, window.petThought].find(candidate => candidate?.onColorMode);
  if (!api) return;
  const unsubscribe = api.onColorMode(apply);
  system?.addEventListener('change', refreshAppearance);
  window.addEventListener('beforeunload', () => {
    unsubscribe();
    system?.removeEventListener('change', refreshAppearance);
  }, { once: true });
})();
