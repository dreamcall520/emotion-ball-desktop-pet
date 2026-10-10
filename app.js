(function initializeWebsite() {
  'use strict';

  const documentRoot = document.documentElement;
  const themeButtons = document.querySelectorAll('[data-theme-toggle]');
  const navButton = document.querySelector('.nav-toggle');
  const navigation = document.getElementById('site-nav');
  const channelMenus = document.querySelectorAll('[data-channel-menu]');
  const toast = document.querySelector('[data-toast]');
  const backToTopButton = document.querySelector('[data-back-to-top]');
  const topSection = document.getElementById('top');
  let toastTimer = null;

  function storedTheme() {
    try {
      const value = window.localStorage.getItem('emotion-ball-site-theme');
      return ['auto', 'light', 'dark'].includes(value) ? value : 'light';
    } catch (_error) {
      return 'light';
    }
  }

  function setTheme(theme) {
    if (theme === 'auto') {
      documentRoot.removeAttribute('data-theme');
    } else {
      documentRoot.dataset.theme = theme;
    }
    const labels = { auto: '跟随系统', light: '浅色', dark: '深色' };
    for (const themeButton of themeButtons) {
    themeButton.textContent = `外观：${labels[theme]}`;
    themeButton.setAttribute('aria-label', `切换页面外观，当前${labels[theme]}`);
    themeButton.setAttribute('title', `切换页面外观，当前${labels[theme]}`);
    themeButton.dataset.themeChoice = theme;
    }
    try {
      window.localStorage.setItem('emotion-ball-site-theme', theme);
    } catch (_error) {
      // 外观偏好保存失败不会影响浏览。
    }
  }

  setTheme(storedTheme());

  for (const themeButton of themeButtons) themeButton.addEventListener('click', () => {
    const order = ['auto', 'dark', 'light'];
    const current = themeButton.dataset.themeChoice || 'auto';
    setTheme(order[(order.indexOf(current) + 1) % order.length]);
  });

  function setNavigation(open) {
    navigation.classList.toggle('is-open', open);
    navButton.setAttribute('aria-expanded', String(open));
  }

  navButton.addEventListener('click', () => setNavigation(!navigation.classList.contains('is-open')));

  for (const link of document.querySelectorAll('.site-header a')) {
    link.addEventListener('click', () => {
      setNavigation(false);
    });
  }

  document.addEventListener('click', (event) => {
    if (!navigation.contains(event.target) && !navButton.contains(event.target)) setNavigation(false);
    for (const menu of channelMenus) {
      if (!menu.parentElement.contains(event.target)) menu.open = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
      setNavigation(false);
      navButton.focus();
    }
    if (event.key === 'Escape') for (const menu of channelMenus) {
      if (menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    }
  });

  if (backToTopButton && topSection && 'IntersectionObserver' in window) {
    const topObserver = new IntersectionObserver(([entry]) => {
      const shouldShow = !entry.isIntersecting;
      backToTopButton.classList.toggle('is-visible', shouldShow);
      backToTopButton.setAttribute('aria-hidden', String(!shouldShow));
      backToTopButton.tabIndex = shouldShow ? 0 : -1;
    });

    topObserver.observe(topSection);
    backToTopButton.addEventListener('click', () => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      topSection.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  async function copyValue(value) {
    try {
      await navigator.clipboard.writeText(value);
      showToast('SHA-256 已复制');
    } catch (_error) {
      showToast(`请手动复制: ${value}`);
    }
  }

  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', () => copyValue(button.dataset.copy));
  }

})();
