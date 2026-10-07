/* Palette adapter for the embedded 0.4.00 renderers; appearance stays independent. */
(() => {
  document.documentElement.dataset.uiTheme = 'blue';
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type === 'qiuqiu-demo-theme' && ['green', 'blue'].includes(data.uiTheme)) {
      document.documentElement.dataset.uiTheme = data.uiTheme;
    }
  });
})();
