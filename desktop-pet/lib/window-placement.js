const SIZES = Object.freeze({
  tiny: Object.freeze({ width: 80, height: 80 }),
  small: Object.freeze({ width: 120, height: 120 }),
  medium: Object.freeze({ width: 180, height: 180 }),
  large: Object.freeze({ width: 260, height: 260 })
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function intersectionArea(a, b) {
  const width = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const height = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  return width * height;
}

function defaultBounds(primaryDisplay, sizeName, margin = 24) {
  const size = SIZES[sizeName] || SIZES.medium;
  const area = primaryDisplay.workArea;
  return {
    x: area.x + area.width - size.width - margin,
    y: area.y + area.height - size.height - margin,
    ...size
  };
}

function ensureVisibleBounds(bounds, displays, primaryDisplay) {
  const target = displays
    .map(display => ({ display, area: intersectionArea(bounds, display.workArea) }))
    .sort((a, b) => b.area - a.area)[0];

  if (!target || target.area === 0) {
    const sizeName =
      Object.keys(SIZES).find(
        name =>
          SIZES[name].width === bounds.width && SIZES[name].height === bounds.height
      ) || 'medium';
    return defaultBounds(primaryDisplay, sizeName);
  }

  const area = target.display.workArea;
  return {
    x: clamp(Math.round(bounds.x), area.x, area.x + area.width - bounds.width),
    y: clamp(Math.round(bounds.y), area.y, area.y + area.height - bounds.height),
    width: bounds.width,
    height: bounds.height
  };
}

module.exports = {
  SIZES,
  defaultBounds,
  ensureVisibleBounds
};
