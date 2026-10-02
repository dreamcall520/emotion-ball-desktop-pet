// The transparent pet window is larger than its painted body. These fractions
// were measured from the rendered silhouettes; blob is the existing spacing baseline.
const VERTICAL_INSETS = Object.freeze({
  dumpling: [0.11, 0.11],
  cloud: [0.17, 0.17],
  'aurora-cloud': [0.105, 0.17],
  egg: [0.065, 0.065],
  square: [0.11, 0.11],
  wedge: [0.10, 0.10],
  gem: [0.06, 0.06]
});

function petVisualBounds(bounds, shape, presentation = null) {
  // Preserve the existing quota anchor for the cloud's peeked presentation.
  if (shape === 'aurora-cloud' && presentation?.mode === 'peeked' &&
      ['left', 'right'].includes(presentation.side)) {
    bounds = { ...bounds, x: bounds.x + (presentation.side === 'right' ? 1 : -1) * bounds.width * 0.35 };
  }
  const insets = VERTICAL_INSETS[shape];
  if (!insets) return bounds;
  const top = (insets[0] - 0.06) * bounds.height;
  const bottom = (insets[1] - 0.06) * bounds.height;
  return { ...bounds, y: bounds.y + top, height: bounds.height - top - bottom };
}

module.exports = { petVisualBounds };
