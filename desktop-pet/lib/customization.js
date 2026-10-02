(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetCustomization = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const DEFAULT_SHAPE_TUNING = Object.freeze({ width: 1, height: 1, softness: 0.5, asymmetry: 0 });
  const DEFAULT_APPEARANCE = Object.freeze({
    shape: 'blob', bodyColor: '#EEEBE4', eyeColor: '#1A1A1A',
    glowPinkColor: '#D05ED6', glowGoldColor: '#D0AD8A', eyeScale: 1,
    eyeSpacing: 1, eyeHeight: 0, auroraTransparency: 0, auroraStyle: 'dimensional', auroraContour: 'original',
    shapeTuning: DEFAULT_SHAPE_TUNING, idleEyes: 'original'
  });
  const EYE_PRESETS = Object.freeze({ original: null, happy: 2, curious: 3, sleepy: 4, puzzled: 14 });
  const SHAPES = Object.freeze(['blob', 'dumpling', 'cloud', 'aurora-cloud', 'egg', 'square', 'wedge', 'gem']);
  const SHAPE_RECOMMENDED_COLORS = Object.freeze({
    blob: Object.freeze({ bodyColor: '#EEEBE4', eyeColor: '#1A1A1A' }),
    cloud: Object.freeze({ bodyColor: '#5B3BC7', eyeColor: '#FFFFFF' }),
    'aurora-cloud': Object.freeze({ bodyColor: '#5B3BC7', eyeColor: '#FFFFFF',
      glowPinkColor: '#D05ED6', glowGoldColor: '#D0AD8A' }),
    square: Object.freeze({ bodyColor: '#EEEBE4', eyeColor: '#1A1A1A' })
  });
  const ACTIONS = Object.freeze({ hop: 1800, jelly: 1600, sway: 1800, peek: 1900, bow: 1600, spin: 1600 });
  const DEFAULT_SEQUENCE = Object.freeze([
    Object.freeze({ action: 'peek', pauseMs: 300 }),
    Object.freeze({ action: 'jelly', pauseMs: 300 })
  ]);

  function color(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback;
  }

  function bounded(value, min, max, fallback, precision = 2) {
    return Number.isFinite(value)
      ? Math.round(Math.min(max, Math.max(min, value)) * (10 ** precision)) / (10 ** precision)
      : fallback;
  }

  function normalizeAppearance(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const tuning = value.shapeTuning && typeof value.shapeTuning === 'object' ? value.shapeTuning : {};
    const shape = SHAPES.includes(value.shape) ? value.shape : DEFAULT_APPEARANCE.shape;
    return {
      shape,
      bodyColor: color(value.bodyColor, DEFAULT_APPEARANCE.bodyColor),
      eyeColor: color(value.eyeColor, DEFAULT_APPEARANCE.eyeColor),
      glowPinkColor: color(value.glowPinkColor, DEFAULT_APPEARANCE.glowPinkColor),
      glowGoldColor: color(value.glowGoldColor, DEFAULT_APPEARANCE.glowGoldColor),
      eyeScale: shape === 'aurora-cloud' ? 1 : bounded(value.eyeScale, 0.4, 1.25, DEFAULT_APPEARANCE.eyeScale),
      eyeSpacing: shape === 'aurora-cloud' ? 1 : bounded(value.eyeSpacing, 0.7, 1.3, DEFAULT_APPEARANCE.eyeSpacing),
      eyeHeight: shape === 'aurora-cloud' ? 0 : bounded(value.eyeHeight, -30, 30, DEFAULT_APPEARANCE.eyeHeight, 0),
      auroraTransparency: bounded(value.auroraTransparency, 0, 60,
        DEFAULT_APPEARANCE.auroraTransparency, 0),
      auroraStyle: ['dimensional', 'simple'].includes(value.auroraStyle)
        ? value.auroraStyle : DEFAULT_APPEARANCE.auroraStyle,
      auroraContour: shape === 'aurora-cloud' ? 'six-lobe' : 'original',
      shapeTuning: shape === 'aurora-cloud' ? { ...DEFAULT_SHAPE_TUNING } : {
        width: bounded(tuning.width, 0.75, 1.25, DEFAULT_SHAPE_TUNING.width),
        height: bounded(tuning.height, 0.75, 1.25, DEFAULT_SHAPE_TUNING.height),
        softness: bounded(tuning.softness, 0, 1, DEFAULT_SHAPE_TUNING.softness),
        asymmetry: bounded(tuning.asymmetry, -1, 1, DEFAULT_SHAPE_TUNING.asymmetry)
      },
      idleEyes: shape === 'aurora-cloud' ? 'original' :
        Object.hasOwn(EYE_PRESETS, value.idleEyes) ? value.idleEyes : DEFAULT_APPEARANCE.idleEyes
    };
  }

  function applyShapeRecommendation(appearance, shape, contour = 'original') {
    if (!Object.hasOwn(SHAPE_RECOMMENDED_COLORS, shape)) return { ...appearance };
    const colors = SHAPE_RECOMMENDED_COLORS[shape];
    return { ...appearance, shape, ...colors,
      auroraContour: shape === 'aurora-cloud' ? 'six-lobe' : 'original',
      ...(shape === 'aurora-cloud' ? { idleEyes: 'original', eyeScale: 1, eyeSpacing: 1,
        eyeHeight: 0, shapeTuning: { ...DEFAULT_SHAPE_TUNING } } : {}) };
  }

  function effectiveAppearance(raw) { return normalizeAppearance(raw); }

  function normalizeSequence(raw) {
    if (!Array.isArray(raw)) return DEFAULT_SEQUENCE.map(step => ({ ...step }));
    return raw.slice(0, 8).filter(step => step && Object.hasOwn(ACTIONS, step.action)).map(step => ({
      action: step.action,
      pauseMs: Number.isFinite(step.pauseMs)
        ? Math.round(Math.min(2000, Math.max(0, step.pauseMs)) / 100) * 100
        : 300
    }));
  }

  function normalizeCustomization(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      appearance: normalizeAppearance(value.appearance),
      sequence: normalizeSequence(value.sequence)
    };
  }

  function auroraReferenceTexture() { return null; }

  // A turning cloud passes through a cushioned four-corner silhouette before
  // it becomes edge-on. Keep the same 96-point ordering as the approved ring
  // so its body, eye clip and artwork clip can share one interpolated outline.
  // The image itself is deliberately unchanged: only a live turn uses this.
  function auroraTurnRing(baseRing, amount) {
    if (!Array.isArray(baseRing) || baseRing.length !== 96 ||
        !baseRing.every(point => Array.isArray(point) && point.length === 2 &&
          Number.isFinite(point[0]) && Number.isFinite(point[1]))) return null;
    const blend = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0));
    if (blend === 0) return baseRing.map(point => point.slice());
    const xs = baseRing.map(point => point[0]);
    const ys = baseRing.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    if (maxX - minX < 1 || maxY - minY < 1) return null;
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const halfWidth = (maxX - minX) * 0.471;
    const halfHeight = (maxY - minY) * 0.488;
    const power = 3;
    return baseRing.map(([x, y]) => {
      const angle = Math.atan2(y - centerY, x - centerX);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const radius = Math.pow(
        Math.pow(Math.abs(cos) / halfWidth, power) +
        Math.pow(Math.abs(sin) / halfHeight, power), -1 / power);
      const roundedX = centerX + radius * cos;
      const roundedY = centerY + radius * sin;
      return [x + (roundedX - x) * blend, y + (roundedY - y) * blend];
    });
  }

  return Object.freeze({ DEFAULT_APPEARANCE, DEFAULT_SHAPE_TUNING, DEFAULT_SEQUENCE, EYE_PRESETS, SHAPES, ACTIONS,
    SHAPE_RECOMMENDED_COLORS, applyShapeRecommendation,
    normalizeAppearance, effectiveAppearance, normalizeSequence, normalizeCustomization, auroraReferenceTexture, auroraTurnRing });
}));
