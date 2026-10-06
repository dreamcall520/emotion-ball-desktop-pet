(() => {
  'use strict';

  const panels = [...document.querySelectorAll('[data-release-panel]')];
  const links = [...document.querySelectorAll('[data-release-link]')];
  const picker = document.querySelector('[data-release-select]');
  const status = document.querySelector('[data-release-status]');
  if (!panels.length || !picker || links.length !== panels.length) return;

  const byID = new Map(panels.map(panel => [panel.id, panel]));
  function selectedID() {
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      return byID.has(id) ? id : panels[0].id;
    } catch (_error) {
      return panels[0].id;
    }
  }

  function showVersion(id, announce = false) {
    if (!byID.has(id)) return;
    for (const panel of panels) panel.hidden = panel.id !== id;
    for (const link of links) {
      if (link.hash === `#${id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    picker.value = id;
    if (announce && status) status.textContent = `已显示 ${byID.get(id).querySelector('h3').textContent}`;
  }

  function navigate(id) {
    if (!byID.has(id)) return;
    if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
    showVersion(id, true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  for (const link of links) {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(link.hash.slice(1));
    });
  }
  picker.addEventListener('change', () => navigate(picker.value));
  const restore = () => {
    showVersion(selectedID(), true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  window.addEventListener('hashchange', restore);
  window.addEventListener('popstate', restore);

  showVersion(selectedID());
  document.documentElement.dataset.updatesReady = 'true';
  if (location.hash) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
})();
