const LABEL_SIZES = Object.freeze({
  standard: Object.freeze({ width: 168, height: 58 }),
  standardExpanded: Object.freeze({ width: 196, height: 131 }),
  standardExpandedDual: Object.freeze({ width: 196, height: 144 }),
  compact: Object.freeze({ width: 128, height: 32 }),
  apiExpanded: Object.freeze({ width: 196, height: 92 }),
  compactExpanded: Object.freeze({ width: 196, height: 131 }),
  compactExpandedDual: Object.freeze({ width: 196, height: 144 })
});
const GAP = 8;
// Ordinary 22/24px roles need a 48px target; the 50px composite and
// unknown roles retain 64px. Painted collision geometry remains independent.
const ROLE_PAINT_WIDTH = 50;
const ROLE_GAP = 8;
const SIDE_GAP = 4;
const { petVisualBounds } = require('./pet-visual-bounds');
const GEOMETRY_LIMIT = Math.floor(Number.MAX_SAFE_INTEGER / 4);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value)
  ? clamp(value, -GEOMETRY_LIMIT, GEOMETRY_LIMIT) : fallback;
const positive = (value, fallback) => Number.isFinite(value) && value > 0
  ? Math.min(value, GEOMETRY_LIMIT) : fallback;

function safeArea(area) {
  return {
    x: Math.round(finite(area && area.x, 0)),
    y: Math.round(finite(area && area.y, 0)),
    width: Math.max(1, Math.floor(positive(area && area.width, 1))),
    height: Math.max(1, Math.floor(positive(area && area.height, 1)))
  };
}

function safePet(pet, area) {
  const width = positive(pet && pet.width, 80);
  const height = positive(pet && pet.height, 80);
  return {
    x: finite(pet && pet.x, area.x + (area.width - width) / 2),
    y: finite(pet && pet.y, area.y + (area.height - height) / 2),
    width,
    height
  };
}

function safeObstacle(obstacle) {
  if (!obstacle || !Number.isFinite(obstacle.x) || !Number.isFinite(obstacle.y) ||
    !Number.isFinite(obstacle.width) || !Number.isFinite(obstacle.height) ||
    obstacle.width <= 0 || obstacle.height <= 0) return null;
  return {
    x: finite(obstacle.x, 0),
    y: finite(obstacle.y, 0),
    width: positive(obstacle.width, 1),
    height: positive(obstacle.height, 1)
  };
}

function inside(candidate, size, area) {
  return candidate.x >= area.x && candidate.y >= area.y &&
    candidate.x + size.width <= area.x + area.width &&
    candidate.y + size.height <= area.y + area.height;
}

function overlaps(candidate, size, obstacle) {
  return Boolean(obstacle && candidate.x < obstacle.x + obstacle.width &&
    candidate.x + size.width > obstacle.x && candidate.y < obstacle.y + obstacle.height &&
    candidate.y + size.height > obstacle.y);
}

function bounded(candidate, size, area) {
  return {
    x: Math.round(clamp(candidate.x, area.x, area.x + area.width - size.width)),
    y: Math.round(clamp(candidate.y, area.y, area.y + area.height - size.height)),
    width: size.width,
    height: size.height,
    placement: candidate.placement
  };
}

function quotaRoleTargetWidth(paintWidth) { return [22,24].includes(paintWidth) ? 48 : 64; }

// Visible free and edge-peek cards share direction. Inputs are sizes, never their last positions.
function quotaFreeStackBounds(petBounds, workArea, cards, presentation, bubble = null) {
  const peeked = presentation?.mode === 'peeked' && ['left','right'].includes(presentation.side);
  if (presentation?.mode !== 'free' && !peeked) return null;
  const ids = peeked ? ['codex','api','zcode','workbuddy'].filter(id => cards?.[id])
    : ['codex','api','zcode', ...(cards?.workbuddy ? ['workbuddy'] : [])];
  if (!ids.length) return null;
  const rows = ids.map(id => ({ id, ...cards?.[id] }));
  if (rows.some(row => !Number.isFinite(row.width) || row.width <= 0 || !Number.isFinite(row.height) || row.height <= 0)) return null;
  const area = safeArea(workArea), nativePet = safePet(petBounds, area);
  const visual = petVisualBounds(nativePet,presentation.shape,{...presentation,quotaAnchor:true,quotaGuard:rows[0].guardTargetWidth>0});
  const pet = ['ring','duo','split','stages'].includes(presentation.quotaStyle)
    ? presentation.shape === 'new-year-sheep' ? nativePet : {...visual,y:nativePet.y,height:nativePet.height} : visual;
  const preferredCenter=pet.x+pet.width/2, obstacle=safeObstacle(bubble);
  for(const row of rows) {
    row.inset=row.inset===2?2:0;
    row.faceWidth=row.width-row.inset*2;row.faceHeight=row.height-row.inset*2;
    if(row.faceWidth<=0||row.faceHeight<=0)return null;
    row.gutter=[48,64].includes(row.guardTargetWidth)?row.guardTargetWidth+ROLE_GAP:0;
    row.top=row.gutter?Math.max(row.height,44)+6-row.height:0;
    row.left=peeked ? row.gutter>0 && presentation.side==='right' : row.gutter>0 && preferredCenter>area.x+area.width/2 && (nativePet.x+nativePet.width>=area.x+area.width-row.gutter || preferredCenter+row.width/2+row.gutter>area.x+area.width);
  }
  const left=Math.max(...rows.map(r=>r.width/2+(r.left?r.gutter:0))),right=Math.max(...rows.map(r=>r.width/2+(r.left?0:r.gutter)));
  if(left+right>area.width)return fallback();
  const center=Math.round(clamp(preferredCenter,area.x+left,area.x+area.width-right));
  const ordered = peeked || rows.length === 4;
  const stackHeight = rows.reduce((sum,row)=>sum+row.faceHeight,0)+GAP*(rows.length-1);
  for(const placement of ['below','above']) {
    let cursor=placement==='below'?pet.y+pet.height+GAP:pet.y-GAP-(ordered?stackHeight:0);
    const result={};let clear=true;
    for(const row of rows) {
      const face={x:Math.round(peeked ? presentation.side==='left' ? area.x+2 : area.x+area.width-row.faceWidth-2 : center-row.faceWidth/2),y:Math.round(placement==='below'||ordered?cursor:cursor-row.faceHeight),width:row.faceWidth,height:row.faceHeight};
      const x=face.x-row.inset-(row.left?row.gutter:0),y=face.y-row.inset-row.top;
      const native={x,y,width:row.width+row.gutter,height:row.height+row.top,placement,
        ...(row.gutter?{guardSide:row.left?'left':'right',cardInset:{x:row.left?row.gutter:0,y:row.top}}:{}),face};
      const roleWidth=[22,24,50].includes(row.roleWidth)?row.roleWidth:ROLE_PAINT_WIDTH;
      const ink=row.gutter?{x:face.x-row.inset-(row.left?ROLE_GAP+roleWidth:0),y:face.y-row.inset-(row.inset?1:0),
        width:row.width+ROLE_GAP+roleWidth,height:row.height+(row.inset?1:0)}:face;
      if(!inside(native,native,area)||overlaps(ink,ink,pet)||overlaps(ink,ink,obstacle))clear=false;
      result[row.id]=native;cursor=placement==='below'||ordered?face.y+face.height+GAP:face.y-GAP;
    }
    if(clear)return {placement,cards:result};
  }
  return fallback();
  function fallback() {
    return peeked || cards?.workbuddy ? { placement: 'hidden', cards: {}, hidden: ids } : null;
  }
}

function quotaLabelSize(value, expanded = false, itemCount = 1, extraCredits = false, guardEntry = false, rolePaintWidth = null, sourceId = 'codex') {
  if (sourceId === 'zcode' && expanded === true && itemCount > 0) return { width: 196, height: itemCount === 1 ? 154 : 166 + (Math.ceil(Math.min(itemCount, 32) / 2) - 1) * 90 };
  if (expanded === true && itemCount > 2) return { width: 196, height: 144 + (Math.ceil(Math.min(itemCount, 32) / 2) - 1) * 84 };
  if (expanded === true && itemCount > 1 && value === 'standard') return LABEL_SIZES.standardExpandedDual;
  if (expanded === true && itemCount > 1 && value === 'compact') return LABEL_SIZES.compactExpandedDual;
  if (expanded === true && value === 'standard') return LABEL_SIZES.standardExpanded;
  if (expanded === true && value === 'compact') return LABEL_SIZES.compactExpanded;
  const card = value !== 'compact' && itemCount > 2
    ? { width: 168, height: 58 + (Math.min(itemCount, 32) - 2) * 22 } : LABEL_SIZES[value] || LABEL_SIZES.standard;
  return guardEntry && !expanded ? { width: card.width + ROLE_GAP + quotaRoleTargetWidth(rolePaintWidth), height: Math.max(card.height, 44) + 6 } : card;
}

function quotaLabelBounds(petBounds, workArea, obstacleBounds = null, sizeName = 'standard', expanded = false, itemCount = 1,
  presentation = null, extraCredits = false, guardEntry = false) {
  const area = safeArea(workArea);
  const nativePet = safePet(petBounds, area);
  const visual = petVisualBounds(nativePet, presentation?.shape, { ...presentation, quotaAnchor: true, quotaGuard: guardEntry === true && expanded !== true });
  // Rings fit the native host's outer edge while shrinking the body inside it.
  // Keep the cloud's horizontal peek anchor, but reserve the ring envelope vertically.
  const pet = ['ring', 'duo', 'split', 'stages'].includes(presentation?.quotaStyle)
    ? presentation?.shape === 'new-year-sheep' ? nativePet : { ...visual, y: nativePet.y, height: nativePet.height } : visual;
  const obstacle = safeObstacle(obstacleBounds);
  const requestedSize = quotaLabelSize(sizeName, expanded, itemCount, extraCredits, false, null, presentation?.quotaSourceId);
  const size = {
    width: Math.min(requestedSize.width, area.width),
    height: Math.min(requestedSize.height, area.height)
  };
  const centerX = pet.x + pet.width / 2;
  const centerY = pet.y + pet.height / 2;
  const coordinated=['free','peeked'].includes(presentation?.mode)&&presentation?.quotaGroupLayout;
  if(coordinated && inside(coordinated,coordinated,area) && coordinated.width===size.width+(guardEntry&&!expanded?ROLE_GAP+quotaRoleTargetWidth(presentation?.quotaRoleWidth):0)
    && coordinated.height===(guardEntry&&!expanded?Math.max(size.height,44)+6:size.height)) return coordinated;
  if (presentation?.quotaBottomAligned === true) {
    // ZCode follows the existing Codex card without changing Codex's own anchor.
    // Keep obstacle rectangles separate: their bounding union can cover free gaps.
    const stack = safeObstacle(presentation.quotaStackBelow);
    const obstacles = Array.isArray(presentation.quotaObstacles)
      ? presentation.quotaObstacles.map(safeObstacle).filter(Boolean) : [obstacle].filter(Boolean);
    if (stack && !obstacles.some(row => row.x === stack.x && row.y === stack.y && row.width === stack.width && row.height === stack.height)) obstacles.push(stack);
    const alignedX = (stack ? stack.x + stack.width / 2 : centerX) - size.width / 2;
    const positions = [
      { placement: 'below', x: alignedX, y: stack ? stack.y + stack.height + GAP : pet.y + pet.height + GAP },
      ...(stack ? [{ placement: 'above', x: alignedX, y: stack.y - size.height - GAP }] : []),
      { placement: 'below', x: centerX - size.width / 2, y: pet.y + pet.height + GAP },
      { placement: 'above', x: centerX - size.width / 2, y: pet.y - size.height - GAP },
      { placement: 'right', x: pet.x + pet.width + GAP, y: centerY - size.height / 2 },
      { placement: 'left', x: pet.x - size.width - GAP, y: centerY - size.height / 2 },
      ...obstacles.flatMap(row => [
        { placement: 'right', x: row.x + row.width + GAP, y: row.y },
        { placement: 'left', x: row.x - size.width - GAP, y: row.y },
        { placement: 'above', x: alignedX, y: row.y - size.height - GAP }
      ])
    ].map(candidate => bounded(candidate, size, area));
    const clear = candidate => !overlaps(candidate, size, pet) && !obstacles.some(row => overlaps(candidate, size, row));
    if (!guardEntry || expanded) return positions.find(clear) || positions[0];
    const gutter = ROLE_GAP + quotaRoleTargetWidth(presentation?.quotaRoleWidth);
    const group = { width: Math.min(size.width + gutter, area.width), height: Math.min(Math.max(size.height, 44) + 6, area.height) };
    const top = Math.max(0, group.height - size.height);
    const rightEdge = ['free','peeked'].includes(presentation?.mode) && centerX > area.x + area.width / 2 &&
      (nativePet.x + nativePet.width >= area.x + area.width - gutter || centerX + size.width / 2 + gutter >= area.x + area.width);
    const pairs = positions.flatMap(candidate => (rightEdge ? [true, false] : [false, true]).map(left => ({
      ...bounded({ ...candidate, x: candidate.x - (left ? gutter : 0), y: candidate.y - top }, group, area),
      guardSide: left ? 'left' : 'right', cardInset: { x: left ? Math.max(0, group.width - size.width) : 0, y: top }
    })));
    const roleWidth = [22,24,50].includes(presentation?.quotaRoleWidth) ? presentation.quotaRoleWidth : ROLE_PAINT_WIDTH;
    const painted = candidate => ({ x: candidate.x + (candidate.guardSide === 'left' ? gutter - ROLE_GAP - roleWidth : 0),
      y: candidate.y + candidate.cardInset.y - (sizeName === 'compact' ? 1 : 0),
      width: Math.min(candidate.width, size.width + ROLE_GAP + roleWidth), height: size.height + (sizeName === 'compact' ? 1 : 0) });
    return pairs.find(candidate => {
      // Match Codex's painted pair: the native top/target gutter is transparent.
      const face = painted(candidate);
      return !overlaps(face, face, pet) && !obstacles.some(row => overlaps(face, face, row));
    }) || pairs[0];
  }
  const candidates = [
    { placement: 'below', x: centerX - size.width / 2, y: pet.y + pet.height + GAP },
    { placement: 'above', x: centerX - size.width / 2, y: pet.y - size.height - GAP },
    { placement: 'right', x: pet.x + pet.width + GAP, y: centerY - size.height / 2 },
    { placement: 'left', x: pet.x - size.width - GAP, y: centerY - size.height / 2 }
  ].map(candidate => ({ ...candidate, x: Math.round(candidate.x), y: Math.round(candidate.y) }));

  const valid = candidates.find(candidate => inside(candidate, size, area) &&
    !overlaps(candidate, size, obstacle));

  const fallbacks = candidates.map(candidate => bounded(candidate, size, area));
  const safe = fallbacks.find(candidate => !overlaps(candidate, size, pet) &&
    !overlaps(candidate, size, obstacle));
  const aroundObstacle = obstacle ? [
    { placement: 'left', x: obstacle.x - size.width - GAP, y: centerY - size.height / 2 },
    { placement: 'right', x: obstacle.x + obstacle.width + GAP, y: centerY - size.height / 2 },
    { placement: 'above', x: centerX - size.width / 2, y: obstacle.y - size.height - GAP },
    { placement: 'below', x: centerX - size.width / 2, y: obstacle.y + obstacle.height + GAP }
  ].map(candidate => bounded(candidate, size, area)) : [];
  const aroundObstacleSafe = aroundObstacle.find(candidate =>
    !overlaps(candidate, size, pet) && !overlaps(candidate, size, obstacle));
  // In free mode a horizontal edge only needs a slide along that edge.
  // Try the bounded near-side anchors before jumping to a distant side.
  const ordinary = valid ? { x: valid.x, y: valid.y, ...size, placement: valid.placement } : null;
  const card = (presentation?.mode === 'free' ? safe || ordinary : ordinary || safe) || aroundObstacleSafe ||
    fallbacks.find(candidate => !overlaps(candidate, size, obstacle)) || fallbacks[0];
  if (!guardEntry || expanded) return card;

  const requested = quotaLabelSize(sizeName, expanded, itemCount, extraCredits, true, presentation?.quotaRoleWidth);
  const width = Math.min(requested.width, area.width), height = Math.min(requested.height, area.height);
  const gutter = Math.max(0, width - size.width), topGutter = Math.max(0, height - size.height);
  const knownRole = [22,24,50].includes(presentation?.quotaRoleWidth);
  const roleWidth = knownRole ? presentation.quotaRoleWidth : ROLE_PAINT_WIDTH;
  const leftGap = knownRole && !['ring','duo','split','stages'].includes(presentation?.quotaStyle) ? 16 : SIDE_GAP;
  const rightEdge = ['free','peeked'].includes(presentation?.mode) && centerX > area.x + area.width / 2 &&
    (nativePet.x + nativePet.width >= area.x + area.width - gutter || centerX + size.width / 2 + gutter >= area.x + area.width);
  const withGuard = candidate => {
    // Keep the formal card baseline unless its complete right-role pair needs
    // clamping or a different side to avoid the existing dialogue bubble.
    const x = Math.round(clamp(candidate.x - (candidate.placement === 'left' ? Math.min(gutter, ROLE_GAP + roleWidth - GAP + leftGap) : candidate.placement === 'right' ? GAP - SIDE_GAP : 0),
      area.x, area.x + area.width - width));
    const y = Math.round(clamp(candidate.y - topGutter, area.y, area.y + area.height - height));
    // Along the right boundary the visible card, rather than the transparent
    // role tail, owns the outer edge. Keep side fallbacks for crowded heights.
    const roleLeft = rightEdge && ['above','below'].includes(candidate.placement);
    return { x: roleLeft ? area.x + area.width - width : x, y, width, height, placement: candidate.placement,
      guardSide: roleLeft ? 'left' : 'right', cardInset: { x: roleLeft ? gutter : 0, y: candidate.y - y } };
  };
  // Score from the normal pet anchor, not from an already distant bubble fallback.
  const preferred = candidates.find(candidate => inside(candidate, size, area)) || fallbacks[0];
  const pair = withGuard(preferred);
  const paintOffset = candidate => candidate.guardSide === 'left' ? gutter - ROLE_GAP - roleWidth : 0;
  const clear = candidate => {
    // The compact zombie reaches 1 DIP above the face; the remaining native top gutter is transparent.
    const top = sizeName === 'compact' ? 1 : 0;
    const visualPair = { ...candidate, x: candidate.x + paintOffset(candidate), width: Math.min(candidate.width, size.width + ROLE_GAP + roleWidth),
      y: candidate.y + candidate.cardInset.y - top, height: size.height + top };
    return !overlaps(visualPair, visualPair, obstacle) && !overlaps(visualPair, visualPair, pet);
  };
  if (presentation?.mode === 'free' || rightEdge) {
    const near = fallbacks.map(withGuard).find(clear);
    if (near) return near;
  }
  if (clear(pair)) return pair;
  const choices = [...fallbacks, ...aroundObstacle].map(withGuard);
  if (obstacle) {
    // A small overlap needs only a short slide along the bubble edge. Keep the
    // card/role pair together, including the compact role's 1px upper reach.
    const top = sizeName === 'compact' ? 1 : 0;
    for (const anchor of [...choices, pair]) {
      const width = Math.min(anchor.width, size.width + ROLE_GAP + roleWidth);
      const shifts = [
        { x: obstacle.x - width - GAP - paintOffset(anchor), y: anchor.y },
        { x: obstacle.x + obstacle.width + GAP - paintOffset(anchor), y: anchor.y },
        { x: anchor.x, y: obstacle.y - size.height - GAP - anchor.cardInset.y },
        { x: anchor.x, y: obstacle.y + obstacle.height + GAP + top - anchor.cardInset.y }
      ];
      for (const shift of shifts) choices.push({ ...anchor,
        x: Math.round(clamp(shift.x, area.x, area.x + area.width - anchor.width)),
        y: Math.round(clamp(shift.y, area.y, area.y + area.height - anchor.height)) });
    }
  }
  const distance = candidate => (candidate.x - pair.x) ** 2 + (candidate.y - pair.y) ** 2;
  const safeChoices = choices.filter(clear);
  const nearby = safeChoices.filter(candidate => distance(candidate) <= size.height ** 2)
    .sort((a, b) => distance(a) - distance(b))[0];
  const proximity = candidate => {
    const x = candidate.x + paintOffset(candidate) + Math.min(candidate.width, size.width + ROLE_GAP + roleWidth) / 2;
    const y = candidate.y + candidate.cardInset.y + size.height / 2;
    return (x - centerX) ** 2 + (y - centerY) ** 2;
  };
  return nearby || safeChoices.sort((a, b) => proximity(a) - proximity(b) || distance(a) - distance(b))[0] || pair;
}

module.exports = { GAP, LABEL_SIZES, quotaLabelSize, quotaLabelBounds, quotaRoleTargetWidth, quotaFreeStackBounds };
