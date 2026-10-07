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
})();
