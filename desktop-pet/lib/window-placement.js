const { GAP } = require('./quota-label-placement');

const SIZES = Object.freeze({
  micro: Object.freeze({ width: 60, height: 60 }),
  tiny: Object.freeze({ width: 80, height: 80 }),
  compact: Object.freeze({ width: 108, height: 108 }),
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

function adjacentBounds(pet, area, size) {
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  const x = pet.x + (pet.width - width) / 2, y = pet.y + (pet.height - height) / 2;
  const candidates = [
    { x, y: pet.y - height - GAP }, { x, y: pet.y + pet.height + GAP },
    { x: pet.x + pet.width + GAP, y }, { x: pet.x - width - GAP, y }
  ].map(candidate => ({ x: Math.round(candidate.x), y: Math.round(candidate.y), width, height }));
  const inside = b => b.x >= area.x && b.y >= area.y && b.x + width <= area.x + area.width && b.y + height <= area.y + area.height;
  const fits = candidates.find(inside);
  if (fits) return fits;
  const bounded = candidates.map(b => ({ ...b,
    x: clamp(b.x, area.x, area.x + area.width - width),
    y: clamp(b.y, area.y, area.y + area.height - height) }));
  return bounded.find(b => b.x + width <= pet.x || b.x >= pet.x + pet.width || b.y + height <= pet.y || b.y >= pet.y + pet.height) || bounded[0];
}

const windowMinimums = new WeakMap();
function positionWindowNearPet(win, petBounds, screen) {
  const pet = petBounds || screen.getPrimaryDisplay().workArea;
  const area = (screen.getDisplayMatching(pet) || screen.getPrimaryDisplay()).workArea;
  const minimum = windowMinimums.get(win) || win.getMinimumSize();
  windowMinimums.set(win, minimum);
  win.setMinimumSize(Math.min(minimum[0], area.width), Math.min(minimum[1], area.height));
  const current = win.getBounds(), next = adjacentBounds(pet, area, current);
  if (['x', 'y', 'width', 'height'].some(key => current[key] !== next[key])) win.setBounds(next, false);
  return next;
}

module.exports = {
  SIZES,
  defaultBounds,
  ensureVisibleBounds,
  adjacentBounds,
  positionWindowNearPet
};
