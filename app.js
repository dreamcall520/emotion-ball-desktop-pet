(function initializeWebsite() {
  'use strict';

  const documentRoot = document.documentElement;
  const themeButton = document.querySelector('[data-theme-toggle]');
  const navButton = document.querySelector('.nav-toggle');
  const navigation = document.getElementById('site-nav');
  const toast = document.querySelector('[data-toast]');
  const backToTopButton = document.querySelector('[data-back-to-top]');
  const topSection = document.getElementById('top');
  let toastTimer = null;

  function storedTheme() {
    try {
      const value = window.localStorage.getItem('emotion-ball-site-theme');
      return ['auto', 'light', 'dark'].includes(value) ? value : 'dark';
    } catch (_error) {
      return 'dark';
    }
  }

  function setTheme(theme) {
    if (theme === 'auto') {
      documentRoot.removeAttribute('data-theme');
    } else {
      documentRoot.dataset.theme = theme;
    }
    const labels = { auto: '外观: 系统', light: '外观: 浅色', dark: '外观: 深色' };
    themeButton.textContent = labels[theme];
    themeButton.dataset.themeChoice = theme;
    try {
      window.localStorage.setItem('emotion-ball-site-theme', theme);
    } catch (_error) {
      // 外观偏好保存失败不会影响浏览。
    }
  }

  setTheme(storedTheme());

  themeButton.addEventListener('click', () => {
    const order = ['auto', 'dark', 'light'];
    const current = themeButton.dataset.themeChoice || 'auto';
    setTheme(order[(order.indexOf(current) + 1) % order.length]);
  });

  navButton.addEventListener('click', () => {
    const willOpen = !navigation.classList.contains('is-open');
    navigation.classList.toggle('is-open', willOpen);
    navButton.setAttribute('aria-expanded', String(willOpen));
    navButton.textContent = willOpen ? '关闭' : '菜单';
  });

  for (const link of navigation.querySelectorAll('a')) {
    link.addEventListener('click', () => {
      navigation.classList.remove('is-open');
      navButton.setAttribute('aria-expanded', 'false');
      navButton.textContent = '菜单';
    });
  }

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
