(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetFacing = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  // 使用球球所在显示器的工作区；中间 12% 保留方向，避免中线附近来回翻面。
  function resolve(bounds, area, previous = null) {
    if (![bounds?.x, bounds?.width, area?.x, area?.width].every(Number.isFinite) ||
        bounds.width <= 0 || area.width <= 0) return previous === 'left' ? 'left' : 'right';
    const relative = (bounds.x + bounds.width / 2 - area.x) / area.width;
    if (previous === 'left' && relative >= 0.44) return 'left';
    if (previous === 'right' && relative <= 0.56) return 'right';
    return relative > 0.5 ? 'left' : 'right';
  }
  return Object.freeze({ resolve });
}));
