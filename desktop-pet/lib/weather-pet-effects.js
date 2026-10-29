/* Weather ornaments never replace the cloud body, eyes or motion owner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WeatherPetEffects = api;
}(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const MAX_AGE = 60 * 60 * 1000;

  function pollutionLevel(air) {
    if (!air || !Number.isFinite(air.aqi) || air.aqi < 0) return 0;
    const thresholds = air.standard === 'european' ? [60, 80, 100] :
      ['us', 'cn'].includes(air.standard) ? [100, 150, 200] : null;
    return thresholds ? thresholds.reduce((level, threshold) => level + (air.aqi > threshold ? 1 : 0), 0) : 0;
  }

  function describe(packet, now = Date.now()) {
    const updated = typeof packet?.updatedAt === 'number' ? packet.updatedAt : Date.parse(packet?.updatedAt);
    const current = packet?.current;
    if ((Number.isFinite(current?.time) && (current.time > now + 15 * 60000 || now - current.time > 90 * 60000)) || packet?.enabled === false || !current || !Number.isFinite(updated) || updated > now + 60000 || now - updated > MAX_AGE ||
        !Number.isInteger(current.weatherCode)) return { kind: 'none', pollution: 0 };
    const code = current.weatherCode;
    const kind = [45, 48].includes(code) ? 'fog' :
      [71, 73, 75, 77, 85, 86].includes(code) ? 'snow' :
      [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code) ? 'rain' :
      Number.isFinite(current.windSpeed) && current.windSpeed >= 28 ? 'wind' :
      current.isDay === false || current.isDay === 0 ? 'night' : code <= 2 ? 'sun' : 'none';
    return { kind, pollution: pollutionLevel(packet.airQuality) };
  }

  function ornamentsAllowed(state) {
    return state?.shape === 'cloud' && state.visible !== false && state.sleeping !== true &&
      state.busy !== true && state.atEdge !== true;
  }

  function eyeShadow(eye, bounds, baselineHeight) {
    if (!eye || !bounds || ![eye.left, eye.top, eye.width, eye.height, bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) ||
      eye.width <= 0 || eye.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return null;
    const height = Math.max(eye.height, Number.isFinite(baselineHeight) ? baselineHeight : eye.height);
    return { left: (eye.left - bounds.left - eye.width * .12) / bounds.width * 100,
      top: (eye.top + eye.height / 2 + height * .57 - bounds.top) / bounds.height * 100,
      width: eye.width * 1.24 / bounds.width * 100,
      height: Math.max(height * .12, bounds.height * .009) / bounds.height * 100 };
  }

  const AMBIENT_KINDS = new Set(['rain', 'snow', 'sun', 'night']);
  function ornamentMotion(kind, index, width = 120) {
    if (!AMBIENT_KINDS.has(kind) || !Number.isInteger(index) || index < 0 || index > 3) return null;
    const scale = Math.max(.7, Math.min(2.2, width / 120));
    if (kind === 'rain' || kind === 'snow') {
      const snow = kind === 'snow';
      const drift = (snow ? [-5, 4, -4, 6] : [-1.2, .6, -1.8, 1.1])[index] * scale;
      const fall = (snow ? [18, 25, 17, 16] : [10, 9, 12, 10])[index] * scale;
      return { keyframes: [
        { transform: 'translate(0, -2px) scale(.72)', opacity: 0, offset: 0 },
        { transform: `translate(${drift * .12}px, ${fall * .05}px) scale(1)`, opacity: snow ? .94 : .92, offset: .18 },
        { transform: `translate(${drift * .7}px, ${fall * .64}px) scale(.96)`, opacity: snow ? .88 : .84, offset: .7 },
        { transform: `translate(${drift}px, ${fall}px) scale(.65)`, opacity: 0, offset: 1 }
      ], options: { duration: (snow ? [2900, 3000, 2800, 3100] : [1350, 1450, 1300, 1500])[index],
        delay: (snow ? [0, 360, 720, 1080] : [0, 380, 760, 1140])[index], iterations: snow ? 2 : 3,
        easing: snow ? 'cubic-bezier(.35,.08,.45,.94)' : 'cubic-bezier(.46,.08,.78,.72)', fill: 'both' } };
    }
    if (index > 1) return null;
    const night = kind === 'night';
    return { keyframes: [
      { transform: 'scale(.6)', opacity: 0, offset: 0 },
      { transform: 'scale(1)', opacity: night ? .48 : .62, offset: .35 },
      { transform: 'scale(.87)', opacity: night ? .3 : .44, offset: .7 },
      { transform: 'scale(.6)', opacity: 0, offset: 1 }
    ], options: { duration: night ? 3500 : 2700, delay: index * 580, iterations: 1,
      easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' } };
  }

  function create(target, getContext) {
    if (!target || !target.ownerDocument) return null;
    const document = target.ownerDocument, view = document.defaultView;
    if (!view?.requestAnimationFrame) return null;
    const layer = document.createElement('div');
    layer.className = 'weather-pet-effects';
    layer.setAttribute('aria-hidden', 'true');
    const rings = [0, 1].map(() => {
      const node = document.createElement('span'); node.className = 'weather-eye-ring'; layer.appendChild(node); return node;
    });
    const ornament = document.createElement('div'); ornament.className = 'weather-cloud-ornament';
    for (let i = 0; i < 4; i++) {
      const node = document.createElement('i'); ornament.appendChild(node);
    }
    layer.appendChild(ornament);
    let packet = null, destroyed = false, burstAt = Date.now(), lastKind = null, frame = null;
    let eyeHeights = [0, 0], body = null;
    const animations = [];
    function stopParticles() { animations.splice(0).forEach(animation => animation.cancel()); }
    function stopFrame() { if (frame !== null) view.cancelAnimationFrame(frame); frame = null; }
    function playParticles(kind, width) {
      if (animations.length || typeof ornament.firstChild?.animate !== 'function') return;
      Array.from(ornament.children).forEach((node, index) => {
        const motion = ornamentMotion(kind, index, width);
        if (motion) animations.push(node.animate(motion.keyframes, motion.options));
      });
    }
    function sync() {
      if (destroyed) return;
      const state = typeof getContext === 'function' ? getContext() : {};
      const effect = describe(packet), now = Date.now();
      if (effect.kind !== lastKind) { lastKind = effect.kind; burstAt = now; stopParticles(); }
      const allowed = ornamentsAllowed(state);
      const burstDuration = ['rain', 'snow'].includes(effect.kind) ? 7600 : 4400;
      const ambient = allowed && state.reducedMotion !== true && AMBIENT_KINDS.has(effect.kind) && (now - burstAt) % 120000 < burstDuration;
      const visible = allowed && (effect.pollution > 0 || ambient);
      layer.hidden = !visible;
      if (!ambient) stopParticles();
      if (!visible) { stopFrame(); return; }
      if (layer.parentElement !== target) target.appendChild(layer);
      const bounds = target.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) { layer.hidden = true; stopFrame(); return; }
      layer.dataset.weather = effect.kind;
      layer.style.setProperty?.('--weather-pet-width', bounds.width + 'px');
      layer.dataset.pollution = String(effect.pollution);
      layer.dataset.static = String(state.reducedMotion === true);
      ornament.hidden = !ambient;
      layer.style.opacity = String(Number.isFinite(state.opacity) ? Math.max(0, Math.min(1, state.opacity)) : 1);
      const nextBody = target.querySelector(':scope > svg');
      if (body !== nextBody) { body = nextBody; eyeHeights = [0, 0]; }
      const eyes = target.querySelectorAll(':scope > svg .eb-eye');
      rings.forEach((ring, index) => {
        const eye = eyes[index]?.getBoundingClientRect();
        ring.hidden = !effect.pollution || !eye || eye.width <= 0 || eye.height <= 0;
        if (ring.hidden) return;
        eyeHeights[index] = Math.max(eyeHeights[index], eye.height / bounds.height);
        const shadow = eyeShadow(eye, bounds, eyeHeights[index] * bounds.height);
        ring.hidden = !shadow;
        if (!shadow) return;
        Object.entries(shadow).forEach(([key, value]) => { ring.style[key] = value + '%'; });
      });
      if (ambient) playParticles(effect.kind, bounds.width);
      if (frame === null) frame = view.requestAnimationFrame(() => { frame = null; sync(); });
    }
    const observer = typeof view.MutationObserver === 'function' ? new view.MutationObserver(sync) : null;
    observer?.observe(target, { attributes: true, attributeFilter: ['class', 'data-mode', 'data-motion-owner', 'data-shape', 'data-presentation', 'data-dragging'] });
    const timer = setInterval(sync, 1000);
    return {
      update(value) { packet = value; sync(); },
      sync,
      destroy() { destroyed = true; clearInterval(timer); stopFrame(); stopParticles(); observer?.disconnect(); layer.remove(); }
    };
  }
  return { MAX_AGE, pollutionLevel, describe, ornamentsAllowed, eyeShadow, ornamentMotion, create };
}));
