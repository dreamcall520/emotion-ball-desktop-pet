(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DetailsPopovers = api.bind(root.document, root);
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  function bind(document, host) {
    const closeAll = () => { for (const help of document.querySelectorAll('.chart-help[open]')) help.open = false; };
    document.addEventListener('visibilitychange', () => { if (document.hidden) closeAll(); });
    document.addEventListener('click', event => { if (event.target?.closest?.('#details-close')) closeAll(); }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAll(); }, true);
    host.addEventListener('pagehide', closeAll);
    return { closeAll };
  }
  return { bind };
});
