const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { chooseMotion } = require('../lib/interaction-motion');
const { SIZES } = require('../lib/window-placement');
const helperPath = path.resolve(__dirname, '../scripts/verify-body-motion.js');

function helper() {
  assert.ok(fs.existsSync(helperPath), '缺少真实身体动作验收助手');
  return require(helperPath);
}

test('动作验收尺寸必须完整取自产品实际尺寸定义', () => {
  assert.deepEqual(helper().BODY_MOTION_SIZES, Object.values(SIZES).map(size => size.width));
});

// 只替代启动Electron的进程边界，实际运行烟测脚本的输出校验；不打开GUI。
async function validateSmokeOutput(markers) {
  const runner = path.resolve(__dirname, '../scripts/smoke-electron.js');
  const runnerRequire = createRequire(runner);
  const result = { exitCode: 0, errors: '' };
  await vm.runInNewContext(fs.readFileSync(runner, 'utf8'), {
    __dirname: path.dirname(runner), setTimeout, clearTimeout,
    process: {
      env: {}, stdout: { write() {} }, stderr: { write(text) { result.errors += text; } },
      set exitCode(value) { result.exitCode = value; }
    },
    require(name) {
      if (name === 'electron') return '/not-launched/electron';
      if (name !== 'node:child_process') return runnerRequire(name);
      return { spawn() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => {
          child.stdout.emit('data', markers.map(marker => `PET_${marker}_OK`).join('\n'));
          child.emit('close', 0);
        });
        return child;
      } };
    }
  });
  return result;
}

const completeMarkers = [
  'SMOKE', 'BOUNCE', 'USER_DATA', 'ACTIVITY_STATES', 'GAZE', 'TOUCH_DRAG', 'BUBBLE_REPLY',
  'BUBBLE_EDGES_SETTINGS', 'NATIVE_ACTIVITY', 'FIXED_COLOR', 'DOUBLE_CLICK', 'BODY_MOTION',
  'BODY_MOTION_INTERRUPTS', 'BODY_MOTION_EDGES',
  'CODEX_SIMULATED', 'CODEX_TASK_MENU', 'CODEX_TASK_TITLE',
  ...Object.values(SIZES).map(size => `CODEX_SIZE_${size.width}`),
  ...Object.values(SIZES).map(size => `BODY_MOTION_SIZE_${size.width}`),
  ...['HOP', 'JELLY', 'SWAY', 'PEEK', 'BOW', 'SPIN'].map(id => `BODY_MOTION_${id}`)
];

test('烟测接受全部真实尺寸的通过标记，不额外要求不存在的240尺寸', async () => {
  const result = await validateSmokeOutput(completeMarkers);
  assert.equal(result.exitCode, 0, result.errors);
});

test('烟测拒绝用旧240标记冒充真实大尺寸已通过', async () => {
  const largeMarker = `BODY_MOTION_SIZE_${SIZES.large.width}`;
  const result = await validateSmokeOutput(completeMarkers.filter(marker => marker !== largeMarker).concat('BODY_MOTION_SIZE_240'));
  assert.equal(result.exitCode, 1, '未完成真实大尺寸检查不能通过');
  assert.ok(result.errors.includes(largeMarker), result.errors);
});

test('只有旧动作标记不能冒充已完成 Codex 原生检查', async () => {
  const result = await validateSmokeOutput(completeMarkers.filter(marker => !marker.startsWith('CODEX_')));
  assert.equal(result.exitCode, 1);
  assert.match(result.errors, /CODEX_SIMULATED/);
  const missingTiny = await validateSmokeOutput(completeMarkers.filter(marker => marker !== 'CODEX_SIZE_80'));
  assert.equal(missingTiny.exitCode, 1);
  assert.match(missingTiny.errors, /CODEX_SIZE_80/);
});

test('缺少任务菜单或名称开关标记时烟测失败', async () => {
  for (const marker of ['CODEX_TASK_MENU', 'CODEX_TASK_TITLE']) {
    const result = await validateSmokeOutput(completeMarkers.filter(value => value !== marker));
    assert.equal(result.exitCode, 1, `缺少 ${marker} 时不能通过`);
    assert.match(result.errors, new RegExp(marker));
  }
});

test('动作验收用轮廓点与实际变换判断边界，不误用旋转矩形的四角', () => {
  const { contourBounds } = helper();
  const points = 'M 0 -1 L 1 0 L 0 1 L -1 0 Z';
  const angle = Math.PI / 4;
  const bounds = contourBounds(points, { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 1, f: 1 });
  assert.ok(bounds.minX > 0.29 && bounds.maxX < 1.71);
  assert.ok(bounds.minY > 0.29 && bounds.maxY < 1.71);
  assert.equal(bounds.pointCount, 4);
  assert.throws(() => contourBounds('', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), /轮廓/);
});

test('真实帧边界检查拒绝裁切和改色，但接受负坐标显示器', () => {
  const { assertVisibleFrame } = helper();
  const frame = { viewport: { width: 80, height: 80 }, contour: { minX: 2, maxX: 78, minY: 2, maxY: 78, pointCount: 96 }, bodyColor: '#EEEBE4', eyeColors: ['#1A1A1A', '#1A1A1A'] };
  const area = { x: -1440, y: -200, width: 1440, height: 900 };
  const bounds = { x: -1400, y: -180, width: 80, height: 80 };
  assert.doesNotThrow(() => assertVisibleFrame(frame, bounds, area, 'hop'));
  assert.throws(() => assertVisibleFrame({ ...frame, contour: { ...frame.contour, minX: -1 } }, bounds, area, 'hop'), /裁切/);
  assert.throws(() => assertVisibleFrame({ ...frame, bodyColor: '#FFFFFF' }, bounds, area, 'hop'), /颜色/);
  assert.throws(() => assertVisibleFrame(frame, { ...bounds, x: -1450 }, area, 'hop'), /屏幕/);
});

test('每种动作的真实双击随机值遵守权重与上次动作排除规则', () => {
  const { randomForMotion } = helper();
  const ids = ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin'];
  for (const previous of [null, ...ids]) {
    for (const id of ids.filter(id => id !== previous)) {
      assert.equal(chooseMotion(randomForMotion(id, previous), previous).id, id);
    }
  }
  assert.throws(() => randomForMotion('hop', 'hop'), /排除/);
});

test('结束身体允许原有轻微呼吸，但不允许残留压扁、旋转或位移', () => {
  const { isRestingTransform } = helper();
  assert.equal(typeof isRestingTransform, 'function', '缺少呼吸与动作残留的分离检查');
  const pose = (x, y, rotate, sx, sy) => `translate(${114.27 + x} ${114.27 + y}) rotate(${rotate}) scale(${sx} ${sy}) translate(-114.27 -114.27)`;
  assert.ok(isRestingTransform(pose(0, 0.6, 0, 1.01, 1.01)));
  assert.ok(!isRestingTransform(pose(0, 0, 0, 1, 0.9)));
  assert.ok(!isRestingTransform(pose(0, 0, 2, 1, 1)));
  assert.ok(!isRestingTransform(pose(0, 3, 0, 1, 1)));
  assert.ok(!isRestingTransform(''));
});
