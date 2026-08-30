const LABEL_SIZES = Object.freeze({
  standard: Object.freeze({ width: 168, height: 58 }),
  standardExpanded: Object.freeze({ width: 196, height: 96 }),
  standardExpandedDual: Object.freeze({ width: 196, height: 128 }),
  compact: Object.freeze({ width: 128, height: 32 }),
  compactExpanded: Object.freeze({ width: 196, height: 96 }),
  compactExpandedDual: Object.freeze({ width: 196, height: 128 })
});
const GAP = 8;
const GEOMETRY_LIMIT = Math.floor(Number.MAX_SAFE_INTEGER / 4);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value)
  ? clamp(value, -GEOMETRY_LIMIT, GEOMETRY_LIMIT) : fallback;
const positive = (value, fallback) => Number.isFinite(value) && value > 0
  ? Math.min(value, GEOMETRY_LIMIT) : fallback;

function safeArea(area) {
  return {
    x: Math.round(finite(area && area.x, 0)),
    y: Math.round(finite(area && area.y, 0)),
    width: Math.max(1, Math.floor(positive(area && area.width, 1))),
    height: Math.max(1, Math.floor(positive(area && area.height, 1)))
  };
}

function safePet(pet, area) {
  const width = positive(pet && pet.width, 80);
  const height = positive(pet && pet.height, 80);
  return {
    x: finite(pet && pet.x, area.x + (area.width - width) / 2),
    y: finite(pet && pet.y, area.y + (area.height - height) / 2),
    width,
    height
  };
}

function safeObstacle(obstacle) {
  if (!obstacle || !Number.isFinite(obstacle.x) || !Number.isFinite(obstacle.y) ||
    !Number.isFinite(obstacle.width) || !Number.isFinite(obstacle.height) ||
    obstacle.width <= 0 || obstacle.height <= 0) return null;
  return {
    x: finite(obstacle.x, 0),
    y: finite(obstacle.y, 0),
    width: positive(obstacle.width, 1),
    height: positive(obstacle.height, 1)
  };
}

function inside(candidate, size, area) {
  return candidate.x >= area.x && candidate.y >= area.y &&
    candidate.x + size.width <= area.x + area.width &&
    candidate.y + size.height <= area.y + area.height;
}

function overlaps(candidate, size, obstacle) {
  return Boolean(obstacle && candidate.x < obstacle.x + obstacle.width &&
    candidate.x + size.width > obstacle.x && candidate.y < obstacle.y + obstacle.height &&
    candidate.y + size.height > obstacle.y);
}

function bounded(candidate, size, area) {
  return {
    x: Math.round(clamp(candidate.x, area.x, area.x + area.width - size.width)),
    y: Math.round(clamp(candidate.y, area.y, area.y + area.height - size.height)),
    width: size.width,
    height: size.height,
    placement: candidate.placement
  };
}

function quotaLabelSize(value, expanded = false, itemCount = 1) {
  if (expanded === true && itemCount > 1 && value === 'standard') return LABEL_SIZES.standardExpandedDual;
  if (expanded === true && itemCount > 1 && value === 'compact') return LABEL_SIZES.compactExpandedDual;
  if (expanded === true && value === 'standard') return LABEL_SIZES.standardExpanded;
  if (expanded === true && value === 'compact') return LABEL_SIZES.compactExpanded;
  return LABEL_SIZES[value] || LABEL_SIZES.standard;
}

function quotaLabelBounds(petBounds, workArea, obstacleBounds = null, sizeName = 'standard', expanded = false, itemCount = 1) {
  const area = safeArea(workArea);
  const pet = safePet(petBounds, area);
  const obstacle = safeObstacle(obstacleBounds);
  const requestedSize = quotaLabelSize(sizeName, expanded, itemCount);
  const size = {
    width: Math.min(requestedSize.width, area.width),
    height: Math.min(requestedSize.height, area.height)
  };
  const centerX = pet.x + pet.width / 2;
  const centerY = pet.y + pet.height / 2;
  const candidates = [
    { placement: 'below', x: centerX - size.width / 2, y: pet.y + pet.height + GAP },
    { placement: 'above', x: centerX - size.width / 2, y: pet.y - size.height - GAP },
    { placement: 'right', x: pet.x + pet.width + GAP, y: centerY - size.height / 2 },
    { placement: 'left', x: pet.x - size.width - GAP, y: centerY - size.height / 2 }
  ].map(candidate => ({ ...candidate, x: Math.round(candidate.x), y: Math.round(candidate.y) }));

  const valid = candidates.find(candidate => inside(candidate, size, area) &&
    !overlaps(candidate, size, obstacle));
  if (valid) return { x: valid.x, y: valid.y, ...size, placement: valid.placement };

  const fallbacks = candidates.map(candidate => bounded(candidate, size, area));
  const safe = fallbacks.find(candidate => !overlaps(candidate, size, pet) &&
    !overlaps(candidate, size, obstacle));
  const aroundObstacle = obstacle ? [
    { placement: 'left', x: obstacle.x - size.width - GAP, y: centerY - size.height / 2 },
    { placement: 'right', x: obstacle.x + obstacle.width + GAP, y: centerY - size.height / 2 },
    { placement: 'above', x: centerX - size.width / 2, y: obstacle.y - size.height - GAP },
    { placement: 'below', x: centerX - size.width / 2, y: obstacle.y + obstacle.height + GAP }
  ].map(candidate => bounded(candidate, size, area)) : [];
  const aroundObstacleSafe = aroundObstacle.find(candidate =>
    !overlaps(candidate, size, pet) && !overlaps(candidate, size, obstacle));
  return safe || aroundObstacleSafe ||
    fallbacks.find(candidate => !overlaps(candidate, size, obstacle)) || fallbacks[0];
}

module.exports = { LABEL_SIZES, quotaLabelSize, quotaLabelBounds };
