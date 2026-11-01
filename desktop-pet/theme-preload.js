// Session preload runs before page preloads and before the document's first paint.
const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame && location.protocol === 'file:') {
  const normalize = value => ({ mode: value?.mode === 'accessible' ? 'accessible' : 'standard',
    appearance: ['light', 'dark'].includes(value?.appearance) ? value.appearance : 'system',
    theme: ['green', 'blue', 'purple'].includes(value?.theme) ? value.theme : 'blue' });
  let current = normalize(ipcRenderer.sendSync('pet:initial-color-mode'));
  const apply = () => {
    const root = document.documentElement;
    if (!root) return;
    const appearance = current.appearance === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : current.appearance;
    if (root.dataset.uiTheme !== current.theme) root.dataset.uiTheme = current.theme;
    if (root.dataset.colorMode !== current.mode) root.dataset.colorMode = current.mode;
    if (root.dataset.appearance !== appearance) root.dataset.appearance = appearance;
    if (root.dataset.accessibleAppearance !== appearance) root.dataset.accessibleAppearance = appearance;
    const blue = document.getElementById('blue-style');
    if (blue) blue.disabled = current.theme !== 'blue';
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { apply(); observer.disconnect(); }, { once: true });
  const listeners = new Set();
  ipcRenderer.on('pet:color-mode', (_event, mode, appearance, theme) => {
    current = normalize({ mode, appearance, theme }); apply();
    for (const callback of listeners) callback(current.mode, current.appearance, current.theme);
  });
  contextBridge.exposeInMainWorld('qiuqiuColorMode', {
    initial: current,
    onColorMode(callback) {
      if (typeof callback !== 'function') return () => {};
      listeners.add(callback);
      callback(current.mode, current.appearance, current.theme);
      return () => listeners.delete(callback);
    }
  });
  // DOM modal ownership is reported from this shared isolated preload only;
  // ordinary desktop notes and timer mini/message windows remain companions.
  let modal = false;
  const reportModal = () => {
    const next = Boolean(document.querySelector?.('dialog:modal'));
    if (next !== modal) { modal = next; ipcRenderer.sendSync('pet:quota-modal', next); }
  };
  const modalObserver = new MutationObserver(reportModal);
  modalObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('close', reportModal, true);
  document.addEventListener('cancel', () => queueMicrotask(reportModal), true);
  reportModal();
}
