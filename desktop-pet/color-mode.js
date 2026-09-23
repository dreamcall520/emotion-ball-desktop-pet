(() => {
  const root = document.documentElement;
  const apply = value => { root.dataset.colorMode = value === 'accessible' ? 'accessible' : 'standard'; };
  apply('standard');
  const api = [window.petDesktop, window.petQuotaLabel, window.qiuqiuChat,
    window.petBubble, window.edgeNotice, window.petThought].find(candidate => candidate?.onColorMode);
  if (!api) return;
  const unsubscribe = api.onColorMode(apply);
  window.addEventListener('beforeunload', unsubscribe, { once: true });
})();
