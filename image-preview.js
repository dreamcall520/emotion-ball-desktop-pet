(() => {
  if (document.querySelector('[data-image-preview-dialog]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'image-preview';
  dialog.dataset.imagePreviewDialog = '';
  dialog.setAttribute('aria-labelledby', 'image-preview-title');
  dialog.innerHTML = `<header class="image-preview-header"><h2 id="image-preview-title">首次打开球球</h2><button class="image-preview-close" type="button" aria-label="关闭图片预览" autofocus><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></header><div class="image-preview-content"><figure class="install-settings"><div class="install-settings-image image-preview-stage"></div></figure></div>`;
  document.body.append(dialog);
  const stage = dialog.querySelector('.image-preview-stage');
  let trigger;

  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    document.documentElement.classList.remove('image-preview-open');
    trigger?.focus({ preventScroll: true });
  });
  document.addEventListener('click', event => {
    const source = event.target.closest('[data-image-preview]');
    if (!source || !source.querySelector('img')) return;
    event.preventDefault();
    trigger = source;
    stage.replaceChildren(...Array.from(source.children)
      .filter(child => ['IMG', 'SVG', 'SPAN'].includes(child.tagName.toUpperCase()))
      .map(child => child.cloneNode(true)));
    const image = stage.querySelector('img');
    image.loading = 'eager';
    stage.style.setProperty('--preview-ratio', (image.width || image.naturalWidth || 1430) / (image.height || image.naturalHeight || 1196));
    document.documentElement.classList.add('image-preview-open');
    if (!dialog.open) dialog.showModal();
  });
})();
