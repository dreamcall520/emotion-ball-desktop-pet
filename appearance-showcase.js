/* These controls send appearance choices to the current App renderers. */
(() => {
  const root = document.querySelector('[data-appearance-demo]');
  if (!root) return;
  function render() {
    root.querySelectorAll('[data-ap-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.apTheme === root.dataset.uiTheme)));
    root.querySelectorAll('[data-ap-look]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.apLook === root.dataset.look)));
    root.querySelector('[data-ap-contrast]').checked = root.dataset.mode === 'accessible';
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.apTheme) root.dataset.uiTheme = button.dataset.apTheme;
    if (button.dataset.apLook) root.dataset.look = button.dataset.apLook;
    render();
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-ap-contrast]')) root.dataset.mode = event.target.checked ? 'accessible' : 'standard';
  });
  render();
})();
