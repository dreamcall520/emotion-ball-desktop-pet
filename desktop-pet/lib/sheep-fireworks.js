(function (root) {
  'use strict';
  const COLORS = Object.freeze(['#f45d43', '#edb232', '#ed7ca4']);

  // Pure clock-driven state: the owner decides when this canvas is eligible to animate.
  function create(random = Math.random) {
    let nextAt = null, active = null, previousNow = null, scheduledSeason = null, sequence = 0;
    const unit = () => Math.min(1, Math.max(0, Number(random()) || 0));
    const gap = inSeason => inSeason ? 20000 + Math.round(unit() * 20000) : 120000 + Math.round(unit() * 180000);
    function reset() { nextAt = null; active = null; previousNow = null; scheduledSeason = null; }
    return {
      frame(now, enabled, inSeason = false, idle = true) {
        if (!enabled || !Number.isFinite(now)) { reset(); return null; }
        if (previousNow !== null && now < previousNow) reset();
        previousNow = now;
        const season = Boolean(inSeason);
        if (active && now - active.startedAt >= active.durationMs) {
          active = null;
        }
        // Brief idle interruptions hide the current show but retain the next deadline.
        // Only the owner's hard disable above resets the waiting clock.
        if (active && !idle) active = null;
        if (!active) {
          if (nextAt === null || scheduledSeason !== season) {
            nextAt = now + gap(season); scheduledSeason = season; return null;
          }
          if (!idle || now < nextAt) return null;
          const durationMs = 5000 + Math.round(unit() * 2000);
          const count = Math.min(8, 4 + Math.floor(unit() * 5));
          const firstSide = unit() < .5 ? 0 : 1;
          const bursts = Array.from({ length: count }, (_, index) => {
            const right = (firstSide + index) % 2 === 1;
            const slot = Math.floor(index / 2);
            const leftX = [48, 74, 52, 77][slot] + unit() * 4 - 2;
            const rocketMs = 1000 + Math.round(unit() * 400);
            const expandMs = 900, holdMs = 450, fallMs = 1900;
            const lifeMs = rocketMs + expandMs + holdMs + fallMs;
            return Object.freeze({
              x: right ? 320 - leftX : leftX,
              y: [56, 49, 82, 68][slot] + unit() * 4 - 2,
              startX: (right ? 283 : 22) + unit() * 15,
              startY: 284 + unit() * 12,
              radius: 30 + unit() * 14,
              delayMs: Math.round(index / (count - 1) * (durationMs - lifeMs)),
              rocketMs, expandMs, holdMs, fallMs, lifeMs,
              rays: 18 + Math.min(8, Math.floor(unit() * 9)),
              rotation: unit() * Math.PI * 2,
              colorIndex: Math.min(COLORS.length - 1, Math.floor(unit() * COLORS.length))
            });
          });
          active = { startedAt: now, durationMs, bursts: Object.freeze(bursts), id: ++sequence, inSeason: season };
          nextAt = now + durationMs + gap(season);
        }
        const elapsedMs = now - active.startedAt;
        return { key: `${active.id}:${Math.floor(elapsedMs * 30 / 1000)}`,
          progress: elapsedMs / active.durationMs, elapsedMs,
          durationMs: active.durationMs, bursts: active.bursts, inSeason: active.inSeason };
      }
    };
  }

  function draw(context, frame) {
    if (!context || !frame) return;
    context.save();
    try {
      context.globalCompositeOperation = 'source-over';
      context.lineCap = 'round';
      context.shadowBlur = 0;
      // Keep foreground face/hands clear even between the painted wool contours.
      const safe = (x, y) => x > 1 && x < 319 && y > 1 && y < 319 && !(x >= 80 && x <= 240 && y >= 95);
      const line = (x0, y0, x1, y1) => {
        if (!safe(x0, y0) || !safe(x1, y1)) return;
        context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1);
        // A sub-pixel warm keyline keeps sparks legible over pale desktops.
        // Both layers share the original fade; no opaque outline remains at the tail.
        const width = context.lineWidth, color = context.strokeStyle, alpha = context.globalAlpha;
        context.strokeStyle = '#81503e'; context.lineWidth = width + .85; context.globalAlpha = alpha * .66;
        context.stroke();
        context.strokeStyle = color; context.lineWidth = width; context.globalAlpha = alpha;
        context.stroke();
      };
      for (const burst of frame.bursts) {
        const age = frame.elapsedMs - burst.delayMs;
        if (age < 0 || age >= burst.lifeMs) continue;
        if (age < burst.rocketMs) {
          const t = age / burst.rocketMs;
          const point = u => {
            const rise = 1 - (1 - u) ** 1.25;
            return [burst.startX + (burst.x - burst.startX) * rise + Math.sin(u * Math.PI) * 2,
              burst.startY + (burst.y - burst.startY) * rise];
          };
          const head = point(t);
          for (let tail = 4; tail > 0; tail--) {
            const a = point(Math.max(0, t - tail * .045));
            const b = point(Math.max(0, t - (tail - 1) * .045));
            context.lineWidth = 1.3; context.globalAlpha = .2 + (4 - tail) * .16;
            context.strokeStyle = COLORS[burst.colorIndex]; line(...a, ...b);
          }
          context.lineWidth = 1.6; context.globalAlpha = .95; context.strokeStyle = '#ffe6a0';
          line(head[0] - 1.5, head[1], head[0] + 1.5, head[1]);
          line(head[0], head[1] - 2.3, head[0], head[1] + 2.3);
          continue;
        }
        const bloomAge = age - burst.rocketMs;
        const spread = Math.min(1, bloomAge / burst.expandMs);
        const fall = Math.min(1, Math.max(0, (bloomAge - burst.expandMs - burst.holdMs) / burst.fallMs));
        const radius = burst.radius * (1 - (1 - spread) ** 3) * (1 + fall * .1);
        const alpha = (1 - fall) ** .8 * .95;
        const tail = 2 + 6 * (1 - spread) + 2 * (1 - fall);
        const gravity = 36 * fall * fall;
        for (let index = 0; index < burst.rays; index++) {
          const angle = burst.rotation + index * Math.PI * 2 / burst.rays;
          const length = radius * (index % 2 ? .87 : 1);
          const inner = Math.max(0, length - tail);
          const x = burst.x + Math.cos(angle) * length, y = burst.y + Math.sin(angle) * length + gravity;
          context.globalAlpha = alpha * (.85 + .15 * Math.sin(bloomAge * .006 + index * 2.1));
          context.strokeStyle = COLORS[(burst.colorIndex + index) % COLORS.length];
          context.lineWidth = 1.3;
          line(burst.x + Math.cos(angle) * inner, burst.y + Math.sin(angle) * inner + gravity, x, y);
          if (index % 3 === 0 && spread > .2) {
            const star = .8 + 1.5 * (1 - fall);
            context.lineWidth = 1.05; context.strokeStyle = '#ffe7a5';
            line(x - star, y, x + star, y); line(x, y - star, x, y + star);
          }
        }
      }
    } finally { context.restore(); }
  }

  const api = { create, draw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SheepFireworks = api;
})(typeof window === 'undefined' ? globalThis : window);
