/* ============================================================
 * ball.js —— 渲染层（纯渲染，不含业务逻辑）
 *
 *   坐标系：viewBox -15 -15 259 259，头部中心 HEAD_C = 114.2705
 *   身体：形状轮廓环（blob 圆胖 / wedge 三角 / gem 菱形）折线路径
 *   眼睛：25 组表情眼环（48 点轮廓），由 engine 逐点插值后传入，
 *        本层负责球面投影、变换与 path 更新
 *   球面投影：按眼睛当前高度采样身体轮廓的局部半宽，经度换算 + 余弦压缩，
 *            自旋偏航时眼睛绕到背面自动隐藏（cos <= 0.02 判定）
 *   彩带：两种形态 ——
 *        自旋甩带（角速度达阈值时甩出、减速后回缩的 3D 轨道拖尾）
 *        常驻环带（低倾角水平轨道持续环绕，用于"思考中"等状态）
 *        均使用 5-stop 色相漂移渐变 + 头宽尾细轮廓 + 圆头封口
 *   撒花：一次性物理粒子（速度衰减 + 微重力 + 金色五角星混入）
 *   zzz：睡眠状态右上角循环漂浮的字母粒子
 * ============================================================ */
(function () {
  'use strict';

  var EB = (window.EmotionBall = window.EmotionBall || {});
  var RD = window.EB_RINGS;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var uid = 0;
  var TAU = Math.PI * 2;

  var HEAD_C = RD.HEAD_C;          /* 114.2705 */
  var EYE_HALF = RD.EYE_HALF;      /* 21 */
  var EXPR = RD.EXPRESSIONS;
  var STAR_GOLD = RD.STAR_GOLD;
  var CONFETTI_COLORS = ['#f9705c', '#5b95f0', '#3fbe86', '#f5b13f', '#9a72ee', '#35c3bd'];
  /* 五角星 path（内径比 0.42） */
  var STAR_PATH = (function () {
    var pts = [];
    for (var e = 0; e < 10; e++) {
      var a = -Math.PI / 2 + e * Math.PI / 5;
      var r = e % 2 === 0 ? 1 : 0.42;
      pts.push((Math.cos(a) * r).toFixed(3) + ' ' + (Math.sin(a) * r).toFixed(3));
    }
    return 'M' + pts.join('L') + 'Z';
  })();

  function el(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function shade(hex, amt) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var target = amt < 0 ? 0 : 255;
    var a = Math.abs(amt);
    r = Math.round(r + (target - r) * a);
    g = Math.round(g + (target - g) * a);
    b = Math.round(b + (target - b) * a);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function isNearBlack(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
    var value = parseInt(hex.slice(1), 16);
    return Math.max((value >> 16) & 255, (value >> 8) & 255, value & 255) <= 48;
  }

  /* 轮廓环 → 闭合折线 path；48 点密度下视觉平滑 */
  function ringPath(ring) {
    var s = 'M';
    for (var i = 0; i < ring.length; i++) {
      s += (i ? 'L' : '') + ring[i][0].toFixed(2) + ' ' + ring[i][1].toFixed(2);
    }
    return s + 'Z';
  }
  function centroid(ring) {
    var x = 0, y = 0;
    for (var i = 0; i < ring.length; i++) { x += ring[i][0]; y += ring[i][1]; }
    return [x / ring.length, y / ring.length];
  }

  /* Only the aurora's resting eyes use the reference's equal-width, rounded
   * strokes. Blend out as an expression starts so the other 24 eye shapes,
   * including sleeping and spiral eyes, keep their original silhouettes. */
  function auroraEyeRing(ring, index) {
    var reference = EXPR[0][index];
    if (!reference || ring.length !== reference.length || ring.length % 2) return ring;
    var distance = 0;
    for (var i = 0; i < ring.length; i++) {
      var dx = ring[i][0] - reference[i][0];
      var dy = ring[i][1] - reference[i][1];
      distance += dx * dx + dy * dy;
    }
    var blend = clamp(1 - Math.sqrt(distance / ring.length) / 18, 0, 1);
    if (blend === 0) return ring;

    var minY = Infinity, maxY = -Infinity;
    for (var j = 0; j < ring.length; j++) {
      minY = Math.min(minY, ring[j][1]);
      maxY = Math.max(maxY, ring[j][1]);
    }
    var height = maxY - minY;
    var center = centroid(ring);
    var radius = 9.5;
    var capHeight = Math.min(9, height * 0.23);
    var half = ring.length / 2;
    var rounded = ring.map(function (_point, pointIndex) {
      var fraction = pointIndex < half
        ? pointIndex / (half - 1)
        : (ring.length - 1 - pointIndex) / (half - 1);
      var u = (1 - Math.cos(Math.PI * fraction)) / 2;
      var y = minY + height * u;
      var endDistance = Math.min(y - minY, maxY - y);
      var cap = endDistance < capHeight
        ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - endDistance / capHeight, 2)))
        : 1;
      var midline = center[0] + 12 * (u - 0.5) + 6 * 4 * u * (1 - u);
      return [midline + (pointIndex < half ? radius : -radius) * cap, y];
    });
    var xOffset = center[0] - centroid(rounded)[0];
    return ring.map(function (point, pointIndex) {
      return [point[0] * (1 - blend) + (rounded[pointIndex][0] + xOffset) * blend,
        point[1] * (1 - blend) + rounded[pointIndex][1] * blend];
    });
  }

  function createBall(container, opts) {
    opts = opts || {};
    var id = 'eb' + (uid++);
    var lite = !!opts.lite;
    var liteRibbons = lite && opts.liteRibbons === true;
    var facing = opts.facing === 'left' ? -1 : 1;
    var suppliedShape = opts.customShape || opts.shapeData;
    var validCustomShape = suppliedShape && Array.isArray(suppliedShape.ring) &&
      suppliedShape.ring.length >= 24 && suppliedShape.ring.length <= 512 &&
      suppliedShape.ring.every(function (point) {
        return Array.isArray(point) && point.length === 2 &&
          Number.isFinite(point[0]) && Number.isFinite(point[1]);
      }) && suppliedShape.face &&
      ['x', 'y', 'sx', 'sy', 'eye'].every(function (key) { return Number.isFinite(suppliedShape.face[key]); });
    var shape = validCustomShape ? suppliedShape : (RD.SHAPES[opts.shape] || RD.SHAPES.blob);
    var eyeSpacing = Number.isFinite(opts.eyeSpacing) ? clamp(opts.eyeSpacing, 0.7, 1.3) : 1;
    var eyeHeight = Number.isFinite(opts.eyeHeight) ? clamp(opts.eyeHeight, -30, 30) : 0;
    var fittedEyes = !!validCustomShape || eyeSpacing !== 1 || eyeHeight !== 0;
    var face = shape.face;
    var headRing = shape.ring;
    var aurora = validCustomShape && opts.shape === 'aurora-cloud';
    var simpleAurora = aurora && opts.auroraStyle === 'simple';
    var auroraMotionPreference = aurora && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var eyeGuard = face.eyeGuard &&
      ['maxWidth', 'maxHeight', 'minGap'].every(function (key) {
        return Number.isFinite(face.eyeGuard[key]) && face.eyeGuard[key] > 0;
      }) ? face.eyeGuard : null;

    /* ---- 形状轮廓采样：每 2px 一行的 [minX, maxX]，供眼睛贴合任意身体轮廓 ---- */
    var silMinX = 1e9, silMaxX = -1e9, silMinY = 1e9, silMaxY = -1e9;
    var i, p;
    for (i = 0; i < headRing.length; i++) {
      if (headRing[i][0] < silMinX) silMinX = headRing[i][0];
      if (headRing[i][0] > silMaxX) silMaxX = headRing[i][0];
      if (headRing[i][1] < silMinY) silMinY = headRing[i][1];
      if (headRing[i][1] > silMaxY) silMaxY = headRing[i][1];
    }
    var SIL_STEP = 2;
    var silRows = [];
    (function buildSil() {
      var rows = Math.ceil((silMaxY - silMinY) / SIL_STEP) + 1;
      for (var r = 0; r < rows; r++) {
        var y = silMinY + r * SIL_STEP;
        var lo = 1e9, hi = -1e9;
        for (var e = 0; e < headRing.length; e++) {
          var a = headRing[e], b = headRing[(e + 1) % headRing.length];
          var y0 = a[1], y1 = b[1];
          if ((y0 <= y && y1 >= y) || (y1 <= y && y0 >= y)) {
            var t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
            var x = a[0] + (b[0] - a[0]) * t;
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          }
        }
        if (lo > hi) { lo = HEAD_C - 4; hi = HEAD_C + 4; }
        silRows.push([lo, hi]);
      }
    })();
    function silAt(y) {
      var r = Math.round((clamp(y, silMinY, silMaxY) - silMinY) / SIL_STEP);
      return silRows[clamp(r, 0, silRows.length - 1)];
    }
    function roomAt(y, halfHeight) {
      var lo = -Infinity, hi = Infinity;
      for (var yy = y - halfHeight; yy < y + halfHeight; yy += eyeGuard ? 2 : 4) {
        var row = silAt(yy);
        lo = Math.max(lo, row[0]);
        hi = Math.min(hi, row[1]);
      }
      var last = silAt(y + halfHeight);
      return [Math.max(lo, last[0]), Math.min(hi, last[1])];
    }

    /* ---- SVG 骨架 ---- */
    var svg = el('svg', {
      // 幻彩云的参考轮廓已留出内边距，在桌面窗口里再套通用留白会显得矮胖且偏小。
      viewBox: aurora ? '-3 -3 235 235' : '-15 -15 259 259',
      width: '100%',
      height: '100%',
      role: 'img',
      'aria-label': opts.label || 'AI 表情小球'
    });
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    var defs = el('defs', {});
    var grad = aurora
      ? el('linearGradient', { id: id + 'g', x1: '0%', y1: '0%', x2: '0%', y2: '100%' })
      : el('radialGradient', { id: id + 'g',
        cx: opts.shape === 'cloud' ? '48%' : '38%',
        cy: opts.shape === 'cloud' ? '50%' : '32%',
        r: opts.shape === 'cloud' ? '71%' : '75%' });
    var stopA = el('stop', { offset: '0%' });
    var stopB = el('stop', { offset: aurora ? '42%' : opts.shape === 'cloud' ? '50%' : '62%' });
    var stopC = el('stop', { offset: aurora ? '76%' : '100%' });
    var stopD = aurora ? el('stop', { offset: '100%' }) : null;
    grad.appendChild(stopA); grad.appendChild(stopB); grad.appendChild(stopC);
    if (stopD) grad.appendChild(stopD);
    defs.appendChild(grad);
    var auroraGlows = null;
    var auroraHalo = null;
    var auroraFallbackStar = null;
    var auroraStarAngle = 0;
    var auroraStarHover = 0;
    var auroraStarLastTime = null;
    var auroraTextureAnimator = null;
    var auroraRimStops = null;
    var auroraRimPaths = [];
    if (aurora && !simpleAurora) {
      var auroraColors = [
        /^#[0-9a-f]{6}$/i.test(opts.glowPinkColor || '') ? opts.glowPinkColor : '#D05ED6',
        /^#[0-9a-f]{6}$/i.test(opts.glowGoldColor || '') ? opts.glowGoldColor : '#D0AD8A'
      ];
      [['pink', auroraColors[0]], ['gold', auroraColors[1]]].forEach(function (entry) {
        var light = el('radialGradient', { id: id + entry[0], cx: '50%', cy: '50%', r: '50%' });
        var referenceGold = entry[0] === 'gold' && entry[1].toUpperCase() === '#D0AD8A';
        light.appendChild(el('stop', { offset: '0%',
          'stop-color': referenceGold ? '#FFD78B' : shade(entry[1], entry[0] === 'gold' ? 0.22 : 0.24),
          'stop-opacity': entry[0] === 'gold' ? '0.82' : '1' }));
        light.appendChild(el('stop', { offset: '50%', 'stop-color': entry[1],
          'stop-opacity': entry[0] === 'gold' ? '0.45' : '0.74' }));
        light.appendChild(el('stop', { offset: '100%', 'stop-color': entry[1], 'stop-opacity': '0' }));
        defs.appendChild(light);
      });
      var rimGradient = el('linearGradient', { id: id + 'rim', x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
      auroraRimStops = [
        el('stop', { offset: '0%', 'stop-opacity': '0.86' }),
        el('stop', { offset: '31%', 'stop-opacity': '0.38' }),
        el('stop', { offset: '55%', 'stop-opacity': '0.04' }),
        el('stop', { offset: '83%', 'stop-opacity': '0.62' }),
        el('stop', { offset: '100%', 'stop-opacity': '0.96' })
      ];
      auroraRimStops.forEach(function (stop) { rimGradient.appendChild(stop); });
      defs.appendChild(rimGradient);
      var haloFilter = el('filter', { id: id + 'halo', x: '-15%', y: '-15%', width: '130%', height: '130%' });
      haloFilter.appendChild(el('feGaussianBlur', { stdDeviation: '1.4' }));
      defs.appendChild(haloFilter);
      var volumeFilter = el('filter', { id: id + 'volumeBlur', x: '-17%', y: '-17%', width: '134%', height: '134%' });
      volumeFilter.appendChild(el('feGaussianBlur', { stdDeviation: '4.8' }));
      defs.appendChild(volumeFilter);
      var starBlur = el('filter', { id: id + 'starBlur', x: '-25%', y: '-25%', width: '150%', height: '150%' });
      starBlur.appendChild(el('feGaussianBlur', { stdDeviation: '2.8' }));
      defs.appendChild(starBlur);
      var eyeGlowFilter = el('filter', { id: id + 'eyeGlow', x: '-45%', y: '-45%', width: '190%', height: '190%' });
      eyeGlowFilter.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '2.4', result: 'glow' }));
      var glowMerge = el('feMerge', {});
      glowMerge.appendChild(el('feMergeNode', { in: 'glow' }));
      glowMerge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
      eyeGlowFilter.appendChild(glowMerge);
      defs.appendChild(eyeGlowFilter);
    }
    var bodyClipPath = null;
    if (fittedEyes) {
      var bodyClip = el('clipPath', { id: id + 'clip', clipPathUnits: 'userSpaceOnUse' });
      bodyClipPath = el('path', { d: ringPath(headRing) });
      bodyClip.appendChild(bodyClipPath);
      defs.appendChild(bodyClip);
    }
    svg.appendChild(defs);

    var fxBack = el('g', { 'pointer-events': 'none' });
    svg.appendChild(fxBack);

    var bodyG = el('g', {});
    /* Keep the cloud material translucent as a single composited layer.
     * Its eyes stay outside this group so they remain solid and legible. */
    var transparency = Number.isFinite(opts.auroraTransparency)
      ? clamp(opts.auroraTransparency, 0, 60) : 24;
    var materialG = aurora ? el('g', { class: 'eb-aurora-material',
      opacity: r2(1 - transparency / 100) }) : bodyG;
    if (aurora) bodyG.appendChild(materialG);
    function syncAuroraFacing() {
      if (!aurora) return;
      // A little more height and tilt bring out the lower lobe; mirroring swaps it with the gaze.
      materialG.setAttribute('transform',
        (facing < 0 ? 'translate(228.541 0) scale(-1 1) ' : '') +
        'translate(0 -2.29) scale(1 1.02) rotate(3.2 114.2705 114.2705)');
    }
    syncAuroraFacing();
    if (aurora && !simpleAurora) {
      auroraHalo = el('path', { d: ringPath(headRing), fill: 'none',
        stroke: '#8166D9', 'stroke-width': '2.5', 'stroke-opacity': '0.17',
        filter: 'url(#' + id + 'halo)', 'pointer-events': 'none' });
      materialG.appendChild(auroraHalo);
    }
    var head = el('path', { class: 'eb-head', d: ringPath(headRing), fill: 'url(#' + id + 'g)', stroke: 'none', 'stroke-width': '2' });
    materialG.appendChild(head);
    if (aurora && !simpleAurora) {
      var bodyWidth = silMaxX - silMinX, bodyHeight = silMaxY - silMinY;
      auroraGlows = el('g', { 'clip-path': 'url(#' + id + 'clip)', 'pointer-events': 'none' });
      /* Gold and pink overlap as one soft internal light source. Offset,
       * tapered ellipses avoid the appearance of separate circular stickers. */
      auroraGlows.appendChild(el('ellipse', {
        cx: r2(silMinX + bodyWidth * 0.59), cy: r2(silMinY + bodyHeight * 0.56),
        rx: r2(bodyWidth * 0.42), ry: r2(bodyHeight * 0.39),
        fill: 'url(#' + id + 'pink)'
      }));
      auroraGlows.appendChild(el('ellipse', {
        cx: r2(silMinX + bodyWidth * 0.66), cy: r2(silMinY + bodyHeight * 0.57),
        rx: r2(bodyWidth * 0.3), ry: r2(bodyHeight * 0.23),
        fill: 'url(#' + id + 'pink)', opacity: '0.3'
      }));
      auroraGlows.appendChild(el('ellipse', {
        cx: r2(silMinX + bodyWidth * 0.56), cy: r2(silMinY + bodyHeight * 0.32),
        rx: r2(bodyWidth * 0.3), ry: r2(bodyHeight * 0.34),
        fill: 'url(#' + id + 'gold)',
        transform: 'rotate(-17 ' + r2(silMinX + bodyWidth * 0.56) + ' ' +
          r2(silMinY + bodyHeight * 0.32) + ')'
      }));
      auroraGlows.appendChild(el('ellipse', {
        cx: r2(silMinX + bodyWidth * 0.44), cy: r2(silMinY + bodyHeight * 0.4),
        rx: r2(bodyWidth * 0.23), ry: r2(bodyHeight * 0.19),
        fill: 'url(#' + id + 'gold)', opacity: '0.24'
      }));
      auroraGlows.appendChild(el('ellipse', {
        cx: r2(silMinX + bodyWidth * 0.30), cy: r2(silMinY + bodyHeight * 0.39),
        rx: r2(bodyWidth * 0.19), ry: r2(bodyHeight * 0.15),
        fill: 'url(#' + id + 'gold)', opacity: '0.58'
      }));
      /* The broad blurred stroke supplies 15–20 units of translucent depth;
       * the narrow clipped stroke is the 2–6 unit refracted inner edge. */
      var broadRim = el('path', {
        d: ringPath(headRing), fill: 'none', stroke: 'url(#' + id + 'rim)',
        'stroke-width': '29', 'stroke-opacity': '0.75',
        filter: 'url(#' + id + 'volumeBlur)'
      });
      var fineRim = el('path', {
        d: ringPath(headRing), fill: 'none', stroke: 'url(#' + id + 'rim)',
        'stroke-width': '3.5', 'stroke-opacity': '0.86'
      });
      auroraRimPaths = [broadRim, fineRim];
      auroraGlows.appendChild(broadRim);
      auroraGlows.appendChild(fineRim);
      materialG.appendChild(auroraGlows);
    }

    /* Optional reference artwork replaces only the aurora body's SVG material.
     * A second, eyeless image can repair the baked eye pixels under a soft
     * local mask while live expressions/blinks use the normal SVG eye paths. */
    var auroraTexture = null;
    var auroraTextureLoaded = false;
    var auroraRepair = null;
    var auroraRepairLoaded = false;
    var textureClipPath = null;
    var textureInput = opts.auroraBodyTexture;
    var textureSrc = textureInput && (textureInput.baseSrc || textureInput.src);
    var repairSrc = textureInput && textureInput.repairSrc;
    var wantsRepair = typeof repairSrc === 'string' && !!repairSrc.trim();
    var repairRegions = [];
    if (wantsRepair && Array.isArray(textureInput.repairEyeRegions)) {
      repairRegions = textureInput.repairEyeRegions.map(function (region) {
        if (Array.isArray(region)) {
          return { x: region[0], y: region[1], width: region[2], height: region[3] };
        }
        return region;
      }).filter(function (region) {
        return region && ['x', 'y', 'width', 'height'].every(function (key) {
          return Number.isFinite(region[key]);
        }) && region.width > 0 && region.height > 0;
      });
    }
    var repairGeometry = wantsRepair && textureInput ? {
      x: Number.isFinite(textureInput.repairX) ? textureInput.repairX : textureInput.x,
      y: Number.isFinite(textureInput.repairY) ? textureInput.repairY : textureInput.y,
      width: Number.isFinite(textureInput.repairWidth) ? textureInput.repairWidth : textureInput.width,
      height: Number.isFinite(textureInput.repairHeight) ? textureInput.repairHeight : textureInput.height
    } : null;
    var validRepair = wantsRepair && repairRegions.length === 2 &&
      ['x', 'y', 'width', 'height'].every(function (key) { return Number.isFinite(repairGeometry[key]); }) &&
      repairGeometry.width > 0 && repairGeometry.height > 0;
    var referenceGlowColors =
      (!opts.glowPinkColor || (typeof opts.glowPinkColor === 'string' &&
        opts.glowPinkColor.toUpperCase() === '#D05ED6')) &&
      (!opts.glowGoldColor || (typeof opts.glowGoldColor === 'string' &&
        opts.glowGoldColor.toUpperCase() === '#D0AD8A'));
    if (aurora && !simpleAurora && referenceGlowColors && (!wantsRepair || validRepair) &&
        (!textureInput || !textureInput.bakedEyesEligible || validRepair) &&
        typeof textureSrc === 'string' && textureSrc.trim() &&
        ['x', 'y', 'width', 'height'].every(function (key) { return Number.isFinite(textureInput[key]); }) &&
        textureInput.width > 0 && textureInput.height > 0) {
      var textureAttrs = {
        x: textureInput.x, y: textureInput.y,
        width: textureInput.width, height: textureInput.height,
        preserveAspectRatio: 'none', opacity: '0', 'pointer-events': 'none'
      };
      if (textureInput.flipX) textureAttrs.transform = 'translate(228.541 0) scale(-1 1)';
      var textureClipRef = null;
      if (typeof textureInput.clipPathD === 'string' && textureInput.clipPathD.trim()) {
        var textureClip = el('clipPath', { id: id + 'textureClip', clipPathUnits: 'userSpaceOnUse' });
        textureClipPath = el('path', { d: textureInput.clipPathD });
        textureClip.appendChild(textureClipPath);
        defs.appendChild(textureClip);
        textureClipRef = 'url(#' + id + 'textureClip)';
        textureAttrs['clip-path'] = textureClipRef;
      }
      var textureFilterRef = null;
      if (textureInput.liftPurpleShadows === true) {
        /* The approved artwork has very dark violet lobes at desktop size.
         * Lift only blue-dominant shadows; white eyes and the gold/pink light
         * have no blue-over-red mask and retain their original pixels. */
        var shadowLift = el('filter', {
          id: id + 'shadowLift', x: '-5%', y: '-5%', width: '110%', height: '110%',
          'color-interpolation-filters': 'sRGB'
        });
        shadowLift.appendChild(el('feColorMatrix', {
          in: 'SourceGraphic', type: 'matrix', result: 'violet',
          values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.4 0 3.4 0 0'
        }));
        shadowLift.appendChild(el('feColorMatrix', {
          in: 'SourceGraphic', type: 'matrix', result: 'shadow',
          values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 0 0.75'
        }));
        shadowLift.appendChild(el('feComposite', {
          in: 'violet', in2: 'shadow', operator: 'in', result: 'violetShadow'
        }));
        shadowLift.appendChild(el('feFlood', {
          'flood-color': '#785DE8', 'flood-opacity': '0.45', result: 'coolLight'
        }));
        shadowLift.appendChild(el('feComposite', {
          in: 'coolLight', in2: 'violetShadow', operator: 'in', result: 'maskedLight'
        }));
        shadowLift.appendChild(el('feBlend', {
          in: 'SourceGraphic', in2: 'maskedLight', mode: 'screen'
        }));
        defs.appendChild(shadowLift);
        textureFilterRef = 'url(#' + id + 'shadowLift)';
        textureAttrs.filter = textureFilterRef;
      } else {
        // Soften the baked electric-blue rim and lift the violet midtones on
        // the single transparent image; its alpha and the live eyes stay intact.
        var textureTone = el('filter', {
          id: id + 'textureTone', x: '-5%', y: '-5%', width: '110%', height: '110%',
          'color-interpolation-filters': 'sRGB'
        });
        textureTone.appendChild(el('feColorMatrix', {
          type: 'saturate', values: '0.82'
        }));
        textureTone.appendChild(el('feColorMatrix', {
          type: 'matrix',
          values: '1 0 0.08 0 0  0 1 0 0 0  0 0 0.82 0 0  0 0 0 1 0'
        }));
        var depth = el('feComponentTransfer', {});
        ['R', 'G', 'B'].forEach(function (channel) {
          depth.appendChild(el('feFunc' + channel, { type: 'gamma', exponent: '1.2' }));
        });
        textureTone.appendChild(depth);
        defs.appendChild(textureTone);
        textureFilterRef = 'url(#' + id + 'textureTone)';
        textureAttrs.filter = textureFilterRef;
      }
      auroraTexture = el('image', textureAttrs);
      if (typeof auroraTexture.addEventListener === 'function') {
        auroraTexture.addEventListener('load', function () {
          auroraTextureLoaded = true;
          updateAuroraTexture();
        });
        auroraTexture.addEventListener('error', function () {
          auroraTextureLoaded = false;
          updateAuroraTexture();
        });
      }
      auroraTexture.setAttribute('href', textureSrc);
      materialG.appendChild(auroraTexture);

      // Turn the painted light within the one material image. Keep its soft
      // edges integrated with the original cloud instead of drawing a star.
      if (typeof Image === 'function' && typeof document.createElement === 'function') {
        var sourceImage = new Image();
        sourceImage.onload = function () {
          try {
            var size = 229, centerX = 125, centerY = 109;
            var baseCanvas = document.createElement('canvas');
            var turnCanvas = document.createElement('canvas');
            var frameCanvas = document.createElement('canvas');
            [baseCanvas, turnCanvas, frameCanvas].forEach(function (canvas) {
              canvas.width = size; canvas.height = size;
            });
            var baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
            var turnContext = turnCanvas.getContext('2d', { willReadFrequently: true });
            var frameContext = frameCanvas.getContext('2d');
            if (!baseContext || !turnContext || !frameContext) return;
            baseContext.drawImage(sourceImage, 0, 0, size, size);
            var basePixels = baseContext.getImageData(0, 0, size, size).data;
            var framePixels = baseContext.createImageData(size, size);
            var weights = new Float32Array(size * size);
            for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
              var distance = Math.hypot(x - centerX, y - centerY);
              var edge = clamp((60 - distance) / 28, 0, 1);
              weights[y * size + x] = edge * edge * (3 - 2 * edge);
            }
            var lastFrame = -Infinity;
            auroraTextureAnimator = function (angle, scale, time) {
              if (time - lastFrame < 40) return;
              lastFrame = time;
              turnContext.clearRect(0, 0, size, size);
              turnContext.save();
              turnContext.translate(centerX, centerY);
              turnContext.rotate(angle * Math.PI / 180);
              turnContext.scale(scale, scale);
              turnContext.translate(-centerX, -centerY);
              turnContext.drawImage(sourceImage, 0, 0, size, size);
              turnContext.restore();
              var turned = turnContext.getImageData(0, 0, size, size).data;
              for (var pixel = 0; pixel < weights.length; pixel++) {
                var weight = weights[pixel], offset = pixel * 4;
                for (var channel = 0; channel < 4; channel++) {
                  framePixels.data[offset + channel] =
                    basePixels[offset + channel] * (1 - weight) + turned[offset + channel] * weight;
                }
              }
              frameContext.putImageData(framePixels, 0, 0);
              auroraTexture.setAttribute('href', frameCanvas.toDataURL('image/png'));
            };
          } catch (_) { auroraTextureAnimator = null; }
        };
        sourceImage.src = textureSrc;
      }

      if (validRepair) {
        var repairBlur = el('filter', { id: id + 'repairBlur',
          x: '-50%', y: '-50%', width: '200%', height: '200%' });
        repairBlur.appendChild(el('feGaussianBlur', { stdDeviation: '2.5' }));
        defs.appendChild(repairBlur);
        var repairMask = el('mask', { id: id + 'repairMask', maskUnits: 'userSpaceOnUse',
          x: '-30', y: '-30', width: '320', height: '320', 'mask-type': 'alpha' });
        repairRegions.forEach(function (region) {
          repairMask.appendChild(el('rect', {
            x: region.x, y: region.y, width: region.width, height: region.height,
            rx: '6', fill: '#FFFFFF', filter: 'url(#' + id + 'repairBlur)'
          }));
        });
        defs.appendChild(repairMask);
        var repairAttrs = {
          x: repairGeometry.x, y: repairGeometry.y,
          width: repairGeometry.width, height: repairGeometry.height,
          preserveAspectRatio: 'none', opacity: '0', 'pointer-events': 'none',
          mask: 'url(#' + id + 'repairMask)'
        };
        if (textureClipRef) repairAttrs['clip-path'] = textureClipRef;
        if (textureFilterRef) repairAttrs.filter = textureFilterRef;
        auroraRepair = el('image', repairAttrs);
        if (typeof auroraRepair.addEventListener === 'function') {
          auroraRepair.addEventListener('load', function () {
            auroraRepairLoaded = true;
            updateAuroraTexture();
          });
          auroraRepair.addEventListener('error', function () {
            auroraRepairLoaded = false;
            updateAuroraTexture();
          });
        }
        auroraRepair.setAttribute('href', repairSrc);
        materialG.appendChild(auroraRepair);
      }
    }

    if (aurora && !simpleAurora) {
      /* One soft four-point light moves within the same translucent material. */
      var starPath = 'M0 -64 C10 -22 22 -10 64 0 C22 10 10 22 0 64 ' +
        'C-10 22 -22 10 -64 0 C-22 -10 -10 -22 0 -64 Z';
      if (!auroraTexture) {
        auroraFallbackStar = el('path', { d: starPath, class: 'eb-aurora-fallback-star',
          fill: 'url(#' + id + 'pink)', opacity: '0.65',
          filter: 'url(#' + id + 'starBlur)', 'pointer-events': 'none' });
        materialG.appendChild(auroraFallbackStar);
      }
    }

    function buildEye(k) {
      var node = el('path', {
        class: 'eb-eye',
        fill: '#1A1A1A',
        stroke: 'none',
        'stroke-width': '1.6'
      });
      if (aurora && !simpleAurora) node.setAttribute('filter', 'url(#' + id + 'eyeGlow)');
      node.setAttribute('d', ringPath(EXPR[0][k]));
      return { node: node, sourceRing: null, ring: EXPR[0][k], c: centroid(EXPR[0][k]) };
    }
    var eyeG = fittedEyes ? el('g', { 'clip-path': 'url(#' + id + 'clip)' }) : bodyG;
    if (fittedEyes) bodyG.appendChild(eyeG);
    var eyeL = buildEye(0);
    var eyeR = buildEye(1);
    eyeG.appendChild(eyeL.node);
    eyeG.appendChild(eyeR.node);
    svg.appendChild(bodyG);

    var fxFront = el('g', { 'pointer-events': 'none' });
    svg.appendChild(fxFront);

    /* 眼睛基准中心：默认表情环的质心 */
    var BASE_C = [centroid(EXPR[0][0]), centroid(EXPR[0][1])];

    /* ---- zzz 睡眠粒子：三枚字母沿右上方向循环漂浮 ---- */
    var zzzNodes = [];
    for (var zi = 0; zi < 3; zi++) {
      var zn = el('text', {
        class: 'eb-sleep-z',
        x: 0, y: 0, fill: '#68635B', stroke: '#F3F0EA', opacity: '0',
        'stroke-width': '1.2', 'paint-order': 'stroke fill',
        'font-family': "'Space Grotesk', 'Noto Sans SC', sans-serif",
        'font-weight': '700', 'font-style': 'italic', 'text-anchor': 'middle'
      });
      zn.textContent = 'z';
      fxFront.appendChild(zn);
      zzzNodes.push(zn);
    }

    container.appendChild(svg);

    /* ---- 彩带：3D 轨道拖尾 ---- */
    var trails = [];
    var planes = [];
    var planeG = 4;
    var baseHue = 0;
    var spawnAt = [];
    var spawnIdx = 0;
    var wasFast = false;
    var prevYaw = 0, prevNow = 0;
    var orbitNextAt = 0;
    var confPieces = [];

    function makePlanes() {
      /* 多轨道面交错：2~3 个不同倾角 / 滚转的平面，彩带轮流落在各面上，
       * 甩出的弧线在多个角度方向上交错，而非单一平面里的一组平行弧 */
      planes = [];
      var n = Math.random() < 0.45 ? 2 : 3;
      var roll0 = rand(-0.9, 0.9);
      for (var pi = 0; pi < n; pi++) {
        planes.push({
          tilt: rand(0.16, 0.72),
          roll: roll0 + pi * (Math.PI / n) + rand(-0.15, 0.15)
        });
      }
      planeG = Math.round(rand(4, 6));
      baseHue = rand(0, 360);
      spawnIdx = 0;
    }

    function orbitPoint(o, lam) {
      var hx = o.rad * Math.sin(lam);
      var hy = -o.rad * Math.cos(lam) * Math.sin(o.tilt);
      var ca = Math.cos(o.roll), sa = Math.sin(o.roll);
      return {
        x: HEAD_C + hx * ca - hy * sa,
        y: HEAD_C + hx * sa + hy * ca,
        z: Math.cos(lam) * Math.cos(o.tilt),
        l: lam
      };
    }

    /** 创建一条拖尾：独立 5-stop 渐变 + 前后两段 path */
    function createTrail(cfg) {
      if (trails.length > 8) return;
      var gradEl = el('linearGradient', { id: id + 'tg' + (uid++), gradientUnits: 'userSpaceOnUse' });
      var stops = [];
      for (var s = 0; s < 5; s++) {
        var st = el('stop', { offset: (s / 4).toFixed(3) });
        gradEl.appendChild(st);
        stops.push(st);
      }
      defs.appendChild(gradEl);
      var fill = 'url(#' + gradEl.getAttribute('id') + ')';
      var back = el('path', { stroke: 'none', fill: fill, opacity: '0' });
      var front = el('path', { stroke: 'none', fill: fill, opacity: '0' });
      fxBack.appendChild(back);
      fxFront.appendChild(front);
      trails.push({
        o: cfg.o, r: cfg.r, life: 0, ret: 0, hist: [],
        orbitMode: !!cfg.orbit,
        hue: cfg.hue,
        hueSpan: rand(45, 95) * (Math.random() < 0.5 ? 1 : -1),
        hueVel: rand(18, 42) * (Math.random() < 0.5 ? 1 : -1),
        gradEl: gradEl, stops: stops, back: back, front: front
      });
    }

    /** 自旋甩带：沿本次自旋的多个轨道平面轮流错峰甩出 */
    function spawnTrail(lam0, dir) {
      var pl = planes[spawnIdx % planes.length];
      var tierStep = 38 / Math.max(planeG - 1, 1);
      var rw = planeG <= 3 ? rand(8, 10.5) : planeG === 4 ? rand(6.6, 8.6) : rand(5.6, 7.4);
      createTrail({
        o: {
          lam: lam0, lamVel: dir * rand(0.5, 1.1),
          tilt: pl.tilt + rand(-0.04, 0.04),
          roll: pl.roll + rand(-0.05, 0.05),
          rad: 116 + spawnIdx * tierStep + rand(-1.5, 1.5),
          radVel: rand(0, 2.5),
          follow: rand(0.74, 0.94),
          carry: 0,
          arc: rand(2.2, 3.4)
        },
        r: rw,
        hue: baseHue + 360 * spawnIdx / Math.max(planeG, 1) + rand(-14, 14)
      });
      spawnIdx++;
    }

    /** 常驻环带：低倾角水平轨道匀速环绕（"思考中"等状态的持续效果） */
    function spawnOrbit(idx) {
      createTrail({
        orbit: true,
        o: {
          lam: rand(0, TAU),
          lamVel: (Math.random() < 0.5 ? -1 : 1) * rand(1.7, 2.3),
          tilt: rand(0.1, 0.22),
          roll: rand(-0.12, 0.12),
          rad: 124 + idx * 16,
          radVel: 0,
          follow: 0.8,
          carry: 0,
          arc: rand(2.4, 3.2)
        },
        r: rand(5.5, 7),
        hue: rand(0, 360)
      });
    }

    /* 拖尾轮廓：头宽尾细 + 首尾圆头封口，按 z 正负拆为前 / 后两段 */
    function buildTrail(pts, width) {
      var n = pts.length;
      var nx = [], ny = [], e;
      for (e = 0; e < n; e++) {
        var p0 = pts[e > 0 ? e - 1 : 0], p1 = pts[e < n - 1 ? e + 1 : n - 1];
        var dx = p1.x - p0.x, dy = p1.y - p0.y;
        var h = Math.hypot(dx, dy) || 1;
        dx /= h; dy /= h;
        var d = width * (0.5 + (e / (n - 1)) * 0.5) / 2;
        nx.push(-dy * d); ny.push(dx * d);
      }
      function cap(idx) {
        var hw = Math.max(Math.hypot(nx[idx], ny[idx]), 0.2);
        return 'A' + r2(hw) + ' ' + r2(hw) + ' 0 0 0 ';
      }
      function seg(a, b) {
        var s = '', k;
        for (k = a; k <= b; k++) s += (k === a ? 'M' : 'L') + r2(pts[k].x + nx[k]) + ' ' + r2(pts[k].y + ny[k]);
        s += b === n - 1 ? cap(b) : 'L';
        for (k = b; k >= a; k--) s += (k === b ? '' : 'L') + r2(pts[k].x - nx[k]) + ' ' + r2(pts[k].y - ny[k]);
        if (a === 0) s += cap(0) + r2(pts[0].x + nx[0]) + ' ' + r2(pts[0].y + ny[0]);
        return s + 'Z';
      }
      var front = '', back = '', d0 = 0;
      while (d0 < n) {
        var isF = pts[d0].z >= 0;
        var i2 = d0;
        while (i2 + 1 < n && (pts[i2 + 1].z >= 0) === isF) i2++;
        var a2 = Math.max(d0 - 1, 0), b2 = Math.min(i2 + 1, n - 1);
        if (b2 > a2) {
          var str = seg(a2, b2);
          if (isF) front += str; else back += str;
        }
        d0 = i2 + 1;
      }
      return { front: front, back: back };
    }

    function removeTrail(idx) {
      var rb = trails[idx];
      rb.back.remove(); rb.front.remove(); rb.gradEl.remove();
      trails.splice(idx, 1);
    }

    /* ---- 撒花：一次性物理粒子爆发 ---- */
    function burst(count) {
      if (lite) return;
      count = count || 20;
      for (var i = 0; i < count && confPieces.length < 60; i++) {
        var ang = (i / count) * TAU + rand(-0.35, 0.35);
        var spd = rand(170, 360);
        var star = Math.random() < 0.18;
        var round = !star && Math.random() < 0.3;
        var node;
        if (star) node = el('path', { d: STAR_PATH, fill: STAR_GOLD });
        else if (round) node = el('circle', { r: 1, fill: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0] });
        else node = el('rect', { x: -0.5, y: -0.5, width: 1, height: 1, rx: 0.24, fill: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0] });
        fxFront.appendChild(node);
        confPieces.push({
          x: HEAD_C + Math.cos(ang) * rand(96, 116),
          y: HEAD_C + Math.sin(ang) * rand(96, 116),
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - rand(20, 75),
          life: 0, max: rand(0.45, 0.85),
          r: star ? rand(4, 7) : rand(3.5, 8),
          rot: rand(0, 360), vr: rand(-260, 260),
          stretch: (!star && !round) ? 1.9 : 1,
          el: node
        });
      }
    }

    /* ---- 状态缓存 ---- */
    var curBodyColor = null;
    var curSketch = -1;
    var lastPose = null;

    function isOriginalEye(eyePose, originalRing) {
      if (!eyePose || !Array.isArray(eyePose.ring) || eyePose.ring.length !== originalRing.length ||
          !Number.isFinite(eyePose.open) || Math.abs(eyePose.open - 1) > 0.035 ||
          !Number.isFinite(eyePose.scaleX) || Math.abs(eyePose.scaleX - 1) > 0.025 ||
          !Number.isFinite(eyePose.scaleY) || Math.abs(eyePose.scaleY - 1) > 0.025 ||
          Math.abs(eyePose.x || 0) > 0.5 || Math.abs(eyePose.y || 0) > 0.5 ||
          Math.abs(eyePose.rotate || 0) > 0.5 ||
          Math.abs(eyePose.lookX || 0) > 2.5 || Math.abs(eyePose.lookY || 0) > 2.5 ||
          String(eyePose.color).toUpperCase() !== '#FFFFFF') return false;
      for (var point = 0; point < originalRing.length; point++) {
        if (Math.abs(eyePose.ring[point][0] - originalRing[point][0]) > 0.2 ||
            Math.abs(eyePose.ring[point][1] - originalRing[point][1]) > 0.2) return false;
      }
      return true;
    }

    function useBakedAuroraEyes() {
      return !!(!opts.liveAuroraEyes && auroraRepair && textureInput.bakedEyesEligible && lastPose && facing === 1 &&
        Math.abs(lastPose.body.yaw || 0) < 0.04 &&
        isOriginalEye(lastPose.left, EXPR[0][0]) && isOriginalEye(lastPose.right, EXPR[0][1]));
    }

    var turnMorph = 0;
    var lastTurnShape = -1;
    function updateTurnShape(amount) {
      if (!aurora || typeof opts.auroraTurnRing !== 'function') return;
      var next = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
      if (Math.abs(next - lastTurnShape) < 0.004) return;
      // Fade the approved still into the live body while both share the same
      // silhouette. Only then round the live outline for the turn, avoiding
      // two displaced contours and transparent corners in the middle frames.
      var shapeAmount = Math.max(0, (next - 0.18) / 0.82);
      var ring = shapeAmount < 0.001 ? headRing : opts.auroraTurnRing(headRing, shapeAmount);
      if (!ring) return;
      var d = ringPath(ring);
      head.setAttribute('d', d);
      if (bodyClipPath) bodyClipPath.setAttribute('d', d);
      if (auroraHalo) auroraHalo.setAttribute('d', d);
      for (var rim = 0; rim < auroraRimPaths.length; rim++) auroraRimPaths[rim].setAttribute('d', d);
      if (textureClipPath) {
        textureClipPath.setAttribute('d', shapeAmount < 0.001 ? textureInput.clipPathD : d);
      }
      turnMorph = next;
      lastTurnShape = next;
    }

    function updateAuroraTexture() {
      if (!auroraTexture) return;
      var active = auroraTextureLoaded && (!auroraRepair || auroraRepairLoaded) &&
        curSketch <= 0.5 &&
        typeof curBodyColor === 'string' && curBodyColor.toUpperCase() === '#5B3BC7';
      var bakedEyes = active && useBakedAuroraEyes();
      // The approved PNG has a fixed silhouette. As the turn rounds into a
      // four-corner cloud, blend it into the live gradient body so the new
      // corners remain filled rather than revealing transparent image pixels.
      var liveOpacity = Math.min(1, turnMorph / 0.18);
      var textureOpacity = active ? 1 - liveOpacity : 0;
      auroraTexture.setAttribute('opacity', r2(textureOpacity));
      if (auroraRepair) auroraRepair.setAttribute('opacity', active && !bakedEyes ? r2(textureOpacity) : '0');
      eyeG.setAttribute('display', bakedEyes ? 'none' : '');
      head.setAttribute('display', '');
      // Ease the fallback body in over the first frames of a turn. A sudden
      // fully opaque path shows through the artwork's feathered edge.
      // It then stays underneath the fading image so the cloud's material
      // does not briefly lose density in the middle of the motion.
      head.setAttribute('opacity', active ? r2(Math.min(1, turnMorph / 0.03)) : '1');
      if (auroraGlows) {
        auroraGlows.setAttribute('display', (active && turnMorph < 0.002) || curSketch > 0.5 ? 'none' : '');
        auroraGlows.setAttribute('opacity', active ? r2(liveOpacity) : '1');
      }
      if (auroraHalo) {
        auroraHalo.setAttribute('display', (active && turnMorph < 0.002) || curSketch > 0.5 ? 'none' : '');
        auroraHalo.setAttribute('opacity', active ? r2(liveOpacity) : '1');
      }
    }

    function setBodyColor(color) {
      if (color === curBodyColor) return;
      curBodyColor = color;
      if (aurora) {
        if (simpleAurora) {
          var originalSimple = color.toUpperCase() === '#5B3BC7';
          stopA.setAttribute('stop-color', originalSimple ? '#A98BFF' : shade(color, 0.4));
          stopB.setAttribute('stop-color', originalSimple ? '#8B72FF' : shade(color, 0.22));
          stopC.setAttribute('stop-color', originalSimple ? '#675EFF' : color);
          stopD.setAttribute('stop-color', originalSimple ? '#5757ED' : shade(color, -0.12));
        } else {
          var reference = color.toUpperCase() === '#5B3BC7';
          stopA.setAttribute('stop-color', reference ? '#0A0437' : shade(color, -0.82));
          stopB.setAttribute('stop-color', reference ? '#16084C' : shade(color, -0.73));
          stopC.setAttribute('stop-color', reference ? '#382189' : shade(color, -0.44));
          stopD.setAttribute('stop-color', reference ? '#4832A9' : shade(color, -0.27));
          if (auroraHalo) auroraHalo.setAttribute('stroke', reference ? '#8C82F4' : shade(color, 0.44));
          var rimColors = reference
            ? ['#C0B5FF', '#8276F5', '#291270', '#857AF4', '#9A91FF']
            : [0.56, 0.32, -0.48, 0.35, 0.58].map(function (amount) { return shade(color, amount); });
          rimColors.forEach(function (rimColor, index) {
            auroraRimStops[index].setAttribute('stop-color', rimColor);
          });
        }
      } else {
        var matteCloud = validCustomShape && opts.shape === 'cloud' && isNearBlack(color);
        var raisedCloud = validCustomShape && opts.shape === 'cloud' && !matteCloud;
        stopA.setAttribute('stop-color', matteCloud ? color : shade(color, raisedCloud ? 0.5 : 0.22));
        stopB.setAttribute('stop-color', raisedCloud ? shade(color, 0.08) : color);
        stopC.setAttribute('stop-color', matteCloud ? color : shade(color, raisedCloud ? -0.38 : -0.12));
      }
      if (curSketch > 0.5) head.style.stroke = 'var(--sketch-ink, ' + shade(color, -0.6) + ')';
    }

    /* ---- 眼睛：轮廓环形变 + 球面投影 ---- */
    function setEye(eye, pose, k, sketch, yaw, minOpen, gapFit, anchor) {
      /* d 更新：engine 传入插值后的环（引用不变则跳过）。
       * 缩放锚点用当前环自身质心 —— 眼环位置烘焙在数据里（如检索环偏向一侧），
       * 绕默认质心缩放会把位置偏差放大导致眼睛飞出身体 */
      var ring = pose.ring;
      if (ring && ring !== eye.sourceRing) {
        eye.sourceRing = ring;
        eye.ring = aurora ? auroraEyeRing(ring, k) : ring;
        eye.node.setAttribute('d', ringPath(eye.ring));
        eye.c = centroid(eye.ring);
      }

      var base = eye.c || BASE_C[k];
      var open = clamp(pose.open, minOpen || 0.02, 2.4);
      /* Gaze changes the stroke direction a few degrees, rather than only
       * sliding two fixed slashes across the cloud. This is screen-relative:
       * left/right facing still mirrors the original eye outline. */
      var eyeRotate = (pose.rotate || 0) * facing +
        (aurora ? clamp(-pose.lookX * 0.225, -4.5, 4.5) : 0);
      var rightEyeX = k === 1 && Number.isFinite(face.rightEyeX) ? face.rightEyeX : 1;
      var rightEyeY = k === 1 && Number.isFinite(face.rightEyeY) ? face.rightEyeY : 1;
      var sy = clamp(pose.scaleY * open * face.eye *
        (Number.isFinite(face.eyeYScale) ? face.eyeYScale : 1) * rightEyeY, 0.02, 2.4);
      var sxBase = pose.scaleX * face.eye *
        (Number.isFinite(face.eyeXScale) ? face.eyeXScale : 1) * rightEyeX * facing *
        (aurora ? -1 : 1);
      if (eyeGuard) {
        var minEyeX = Infinity, maxEyeX = -Infinity, minEyeY = Infinity, maxEyeY = -Infinity;
        for (var pointIndex = 0; pointIndex < eye.ring.length; pointIndex++) {
          var eyePoint = eye.ring[pointIndex];
          minEyeX = Math.min(minEyeX, eyePoint[0]);
          maxEyeX = Math.max(maxEyeX, eyePoint[0]);
          minEyeY = Math.min(minEyeY, eyePoint[1]);
          maxEyeY = Math.max(maxEyeY, eyePoint[1]);
        }
        var angle = Math.abs(eyeRotate) * Math.PI / 180;
        var cosAngle = Math.abs(Math.cos(angle)), sinAngle = Math.abs(Math.sin(angle));
        var projectedW = (maxEyeX - minEyeX) * Math.abs(sxBase) * cosAngle +
          (maxEyeY - minEyeY) * sy * sinAngle;
        var projectedH = (maxEyeY - minEyeY) * sy * cosAngle +
          (maxEyeX - minEyeX) * Math.abs(sxBase) * sinAngle;
        var footprintFit = Math.min(1, eyeGuard.maxWidth / Math.max(projectedW, 0.01),
          eyeGuard.maxHeight / Math.max(projectedH, 0.01));
        var totalFit = footprintFit * (gapFit == null ? 1 : gapFit);
        sxBase *= totalFit;
        sy *= totalFit;
      }

      /* 纵向：脸部拟合映射 + 轮廓钳制 */
      var eyeExtentX = eyeGuard
        ? Math.max(Math.abs(minEyeX - base[0]), Math.abs(maxEyeX - base[0])) : EYE_HALF;
      var eyeExtentY = eyeGuard
        ? Math.max(Math.abs(minEyeY - base[1]), Math.abs(maxEyeY - base[1])) : EYE_HALF;
      var halfH = eyeGuard
        ? eyeExtentY * sy * cosAngle + eyeExtentX * Math.abs(sxBase) * sinAngle + 4
        : EYE_HALF * sy + 2;
      /* Some expression rings encode a large positional jump. A cloud's
       * shallow lower lobes need a stable upper-face anchor at every idle
       * expression, while the eye outline itself can still morph normally. */
      var expressionMotion = Number.isFinite(face.expressionMotion)
        ? clamp(face.expressionMotion, 0, 1) : null;
      var faceY = expressionMotion === null
        ? (base[1] - HEAD_C) * face.sy
        : (BASE_C[k][1] - HEAD_C) * face.sy +
          (base[1] - BASE_C[k][1]) * expressionMotion;
      var ey0 = HEAD_C + face.y + eyeHeight + faceY + pose.y + pose.lookY;
      ey0 = clamp(ey0, silMinY + halfH, silMaxY - halfH);
      if (eyeGuard && Number.isFinite(eyeGuard.minTopFraction)) {
        var safeTop = silMinY + (silMaxY - silMinY) * eyeGuard.minTopFraction;
        ey0 = Math.max(ey0, safeTop + halfH);
      }
      if (eyeGuard && Number.isFinite(eyeGuard.maxBottomFraction)) {
        var safeBottom = silMinY + (silMaxY - silMinY) * eyeGuard.maxBottomFraction;
        ey0 = Math.min(ey0, safeBottom - halfH);
      }
      if (anchor) ey0 = anchor.ey;
      if (fittedEyes) {
        var minRoom = 2 * (eyeGuard
          ? eyeExtentX * Math.abs(sxBase) * cosAngle + eyeExtentY * sy * sinAngle + 4
          : EYE_HALF * Math.abs(sxBase) + 2) + 4;
        var initialRoom = roomAt(ey0, halfH);
        if (initialRoom[1] - initialRoom[0] < minRoom) {
          var nearest = ey0, nearestDistance = Infinity;
          for (var candidateY = silMinY + halfH; candidateY <= silMaxY - halfH; candidateY += 2) {
            var candidateRoom = roomAt(candidateY, halfH);
            var distance = Math.abs(candidateY - ey0);
            if (candidateRoom[1] - candidateRoom[0] >= minRoom && distance < nearestDistance) {
              nearest = candidateY;
              nearestDistance = distance;
            }
          }
          ey0 = nearest;
        }
      }

      var sil = silAt(ey0);
      var cx0 = (sil[0] + sil[1]) / 2;
      var hw = Math.max((sil[1] - sil[0]) / 2, 12);

      /* 横向：经度换算 + 自旋偏航 + 余弦压缩 */
      /* 朝向只镜像脸型的固有位置与轮廓；lookX 仍是屏幕坐标，
       * 因而鼠标向右时两种朝向都会向屏幕右侧注视。 */
      var eyeX = expressionMotion === null
        ? (base[0] - HEAD_C) * face.sx
        : (BASE_C[k][0] - HEAD_C) * face.sx +
          (base[0] - BASE_C[k][0]) * expressionMotion;
      var faceX = face.x + eyeX * eyeSpacing + pose.x;
      /* The aurora reference keeps its eyes on the upper middle even while
       * tracking a distant cursor; the generic gaze range is too wide here. */
      var ox = faceX * facing + pose.lookX * (aurora ? 0.5 : 1);
      var theta = clamp(ox / hw, -1.15, 1.15);
      var total = theta + (yaw || 0);
      var cn = Math.cos(total);
      if (cn <= 0.02) {
        eye.node.style.display = 'none';
        return null;
      }
      eye.node.style.display = '';
      var ex = cx0 + hw * Math.sin(total) * 0.985;
      var dyN = (ey0 - HEAD_C) / 130;
      var fy = Math.sqrt(1 - dyN * dyN * 0.22);

      if (fittedEyes) {
        /* Intersect the silhouette across the eye's full height. This and the
         * clip path keep edited eyes inside narrow egg/cloud corners. */
        var room = roomAt(ey0, halfH);
        var lo = room[0], hi = room[1];
        var eyeHalfW = eyeGuard
          ? eyeExtentX * Math.abs(sxBase * cn) * cosAngle + eyeExtentY * sy * fy * sinAngle + 4
          : EYE_HALF * Math.abs(sxBase * cn) + 2;
        if (hi > lo + 2 * eyeHalfW) ex = clamp(ex, lo + eyeHalfW, hi - eyeHalfW);
        else ex = (lo + hi) / 2;
      }
      if (anchor) ex = anchor.ex;

      eye.node.setAttribute('transform',
        'translate(' + r2(ex) + ' ' + r2(ey0) + ')' +
        (eyeRotate ? ' rotate(' + r2(eyeRotate) + ')' : '') +
        ' scale(' + r2(sxBase * cn) + ' ' + r2(sy * fy) + ')' +
        ' translate(' + r2(-base[0]) + ' ' + r2(-base[1]) + ')');

      var placement = null;
      if (eyeGuard) {
        var turn = eyeRotate * Math.PI / 180;
        var turnCos = Math.cos(turn), turnSin = Math.sin(turn);
        var extentLo = Infinity, extentHi = -Infinity;
        for (var edgeIndex = 0; edgeIndex < eye.ring.length; edgeIndex++) {
          var edgePoint = eye.ring[edgeIndex];
          var edgeX = (edgePoint[0] - base[0]) * sxBase * cn;
          var edgeY = (edgePoint[1] - base[1]) * sy * fy;
          var placedX = ex + edgeX * turnCos - edgeY * turnSin;
          extentLo = Math.min(extentLo, placedX);
          extentHi = Math.max(extentHi, placedX);
        }
        placement = { center: (extentLo + extentHi) / 2, minX: extentLo, maxX: extentHi,
          ex: ex, ey: ey0, halfH: halfH };
      }

      var fill = sketch > 0.5 ? 'none' : pose.color;
      /* 线稿眼描边同样走主题墨色：暗色页面用浅墨，避免深色瞳色几乎不可见 */
      var stroke = sketch > 0.5 ? 'var(--sketch-ink, ' + pose.color + ')' : '';
      if (fill !== eye.lastFill) { eye.node.setAttribute('fill', fill); eye.lastFill = fill; }
      if (stroke !== eye.lastStroke) { eye.node.style.stroke = stroke; eye.lastStroke = stroke; }
      return placement;
    }

    /* ---- zzz 睡眠粒子：轻量模式也保留，极小尺寸使用更醒目的字号 ---- */
    function renderZzz(now, amount) {
      var zOn = amount > 0;
      for (var z = 0; z < zzzNodes.length; z++) {
        var znode = zzzNodes[z];
        if (!zOn) {
          if (znode.getAttribute('opacity') !== '0') znode.setAttribute('opacity', '0');
          continue;
        }
        var zp = (now * 0.00033 + z / 3) % 1;
        var maxOpacity = lite ? 0.92 : 0.8;
        var zo = (zp < 0.18 ? zp / 0.18 : 1 - (zp - 0.18) / 0.82) * maxOpacity * amount;
        var fontSize = lite ? 16 + zp * 10 : 12 + zp * 11;
        var x = lite ? 172 + zp * 32 + 4 * Math.sin(zp * 9) : 180 + zp * 34 + 4 * Math.sin(zp * 9);
        if (facing < 0) x = HEAD_C * 2 - x;
        var y = lite ? 54 - zp * 42 : 48 - zp * 42;
        znode.setAttribute('opacity', zo.toFixed(3));
        znode.setAttribute('font-size', fontSize.toFixed(1));
        znode.setAttribute('transform',
          'translate(' + r2(x) + ' ' + r2(y) + ')' +
          ' rotate(' + r2(-10 + zp * 14) + ')');
      }
    }

    /* ---- 每帧 ---- */
    function applyPose(pose) {
      lastPose = pose;
      var b = pose.body;
      var now = performance.now();
      var sketch = b.sketch || 0;

      bodyG.setAttribute('transform',
        'translate(' + r2(HEAD_C + b.x) + ' ' + r2(HEAD_C + b.y) + ')' +
        ' rotate(' + r2(b.rotate || 0) + ')' +
        ' scale(' + r2(b.scale * (b.scaleX == null ? 1 : b.scaleX)) + ' ' +
          r2(b.scale * (b.scaleY == null ? 1 : b.scaleY)) + ')' +
        ' translate(' + r2(-HEAD_C) + ' ' + r2(-HEAD_C) + ')');
      setBodyColor(b.color);

      if (sketch !== curSketch) {
        curSketch = sketch;
        if (sketch > 0.5) {
          /* 线稿模式：描边优先取页面主题墨色 --sketch-ink（暗色页浅墨、亮色页深墨），
           * 无主题变量时回退体色加深 */
          head.setAttribute('fill', 'none');
          head.style.stroke = 'var(--sketch-ink, ' + shade(b.color, -0.6) + ')';
          head.setAttribute('stroke-opacity', '0.85');
          if (auroraGlows) auroraGlows.setAttribute('display', 'none');
          if (auroraHalo) auroraHalo.setAttribute('display', 'none');
          if (aurora) { eyeL.node.setAttribute('filter', 'none'); eyeR.node.setAttribute('filter', 'none'); }
        } else {
          head.setAttribute('fill', 'url(#' + id + 'g)');
          head.style.stroke = '';
          if (auroraGlows) auroraGlows.setAttribute('display', '');
          if (auroraHalo) auroraHalo.setAttribute('display', '');
          if (aurora && !simpleAurora) {
            eyeL.node.setAttribute('filter', 'url(#' + id + 'eyeGlow)');
            eyeR.node.setAttribute('filter', 'url(#' + id + 'eyeGlow)');
          }
        }
      }
      updateTurnShape(b.turnMorph);
      updateAuroraTexture();
      if (auroraTextureAnimator || auroraFallbackStar) {
        var reducedMotion = !!(auroraMotionPreference && auroraMotionPreference.matches);
        var starDt = auroraStarLastTime === null ? 0 : clamp((now - auroraStarLastTime) / 1000, 0, 0.1);
        auroraStarLastTime = now;
        var hovered = !reducedMotion && typeof container.matches === 'function' && container.matches(':hover');
        auroraStarHover += (Number(hovered) - auroraStarHover) * Math.min(1, starDt * 2);
        if (hovered) auroraStarAngle += starDt * 8 * auroraStarHover;
        else auroraStarAngle += (Math.round(auroraStarAngle / 360) * 360 - auroraStarAngle) * Math.min(1, starDt * 1.4);
        var wave = reducedMotion ? 0 : Math.sin(now * 0.00145);
        var wave2 = reducedMotion ? 0 : Math.sin(now * 0.00108 + 1.1);
        var starTransform =
          'translate(' + r2(125 + wave * 3.5) + ' ' + r2(94 + wave2 * 3) + ') ' +
          'rotate(' + r2(auroraStarAngle + wave * 2.6) + ') ' +
          'scale(' + r2(0.58 + wave2 * 0.055) + ' ' + r2(0.62 + wave * 0.06) + ')';
        if (auroraFallbackStar) {
          auroraFallbackStar.setAttribute('transform', starTransform);
          auroraFallbackStar.setAttribute('display', sketch > 0.5 ? 'none' : '');
        }
        if (auroraTextureAnimator && sketch <= 0.5) {
          auroraTextureAnimator(auroraStarAngle + wave * 3,
            1 + wave2 * 0.018, now);
        }
      }

      var yaw = b.yaw || 0;
      var minEyeOpen = lite && (b.zzz || 0) > 0 ? 0.22 : 0.02;
      var leftPlacement = setEye(eyeL, pose.left, 0, sketch, yaw, minEyeOpen);
      var rightPlacement = setEye(eyeR, pose.right, 1, sketch, yaw, minEyeOpen);
      if (eyeGuard && leftPlacement && rightPlacement) {
        var leftAnchor = leftPlacement, rightAnchor = rightPlacement;
        var gapFit = 1;
        for (var pass = 0; pass < 3; pass++) {
          var near = leftPlacement.center < rightPlacement.center ? leftPlacement : rightPlacement;
          var far = near === leftPlacement ? rightPlacement : leftPlacement;
          if (far.minX - near.maxX >= eyeGuard.minGap - 0.25) break;
          var halfWidths = (leftPlacement.maxX - leftPlacement.minX +
            rightPlacement.maxX - rightPlacement.minX) / 2;
          var centerDistance = Math.abs(leftPlacement.center - rightPlacement.center);
          var nextFit = clamp((centerDistance - eyeGuard.minGap) /
            Math.max(halfWidths, 0.01), 0.15, 1);
          /* Keep both eyes visible when a narrow edited silhouette cannot
           * accommodate their requested size. We can use the free horizontal
           * room for the remaining separation below. */
          var smaller = Math.max(0.5, gapFit * nextFit);
          if (smaller >= gapFit - 0.001) break;
          gapFit = smaller;
          leftPlacement = setEye(eyeL, pose.left, 0, sketch, yaw, minEyeOpen, gapFit, leftAnchor);
          rightPlacement = setEye(eyeR, pose.right, 1, sketch, yaw, minEyeOpen, gapFit, rightAnchor);
        }
        var nearEye = leftPlacement.center < rightPlacement.center ? leftPlacement : rightPlacement;
        var farEye = nearEye === leftPlacement ? rightPlacement : leftPlacement;
        var deficit = eyeGuard.minGap - (farEye.minX - nearEye.maxX);
        if (deficit > 0) {
          var nearRoom = roomAt(nearEye.ey, nearEye.halfH);
          var farRoom = roomAt(farEye.ey, farEye.halfH);
          var nearSlack = Math.max(0, nearEye.minX - nearRoom[0] - 2);
          var farSlack = Math.max(0, farRoom[1] - farEye.maxX - 2);
          var nearShift = Math.min(deficit / 2, nearSlack);
          var farShift = Math.min(deficit - nearShift, farSlack);
          nearShift += Math.min(deficit - nearShift - farShift, nearSlack - nearShift);
          if (nearShift + farShift > 0) {
            var nearAnchor = { ex: nearEye.ex - nearShift, ey: nearEye.ey };
            var farAnchor = { ex: farEye.ex + farShift, ey: farEye.ey };
            leftPlacement = setEye(eyeL, pose.left, 0, sketch, yaw, minEyeOpen, gapFit,
              nearEye === leftPlacement ? nearAnchor : farAnchor);
            rightPlacement = setEye(eyeR, pose.right, 1, sketch, yaw, minEyeOpen, gapFit,
              nearEye === rightPlacement ? nearAnchor : farAnchor);
          }
        }
      }

      renderZzz(now, b.zzz || 0);

      if (b.suppressRibbons) {
        // The reference click turn exposes the cloud's inner lights. Legacy
        // orbit ribbons would obscure it, and must not reappear after settling.
        for (var ri = trails.length - 1; ri >= 0; ri--) removeTrail(ri);
        spawnAt.length = 0;
        wasFast = false;
        prevYaw = b.yaw || 0;
        prevNow = now;
        return;
      }

      if (lite && !liteRibbons) return;

      var dt = prevNow ? clamp((now - prevNow) / 1000, 0.001, 0.05) : 1 / 60;
      prevNow = now;

      /* ---- 自旋角速度（甩带触发源） ---- */
      var dYaw = yaw - prevYaw;
      if (!isFinite(dYaw) || Math.abs(dYaw) > 1.2) dYaw = 0;
      prevYaw = yaw;
      var vel = dYaw / dt;
      var fast = Math.abs(vel) >= 0.9;
      var dir = vel >= 0 ? 1 : -1;

      if (fast && !wasFast) {
        makePlanes();
        spawnAt = [];
        for (var q = 0; q < planeG; q++) spawnAt.push(now + q * rand(55, 105));
      }
      if (!fast) spawnAt.length = 0;
      wasFast = fast;
      if (Math.abs(vel) >= 5) {
        while (spawnAt.length && now >= spawnAt[0]) {
          spawnAt.shift();
          spawnTrail(yaw - rand(0, 0.18) * dir, dir);
        }
      }

      /* ---- 常驻环带补给：状态需要且数量不足时错峰生成 ---- */
      var orbitWant = (b.orbit || 0) > 0;
      if (orbitWant && now >= orbitNextAt) {
        var orbitCount = 0;
        for (var oc = 0; oc < trails.length; oc++) if (trails[oc].orbitMode) orbitCount++;
        if (orbitCount < 2) spawnOrbit(orbitCount);
        orbitNextAt = now + 700;
      }

      /* ---- 彩带逐帧更新 ---- */
      for (var ti = trails.length - 1; ti >= 0; ti--) {
        var rb = trails[ti];
        rb.life += dt;
        var retract = rb.orbitMode ? !orbitWant : (!fast || rb.life > 5);
        rb.ret = clamp(rb.ret + (retract ? dt / 0.5 : -dt / 0.35), 0, 1);
        if (retract && rb.ret >= 1) { removeTrail(ti); continue; }
        var o = rb.o;
        if (rb.orbitMode) {
          /* 环带：匀速环绕，叠加少量自旋跟随 */
          o.lam += o.lamVel * dt + dYaw * o.follow;
        } else if (fast) {
          o.carry = vel * o.follow;
          o.lam += dYaw * o.follow + o.lamVel * dt;
        } else {
          o.lam += (o.carry + o.lamVel) * dt;
          o.carry *= Math.exp(-2.6 * dt);
          o.lamVel *= Math.exp(-2.6 * dt);
        }
        o.rad += o.radVel * dt;

        var hist = rb.hist;
        var lastL = hist.length ? hist[hist.length - 1].l : o.lam - 0.001 * dir;
        var dl = o.lam - lastL;
        var steps = Math.min(Math.ceil(Math.abs(dl) / 0.09), 24);
        for (var st = 1; st <= steps; st++) hist.push(orbitPoint(o, lastL + dl * st / steps));
        if (!hist.length) hist.push(orbitPoint(o, o.lam));

        /* 回缩：smoothstep 弧长收窄 + 首点插值细修 + 上限 48 点 */
        var span = o.arc * (1 - rb.ret * rb.ret * (3 - 2 * rb.ret));
        while (hist.length > 2 && Math.abs(o.lam - hist[0].l) > span) hist.shift();
        var over = Math.abs(o.lam - hist[0].l) - span;
        if (hist.length >= 2 && over > 0) {
          var tl = hist[0].l + (o.lam - hist[0].l >= 0 ? 1 : -1) * over;
          hist[0] = orbitPoint(o, tl);
        }
        if (hist.length > 48) hist.splice(0, hist.length - 48);

        var zHead = Math.cos(o.lam) * Math.cos(o.tilt);
        var pz = 0.72 + 0.28 * clamp(zHead, 0, 1);
        var grow = Math.min(rb.life / 0.34, 1);
        grow = grow * grow * (3 - 2 * grow);
        var width = rb.r * pz * 1.7 * grow * (1 - 0.72 * rb.ret * rb.ret);
        var fade = Math.min(rb.life / 0.26, 1).toFixed(3);

        if (hist.length < 2 || width < 0.5) {
          rb.back.setAttribute('opacity', '0');
          rb.front.setAttribute('opacity', '0');
          continue;
        }
        var dstr = buildTrail(hist, width);
        rb.back.setAttribute('d', dstr.back);
        rb.front.setAttribute('d', dstr.front);
        rb.back.setAttribute('opacity', fade);
        rb.front.setAttribute('opacity', fade);

        /* 5-stop 色相漂移渐变，端点跟随拖尾首尾 */
        var hue = rb.hue + rb.hueVel * rb.life;
        for (var si = 0; si < rb.stops.length; si++) {
          var frac = si / (rb.stops.length - 1);
          var hv = hue + frac * rb.hueSpan;
          rb.stops[si].setAttribute('stop-color',
            'hsl(' + (((hv % 360) + 360) % 360).toFixed(0) + ' 56% ' + (56 + 11 * frac).toFixed(0) + '%)');
        }
        var tail = hist[0], headP = hist[hist.length - 1];
        rb.gradEl.setAttribute('x1', tail.x.toFixed(1));
        rb.gradEl.setAttribute('y1', tail.y.toFixed(1));
        rb.gradEl.setAttribute('x2', headP.x.toFixed(1));
        rb.gradEl.setAttribute('y2', headP.y.toFixed(1));
      }

      /* 小尺寸可单独启用原生彩带，但仍跳过较重的撒花粒子。 */
      if (lite) return;

      /* ---- 撒花更新：速度衰减 0.94^60dt + 微重力 40/s ---- */
      for (var ci = confPieces.length - 1; ci >= 0; ci--) {
        var pc = confPieces[ci];
        pc.life += dt;
        if (pc.life >= pc.max) {
          pc.el.remove();
          confPieces.splice(ci, 1);
          continue;
        }
        pc.x += pc.vx * dt;
        pc.y += pc.vy * dt;
        var drag = Math.pow(0.94, 60 * dt);
        pc.vx *= drag;
        pc.vy = pc.vy * drag + 40 * dt;
        pc.rot += pc.vr * dt;
        var u = pc.life / pc.max;
        var fd = u < 0.1 ? u / 0.1 : Math.pow(1 - (u - 0.1) / 0.9, 1.7);
        var sz = Math.max(pc.r * (1 - 0.4 * u), 0.5);
        pc.el.setAttribute('opacity', fd.toFixed(3));
        pc.el.setAttribute('transform',
          'translate(' + r2(pc.x) + ' ' + r2(pc.y) + ') rotate(' + r2(pc.rot) + ') scale(' + r2(sz) + ' ' + r2(sz * pc.stretch) + ')');
      }
    }

    function destroy() {
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    }

    function setFacing(side) {
      if (side === 'left') facing = -1;
      else if (side === 'right') facing = 1;
      syncAuroraFacing();
    }

    return { svg: svg, applyPose: applyPose, burst: burst, setFacing: setFacing, destroy: destroy };
  }

  EB.createBall = createBall;
})();
