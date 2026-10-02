/* A small, passive portrait made from the same shape data as the desktop pet. */
(() => {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const C = 114.2705;
  const cache = new WeakMap();
  const element = (name, attributes = {}) => {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const pathFor = ring => `${ring.map(([x, y], index) =>
    `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')} Z`;
  const tint = (hex, amount) => {
    const value = parseInt(hex.slice(1), 16);
    const target = amount < 0 ? 0 : 255;
    const factor = Math.abs(amount);
    const channels = [16, 8, 0].map(shift =>
      Math.round(((value >> shift) & 255) * (1 - factor) + target * factor));
    return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
  };
  const centroid = ring => ring.reduce((sum, [x, y]) => [sum[0] + x, sum[1] + y], [0, 0])
    .map(value => value / ring.length);

  function drawFrontEyes(svg, appearance) {
    // The portrait faces the reader even when the desktop pet is looking around.
    // Keep its two eyes upright and level; the existing CSS still blinks each eye.
    const shapeScale = appearance.shape === 'square' ? .82 :
      appearance.shape === 'cloud' ? .9 : appearance.shape === 'aurora-cloud' ? .95 : 1;
    const width = 12 * shapeScale * appearance.eyeScale;
    const height = 36 * shapeScale * appearance.eyeScale;
    const spacing = 36 * shapeScale * appearance.eyeSpacing;
    const centerX = C + (appearance.shape === 'aurora-cloud' ? -12 : 0);
    const centerY = C - (appearance.shape === 'aurora-cloud' ? 31 :
      appearance.shape === 'cloud' ? 19 : 24) + appearance.eyeHeight;
    const eyes = element('g', { class: 'avatar-eyes' });
    for (const offset of [-spacing / 2, spacing / 2]) {
      eyes.appendChild(element('rect', {
        class: 'avatar-eye',
        x: (centerX + offset - width / 2).toFixed(2),
        y: (centerY - height / 2).toFixed(2),
        width: width.toFixed(2), height: height.toFixed(2),
        rx: (width / 2).toFixed(2), fill: appearance.eyeColor
      }));
    }
    svg.appendChild(eyes);
  }

  function drawEyes(svg, appearance, shape) {
    if (appearance.idleEyes === 'original') return drawFrontEyes(svg, appearance);
    const face = shape.face;
    const original = window.EB_RINGS.EXPRESSIONS[0];
    const preset = window.PetCustomization.EYE_PRESETS[appearance.idleEyes];
    const expression = window.EB_RINGS.EXPRESSIONS[preset === null ? 0 : preset] || original;
    const eyes = element('g', { class: 'avatar-eyes' });
    const motion = Number.isFinite(face.expressionMotion) ? face.expressionMotion : 1;
    for (let index = 0; index < 2; index++) {
      const ring = expression[index];
      const base = centroid(original[index]);
      const current = centroid(ring);
      let scaleX = face.eye * (face.eyeXScale || 1) * appearance.eyeScale *
        (index === 1 ? face.rightEyeX || 1 : 1);
      let scaleY = face.eye * (face.eyeYScale || 1) * appearance.eyeScale *
        (index === 1 ? face.rightEyeY || 1 : 1);
      // At icon size, keep cloud eyes separate even when the user's size slider is high.
      if (appearance.shape === 'cloud' || appearance.shape === 'aurora-cloud') {
        scaleX *= .78;
        scaleY *= .88;
      }
      if (face.eyeGuard) {
        const xs = ring.map(point => point[0]);
        const ys = ring.map(point => point[1]);
        const fit = Math.min(1,
          face.eyeGuard.maxWidth / ((Math.max(...xs) - Math.min(...xs)) * scaleX),
          face.eyeGuard.maxHeight / ((Math.max(...ys) - Math.min(...ys)) * scaleY));
        scaleX *= fit;
        scaleY *= fit;
      }
      const x = C + face.x + ((base[0] - C) * face.sx +
        (current[0] - base[0]) * motion) * appearance.eyeSpacing;
      const y = C + face.y + appearance.eyeHeight + (base[1] - C) * face.sy +
        (current[1] - base[1]) * motion;
      const placement = element('g', {
        transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scaleX.toFixed(3)} ${scaleY.toFixed(3)}) translate(${-current[0].toFixed(2)} ${-current[1].toFixed(2)})`
      });
      placement.appendChild(element('path', {
        class: 'avatar-eye', d: pathFor(ring), fill: appearance.eyeColor
      }));
      eyes.appendChild(placement);
    }
    svg.appendChild(eyes);
  }

  function drawBody(svg, appearance, shape) {
    const outline = pathFor(shape.ring);
    const defs = element('defs');
    const clip = element('clipPath', { id: 'chat-avatar-clip' });
    const texture = window.PetCustomization.auroraReferenceTexture(appearance, shape, 'light');
    clip.appendChild(element('path', { d: texture?.clipPathD || outline }));
    defs.appendChild(clip);

    if (texture) {
      svg.appendChild(defs);
      const material = element('g', { class: 'avatar-material',
        opacity: (1 - appearance.auroraTransparency / 100).toFixed(2) });
      material.appendChild(element('image', {
        href: texture.baseSrc,
        x: texture.x, y: texture.y,
        width: texture.width, height: texture.height,
        preserveAspectRatio: 'none', 'clip-path': 'url(#chat-avatar-clip)',
        ...(texture.flipX ? { transform: 'translate(228.541 0) scale(-1 1)' } : {})
      }));
      svg.appendChild(material);
      return;
    }

    if (appearance.shape === 'aurora-cloud' && appearance.auroraStyle === 'simple') {
      const reference = appearance.bodyColor === '#5B3BC7';
      const colors = reference
        ? ['#A98BFF', '#8B72FF', '#675EFF', '#5757ED']
        : [tint(appearance.bodyColor, .4), tint(appearance.bodyColor, .22),
          appearance.bodyColor, tint(appearance.bodyColor, -.12)];
      const gradient = element('linearGradient', {
        id: 'chat-avatar-simple', x1: '0%', y1: '0%', x2: '0%', y2: '100%'
      });
      colors.forEach((color, index) => gradient.appendChild(element('stop', {
        offset: ['0%', '42%', '76%', '100%'][index], 'stop-color': color
      })));
      defs.appendChild(gradient);
      svg.appendChild(defs);
      const material = element('g', { class: 'avatar-material',
        opacity: (1 - appearance.auroraTransparency / 100).toFixed(2) });
      material.appendChild(element('path', { d: outline, fill: 'url(#chat-avatar-simple)' }));
      svg.appendChild(material);
      return;
    }

    if (appearance.shape === 'aurora-cloud') {
      const material = element('g', { class: 'avatar-material',
        opacity: (1 - appearance.auroraTransparency / 100).toFixed(2) });
      material.appendChild(element('path', { d: outline, fill: appearance.bodyColor }));
      const pink = element('radialGradient', { id: 'chat-avatar-pink', cx: '42%', cy: '65%', r: '53%' });
      pink.append(element('stop', { offset: '0%', 'stop-color': appearance.glowPinkColor, 'stop-opacity': '.9' }),
        element('stop', { offset: '100%', 'stop-color': appearance.glowPinkColor, 'stop-opacity': '0' }));
      const gold = element('radialGradient', { id: 'chat-avatar-gold', cx: '54%', cy: '35%', r: '42%' });
      gold.append(element('stop', { offset: '0%', 'stop-color': appearance.glowGoldColor, 'stop-opacity': '.85' }),
        element('stop', { offset: '100%', 'stop-color': appearance.glowGoldColor, 'stop-opacity': '0' }));
      defs.append(pink, gold);
      svg.insertBefore(defs, svg.firstChild);
      material.append(element('path', { d: outline, fill: 'url(#chat-avatar-pink)' }),
        element('path', { d: outline, fill: 'url(#chat-avatar-gold)' }));
      svg.appendChild(material);
    } else {
      svg.appendChild(element('path', { d: outline, fill: appearance.bodyColor }));
      const shade = element('radialGradient', { id: 'chat-avatar-shade', cx: '35%', cy: '28%', r: '79%' });
      shade.append(element('stop', { offset: '0%', 'stop-color': '#FFFFFF', 'stop-opacity': '.25' }),
        element('stop', { offset: '55%', 'stop-color': '#FFFFFF', 'stop-opacity': '0' }),
        element('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': '.16' }));
      defs.appendChild(shade);
      svg.insertBefore(defs, svg.firstChild);
      svg.appendChild(element('path', { d: outline, fill: 'url(#chat-avatar-shade)' }));
    }
  }

  function render(target, rawAppearance) {
    if (!target) return;
    const appearance = window.PetCustomization.normalizeAppearance(rawAppearance);
    const key = JSON.stringify(appearance);
    if (cache.get(target) === key) return;
    const shape = window.EB_CUSTOM_SHAPES.createShape(appearance) ||
      window.EB_RINGS.SHAPES[appearance.shape] || window.EB_RINGS.SHAPES.blob;
    const svg = element('svg', { viewBox: '-15 -15 259 259', 'aria-hidden': 'true' });
    if (appearance.shape !== 'aurora-cloud') svg.setAttribute('opacity', (1 - appearance.auroraTransparency / 100).toFixed(2));
    drawBody(svg, appearance, shape);
    drawEyes(svg, appearance, shape);
    target.dataset.shape = appearance.shape;
    target.replaceChildren(svg);
    cache.set(target, key);
  }

  window.PetChatAvatar = Object.freeze({ render });
})();
