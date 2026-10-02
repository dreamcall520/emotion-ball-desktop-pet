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

function petVisualBounds(bounds, shape) {
  const insets = VERTICAL_INSETS[shape];
  if (!insets) return bounds;
  const top = (insets[0] - 0.06) * bounds.height;
  const bottom = (insets[1] - 0.06) * bounds.height;
  return { ...bounds, y: bounds.y + top, height: bounds.height - top - bottom };
}

module.exports = { petVisualBounds };
