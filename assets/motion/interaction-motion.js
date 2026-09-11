(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.InteractionMotion = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var TAU = Math.PI * 2;
  var NEUTRAL = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotate: 0,
    yaw: 0
  };
  var RADIUS = 114.3;
  var BODY_CENTER = 114.2705;
  var SAFE_MIN = -7;
  var SAFE_MAX = 236;

  var MOTIONS = Object.freeze([
    Object.freeze({ id: 'hop', durationMs: 1800, weight: 2, emotion: '10' }),
    Object.freeze({ id: 'jelly', durationMs: 1600, weight: 2, emotion: '03' }),
    Object.freeze({ id: 'sway', durationMs: 1800, weight: 2, emotion: '19' }),
    Object.freeze({ id: 'peek', durationMs: 1900, weight: 2, emotion: '03' }),
    Object.freeze({ id: 'bow', durationMs: 1600, weight: 2, emotion: '14' }),
    Object.freeze({ id: 'spin', durationMs: 1600, weight: 1, emotion: '10' })
  ]);

  var FRAMES = {
    hop: [
      [0, {}],
      [180, { scaleX: 1.06, scaleY: 0.78, y: 14 }],
      [350, { scaleX: 0.90, scaleY: 1.04 }, 0, -32],
      [540, { scaleX: 0.95, scaleY: 1.02 }, 0, -64],
      [760, { scaleX: 1.05, scaleY: 0.80, y: 14 }],
      [940, { scaleX: 0.91, scaleY: 1.03 }, 0, -38],
      [1120, { scaleX: 0.97, scaleY: 1.01 }, 0, -42],
      [1330, { scaleX: 1.04, scaleY: 0.86, y: 9 }],
      [1550, { scaleX: 0.98, scaleY: 1.02 }],
      [1800, {}]
    ],
    jelly: [
      [0, {}],
      [220, { scaleX: 1.06, scaleY: 0.76, y: 16 }],
      [440, { scaleX: 0.83, scaleY: 1.06 }],
      [660, { scaleX: 1.04, scaleY: 0.84, y: 10 }],
      [870, { scaleX: 0.91, scaleY: 1.04 }],
      [1100, { scaleX: 1.02, scaleY: 0.94, y: 4 }],
      [1340, { scaleX: 0.98, scaleY: 1.02 }],
      [1600, {}]
    ],
    sway: [
      [0, {}],
      [250, { rotate: -14, scaleX: 0.96, scaleY: 0.98 }, -16, 0, -5],
      [520, { rotate: 14, scaleX: 0.96, scaleY: 0.98 }, 16, 0, 5],
      [790, { rotate: -12, scaleX: 0.97 }, -14, 0, -5],
      [1100, { rotate: 12, scaleX: 0.97 }, 14, 0, 5],
      [1450, { rotate: -6 }, -6, 0, -2],
      [1800, {}]
    ],
    peek: [
      [0, {}],
      [260, { rotate: -12, scaleX: 0.95, scaleY: 0.96 }, -18, 0, -10],
      [600, { rotate: -12, scaleX: 0.95, scaleY: 0.96 }, -18, 0, -10],
      [880, {}],
      [1180, { rotate: 12, scaleX: 0.95, scaleY: 0.96 }, 18, 0, 10],
      [1540, { rotate: 12, scaleX: 0.95, scaleY: 0.96 }, 18, 0, 10],
      [1900, {}]
    ],
    bow: [
      [0, {}],
      [260, { scaleX: 0.97, scaleY: 0.76, y: 18 }, 0, 0, 0, 8],
      [440, { scaleX: 0.97, scaleY: 0.76, y: 18 }, 0, 0, 0, 8],
      [650, {}],
      [900, { scaleX: 0.99, scaleY: 0.82, y: 14 }, 0, 0, 0, 6],
      [1100, { scaleX: 0.99, scaleY: 0.82, y: 14 }, 0, 0, 0, 6],
      [1360, { scaleX: 0.99, scaleY: 1.02 }],
      [1600, {}]
    ],
    spin: [
      [0, {}],
      [200, { scaleX: 1.03, scaleY: 0.92, y: 5 }],
      [1320, { yaw: TAU }],
      [1600, { yaw: TAU }]
    ]
  };

  function getMotion(id) {
    for (var i = 0; i < MOTIONS.length; i += 1) {
      if (MOTIONS[i].id === id) return MOTIONS[i];
    }
    return null;
  }

  function chooseMotion(random, previousId) {
    var value = (typeof random === 'number' && Number.isFinite(random)) ? random : 0;
    if (value < 0) value = 0;
    if (value >= 1) value = 1 - Number.EPSILON;

    var candidates = MOTIONS.filter(function (motion) {
      return motion.id !== previousId;
    });
    var totalWeight = candidates.reduce(function (sum, motion) {
      return sum + motion.weight;
    }, 0);
    var cursor = value * totalWeight;
    for (var i = 0; i < candidates.length; i += 1) {
      cursor -= candidates[i].weight;
      if (cursor < 0) return candidates[i];
    }
    return candidates[candidates.length - 1] || null;
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function bodyAtFrame(overrides) {
    return {
      x: finiteOr(overrides.x, NEUTRAL.x),
      y: finiteOr(overrides.y, NEUTRAL.y),
      scaleX: finiteOr(overrides.scaleX, NEUTRAL.scaleX),
      scaleY: finiteOr(overrides.scaleY, NEUTRAL.scaleY),
      rotate: finiteOr(overrides.rotate, NEUTRAL.rotate),
      yaw: finiteOr(overrides.yaw, NEUTRAL.yaw)
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampBodyToSafeRange(body) {
    var angle = body.rotate * Math.PI / 180;
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var rx = RADIUS * Math.sqrt(
      Math.pow(body.scaleX * cos, 2) + Math.pow(body.scaleY * sin, 2)
    );
    var ry = RADIUS * Math.sqrt(
      Math.pow(body.scaleX * sin, 2) + Math.pow(body.scaleY * cos, 2)
    );
    body.x = clamp(body.x, SAFE_MIN + rx - BODY_CENTER, SAFE_MAX - rx - BODY_CENTER);
    body.y = clamp(body.y, SAFE_MIN + ry - BODY_CENTER, SAFE_MAX - ry - BODY_CENTER);
    return body;
  }

  function frameValues(frame) {
    return {
      body: bodyAtFrame(frame[1] || {}),
      window: { x: finiteOr(frame[2], 0), y: finiteOr(frame[3], 0) },
      gaze: { x: finiteOr(frame[4], 0), y: finiteOr(frame[5], 0) }
    };
  }

  function smoothstep(value) {
    return value * value * (3 - 2 * value);
  }

  function interpolate(a, b, elapsedMs) {
    var span = b[0] - a[0];
    var progress = span > 0 ? (elapsedMs - a[0]) / span : 1;
    var eased = smoothstep(clamp(progress, 0, 1));
    var from = frameValues(a);
    var to = frameValues(b);
    var body = {};
    var windowPosition = {};
    var gaze = {};
    Object.keys(NEUTRAL).forEach(function (key) {
      body[key] = from.body[key] + (to.body[key] - from.body[key]) * eased;
    });
    ['x', 'y'].forEach(function (key) {
      windowPosition[key] = from.window[key] + (to.window[key] - from.window[key]) * eased;
      gaze[key] = from.gaze[key] + (to.gaze[key] - from.gaze[key]) * eased;
    });
    return { body: clampBodyToSafeRange(body), window: windowPosition, gaze: gaze };
  }

  function neutralSample(done) {
    return {
      body: bodyAtFrame(NEUTRAL),
      window: { x: 0, y: 0 },
      gaze: { x: 0, y: 0 },
      done: done
    };
  }

  function sampleMotion(id, elapsedMs) {
    var motion = getMotion(id);
    if (!motion) return null;
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return neutralSample(false);
    }
    if (elapsedMs >= motion.durationMs) return neutralSample(true);

    var frames = FRAMES[id];
    for (var i = 1; i < frames.length; i += 1) {
      if (elapsedMs <= frames[i][0]) {
        var result = interpolate(frames[i - 1], frames[i], elapsedMs);
        result.done = false;
        return result;
      }
    }
    return neutralSample(true);
  }

  function validRect(rect) {
    return rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
      rect.width > 0 && rect.height > 0;
  }

  function positionForMotion(bounds, workArea, offset) {
    if (!validRect(bounds) || !validRect(workArea) ||
      !offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y) ||
      bounds.width > workArea.width || bounds.height > workArea.height) {
      return null;
    }
    var scale = bounds.width / 259;
    var x = bounds.x + Math.round(offset.x * scale);
    var y = bounds.y + Math.round(offset.y * scale);
    var maxX = workArea.x + workArea.width - bounds.width;
    var maxY = workArea.y + workArea.height - bounds.height;
    x = clamp(x, workArea.x, maxX);
    y = clamp(y, workArea.y, maxY);
    return { x: x, y: y };
  }

  return {
    MOTIONS: MOTIONS,
    getMotion: getMotion,
    chooseMotion: chooseMotion,
    sampleMotion: sampleMotion,
    positionForMotion: positionForMotion
  };
}));
