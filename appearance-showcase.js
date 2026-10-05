/* These controls send appearance choices to the current App renderers. */
(() => {
  const root = document.querySelector('[data-appearance-demo]');
  if (!root) return;
  function render() {
    root.querySelectorAll('[data-ap-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.apMode === root.dataset.mode)));
    root.querySelectorAll('[data-ap-look]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.apLook === root.dataset.look)));
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.apMode) root.dataset.mode = button.dataset.apMode;
    if (button.dataset.apLook) root.dataset.look = button.dataset.apLook;
    render();
  });
  render();
})();
