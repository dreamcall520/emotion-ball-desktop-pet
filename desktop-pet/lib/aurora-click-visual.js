/* Click-only artwork for the aurora cloud. The pet owns timing and eye visibility. */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var CENTER = 114.2705;
  var nextId = 0;

  function svgNode(name, attributes) {
    var node = document.createElementNS(NS, name);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    return node;
  }

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, finite(value, 0)));
  }

  function number(value) {
    return Math.round(value * 100) / 100;
  }

  function spiral(cx, cy, direction) {
    var points = [];
    var segments = 48;
    for (var i = 0; i <= segments; i++) {
      var fraction = i / segments;
      var radius = 1.5 + 17.5 * fraction;
      var theta = -0.72 + direction * fraction * Math.PI * 4.7;
      points.push((i ? 'L' : 'M') + number(cx + Math.cos(theta) * radius) + ' ' +
        number(cy + Math.sin(theta) * radius));
    }
    return points.join('');
  }

  function create(container) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('AuroraClickVisual.create requires a DOM container');
    }

    var id = 'aurora-click-' + (++nextId);
    var previousPosition = container.style.position;
    var ownsPosition = root.getComputedStyle(container).position === 'static';
    if (ownsPosition) container.style.position = 'relative';

    var layer = document.createElement('div');
    layer.className = 'aurora-click-visual';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.visibility = 'hidden';

    var svg = svgNode('svg', {
      viewBox: '-3 -3 235 235',
      width: '100%', height: '100%',
      preserveAspectRatio: 'xMidYMid meet',
      'aria-hidden': 'true', focusable: 'false'
    });
    var defs = svgNode('defs');
    var warmBlur = svgNode('filter', {
      id: id + '-warm-blur', x: '-70%', y: '-70%', width: '240%', height: '240%'
    });
    warmBlur.appendChild(svgNode('feGaussianBlur', { stdDeviation: '7.4' }));
    defs.appendChild(warmBlur);
    var spotBlur = svgNode('filter', {
      id: id + '-spot-blur', x: '-90%', y: '-90%', width: '280%', height: '280%'
    });
    spotBlur.appendChild(svgNode('feGaussianBlur', { stdDeviation: '5.2' }));
    defs.appendChild(spotBlur);
    svg.appendChild(defs);

    var body = svgNode('g');
    svg.appendChild(body);

    var dizzy = svgNode('g', { class: 'aurora-click-visual__dizzy' });
    dizzy.appendChild(svgNode('ellipse', {
      class: 'aurora-click-visual__glow', cx: '96', cy: '105', rx: '38', ry: '27',
      fill: '#F95697', opacity: '.52', filter: 'url(#' + id + '-warm-blur)'
    }));
    dizzy.appendChild(svgNode('ellipse', {
      class: 'aurora-click-visual__glow', cx: '93', cy: '98', rx: '17', ry: '16',
      fill: '#FF9A8C', opacity: '.46', filter: 'url(#' + id + '-warm-blur)'
    }));
    var dizzyFace = svgNode('g');
    var spiralEyes = [[104, 96, 1], [146, 98, -1]].map(function (eye) {
      var group = svgNode('g');
      var curve = spiral(eye[0], eye[1], eye[2]);
      group.appendChild(svgNode('path', { class: 'aurora-click-visual__spiral-halo', d: curve }));
      group.appendChild(svgNode('path', { class: 'aurora-click-visual__spiral', d: curve }));
      dizzyFace.appendChild(group);
      return group;
    });
    dizzy.appendChild(dizzyFace);
    body.appendChild(dizzy);

    var turn = svgNode('g', { class: 'aurora-click-visual__turn' });
    var turnLights = svgNode('g');
    turnLights.appendChild(svgNode('ellipse', {
      class: 'aurora-click-visual__glow', cx: '100', cy: '111', rx: '23', ry: '25',
      fill: '#FF744F', opacity: '.78', filter: 'url(#' + id + '-spot-blur)'
    }));
    turnLights.appendChild(svgNode('ellipse', {
      class: 'aurora-click-visual__glow', cx: '112', cy: '110', rx: '22', ry: '24',
      fill: '#F498AA', opacity: '.8', filter: 'url(#' + id + '-spot-blur)'
    }));
    turnLights.appendChild(svgNode('ellipse', {
      class: 'aurora-click-visual__glow', cx: '127', cy: '107', rx: '21', ry: '26',
      fill: '#58F5CE', opacity: '.9', filter: 'url(#' + id + '-spot-blur)'
    }));
    turnLights.appendChild(svgNode('ellipse', {
      cx: '128', cy: '107', rx: '8', ry: '16',
      fill: '#6CFBE2', opacity: '.48'
    }));
    [[102, 94, 3.7], [108, 105, 3.1], [102, 116, 2.5]].forEach(function (spark) {
      turnLights.appendChild(svgNode('circle', {
        class: 'aurora-click-visual__spark', cx: spark[0], cy: spark[1], r: spark[2]
      }));
    });
    turn.appendChild(turnLights);
    body.appendChild(turn);
    layer.appendChild(svg);
    container.appendChild(layer);

    var destroyed = false;
    function clear() {
      if (destroyed) return;
      layer.style.visibility = 'hidden';
      dizzy.style.display = 'none';
      turn.style.display = 'none';
      container.style.removeProperty('--aurora-click-eye-opacity');
    }

    function set(mode, progress, frame, facing) {
      if (destroyed) return;
      if (mode !== 'dizzy' && mode !== 'turn') {
        clear();
        return;
      }
      var p = clamp01(progress);
      var source = frame && frame.body ? frame.body : {};
      var scale = finite(source.scale, 1);
      var xScale = scale * finite(source.scaleX, 1);
      var yScale = scale * finite(source.scaleY, 1);
      body.setAttribute('transform',
        'translate(' + number(CENTER + finite(source.x, 0)) + ' ' +
          number(CENTER + finite(source.y, 0)) + ') ' +
        'rotate(' + number(finite(source.rotate, 0)) + ') ' +
        'scale(' + number(xScale) + ' ' + number(yScale) + ') ' +
        'translate(' + number(-CENTER) + ' ' + number(-CENTER) + ')');

      layer.style.visibility = 'visible';
      dizzy.style.display = mode === 'dizzy' ? '' : 'none';
      turn.style.display = mode === 'turn' ? '' : 'none';
      if (mode === 'dizzy') {
        var fade = Math.min(1, p / 0.07, (1 - p) / 0.17);
        dizzy.style.opacity = String(number(Math.max(0, fade)));
        container.style.setProperty('--aurora-click-eye-opacity',
          String(number(clamp01((p - 0.80) / 0.18))));
        var flipped = facing === 'left' || facing === -1;
        dizzyFace.setAttribute('transform',
          (flipped ? 'translate(8 0) translate(' + number(2 * CENTER) + ' 0) scale(-1 1) ' : '') +
          'translate(' + number(Math.sin(p * Math.PI * 7) * 1.8) + ' 0)');
        spiralEyes.forEach(function (eye, index) {
          eye.setAttribute('transform', 'rotate(' + number((index ? -1 : 1) * p * 720) +
            ' ' + (index ? 146 : 104) + ' ' + (index ? 98 : 96) + ')');
        });
      } else {
        /* The cloud's profile follows yaw; keep the eyes visible until they
         * turn out of view and bring them back on the returning front. */
        var side = clamp01((1 - xScale) / 0.62);
        turn.style.opacity = String(number(Math.max(0, side * side)));
        var front = Math.max(0, Math.cos(finite(source.yaw, 0)));
        container.style.setProperty('--aurora-click-eye-opacity',
          String(number(clamp01(front * 1.08))));
        turnLights.setAttribute('transform',
          'rotate(' + number(-28 + p * 96) + ' 114 109)');
      }
    }

    function destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
      layer.remove();
      if (ownsPosition && container.style.position === 'relative') {
        container.style.position = previousPosition;
      }
    }

    clear();
    return { set: set, clear: clear, destroy: destroy };
  }

  root.AuroraClickVisual = Object.freeze({ create: create });
}(window));
