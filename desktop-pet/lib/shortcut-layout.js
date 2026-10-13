'use strict';

const IDS = ['chat', 'custom', 'note', 'todo', 'pomodoro', 'settings'];
const PAD = 12, GAP = 12;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const overlapsAxis = (start, length, otherStart, otherLength) => start < otherStart + otherLength && start + length > otherStart;

function layoutShortcuts({ petBounds: pet, workArea: area, shape = 'floating', side }) {
  for (const rect of [pet, area]) {
    if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) {
      throw new TypeError('Shortcut layout requires finite, positive rectangles');
    }
  }
  const room = { left: pet.x - area.x, right: area.x + area.width - pet.x - pet.width,
    above: pet.y - area.y, below: area.y + area.height - pet.y - pet.height };
  const cardSize = Math.max(pet.width, pet.height) <= 108 ? 52 : 58;
  const radius = Math.max(cardSize * 2 + 12, Math.ceil((Math.max(pet.width, pet.height) / 2 + cardSize / 2 + GAP) / Math.cos(Math.PI / 5)));
  const reach = radius + cardSize / 2 - Math.min(pet.width, pet.height) / 2 + PAD;
  const preferred = ({ left: 'right', right: 'left', top: 'below', bottom: 'above' })[side] ||
    (Math.min(room.above, room.below) <= reach || Math.max(room.left, room.right) < reach
      ? room.above >= room.below ? 'above' : 'below'
      : room.right >= room.left ? 'right' : 'left');
  const directions = [preferred, ...Object.keys(room).filter(key => key !== preferred).sort((a, b) => room[b] - room[a])];

  if (shape === 'floating') {
    const placed = (cards, direction) => {
      const x = Math.min(...cards.map(card => card.x)) - PAD, y = Math.min(...cards.map(card => card.y)) - PAD;
      const bounds = { x, y, width: Math.max(...cards.map(card => card.x + cardSize)) + PAD - x,
        height: Math.max(...cards.map(card => card.y + cardSize)) + PAD - y };
      if (bounds.x < area.x || bounds.y < area.y || bounds.x + bounds.width > area.x + area.width || bounds.y + bounds.height > area.y + area.height) return null;
      // Keep the transparent animation path to the pet inside the native canvas.
      const right = Math.ceil(Math.max(bounds.x + bounds.width, pet.x + pet.width)), bottom = Math.ceil(Math.max(bounds.y + bounds.height, pet.y + pet.height));
      bounds.x = Math.floor(Math.min(bounds.x, pet.x)); bounds.y = Math.floor(Math.min(bounds.y, pet.y));
      bounds.width = right - bounds.x; bounds.height = bottom - bounds.y;
      return { shape: 'floating', direction, bounds, cardSize,
        items: cards.map(card => ({ ...card, x: card.x - bounds.x, y: card.y - bounds.y })) };
    };
    const cornerReach = reach + cardSize;
    const nearX = Math.min(room.left, room.right), nearY = Math.min(room.above, room.below);
    const sx = nearX < cornerReach ? room.left <= room.right ? 1 : -1 : 0;
    const sy = nearY < cornerReach ? room.above <= room.below ? 1 : -1 : 0;
    if (sx && sy) {
      // A corner constrains both axes. Keep the real visual center and narrow
      // the fan toward the screen instead of clamping and shifting its center.
      const cx = pet.x + pet.width / 2, cy = pet.y + pet.height / 2, margin = PAD + cardSize / 2;
      const edgeX = sx === 1 ? cx - area.x : area.x + area.width - cx;
      const edgeY = sy === 1 ? cy - area.y : area.y + area.height - cy;
      const maxRadius = radius + 6;
      const horizontal = preferred === 'above' || preferred === 'below';
      // A six-card quarter circle cannot keep the normal spacing. Try only a
      // six-DIP radius adjustment; a compact arrangement handles tighter corners.
      for (let r = radius; r <= maxRadius; r++) {
        const limitX = Math.acos(clamp((margin - edgeX) / r, -1, 1));
        const limitY = Math.asin(clamp((margin - edgeY) / r, -1, 1));
        // Clip only the constrained angles of the existing semicircle. As the
        // pet leaves the corner, this becomes that same 180-degree arc/order.
        const start = horizontal ? Math.max(0, limitY) : Math.max(-Math.PI / 2, limitY, -limitX);
        const end = horizontal ? Math.min(Math.PI, limitX, Math.PI - limitY) : Math.min(Math.PI / 2, limitX);
        const cards = IDS.map((id, index) => {
          const order = (horizontal ? sx === 1 : sy === -1) ? IDS.length - 1 - index : index;
          const angle = start + (end - start) * order / (IDS.length - 1);
          return { id, x: Math.round(cx + sx * Math.cos(angle) * r - cardSize / 2),
            y: Math.round(cy + sy * Math.sin(angle) * r - cardSize / 2), width: cardSize, height: cardSize };
        });
        if (cards.some((card, index) =>
          (overlapsAxis(card.x, cardSize, pet.x - GAP, pet.width + GAP * 2) &&
          overlapsAxis(card.y, cardSize, pet.y - GAP, pet.height + GAP * 2)) ||
          cards.slice(index + 1).some(other => Math.hypot(
            Math.max(0, card.x - other.x - cardSize, other.x - card.x - cardSize),
            Math.max(0, card.y - other.y - cardSize, other.y - card.y - cardSize)) < 6))) continue;
        const layout = placed(cards, preferred);
        if (layout) return layout;
      }
      // A tight corner uses two concentric arcs instead of a grid or a distant
      // single fan. The two inner endpoints keep the real pet center and order.
      const x0 = Math.max(0, margin - edgeX), y0 = Math.max(0, margin - edgeY);
      const inner = Math.max(radius - 16, Math.max(pet.width, pet.height) / 2 + cardSize / 2 + GAP);
      const outerStart = Math.max(inner + cardSize + 6,
        Math.ceil((cardSize + 6) / (Math.cos(Math.PI / 6) - Math.sin(Math.PI / 6))) + 1);
      for (let outer = outerStart; x0 < inner && y0 < inner && outer <= radius + cardSize + 8; outer++) {
        const start = Math.asin(clamp(y0 / outer, 0, 1)), end = Math.acos(clamp(x0 / outer, 0, 1));
        const points = [[x0, Math.sqrt(inner * inner - x0 * x0)],
          ...Array.from({ length: 4 }, (_, i) => {
            const angle = end - (end - start) * i / 3;
            return [Math.cos(angle) * outer, Math.sin(angle) * outer];
          }), [Math.sqrt(inner * inner - y0 * y0), y0]];
        const cards = IDS.map((id, index) => {
          const [x, y] = points[(horizontal ? sx === 1 : sy === -1) ? index : IDS.length - 1 - index];
          return { id, x: Math.round(cx + sx * x - cardSize / 2),
            y: Math.round(cy + sy * y - cardSize / 2), width: cardSize, height: cardSize };
        });
        if (cards.some((card, index) =>
          (overlapsAxis(card.x, cardSize, pet.x - GAP, pet.width + GAP * 2) &&
          overlapsAxis(card.y, cardSize, pet.y - GAP, pet.height + GAP * 2)) ||
          cards.slice(index + 1).some(other => Math.hypot(
            Math.max(0, card.x - other.x - cardSize, other.x - card.x - cardSize),
            Math.max(0, card.y - other.y - cardSize, other.y - card.y - cardSize)) < 6))) continue;
        const compact = placed(cards, preferred);
        if (compact) return compact;
      }
    } else for (const direction of directions) {
      const horizontal = direction === 'above' || direction === 'below';
      const crossLength = horizontal ? area.width : area.height;
      if (radius * 2 + cardSize + PAD * 2 > crossLength) continue;
      const sign = direction === 'above' || direction === 'left' ? -1 : 1;
      const cx = horizontal ? clamp(pet.x + pet.width / 2, area.x + PAD + radius + cardSize / 2,
        area.x + area.width - PAD - radius - cardSize / 2) : pet.x + pet.width / 2;
      const cy = horizontal ? pet.y + pet.height / 2 : clamp(pet.y + pet.height / 2,
        area.y + PAD + radius + cardSize / 2, area.y + area.height - PAD - radius - cardSize / 2);
      const cards = IDS.map((id, index) => {
        const angle = (180 - index * 36) * Math.PI / 180;
        return { id, x: Math.round(cx + (horizontal ? Math.cos(angle) : sign * Math.sin(angle)) * radius - cardSize / 2),
          y: Math.round(cy + (horizontal ? sign * Math.sin(angle) : Math.cos(angle)) * radius - cardSize / 2),
          width: cardSize, height: cardSize };
      });
      let shift = 0;
      for (const card of cards) {
        const crossesPet = horizontal
          ? overlapsAxis(card.x, cardSize, pet.x - GAP, pet.width + GAP * 2)
          : overlapsAxis(card.y, cardSize, pet.y - GAP, pet.height + GAP * 2);
        if (crossesPet) shift = Math.max(shift, direction === 'below' ? pet.y + pet.height + GAP - card.y
          : direction === 'above' ? card.y + cardSize + GAP - pet.y
            : direction === 'right' ? pet.x + pet.width + GAP - card.x : card.x + cardSize + GAP - pet.x);
      }
      shift = Math.max(shift, direction === 'below' ? area.y + PAD - Math.min(...cards.map(card => card.y))
        : direction === 'above' ? Math.max(...cards.map(card => card.y + cardSize)) + PAD - area.y - area.height
          : direction === 'right' ? area.x + PAD - Math.min(...cards.map(card => card.x))
            : Math.max(...cards.map(card => card.x + cardSize)) + PAD - area.x - area.width);
      for (const card of cards) card[horizontal ? 'y' : 'x'] += sign * Math.ceil(shift);
      const layout = placed(cards, direction);
      if (layout) return layout;
    }
  }

  // A list can scroll when the arc cannot fit the current work area.
  const inset = Math.min(8, area.width / 4, area.height / 4);
  const candidates = directions.map(direction => {
    const horizontal = direction === 'above' || direction === 'below';
    const width = Math.max(1, Math.min(320, horizontal ? area.width - inset * 2 : room[direction] - GAP - inset));
    const height = Math.max(1, Math.min(326, horizontal ? room[direction] - GAP - inset : area.height - inset * 2));
    const cx = pet.x + pet.width / 2, cy = pet.y + pet.height / 2;
    return { direction, bounds: { x: Math.round(horizontal ? clamp(cx - width / 2, area.x + inset, area.x + area.width - inset - width)
      : direction === 'right' ? pet.x + pet.width + GAP : pet.x - GAP - width),
      y: Math.round(horizontal ? direction === 'below' ? pet.y + pet.height + GAP : pet.y - GAP - height
        : clamp(cy - height / 2, area.y + inset, area.y + area.height - inset - height)), width: Math.floor(width), height: Math.floor(height) } };
  }).filter(({ bounds }) => bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
  // Prefer readable row widths, then retain as much visible content as possible.
  candidates.sort((a, b) => Math.min(b.bounds.width, 220) - Math.min(a.bounds.width, 220) || b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  const placed = candidates[0];
  if (!placed) throw new RangeError('Work area has no space beside the pet for shortcuts');
  return { shape: 'list', ...placed, cardSize: 52,
    items: IDS.slice(0, 5).map((id, index) => ({ id, x: 15, y: 55 + index * 45, width: Math.max(1, placed.bounds.width - 30), height: 44 })) };
}

module.exports = { layoutShortcuts };
