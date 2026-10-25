const test = require('node:test');
const assert = require('node:assert/strict');
const { quotaLabelBounds, quotaLabelSize } = require('../lib/quota-label-placement');

const AREA = Object.freeze({ x: 0, y: 0, width: 1440, height: 900 });

test('余额复用辅助行，显示与隐藏均保持同一展开高度，折叠尺寸保持原样', () => {
  assert.deepEqual(quotaLabelSize('compact', false, 1, true), { width: 128, height: 32 });
  for (const size of ['compact', 'standard']) {
    assert.deepEqual(quotaLabelSize(size, true, 1, true), { width: 196, height: 131 });
    assert.deepEqual(quotaLabelSize(size, true, 2, true), { width: 196, height: 144 });
    assert.deepEqual(quotaLabelSize(size, true, 1), { width: 196, height: 131 });
    assert.deepEqual(quotaLabelSize(size, true, 2), { width: 196, height: 144 });
  }
  const pet = { x: 1408, y: 878, width: 80, height: 80 };
  const area = { x: 0, y: 32, width: 1512, height: 950 };
  const bubble = { x: 1280, y: 784, width: 224, height: 86 };
  const bounds = quotaLabelBounds(pet, area, bubble, 'compact', true, 1, null, true);
  assertInside(bounds, area);
  assert.equal(bounds.height, 131);
  assert.equal(bounds.x < pet.x + pet.width && bounds.x + bounds.width > pet.x &&
    bounds.y < pet.y + pet.height && bounds.y + bounds.height > pet.y, false);
});

function assertFiniteBounds(result) {
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isFinite(result[key]), true, `${key} 应为有限数字`);
  }
  assert.ok(result.width >= 0);
  assert.ok(result.height >= 0);
}

function assertInside(result, area) {
  assert.ok(result.x >= area.x);
  assert.ok(result.y >= area.y);
  assert.ok(result.x + result.width <= area.x + area.width);
  assert.ok(result.y + result.height <= area.y + area.height);
}

test('标准档使用原小巧版 168×58，优先放在球球下方八像素且不修改输入', () => {
  const pet = Object.freeze({ x: 600, y: 400, width: 80, height: 80 });
  const area = Object.freeze({ ...AREA });
  const obstacle = Object.freeze({ x: 10, y: 10, width: 20, height: 20 });
  assert.deepEqual(quotaLabelBounds(pet, area, obstacle), {
    x: 556, y: 488, width: 168, height: 58, placement: 'below'
  });
});

test('小巧档折叠为 128×32，点击展开为 196×131 液态玻璃明细', () => {
  const pet = Object.freeze({ x: 600, y: 400, width: 80, height: 80 });
  const area = Object.freeze({ ...AREA });
  assert.deepEqual(quotaLabelBounds(pet, area, null, 'compact'), {
    x: 576, y: 488, width: 128, height: 32, placement: 'below'
  });
  assert.deepEqual(quotaLabelBounds(pet, area, null, 'compact', true), {
    x: 542, y: 488, width: 196, height: 131, placement: 'below'
  });
  assert.deepEqual(quotaLabelBounds(pet, area, null, 'unknown'), {
    x: 556, y: 488, width: 168, height: 58, placement: 'below'
  });
});

test('双周期展开宽度不变并增高为 196×144，靠近屏幕边缘仍完整收口', () => {
  const pet = Object.freeze({ x: 600, y: 400, width: 80, height: 80 });
  assert.deepEqual(quotaLabelBounds(pet, AREA, null, 'compact', true, 2), {
    x: 542, y: 488, width: 196, height: 144, placement: 'below'
  });
  assert.deepEqual(quotaLabelBounds(pet, AREA, null, 'standard', true, 2), {
    x: 542, y: 488, width: 196, height: 144, placement: 'below'
  });
  for (const area of [AREA, { x: -1920, y: -180, width: 1920, height: 1080 }]) {
    const edgePet = { x: area.x, y: area.y + area.height - 80, width: 80, height: 80 };
    assertInside(quotaLabelBounds(edgePet, area, null, 'compact', true, 2), area);
  }
});

test('标准档点击后也展开为 196×131 液态玻璃明细', () => {
  const pet = Object.freeze({ x: 600, y: 400, width: 80, height: 80 });
  assert.deepEqual(quotaLabelBounds(pet, AREA, null, 'standard', true), {
    x: 542, y: 488, width: 196, height: 131, placement: 'below'
  });
});

test('下方被气泡占用时按上、右、左的顺序避让', () => {
  const pet = { x: 600, y: 400, width: 80, height: 80 };
  const below = { x: 556, y: 488, width: 168, height: 58 };
  assert.equal(quotaLabelBounds(pet, AREA, below).placement, 'above');

  const topLeftPet = { x: 0, y: 20, width: 80, height: 80 };
  const bubble = { x: 8, y: 108, width: 224, height: 118 };
  assert.deepEqual(quotaLabelBounds(topLeftPet, AREA, bubble), {
    x: 88, y: 31, width: 168, height: 58, placement: 'right'
  });

  const rightPet = { x: 1360, y: 400, width: 80, height: 80 };
  assert.equal(quotaLabelBounds(rightPet, AREA).placement, 'left');
});

test('正负坐标双屏四边均在当前屏内', () => {
  for (const area of [AREA, { x: -1920, y: -180, width: 1920, height: 1080 }]) {
    const pets = [
      { x: area.x, y: area.y, width: 80, height: 80 },
      { x: area.x + area.width - 80, y: area.y, width: 80, height: 80 },
      { x: area.x, y: area.y + area.height - 80, width: 80, height: 80 },
      { x: area.x + area.width - 80, y: area.y + area.height - 80, width: 80, height: 80 }
    ];
    for (const pet of pets) assertInside(quotaLabelBounds(pet, area), area);
  }
});

test('60/80/120/180/260 五档球球均保持 168×58 标准标签和八像素间距', () => {
  for (const size of [60, 80, 120, 180, 260]) {
    const pet = { x: 600, y: 300, width: size, height: size };
    const result = quotaLabelBounds(pet, AREA);
    assert.equal(result.placement, 'below');
    assert.equal(result.width, 168);
    assert.equal(result.height, 58);
    assert.equal(result.y, pet.y + size + 8);
    assert.equal(result.x, Math.round(pet.x + (size - 168) / 2));
  }
});

test('幻彩云半露时额度跟随可见云瓣，左右屏边与各尺寸都保持八像素间距', () => {
  for (const size of [60, 80, 120, 180, 260]) {
    for (const [side, pet] of [
      ['left', { x: AREA.x, y: 300, width: size, height: size }],
      ['right', { x: AREA.x + AREA.width - size, y: 300, width: size, height: size }]
    ]) {
      const result = quotaLabelBounds(pet, AREA, null, 'compact', false, 1,
        { shape: 'aurora-cloud', mode: 'peeked', side });
      const visibleEdge = side === 'left' ? pet.x + size * 0.65 : pet.x + size * 0.35;
      assert.equal(result.placement, side === 'left' ? 'right' : 'left');
      assert.ok(Math.abs((side === 'left' ? result.x - visibleEdge : visibleEdge - result.x - result.width) - 8) <= 0.5,
        `${side} ${size}px 的间距应为 8px`);
      assertInside(result, AREA);
    }
  }
});

test('只有幻彩云半露改变视觉锚点，free靠边可先夹紧下方卡，其余模式保持', () => {
  const pet = { x: 1360, y: 300, width: 80, height: 80 };
  const original = quotaLabelBounds(pet, AREA, null, 'compact');
  for (const presentation of [
    { shape: 'cloud', mode: 'peeked', side: 'right' },
    { shape: 'aurora-cloud', mode: 'free', side: 'right' },
    { shape: 'aurora-cloud', mode: 'tucked', side: 'right' },
    { shape: 'aurora-cloud', mode: 'peeked', side: null }
  ]) {
    const result = quotaLabelBounds(pet, AREA, null, 'compact', false, 1, presentation);
    if (presentation.mode === 'free') {
      assert.equal(result.placement, 'below');assert.equal(result.x, AREA.width - 128);assertInside(result, AREA);
    } else {
      assert.equal(result.placement, original.placement);assert.equal(result.x, original.x);
    }
  }
});

test('非经典外观的额度标签贴近实际可见底部，保留经典外观的视觉间距', () => {
  const pet = { x: 600, y: 400, width: 180, height: 180 };
  const classic = quotaLabelBounds(pet, AREA, null, 'compact');
  const classicGap = classic.y - (pet.y + pet.height * (1 - .06));
  for (const [shape, visibleBottom] of [['cloud', .17], ['aurora-cloud', .17], ['square', .11]]) {
    const quota = quotaLabelBounds(pet, AREA, null, 'compact', false, 1, { shape, mode: 'free' });
    const gap = quota.y - (pet.y + pet.height * (1 - visibleBottom));
    assert.ok(Math.abs(gap - classicGap) <= 1, `${shape} 的额度标签与可见轮廓间距应接近经典`);
  }
});

test('角色常规在卡右，右近边上下卡改为左列并贴边，正式卡面方向不变', () => {
  for (const area of [AREA, { x: -1920, y: -180, width: 1920, height: 1080 }]) {
    for (const size of ['compact', 'standard']) for (const shape of ['blob', 'aurora-cloud']) {
      for (const width of [60, 80, 180, 260]) for (const side of ['left', 'right', null]) {
        const pet = { x: side === 'left' ? area.x : side === 'right' ? area.x + area.width - width : area.x + 500,
          y: area.y + 240, width, height: width };
        const presentation = { shape, side, mode: side ? 'peeked' : 'free' };
        const baseline = quotaLabelBounds(pet, area, null, size, false, 1, presentation);
        const guard = quotaLabelBounds(pet, area, null, size, false, 1, presentation, false, true);
        if(guard.guardSide==='right')assert.equal(guard.placement, baseline.placement);
        if (guard.guardSide === 'left') {
          assert.equal(side,'right');assert.equal(guard.cardInset.x,72);assert.equal(guard.x+guard.cardInset.x+baseline.width,area.x+area.width);
        } else assert.equal(guard.cardInset.x,0);
        const shiftedX = baseline.x + (shape === 'aurora-cloud' && side ? (side === 'right' ? 1 : -1) * width * .08 : 0);
        if(guard.guardSide==='right')assert.ok(Math.abs(guard.x + guard.cardInset.x - Math.min(area.x + area.width - guard.width, shiftedX - (baseline.placement === 'left' ? 54 : baseline.placement === 'right' ? 4 : 0))) <= 1, '角色锚点匹配43%实际半露位移');
        if(guard.guardSide==='right')assert.equal(guard.y + guard.cardInset.y, baseline.y);
        else {const v=require('../lib/pet-visual-bounds').petVisualBounds(pet,shape,{...presentation,quotaAnchor:true,quotaGuard:true});assert.ok(Math.abs(guard.y+guard.cardInset.y-(guard.placement==='below'?v.y+v.height+8:v.y-baseline.height-8))<=.51);}
        assertInside(guard, area);
      }
    }
    const pet = { x: area.x + area.width - 115, y: area.y + 200, width: 80, height: 80 };
    const baseline = quotaLabelBounds(pet, area, null, 'compact');
    const guard = quotaLabelBounds(pet, area, null, 'compact', false, 1, null, false, true);
    assert.equal(baseline.placement, 'below');
    assert.equal(guard.placement, 'below', '角色承载窗宽度不能把下方卡切换成左侧卡');
    assert.equal(guard.guardSide, 'right');
    assert.equal(guard.x + guard.cardInset.x, area.x + area.width - guard.width);
    assert.equal(guard.y + guard.cardInset.y, baseline.y);
  }
});

test('光环按外圈承载包络留八像素，不能按缩小的云主体推卡到光圈内；card/pool保持旧锚点', () => {
  for (const width of [60, 80, 180, 260]) {
    const pet = { x: 600, y: 300, width, height: width };
    const classic = quotaLabelBounds(pet, AREA, null, 'compact', false, 1, { shape: 'aurora-cloud', mode: 'free' });
    for (const quotaStyle of ['card', 'pool']) {
      assert.deepEqual(quotaLabelBounds(pet, AREA, null, 'compact', false, 1,
        { shape: 'aurora-cloud', mode: 'free', quotaStyle }), classic);
    }
    for (const quotaStyle of ['ring', 'duo', 'split', 'stages']) {
      const ring = quotaLabelBounds(pet, AREA, null, 'compact', false, 1,
        { shape: 'aurora-cloud', mode: 'free', quotaStyle }, false, true);
      assert.equal(ring.y + ring.cardInset.y - pet.y - pet.height, 8);
      assert.equal(ring.x + ring.cardInset.x, classic.x);
      const peeked = { x: 1360, y: 300, width: 80, height: 80 };
      const side = quotaLabelBounds(peeked, AREA, null, 'compact', false, 1,
        { shape: 'aurora-cloud', mode: 'peeked', side: 'right', quotaStyle }, false, true);
      assert.equal(side.guardSide,'left');assert.equal(side.x+side.cardInset.x+128,AREA.width,'半露右边界卡面贴屏、角色左列');assert.equal(side.y+side.cardInset.y-peeked.y-peeked.height,8);
    }
  }
});

test('上下被气泡占用而改到球球左侧时，角色与卡整体留位，角色不得压在球球上', () => {
  const pet = { x: 600, y: 400, width: 80, height: 80 };
  const obstacle = { x: 648, y: 310, width: 146, height: 252 };
  const baseline = quotaLabelBounds(pet, AREA, obstacle);
  const guard = quotaLabelBounds(pet, AREA, obstacle, 'standard', false, 1, null, false, true);
  assert.equal(baseline.placement, 'left');
  assert.equal(guard.placement, 'below', '短横移即可沿气泡下缘保留近侧位置');
  assert.equal(guard.guardSide, 'right');
  assert.equal(guard.x, 414);
  assert.equal(guard.y + guard.cardInset.y, 488);
  assert.equal(guard.x + 226 + 8, obstacle.x, '最宽角色包络仍与气泡留8px');
  assertInside(guard, AREA);
});

test('固定右侧角色后最终组合仍避让气泡，包括右缘平移和仅角色撞气泡', () => {
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  for (const area of [AREA, { x: -1920, y: -180, width: 1920, height: 1080 }]) {
    for (const size of ['compact', 'standard']) for (const [petX, bubbleX, bubbleWidth] of [[44, 170, 360], [600, 530, 20]]) {
      const pet = { x: area.x + area.width - petX - 80, y: area.y + 400, width: 80, height: 80 };
      const bubble = { x: area.x + area.width - bubbleX - bubbleWidth, y: area.y + 488, width: bubbleWidth, height: 84 };
      const baseline = quotaLabelBounds(pet, area, bubble, size);
      assert.equal(baseline.placement, 'below');
      assert.equal(intersects(baseline, bubble), false, '普通卡面本身未碰气泡');
      const guard = quotaLabelBounds(pet, area, bubble, size, false, 1, null, false, true);
      const face = { x: guard.x + guard.cardInset.x, y: guard.y + guard.cardInset.y,
        ...quotaLabelSize(size) };
      assert.equal(guard.guardSide, 'right');
      assertInside(guard, area);
      assert.equal(intersects({ ...guard, width: guard.width - 14, y: guard.y + guard.cardInset.y - (size === 'compact' ? 1 : 0), height: face.height + (size === 'compact' ? 1 : 0) }, bubble), false, '最终卡面与角色组合不能因右侧留位而盖住气泡');
      assert.equal(intersects(face, pet), false, '重新避让不得把卡面放到球球上');
      assert.equal(guard.placement, petX === 600 && size === 'compact' ? 'below' : 'above');
      if (petX === 600 && size === 'compact') assert.equal(guard.x, area.x + area.width - 744, '横向微调后仍在羊下方');
    }
  }
});

test('左缘收敛后右侧角色不得压球，整组改用气泡旁的可见位置', () => {
  const pet = { x: 176, y: 400, width: 80, height: 80 };
  const bubble = { x: 240, y: 310, width: 146, height: 252 };
  const result = quotaLabelBounds(pet, AREA, bubble, 'standard', false, 1, null, false, true);
  assert.equal(result.guardSide, 'right');
  assertInside(result, AREA);
  const painted = { ...result, width: result.width - 14, y: result.y + result.cardInset.y, height: 58 };
  for (const obstacle of [pet, bubble]) assert.equal(painted.x < obstacle.x + obstacle.width &&
    painted.x + painted.width > obstacle.x && painted.y < obstacle.y + obstacle.height &&
    painted.y + painted.height > obstacle.y, false);
});

test('候选位置必须完整在屏内且不与气泡相交', () => {
  const pet = { x: 600, y: 400, width: 80, height: 80 };
  const below = { x: 556, y: 488, width: 168, height: 58 };
  const above = { x: 556, y: 334, width: 168, height: 58 };
  const combinedObstacle = { x: 542, y: 310, width: 146, height: 252 };
  const result = quotaLabelBounds(pet, AREA, combinedObstacle);
  assert.equal(result.placement, 'right');
  assert.equal(result.x, 688);
  assert.equal(result.y, 411);
  assert.ok(!(result.x < combinedObstacle.x + combinedObstacle.width &&
    result.x + result.width > combinedObstacle.x && result.y < combinedObstacle.y + combinedObstacle.height &&
    result.y + result.height > combinedObstacle.y));
  assert.ok(below.y < combinedObstacle.y + combinedObstacle.height);
  assert.ok(above.y + above.height > combinedObstacle.y);
});

test('右下角双周期展开遇到可见气泡时仍不得与球球相交', () => {
  const area = { x: 0, y: 32, width: 1512, height: 950 };
  const pet = { x: 1408, y: 878, width: 80, height: 80 };
  const bubble = { x: 1280, y: 784, width: 224, height: 86 };
  const result = quotaLabelBounds(pet, area, bubble, 'standard', true, 2);
  const intersects = (left, right) => left.x < right.x + right.width &&
    left.x + left.width > right.x && left.y < right.y + right.height &&
    left.y + left.height > right.y;

  assertInside(result, area);
  assert.deepEqual(result, { x: 1076, y: 838, width: 196, height: 144, placement: 'left' });
  assert.equal(intersects(result, pet), false, '额度卡片不能因边界收敛而压到球球');
  assert.equal(intersects(result, bubble), false, '额度卡片仍须避开可见气泡');
});

test('极小或畸形工作区安全收敛，不产生负尺寸或非有限数', () => {
  for (const area of [
    { x: -40, y: -30, width: 40, height: 30 },
    { x: 10, y: 20, width: 1, height: 1 },
    { x: Number.NaN, y: Infinity, width: -10, height: Number.NaN }
  ]) {
    const result = quotaLabelBounds({ x: -999, y: 999, width: 80, height: 80 }, area);
    assertFiniteBounds(result);
    if (Number.isFinite(area.x) && Number.isFinite(area.y) && area.width > 0 && area.height > 0) {
      assertInside(result, area);
    }
    assert.ok(['below', 'above', 'right', 'left'].includes(result.placement));
  }
});

test('宠物、工作区和障碍物畸形输入均安全降级且不修改对象', () => {
  const pet = Object.freeze({ x: Number.NaN, y: -Infinity, width: -80, height: 'bad' });
  const area = Object.freeze({ x: -100, y: -50, width: 500, height: 300 });
  const obstacle = Object.freeze({ x: Number.NaN, y: 0, width: -1, height: Infinity });
  const result = quotaLabelBounds(pet, area, obstacle);
  assertFiniteBounds(result);
  assertInside(result, area);
  assert.equal(result.width, 168);
  assert.equal(result.height, 58);
});

test('Number.MAX_VALUE 级别的有限坐标与尺寸不得在中间加法中溢出', () => {
  const max = Number.MAX_VALUE;
  for (const [pet, area, obstacle] of [
    [{ x: max, y: max, width: max, height: max }, { x: max, y: max, width: max, height: max }, null],
    [{ x: max, y: max, width: max, height: max }, { x: 0, y: 0, width: 1440, height: 900 }, null],
    [{ x: -max, y: -max, width: 260, height: 260 }, { x: max, y: -max, width: max, height: max }, null],
    [{ x: max, y: -max, width: 80, height: 80 }, { x: -max, y: max, width: max, height: max },
      { x: max, y: max, width: max, height: max }]
  ]) {
    const result = quotaLabelBounds(pet, area, obstacle);
    assertFiniteBounds(result);
    assert.ok(['below', 'above', 'right', 'left'].includes(result.placement));
  }
});


test('右下角气泡只压住角色5px时向下滑14px，不能整组跳到气泡最左', () => {
  const pet = { x: 1360, y: 820, width: 80, height: 80 };
  const bubble = { x: 1200, y: 730, width: 224, height: 118 };
  const result = quotaLabelBounds(pet, AREA, bubble, 'compact', false, 1,
    { shape: 'aurora-cloud', mode: 'free' }, false, true);
  assert.deepEqual(result, { x: 1170, y: 839, width: 200, height: 50,
    placement: 'left', guardSide: 'right', cardInset: { x: 0, y: 18 } });
  assert.equal(result.x + 128 + 8 + 22, 1328, '僵尸绘制右缘');
  assert.equal(pet.x - 1328, 32, '旧几何间距210px，现32px');
  assert.equal(result.y + result.cardInset.y - 1 - (bubble.y + bubble.height), 8);
});

test('260px羊半露与外露侧边角色净距约减半，入口200px原生窗不缩水', () => {
  const area = { x: 0, y: 0, width: 1440, height: 300 };
  const pet = { x: 1180, y: 20, width: 260, height: 260 };
  for (const mode of ['free', 'peeked']) {
    const result = quotaLabelBounds(pet, area, null, 'compact', false, 1,
      { shape: 'new-year-sheep', side: 'right', mode }, false, true);
    assert.equal(result.x, 1000); assert.equal(result.width, 200);
    assert.equal(result.placement, 'left');
    const paintedPetLeft = pet.x + pet.width * .04;
    const roleRight = result.x + 128 + 8 + 22;
    assert.ok(Math.abs(paintedPetLeft - roleRight - 32.4) < .01, '旧60.4px→32.4px，减少46%');
    assertInside(result, area);
  }
});

test('2px角色气泡冲突只横移10px，原卡不跳到上方', () => {
  const result = quotaLabelBounds({ x: 760, y: 400, width: 80, height: 80 }, AREA,
    { x: 920, y: 488, width: 20, height: 84 }, 'compact', false, 1, null, false, true);
  assert.deepEqual(result, { x: 726, y: 470, width: 200, height: 50,
    placement: 'below', guardSide: 'right', cardInset: { x: 0, y: 18 } });
});


test('四主题80/120/260实际左右朝向按绘制包络留16px，角色0/100也不压道具', () => {
  const { petVisualBounds } = require('../lib/pet-visual-bounds');
  for (const theme of ['none','halloween','christmas','spring-festival']) for (const width of [80,108,120,260]) {
    const area = { x: -1440, y: 32, width: 1440, height: width + 20 };
    for (const side of ['left','right']) for (const mode of ['free','peeked']) for (const quotaRoleWidth of [22,24,50]) {
      const pet = { x: side === 'left' ? area.x : area.x+area.width-width, y:area.y+10,width,height:width };
      const p = {shape:'new-year-sheep',sheepTheme:theme,side,mode,facing:side==='right'?'left':'right',quotaRoleWidth};
      const v = petVisualBounds(pet,p.shape,{...p,quotaAnchor:true});
      const b = quotaLabelBounds(pet,area,null,'compact',false,1,p,false,true);
      assertInside(b,area);assert.equal(b.width,quotaRoleWidth===50?200:184);
      if(side==='right')assert.ok(Math.abs(v.x-(b.x+128+8+quotaRoleWidth)-16)<=.51,JSON.stringify({theme,width,p,b,v}));
      else assert.ok(Math.abs(b.x-(v.x+v.width)-4)<=.51,JSON.stringify({theme,width,p,b,v}));
    }
  }
});

test('圣诞元素与空场按当前原生绘制包络近身，旧朝向和非法包络不生效', () => {
  const { petVisualBounds } = require('../lib/pet-visual-bounds');
  const pet = { x: 900, y: 100, width: 260, height: 260 };
  const base = { shape:'new-year-sheep', sheepTheme:'christmas', facing:'left', quotaAnchor:true, quotaStyle:'card' };
  for (const ink of [{x:.025,width:.94},{x:.29,width:.67}]) {
    const p = { ...base, sheepInk:{theme:'christmas',facing:'left',ink} };
    assert.deepEqual(petVisualBounds(pet,base.shape,p),{...pet,x:pet.x+260*ink.x,width:260*ink.width});
    const card = quotaLabelBounds(pet,{x:0,y:90,width:1160,height:280},null,'compact',false,1,{...p,quotaRoleWidth:22},false,true);
    assert.ok(Math.abs(pet.x+260*ink.x-(card.x+128+8+22)-16)<=.51);
  }
  const expected = petVisualBounds(pet,base.shape,base);
  for (const sheepInk of [{theme:'christmas',facing:'right',ink:{x:.2,width:.6}},
    {theme:'christmas',facing:'left',ink:{x:NaN,width:.6}},
    {theme:'christmas',facing:'left',ink:{x:.9,width:.6}}]) {
    assert.deepEqual(petVisualBounds(pet,base.shape,{...base,sheepInk}),expected);
  }
});

test('free边角先沿屏幕夹紧近侧上下候选，不因卡宽提前跳到远侧',()=>{
 const area={x:-800,y:30,width:800,height:500};
 for(const side of['left','right'])for(const corner of['top','bottom'])for(const size of['compact','standard'])for(const guarded of[false,true]){
  const pet={x:side==='left'?area.x+2:area.x+area.width-82,y:corner==='top'?area.y+2:area.y+area.height-82,width:80,height:80};
  const p={shape:'new-year-sheep',sheepTheme:'none',facing:side==='left'?'right':'left',mode:'free',quotaRoleWidth:22};
  const b=quotaLabelBounds(pet,area,null,size,false,1,p,false,guarded);
  assert.equal(b.placement,corner==='top'?'below':'above','上下候选可夹紧时优先近侧');assertInside(b,area);
  const card={x:b.x+(b.cardInset?.x||0),y:b.y+(b.cardInset?.y||0),...quotaLabelSize(size)};
  assert.equal(card.x<pet.x+pet.width&&card.x+card.width>pet.x&&card.y<pet.y+pet.height&&card.y+card.height>pet.y,false);
  if(guarded){assert.equal(b.width,quotaLabelSize(size).width+56);assert.equal(b.guardSide,side==='right'?'left':'right');}
 }
});


test('普通角色收16px透明尾且组合更贴右缘，大角色和未知角色保持64目标',()=>{
 const pet={x:710,y:130,width:80,height:80},area={x:0,y:0,width:800,height:500};
 for(const size of['compact','standard'])for(const role of[22,24,50,null,undefined]){
  const b=quotaLabelBounds(pet,area,null,size,false,1,{shape:'new-year-sheep',sheepTheme:'none',mode:'free',facing:'left',quotaRoleWidth:role},false,true);
  const width=[22,24].includes(role)?48:64;assert.equal(b.width,quotaLabelSize(size).width+8+width);assert.equal(b.x+b.width,800);assertInside(b,area);
  assert.equal(b.x+quotaLabelSize(size).width+8+width,800,'卡与角色整体平移，目标完整留在workArea');
 }
});

test('free夹紧近侧仍避让气泡，保卡面/角色画面在workArea且不盖羊',()=>{
 const area={x:-1000,y:40,width:1000,height:650};
 for(const corner of['top-left','top-right','bottom-left','bottom-right'])for(const role of[22,24,50]){
  const left=corner.includes('left'),top=corner.includes('top'),pet={x:left?area.x+2:area.x+area.width-122,y:top?area.y+2:area.y+area.height-122,width:120,height:120};
  const bubble={x:left?area.x:area.x+area.width-224,y:top?pet.y+pet.height+2:pet.y-90,width:224,height:86};
  const p={shape:'new-year-sheep',sheepTheme:'none',mode:'free',facing:left?'right':'left',quotaRoleWidth:role};
  const b=quotaLabelBounds(pet,area,bubble,'compact',false,1,p,false,true),paint={x:b.x+(b.guardSide==='left'?b.cardInset.x-8-role:0),y:b.y+b.cardInset.y-1,width:128+8+role,height:33};
  assertInside(b,area);const overlaps=(a,c)=>a.x<c.x+c.width&&a.x+a.width>c.x&&a.y<c.y+c.height&&a.y+a.height>c.y;
  assert.equal(overlaps(paint,bubble),false,JSON.stringify({corner,role,b,bubble}));assert.equal(overlaps(paint,require('../lib/pet-visual-bounds').petVisualBounds(pet,p.shape,{...p,quotaAnchor:true})),false);
 }
});

test('右近边free/peeked角色在左且卡右贴边，中部/左侧原右置，不裁点击目标',()=>{
 const area={x:-800,y:30,width:800,height:600};
 for(const width of[80,120,260])for(const role of[22,24,50])for(const size of['compact','standard']){
  const p={shape:'new-year-sheep',sheepTheme:'none',mode:'free',facing:'left',quotaRoleWidth:role},pet={x:-width-2,y:180,width,height:width};
  const b=quotaLabelBounds(pet,area,null,size,false,1,p,false,true),target=role===50?64:48,face=quotaLabelSize(size);
  assert.equal(b.guardSide,'left');assert.equal(b.cardInset.x,target+8);assert.equal(b.x+b.cardInset.x+face.width,0);assertInside(b,area);
  assert.equal(b.x+b.cardInset.x-8-target,b.x,'目标从窗左开始且不盖卡');
  for(const x of[-798,-500]){const other=quotaLabelBounds({...pet,x},area,null,size,false,1,p,false,true);assert.equal(other.guardSide,'right');assert.equal(other.cardInset.x,0);}
  const peek=quotaLabelBounds(pet,area,null,size,false,1,{...p,mode:'peeked'},false,true);assert.equal(peek.guardSide,'left');assert.equal(peek.x+peek.cardInset.x+face.width,0);
 }
});


test('ZCode 独立可读尺寸不改变 Codex，单开与 Codex 下方锚点一致，双开跟随卡中心', () => {
  const area={x:0,y:0,width:1000,height:800};
  for(const size of ['standard','compact']) for(const count of [1,2,4]) for(const expanded of [false,true]) {
    const pet={x:420,y:120,width:80,height:80};
    const codex=quotaLabelBounds(pet,area,null,size,expanded,count);
    const z=quotaLabelBounds(pet,area,null,size,expanded,count,{quotaSourceId:'zcode',quotaBottomAligned:true});
    assert.equal(z.x+z.width/2,codex.x+codex.width/2); assert.equal(z.y,codex.y);
    const stacked=quotaLabelBounds(pet,area,codex,size,expanded,count,{quotaSourceId:'zcode',quotaBottomAligned:true,quotaStackBelow:codex,quotaObstacles:[codex]});
    assert.equal(stacked.y,codex.y+codex.height+8); assert.equal(stacked.x+stacked.width/2,codex.x+codex.width/2);
    assertInside(stacked,area);
  }
  assert.deepEqual(quotaLabelSize('standard',true,2),{width:196,height:144});
  assert.deepEqual(quotaLabelSize('standard',true,1,false,false,null,'zcode'),{width:196,height:154});
  assert.deepEqual(quotaLabelSize('standard',true,2,false,false,null,'zcode'),{width:196,height:166});
  assert.deepEqual(quotaLabelSize('standard',true,4,false,false,null,'zcode'),{width:196,height:256});
});

test('ZCode 左右及底边夹紧后完整显示且不盖宠物/另一卡，分离障碍物不误占空白', () => {
  const area={x:-1000,y:40,width:1000,height:760};
  const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  for(const size of ['standard','compact']) for(const expanded of [false,true]) for(const x of [-998,-540,-82]) for(const y of [180,718]) {
    const pet={x,y,width:80,height:80},codex=quotaLabelBounds(pet,area,null,size,expanded,2);
    for(const stack of [null,codex]) {
      const z=quotaLabelBounds(pet,area,stack,size,expanded,4,{quotaSourceId:'zcode',quotaBottomAligned:true,quotaStackBelow:stack,quotaObstacles:[stack].filter(Boolean)});
      assertInside(z,area); assert.equal(overlap(z,pet),false,JSON.stringify({pet,codex,z}));
      if(stack) assert.equal(overlap(z,stack),false,JSON.stringify({pet,codex,z}));
    }
  }
});

test('ZCode compact pair stays adjacent to Codex at all four corners before trying a pet fallback', () => {
  const area = { x: -1440, y: 24, width: 1440, height: 876 };
  for (const x of [area.x, area.x + area.width - 80]) for (const y of [area.y, area.y + area.height - 80]) {
    const pet = { x, y, width: 80, height: 80 };
    const codex = quotaLabelBounds(pet, area, null, 'compact', false, 1, { mode: 'free', quotaRoleWidth: 22 }, false, true);
    const face = { x: codex.x + codex.cardInset.x + 2, y: codex.y + codex.cardInset.y + 2, width: 124, height: 28 };
    const zcode = quotaLabelBounds(pet, area, face, 'compact', false, 1,
      { mode: 'free', quotaSourceId: 'zcode', quotaBottomAligned: true, quotaStackBelow: face, quotaObstacles: [face] });
    assertInside(zcode, area); assertInside(face, area);
    assert.equal(zcode.x + zcode.width/2, face.x + face.width/2, JSON.stringify({pet,face,zcode}));
    assert.ok(zcode.y === face.y + face.height + 8 || zcode.y + zcode.height + 8 === face.y, JSON.stringify({pet,face,zcode}));
    assert.deepEqual(quotaLabelBounds(pet, area, null, 'compact', false, 1, { mode: 'free', quotaRoleWidth: 22 }, false, true), codex);
  }
});

test('three cards prefer Codex → API → ZCode below in free space and avoid both cards at every corner', () => {
  const { apiLabelBounds } = require('../lib/api-usage-label-window');
  const area = { x: -1440, y: 24, width: 1440, height: 876 };
  const overlap = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  for (const [name,x,y] of [['center', -760, 200], ['top-left', -1440, 24], ['top-right', -80, 24],
    ['bottom-left', -1440, 820], ['bottom-right', -80, 820]]) {
    const pet = { x, y, width: 80, height: 80 };
    const codex = quotaLabelBounds(pet, area, null, 'compact', false, 1, { mode:'free',quotaRoleWidth:22 }, false, true);
    const face = { x:codex.x+codex.cardInset.x+2, y:codex.y+codex.cardInset.y+2, width:124,height:28 };
    for (const apiExpanded of [false,true]) for (const expanded of [false,true]) {
      const api = apiLabelBounds(pet,area,face,null,apiExpanded,{mode:'free'}), inset=apiExpanded?0:2;
      const apiFace={x:api.x+inset,y:api.y+inset,width:api.width-inset*2,height:api.height-inset*2};
      const stack = [face,apiFace].sort((a,b)=>b.y+b.height-a.y-a.height)[0];
      const z = quotaLabelBounds(pet,area,null,'compact',expanded,4,{mode:'free',quotaSourceId:'zcode',quotaBottomAligned:true,
        quotaStackBelow:stack,quotaObstacles:[face,api]});
      assertInside(z,area);
      for(const obstacle of [pet,face,api]) assert.equal(overlap(z,obstacle),false,JSON.stringify({name,expanded,apiExpanded,z,obstacle}));
      if(name==='center') {
        assert.equal(z.y,apiFace.y+apiFace.height+8);
        assert.equal(z.x+z.width/2,face.x+face.width/2);
      }
      assert.deepEqual(quotaLabelBounds(pet,area,null,'compact',false,1,{mode:'free',quotaRoleWidth:22},false,true),codex);
    }
  }
});

test('free three-card group chooses one direction from all faces, including guard native gutters', () => {
  const { quotaFreeStackBounds } = require('../lib/quota-label-placement');
  const area={x:0,y:32,width:1200,height:800};
  const cards={codex:{width:128,height:32,inset:2,guardTargetWidth:48,roleWidth:22},api:{width:128,height:32,inset:2},zcode:{width:128,height:32,inset:2}};
  const pet={x:560,y:690,width:80,height:80};
  const plan=quotaFreeStackBounds(pet,area,cards,{mode:'free',shape:'blob'});
  assert.equal(plan.placement,'above');
  const faces=Object.values(plan.cards).map(row=>row.face);
  for(const row of Object.values(plan.cards))assertInside(row,area);
  assert.equal(faces[0].y+faces[0].height,pet.y-8);
  assert.equal(faces[1].y+faces[1].height+8,faces[0].y);
  assert.equal(faces[2].y+faces[2].height+8,faces[1].y);
  assert.ok(faces.every(row=>row.x+row.width/2===600));
  const low={...pet,y:200},below=quotaFreeStackBounds(low,area,cards,{mode:'free',shape:'blob'});
  assert.equal(below.placement,'below');
  const bubble={x:530,y:290,width:180,height:140};
  assert.equal(quotaFreeStackBounds(low,area,cards,{mode:'free',shape:'blob'},bubble).placement,'above','a bubble only rejects the intersecting candidate');
  assert.equal(quotaFreeStackBounds(pet,area,cards,{mode:'tucked',side:'left'}),null);
  assert.equal(quotaFreeStackBounds(pet,area,{...cards,api:null},{mode:'free'}),null,'single and dual layouts stay unchanged');
  assert.equal(quotaFreeStackBounds({x:560,y:160,width:80,height:80},{...area,height:300},
    {...cards,zcode:{width:196,height:256,inset:0}},{mode:'free'}),null,'an entire group that fits neither direction uses the existing fallback');
});

test('grouped free corners and expanded buckets stay aligned and inside; peek and blocked groups retain legacy fallback',()=>{
  const {quotaFreeStackBounds}=require('../lib/quota-label-placement'),area={x:-1400,y:32,width:1400,height:850};
  for(const x of[-1400,-80])for(const y of[32,802])for(const role of[22,24,50])for(const apiExpanded of[false,true])for(const count of[1,2,4])for(const expanded of[false,true])for(const size of['compact','standard']){
    const pet={x,y,width:80,height:80},cards={codex:{width:128,height:32,inset:2,guardTargetWidth:role===50?64:48,roleWidth:role},
      api:{width:apiExpanded?196:128,height:apiExpanded?92:32,inset:apiExpanded?0:2},zcode:{...quotaLabelSize(size,expanded,count,false,false,null,'zcode'),inset:size==='compact'&&!expanded?2:0}};
    const before=JSON.stringify(cards),plan=quotaFreeStackBounds(pet,area,cards,{mode:'free'});assert.ok(plan);
    assert.equal(plan.placement,y===32?'below':'above');
    const faces=Object.values(plan.cards).map(row=>row.face),center=faces[0].x+faces[0].width/2;
    for(const row of Object.values(plan.cards))assertInside(row,area);
    for(const face of faces)assert.equal(face.x+face.width/2,center);
    for(let i=1;i<faces.length;i++)assert.equal(plan.placement==='above'?faces[i-1].y-faces[i].y-faces[i].height:faces[i].y-faces[i-1].y-faces[i-1].height,8);
    assert.equal(JSON.stringify(cards),before);
    for(const side of['left','right'])assert.equal(quotaFreeStackBounds(pet,area,cards,{mode:'tucked',side}),null);
    assert.equal(quotaFreeStackBounds(pet,area,cards,{mode:'free'},{...area}),null);
  }
});

test('four-card free stack shares one direction and hides safely when space runs out', () => {
  const { quotaFreeStackBounds } = require('../lib/quota-label-placement');
  const cards = Object.fromEntries(['codex','api','zcode','workbuddy'].map(id => [id,{width:128,height:32,inset:2}]));
  const area={x:-1000,y:0,width:1000,height:800};
  for(const y of [100,650]) {
    const pet={x:-550,y,width:80,height:80};
    const plan=quotaFreeStackBounds(pet,area,cards,{mode:'free'});
    assert.equal(Object.keys(plan.cards).length,4);
    assert.equal(plan.placement,y===100?'below':'above');
    const rows=Object.values(plan.cards);
    for(const row of rows) {
      assert.equal(row.face.x+row.face.width/2,pet.x+pet.width/2);
      assert.ok(row.y>=area.y && row.y+row.height<=area.height);
    }
    for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) {
      const a=rows[i].face,b=rows[j].face;
      assert.ok(a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
  }
  const partial=quotaFreeStackBounds({x:-550,y:30,width:80,height:80},{...area,height:230},cards,{mode:'free'});
  assert.deepEqual(partial.hidden,Object.keys(cards));
  assert.equal(Object.keys(partial.cards).length,0);
  const blocked=quotaFreeStackBounds({x:-550,y:30,width:80,height:80},{...area,height:150},cards,{mode:'free'});
  assert.deepEqual(blocked.hidden,Object.keys(cards));
  assert.deepEqual(blocked.cards,{});
});


test('peeked four-card group uses mirrored edge columns, stable gaps and safe space recovery without moving pet', () => {
  const { quotaFreeStackBounds } = require('../lib/quota-label-placement');
  const area={x:-1000,y:20,width:1000,height:880};
  for(const side of ['left','right']) for(const y of [20,160,420,820]) for(const expanded of ['none','codex','api','zcode','workbuddy']) {
    const pet={x:side==='left'?area.x:area.x+area.width-80,y,width:80,height:80}, original={...pet};
    const cards=Object.fromEntries(['codex','api','zcode','workbuddy'].map(id=>[id,{width:id===expanded?196:128,height:id===expanded?(id==='zcode'?256:id==='api'?92:131):32,inset:id===expanded?0:2,...(id==='codex'&&expanded!=='codex'?{guardTargetWidth:48,roleWidth:22}:{})}]));
    const plan=quotaFreeStackBounds(pet,area,cards,{mode:'peeked',side,shape:'blob'});
    assert.equal(Object.keys(plan.cards).length,4);assert.deepEqual(pet,original);
    const rows=Object.values(plan.cards), faces=rows.map(row=>row.face);
    for(const row of rows) {
      assertInside(row,area);
      assert.equal(row.face.x+(side==='right'?row.face.width:0),side==='left'?area.x+2:area.x+area.width-2);
    }
    for(let i=1;i<faces.length;i++) assert.equal(faces[i].y-faces[i-1].y-faces[i-1].height,8);
    for(let i=0;i<faces.length;i++) for(let j=i+1;j<faces.length;j++) assert.ok(faces[i].y+faces[i].height<=faces[j].y||faces[j].y+faces[j].height<=faces[i].y);
    const hidden=quotaFreeStackBounds({...pet,y:50},{...area,height:150},cards,{mode:'peeked',side});assert.equal(hidden.placement,'hidden');assert.equal(hidden.hidden.length,4);
    assert.equal(Object.keys(quotaFreeStackBounds(pet,area,cards,{mode:'peeked',side}).cards).length,4);
    assert.equal(quotaFreeStackBounds(pet,area,cards,{mode:'tucked',side}),null);
  }
});


test('sheep four-theme shared groups retain mirrored order, painted guard clearance and whole-group recovery', () => {
  const { quotaFreeStackBounds } = require('../lib/quota-label-placement');
  const { petVisualBounds } = require('../lib/pet-visual-bounds');
  const area = { x:-1440, y:32, width:1440, height:1040 };
  const overlap = (a,b) => a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;
  for (const sheepTheme of ['none','halloween','christmas','spring-festival']) for (const width of [80,120,260])
    for (const side of ['left','right']) for (const mode of ['free','peeked']) for (const nearBottom of [false,true]) for (const roleWidth of [22,24,50]) {
      const pet = { x:side==='left'?area.x:area.x+area.width-width, y:nearBottom?area.y+area.height-width:area.y, width, height:width };
      const original = {...pet};
      const presentation = { mode, side, shape:'new-year-sheep', sheepTheme, facing:side==='left'?'right':'left' };
      const cards = {codex:{width:128,height:32,inset:2,roleWidth,guardTargetWidth:roleWidth===50?64:48},api:{width:128,height:32,inset:2},
        zcode:{width:196,height:256,inset:0},workbuddy:{width:128,height:32,inset:2}};
      const plan = quotaFreeStackBounds(pet,area,cards,presentation);
      assert.equal(Object.keys(plan.cards).length,4,JSON.stringify({presentation,width,nearBottom,plan}));
      assert.deepEqual(pet,original);
      const visual=petVisualBounds(pet,presentation.shape,{...presentation,quotaAnchor:true,quotaGuard:true});
      const rows=Object.values(plan.cards);
      for (const row of rows) { assertInside(row,area); assert.equal(overlap(row.face,visual),false); }
      for (let i=1;i<rows.length;i++) assert.equal(rows[i].face.y-rows[i-1].face.y-rows[i-1].face.height,8);
      const guard=rows[0], art={x:guard.guardSide==='left'?guard.face.x-2-8-roleWidth:guard.face.x-2+128+8,
        y:guard.face.y-3,width:roleWidth,height:32};
      assert.equal(overlap(art,visual),false,JSON.stringify({guard,visual,art}));
      if(mode==='peeked') for(const row of rows) assert.equal(row.face.x+(side==='right'?row.face.width:0),side==='left'?area.x+2:area.x+area.width-2);
      const small={...area,height:width+40};
      const hidden=quotaFreeStackBounds({...pet,y:area.y+20},small,cards,presentation);
      assert.deepEqual(hidden.hidden,Object.keys(cards)); assert.deepEqual(hidden.cards,{});
      assert.equal(Object.keys(quotaFreeStackBounds(pet,area,cards,presentation).cards).length,4);
    }
});
