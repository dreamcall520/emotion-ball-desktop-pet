(() => {
  'use strict';

  // ponytail: browser fallback only; use a frame-ancestors response header at the CDN for enforcement.
  let ancestor = window;
  while (ancestor !== ancestor.parent) {
    ancestor = ancestor.parent;
    try {
      if (ancestor.location.origin === location.origin) continue;
    } catch (_error) {}
    location.replace(new URL('embed-blocked.html', document.currentScript.src).href);
    return;
  }

  const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const allowed = `${editable}, a, button, pre, code, dialog, [data-copy-allowed]`;
  for (const name of ['contextmenu', 'dragstart']) {
    document.addEventListener(name, event => {
      const media = event.target.closest?.('img, canvas');
      if (media?.closest('[data-protect-media]')) event.preventDefault();
    });
  }
  document.addEventListener('copy', event => {
    if (event.target.closest?.(editable)) return;
    const selection = window.getSelection();
    for (let index = 0; index < (selection?.rangeCount || 0); index++) {
      const range = selection.getRangeAt(index);
      const node = range.commonAncestorContainer;
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (element?.closest(allowed)) continue;
      if ([...document.querySelectorAll('[data-protect-copy]')].some(region => range.intersectsNode(region))) {
        event.preventDefault();
        return;
      }
    }
  });
})();
