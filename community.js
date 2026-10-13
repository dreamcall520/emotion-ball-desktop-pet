(() => {
  const storageKey = 'emotion-ball-site-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const select = document.querySelector('[data-theme-select]');
  function applyTheme(value) {
    if (value === 'auto') delete root.dataset.theme;
    else root.dataset.theme = value;
    const dark = value === 'dark' || (value === 'auto' && system.matches);
    document.querySelectorAll('[data-theme-picture] source').forEach(source => source.media = dark ? 'all' : 'not all');
  }
  let preference = 'auto';
  try { const saved = localStorage.getItem(storageKey); if (['auto','light','dark'].includes(saved)) preference = saved; } catch {}
  select.value = preference;
  applyTheme(preference);
  select.addEventListener('change', () => {
    applyTheme(select.value);
    try { localStorage.setItem(storageKey, select.value); } catch {}
  });
  system.addEventListener('change', () => applyTheme(select.value));
  document.addEventListener('visibilitychange', () => root.classList.toggle('motion-paused', document.hidden));

  const reducedRosterMotion = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-roster]').forEach(group => {
    const viewport = group.querySelector('[data-roster-viewport]');
    const list = viewport.querySelector('.roster-list');
    const toggle = group.querySelector('[data-roster-toggle]');
    if (list.children.length < 2) {
      toggle.closest('.roster-controls').hidden = true;
      group.dataset.rosterPaused = 'true';
      return;
    }
    const fill = () => {
      while (viewport.scrollHeight < viewport.clientHeight + list.scrollHeight) {
        const repeat = list.cloneNode(true);
        repeat.setAttribute('aria-hidden', 'true');
        repeat.inert = true;
        viewport.append(repeat);
      }
    };
    fill();
    new ResizeObserver(fill).observe(viewport);
    const title = group.querySelector('h3').textContent;
    let paused = reducedRosterMotion.matches, visible = false, frame = 0, previous = 0, offset = 0;
    function advance(time) {
      if (previous) {
        offset = (offset + Math.min(time - previous, 64) * .018) % list.scrollHeight;
        viewport.scrollTop = offset;
      }
      previous = time;
      frame = requestAnimationFrame(advance);
    }
    function syncMotion() {
      if (!paused && visible && !document.hidden) {
        if (!frame) {
          previous = 0;
          offset = viewport.scrollTop % list.scrollHeight;
          frame = requestAnimationFrame(advance);
        }
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }
    function setPaused(value) {
      paused = value;
      group.dataset.rosterPaused = String(value);
      toggle.setAttribute('aria-pressed', String(value));
      toggle.title = value ? '继续滚动' : '暂停滚动';
      toggle.setAttribute('aria-label', `${value ? '继续' : '暂停'}滚动：${title}`);
      syncMotion();
    }
    for (const event of ['wheel', 'touchstart', 'pointerdown']) viewport.addEventListener(event, () => setPaused(true), { passive: true });
    viewport.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) setPaused(true);
    });
    toggle.addEventListener('click', () => setPaused(!paused));
    reducedRosterMotion.addEventListener('change', event => { if (event.matches) setPaused(true); });
    document.addEventListener('visibilitychange', syncMotion);
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      syncMotion();
    }).observe(viewport);
    setPaused(paused);
  });

  document.querySelectorAll('[data-dialog-open]').forEach(button => button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.dialogOpen);
    const variant = document.querySelector('input[name="variant"]:checked');
    const style = document.querySelector('input[name="style"]:checked');
    const inquiry = dialog.querySelector('[data-inquiry]');
    if (inquiry) {
      const product = document.querySelector('[data-product-title]');
      inquiry.textContent = `${product.textContent}${style ? ` · ${style.value}` : ''}${variant ? ` · ${variant.value}` : ''} · ¥${product.dataset.productPrice}\n想确认商品细节与发货安排。`;
    }
    const status = dialog.querySelector('[data-copy-status]');
    if (status) status.textContent = '';
    dialog.showModal();
  }));
  document.querySelectorAll('.c-dialog').forEach(dialog => {
    dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
  });
  document.querySelectorAll('[data-pay-channel]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-pay-channel]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-pay-panel]').forEach(panel => panel.hidden = panel.dataset.payPanel !== button.dataset.payChannel);
  }));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-category]').forEach(card => card.hidden = button.dataset.filter !== 'all' && button.dataset.filter !== card.dataset.category);
  }));
  document.querySelectorAll('[data-copy-inquiry], [data-copy-value]').forEach(button => button.addEventListener('click', async () => {
    const dialog = button.closest('dialog');
    const status = dialog.querySelector('[data-copy-status]');
    try {
      await navigator.clipboard.writeText(button.dataset.copyValue || dialog.querySelector('[data-inquiry]').textContent);
      status.textContent = button.dataset.copyValue ? '微信号已复制，可在微信中搜索添加。' : '商品信息已复制，可粘贴到微信。';
    } catch {
      status.textContent = button.dataset.copyValue ? '复制未完成，请长按选择微信号 ooOJBKoo。' : '复制未完成，请长按选择商品信息。';
    }
  }));
  document.querySelectorAll('[data-variant-image]').forEach(input => input.addEventListener('change', () => {
    const image = document.querySelector('[data-product-image]');
    image.src = input.dataset.variantImage;
    image.alt = `${document.querySelector('[data-product-title]').textContent} · ${input.value}设计效果图`;
  }));
  document.querySelectorAll('[data-variant-price]').forEach(input => input.addEventListener('change', () => {
    document.querySelector('[data-product-title]').dataset.productPrice = input.dataset.variantPrice;
    document.querySelector('[data-price-value]').textContent = input.dataset.variantPrice;
  }));
  document.addEventListener('click', event => {
    document.querySelectorAll('.c-mobile[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.c-mobile[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
  });
})();
