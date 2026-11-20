const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const { petVisualBounds } = require('./pet-visual-bounds');
const { adjacentBounds } = require('./window-placement');

function bubbleMaxWidth(workArea) {
  const width = Math.max(1, Math.floor(workArea.width));
  return Math.min(224, width - Math.min(8, Math.floor((width - 1) / 2)) * 2);
}

function bubbleBounds(petBounds, workArea, interactive = false, preferredHeight = null, shape = 'blob', obstacles = [], preferredWidth = null) {
  petBounds = petVisualBounds(petBounds, shape);
  const areaWidth = Math.max(1, Math.floor(workArea.width));
  const areaHeight = Math.max(1, Math.floor(workArea.height));
  const paddingX = Math.min(8, Math.floor((areaWidth - 1) / 2));
  const paddingY = Math.min(8, Math.floor((areaHeight - 1) / 2));
  const maxWidth = bubbleMaxWidth(workArea);
  const width = !interactive && Number.isFinite(preferredWidth)
    ? Math.min(maxWidth, Math.max(80, Math.ceil(preferredWidth))) : maxWidth;
  const baseHeight = interactive ? 118 : 86;
  // A measured single line needs 44px of surface plus 22px for the cloud dots.
  // Keep the larger initial estimate and interactive minimum until content is measured.
  const minimumHeight = interactive ? baseHeight : 66;
  const requestedHeight = Number.isFinite(preferredHeight)
    ? Math.max(minimumHeight, Math.ceil(preferredHeight))
    : baseHeight;
  const height = Math.min(requestedHeight, areaHeight - paddingY * 2);
  const minX = workArea.x + paddingX;
  const minY = workArea.y + paddingY;
  const centerX = petBounds.x + petBounds.width / 2;
  const aboveY = petBounds.y - height - 8;
  let placement = aboveY >= minY ? 'above' : 'below';
  const targetY = placement === 'above' ? aboveY : petBounds.y + petBounds.height + 8;
  let x = Math.round(clamp(centerX - width / 2, minX, workArea.x + areaWidth - paddingX - width));
  let y = Math.round(clamp(targetY, minY, workArea.y + areaHeight - paddingY - height));
  const occupied = obstacles.filter(rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0);
  if (occupied.some(rect => x < rect.x + rect.width && x + width > rect.x && y < rect.y + rect.height && y + height > rect.y)) {
    ({ x, y } = adjacentBounds(petBounds, { x: minX, y: minY, width: areaWidth - paddingX * 2, height: areaHeight - paddingY * 2 }, { width, height }, occupied));
    placement = y + height / 2 < petBounds.y + petBounds.height / 2 ? 'above' : 'below';
  }
  // Keep both cloud dots clear of the rounded corners within the native inset.
  const anchorInset = Math.min(35, width / 2);
  return { x, y, width, height, placement, anchorX: clamp(centerX - x, anchorInset, width - anchorInset) };
}
module.exports = { bubbleBounds, bubbleMaxWidth };
