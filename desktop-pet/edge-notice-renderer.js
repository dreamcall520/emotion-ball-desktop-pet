(() => {
  const notice = document.getElementById('notice');
  let previous = null;
  const unsubscribe = window.edgeNotice.onUpdate(value => {
    if (!value || !['text', 'quota'].includes(value.kind)) return;
    document.documentElement.dataset.appearance = ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system';
    document.body.dataset.side = value.side === 'right' ? 'right' : 'left';
    document.body.dataset.kind = value.kind;
    document.getElementById('brand').textContent = value.kind === 'quota' ? 'Codex' : '';
    const status = ['偏低', '紧张', '已用尽'].includes(value.statusLabel) ? ` · ${value.statusLabel}` : '';
    document.getElementById('text').textContent = value.kind === 'quota'
      ? `${value.period} · 剩余 ${value.remaining}%${status}` : value.text;
    if (previous !== value.id) {
      notice.classList.remove('appear');
      void notice.offsetWidth;
      notice.classList.add('appear');
      previous = value.id;
    }
  });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
})();
