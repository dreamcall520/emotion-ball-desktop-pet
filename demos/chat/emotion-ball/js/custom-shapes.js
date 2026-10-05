/* Editable body outlines. The original rings remain authoritative for untuned legacy shapes. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EB_CUSTOM_SHAPES = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var C = 114.2705;
  var COUNT = 96;
  var TAU = Math.PI * 2;
  var FACES = {
    dumpling: { x: -10, y: -18, sx: 0.72, sy: 0.8, eye: 0.58 },
    cloud: { x: -13, y: 33, sx: 0.94, sy: 0.92, eye: 0.75,
      rightEyeX: 1.35, rightEyeY: 1.1, expressionMotion: 0.15,
      eyeGuard: { maxWidth: 32, maxHeight: 52, minGap: 8, minTopFraction: 0.25 } },
    'aurora-cloud': { x: -40, y: -9, sx: 0.55, sy: 0.12, eye: 0.7,
      eyeXScale: 0.95, eyeYScale: 1.98, rightEyeX: 1.17, expressionMotion: 0.15,
      eyeGuard: { maxWidth: 32, maxHeight: 60, minGap: 6,
        minTopFraction: 0.23, maxBottomFraction: 0.8 } },
    egg: { x: -12, y: -21, sx: 0.7, sy: 0.76, eye: 0.55 },
    square: { x: -10, y: -19, sx: 0.72, sy: 0.8, eye: 0.58 }
  };

  function clampNumber(value, min, max, fallback) {
    return typeof value === 'number' && isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  function cubicPoint(segment, t) {
    var mt = 1 - t;
    var weights = [mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t];
    return [0, 1].map(function (axis) {
      return segment.reduce(function (sum, point, index) { return sum + point[axis] * weights[index]; }, 0);
    });
  }

  function cloudOutline(softness) {
    /* Two broad crowns, shallow middle dip, two side puffs and a lower centre
     * puff. Control points follow the user's five-lobed cloud reference. */
    var start = [61, 135];
    var segments = [
      [start, [62, 58], [107, 0], [189, 0]],
      [[189, 0], [219, 0], [246, 9], [267, 30]],
      [[267, 30], [284, 22], [301, 21], [325, 26]],
      [[325, 26], [380, 39], [415, 84], [415, 137]],
      [[415, 137], [450, 158], [465, 187], [465, 222]],
      [[465, 222], [465, 290], [415, 342], [324, 332]],
      [[324, 332], [297, 357], [270, 369], [236, 369]],
      [[236, 369], [201, 369], [171, 355], [149, 336]],
      [[149, 336], [68, 350], [7, 315], [0, 242]],
      [[0, 242], [-5, 193], [16, 157], start]
    ];
    var dense = [start], cumulative = [0], total = 0;
    segments.forEach(function (segment) {
      for (var step = 1; step <= 40; step++) {
        var point = cubicPoint(segment, step / 40);
        var previous = dense[dense.length - 1];
        total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        dense.push(point);
        cumulative.push(total);
      }
    });
    var ring = [], edge = 1;
    for (var i = 0; i < COUNT; i++) {
      var target = total * i / COUNT;
      while (edge < cumulative.length - 1 && cumulative[edge] < target) edge++;
      var length = cumulative[edge] - cumulative[edge - 1];
      var mix = length ? (target - cumulative[edge - 1]) / length : 0;
      var x = (dense[edge - 1][0] + (dense[edge][0] - dense[edge - 1][0]) * mix - 230) * 0.46;
      var y = (dense[edge - 1][1] + (dense[edge][1] - dense[edge - 1][1]) * mix - 184.5) * 0.46;
      /* Softness rounds the valleys toward a smooth oval; lower values make
       * the five lobes more pronounced, without changing the default shape. */
      var angle = Math.atan2(y, x);
      var ellipseRadius = 1 / Math.sqrt(Math.pow(Math.cos(angle) / 108, 2) +
        Math.pow(Math.sin(angle) / 85, 2));
      var radius = Math.hypot(x, y);
      var blend = (softness - 0.5) * 0.5;
      var factor = radius ? (radius + (ellipseRadius - radius) * blend) / radius : 1;
      ring.push([x * factor, y * factor]);
    }
    return ring;
  }
  function sixLobeOutline() {
    return Array.from({ length: COUNT }, function (_, index) {
      var angle = TAU * index / COUNT;
      var radius = 0.9 + 0.1 * Math.cos(6 * angle);
      return [108 * radius * Math.cos(angle), 107 * radius * Math.sin(angle)];
    });
  }
  function newOutline(shape, softness) {
    if (shape === 'cloud') return cloudOutline(softness);
    if (shape === 'aurora-cloud') return sixLobeOutline();
    var ring = [];
    for (var i = 0; i < COUNT; i++) {
      var angle = TAU * i / COUNT;
      var cosine = Math.cos(angle), sine = Math.sin(angle);
      var x, y;
      if (shape === 'square') {
        /* Superellipse: even its least soft setting has rounded, smooth corners. */
        var power = 5.8 - softness * 3.6;
        var radial = 1 / Math.pow(Math.pow(Math.abs(cosine), power) +
          Math.pow(Math.abs(sine), power), 1 / power);
        x = 101 * cosine * radial;
        y = 101 * sine * radial;
      } else if (shape === 'egg') {
        /* A narrow crown and a fuller lower half. */
        var fullness = 1 + (0.5 - softness) * 0.08 * Math.cos(2 * angle);
        x = 94 * cosine * (0.91 + 0.09 * sine) * fullness;
        y = 112 * sine * (1 + (0.5 - softness) * 0.04 * Math.cos(2 * angle));
      } else {
        /* Dumpling: round, slightly cushioned rather than a perfect circle. */
        var puff = 1 + (0.04 - 0.025 * softness) * Math.cos(3 * angle + 0.45);
        x = 103 * cosine * puff;
        y = 101 * sine * puff;
      }
      ring.push([x, y]);
    }
    return ring;
  }

  function legacyOutline(shape, softness, source) {
    if (source && source.ring) {
      return source.ring.map(function (point, i) {
        var angle = TAU * i / source.ring.length;
        var soften = shape === 'blob' ? (0.5 - softness) * 5 * Math.cos(4 * angle) : 0;
        return [point[0] - C + soften * Math.cos(angle), point[1] - C + soften * Math.sin(angle)];
      });
    }
    /* Supports previews rendered before rings.js has loaded. */
    return newOutline('dumpling', softness);
  }

  function createShape(appearance) {
    var value = appearance && typeof appearance === 'object' ? appearance : {};
    var shape = value.shape || 'blob';
    var legacy = shape === 'blob' || shape === 'wedge' || shape === 'gem';
    if (!legacy && !Object.prototype.hasOwnProperty.call(FACES, shape)) return null;

    var raw = value.shapeTuning && typeof value.shapeTuning === 'object' ? value.shapeTuning : {};
    var width = clampNumber(raw.width, 0.75, 1.25, 1);
    var height = clampNumber(raw.height, 0.75, 1.25, 1);
    var softness = clampNumber(raw.softness, 0, 1, 0.5);
    var asymmetry = clampNumber(raw.asymmetry, -1, 1, 0);
    if (legacy && width === 1 && height === 1 && softness === 0.5 && asymmetry === 0) return null;

    var source = root.EB_RINGS && root.EB_RINGS.SHAPES && root.EB_RINGS.SHAPES[shape];
    var local = legacy ? legacyOutline(shape, softness, source) : newOutline(shape, softness);
    var maxExtent = 0;
    var ring = local.map(function (point) {
      var x = point[0] * width + asymmetry * 9 * point[1] / 110;
      var y = point[1] * height + asymmetry * 4 * point[0] / 110;
      maxExtent = Math.max(maxExtent, Math.abs(x), Math.abs(y));
      return [x, y];
    });
    /* The body remains inside the fixed SVG viewBox even at slider extremes. */
    var fit = Math.min(1, 126 / maxExtent);
    ring = ring.map(function (point) { return [C + point[0] * fit, C + point[1] * fit]; });

    var baseFace = legacy && source ? source.face : FACES[shape] || FACES.dumpling;
    return {
      ring: ring,
      face: { x: baseFace.x, y: baseFace.y, sx: baseFace.sx, sy: baseFace.sy,
        eye: baseFace.eye, rightEyeX: baseFace.rightEyeX, rightEyeY: baseFace.rightEyeY,
        expressionMotion: baseFace.expressionMotion, eyeXScale: baseFace.eyeXScale,
        eyeYScale: baseFace.eyeYScale,
        eyeGuard: baseFace.eyeGuard && { maxWidth: baseFace.eyeGuard.maxWidth,
          maxHeight: baseFace.eyeGuard.maxHeight, minGap: baseFace.eyeGuard.minGap,
          minTopFraction: baseFace.eyeGuard.minTopFraction,
          maxBottomFraction: baseFace.eyeGuard.maxBottomFraction } },
      tiltScale: legacy && source ? source.tiltScale : 1
    };
  }

  return Object.freeze({ createShape: createShape });
}));
