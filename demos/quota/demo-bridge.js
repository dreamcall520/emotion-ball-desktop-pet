/* In-memory website bridge. The public App renderers receive synthetic models only. */
(() => {
  'use strict';
  const kind = /(?:quota|workbuddy)-label\.html$/.test(location.pathname) ? 'quota' : /(?:codex|workbuddy)-details\.html$/.test(location.pathname) ? 'details' : location.pathname.endsWith('api-usage-label.html') ? 'api-label' : 'api-report';
  let model = null, appearance = 'light', colorMode = 'standard', uiTheme = 'blue', readRequest;
  const listeners = new Set(), colors = new Set();
  const send = (action, extra = {}) => parent.postMessage({ type: 'qiuqiu-quota-action', kind, action, ...extra }, location.origin);
  const listen = (set, fn) => { set.add(fn); return () => set.delete(fn); };
  const theme = () => {
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.accessibleAppearance = appearance;
    document.documentElement.dataset.resolvedAppearance = appearance;
    document.documentElement.dataset.colorMode = colorMode;
    colors.forEach(fn => fn(colorMode, appearance, uiTheme));
  };
  const update = () => {
    theme();
    if (!model) return;
    listeners.forEach(fn => fn({ ...model, appearance, colorMode }));
    const label = document.getElementById('quota-label');
    if (kind === 'quota' && label) {
      if (model.expanded) { label.removeAttribute('role'); label.removeAttribute('tabindex'); }
      else { label.setAttribute('role', 'button'); label.tabIndex = 0; }
      label.setAttribute('aria-expanded', String(Boolean(model.expanded)));
    }
  };
  const onColorMode = fn => { fn(colorMode, appearance, uiTheme); return listen(colors, fn); };
  const onModel = fn => { if (model) fn({ ...model, appearance, colorMode }); return listen(listeners, fn); };
  window.petQuotaLabel = { onModel, onColorMode, toggleExpanded: () => send('toggle'), openDetail: (action, period) => send('detail', { detail: action, period }) };
  window.petCodexDetails = { onModel, onColorMode, close: () => send('close'), openDetail: (action, period) => send('detail', { detail: action, period }), openThread: id => send('thread', { id }), resize: height => send('resize', { height }),
    markAllRead: generation => new Promise(resolve => { readRequest={generation,resolve};send('mark-all-read',{generation}); }) };
  window.qiuqiuWorkBuddyLabel = { onState: onModel, onColorMode, toggle: () => send('toggle'), refresh: () => send('detail', { detail: 'trend' }), trend: () => send('detail', { detail: 'trend' }), tasks: action => send('detail', { detail: action }) };
  window.petWorkBuddyDetails = { onModel, onColorMode, close: () => send('close'), resize: height => send('resize', { height }), refreshTasks: () => send('detail', { detail: model?.action }), clearTasks: () => {}, openTask: () => {} };
  window.qiuqiuApiUsageLabel = { onState: onModel, onColorMode, toggle: () => send('toggle-api'), openDetails: () => send('api') };
  window.qiuqiuApiUsage = { getState: async () => model || {}, onState: onModel, onColorMode, refresh: async () => { send('refresh-api'); return model; }, connect: async () => model, disconnect: async () => model, openGuide: async () => { send('guide'); return model; } };
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type === 'qiuqiu-demo-theme' && ['light', 'dark'].includes(data.appearance) && ['standard', 'accessible'].includes(data.colorMode)) {
      appearance = data.appearance; colorMode = data.colorMode;if(['blue','green'].includes(data.uiTheme)) uiTheme=data.uiTheme; update();
    } else if (data?.type === 'qiuqiu-quota-model' && data.kind === kind && data.model && typeof data.model === 'object') {
      model = data.model; update();
    } else if (data?.type === 'qiuqiu-demo-motion') document.documentElement.dataset.demoPaused = String(data.paused === true);
    else if (data?.type === 'qiuqiu-quota-read-result' && readRequest && data.generation === readRequest.generation) { readRequest.resolve(data.success===true);readRequest=null; }
  });
  document.addEventListener('DOMContentLoaded', () => {
    if (kind === 'quota') document.getElementById('quota-label').addEventListener('keydown', event => {
      if (!model?.expanded && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); send('toggle'); }
    });
    send('ready');
  });
})();
