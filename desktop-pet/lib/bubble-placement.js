const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function bubbleBounds(petBounds, workArea, interactive = false, preferredHeight = null) {
  const areaWidth = Math.max(1, Math.floor(workArea.width));
  const areaHeight = Math.max(1, Math.floor(workArea.height));
  const paddingX = Math.min(8, Math.floor((areaWidth - 1) / 2));
  const paddingY = Math.min(8, Math.floor((areaHeight - 1) / 2));
  const width = Math.min(224, areaWidth - paddingX * 2);
  const baseHeight = interactive ? 118 : 86;
  const requestedHeight = Number.isFinite(preferredHeight)
    ? Math.max(baseHeight, Math.ceil(preferredHeight))
    : baseHeight;
  const height = Math.min(requestedHeight, areaHeight - paddingY * 2);
  const minX = workArea.x + paddingX;
  const minY = workArea.y + paddingY;
  const centerX = petBounds.x + petBounds.width / 2;
  const aboveY = petBounds.y - height - 8;
  const placement = aboveY >= minY ? 'above' : 'below';
  const targetY = placement === 'above' ? aboveY : petBounds.y + petBounds.height + 8;
  const x = Math.round(clamp(centerX - width / 2, minX, workArea.x + areaWidth - paddingX - width));
  const y = Math.round(clamp(targetY, minY, workArea.y + areaHeight - paddingY - height));
  const anchorInset = Math.min(20, width / 2);
  return { x, y, width, height, placement, anchorX: clamp(centerX - x, anchorInset, width - anchorInset) };
}
module.exports = { bubbleBounds };
