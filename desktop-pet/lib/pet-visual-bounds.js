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
    bounds = { ...bounds, x: bounds.x + (presentation.side === 'right' ? 1 : -1) * bounds.width * (presentation?.quotaGuard ? .43 : .35) };
  }
  // Measured from the approved idle/A+B atlases, alpha>=32, plus 2 source px
  // padding. Match each theme and facing; never change shortcut/bubble anchors.
  if (shape === 'new-year-sheep' && presentation?.quotaAnchor) {
    const live = presentation.sheepInk;
    const ink = live?.ink;
    if (presentation.sheepTheme === 'christmas' && live?.theme === 'christmas' &&
        live.facing === presentation.facing && !['ring','duo','split','stages'].includes(presentation.quotaStyle) &&
        ink && [ink.x,ink.width].every(Number.isFinite) && ink.x >= 0 && ink.width > 0 && ink.x + ink.width <= 1.001) {
      return { ...bounds, x: bounds.x + bounds.width * ink.x, width: bounds.width * ink.width };
    }
    const envelopes = { none: [40,270], halloween: [45,270], christmas: [39,318], 'spring-festival': [42,278] };
    const measured = envelopes[presentation.sheepTheme];
    if (!measured) return { ...bounds, x: bounds.x + bounds.width * .04, width: bounds.width * .92 };
    let [left, right] = measured;
    if (presentation.facing === 'right') [left,right] = [320-right,320-left];
    // The ring fitter uniformly scales sheep around the middle of the host.
    const factor = ['ring','duo','split','stages'].includes(presentation.quotaStyle) ? .74 : 1;
    const start = .5 + (left/320-.5)*factor, end = .5+(right/320-.5)*factor;
    return { ...bounds, x: bounds.x + bounds.width*start, width: bounds.width*(end-start) };
  }
  const insets = VERTICAL_INSETS[shape];
  if (!insets) return bounds;
  const top = (insets[0] - 0.06) * bounds.height;
  const bottom = (insets[1] - 0.06) * bounds.height;
  return { ...bounds, y: bounds.y + top, height: bounds.height - top - bottom };
}

module.exports = { petVisualBounds };
