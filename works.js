(() => {
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
