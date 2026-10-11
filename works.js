(() => {
  const dialog = document.getElementById('sticker-dialog');
  const status = dialog.querySelector('[data-sticker-status]');
  let activeShare;
  document.querySelectorAll('[data-sticker-open]').forEach(button => button.addEventListener('click', () => {
    activeShare = button;
    const image = dialog.querySelector('[data-sticker-qr-image]');
    const save = dialog.querySelector('[data-save-sticker]');
    dialog.querySelector('#sticker-dialog-title').textContent = button.dataset.stickerTitle;
    image.src = button.dataset.stickerQr;
    image.alt = `${button.dataset.stickerTitle}微信添加二维码`;
    save.href = button.dataset.stickerQr;
    save.download = `${button.dataset.stickerTitle}-微信二维码.png`;
    status.textContent = '';
    dialog.showModal();
  }));
  dialog.querySelector('[data-copy-sticker]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(activeShare.dataset.stickerUrl);
      status.textContent = '表情链接已复制，请在微信中打开。';
    } catch {
      status.textContent = '复制未完成，可保存二维码后在微信中识别。';
    }
  });
  const images = document.querySelectorAll('[data-sticker]');
  const toggle = document.querySelector('[data-sticker-toggle]');
  const label = toggle.querySelector('[data-sticker-toggle-label]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  function sync() {
    const playing = !paused && !document.hidden;
    images.forEach(image => {
      const source = playing ? image.dataset.animated : image.dataset.static;
      if (image.getAttribute('src') !== source) image.src = source;
    });
    toggle.setAttribute('aria-pressed', String(paused));
    label.textContent = paused ? '播放动画' : '暂停动画';
  }
  toggle.hidden = false;
  toggle.addEventListener('click', () => { paused = !paused; sync(); });
  reduced.addEventListener('change', event => { if (event.matches) { paused = true; sync(); } });
  document.addEventListener('visibilitychange', sync);
  sync();
})();
