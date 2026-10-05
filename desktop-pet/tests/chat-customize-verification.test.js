const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { assertChatSurface, createSmokeChatRpc } = require('../scripts/verify-chat-integration');
const { assertCustomizeSurface, assertAvatarSaveTransition } = require('../scripts/verify-customize-unified');
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });

function chatView(width = 360) {
  return { width, height: 480, scrollWidth: width, panel: rect(0, 0, width, 480), header: rect(1, 1, width - 2, 52),
    avatar: rect(12, 11, 32, 32), title: '聊一会儿', titleFont: '16px', statusHidden: true,
    update: rect(12, 61, width - 24, 36), conversation: rect(1, 97, width - 2, 190),
    composer: rect(12, 290, width - 24, 178), input: rect(13, 291, width - 26, 106), inputScroll: 172, inputClient: 106,
    send: rect(width - 98, 416, 74, 30), sendLabel: rect(width - 85.5, 423, 28, 16), sendIcon: rect(width - 51.5, 423.5, 15, 15),
    updateInMessages: false, headerButtons: [{ selector: '#close-chat', rect: rect(width - 39, 12, 27, 30) }],
    roles: [{ role: 'user', label: '你', border: '0px', background: 'rgb(225, 244, 236)' },
      { role: 'assistant', label: '球球', border: '0px', background: 'rgba(0, 0, 0, 0)' }] };
}

test('聊天验收比较 native 内容而非外框，接受 320/360 和四行滚动', () => {
  for (const width of [320, 360]) assert.doesNotThrow(() => assertChatSurface(chatView(width), { width, height: 480 }, { width, longInput: true }));
  assert.throws(() => assertChatSurface(chatView(), { width: 360, height: 508 }), /native content/);
  const view = chatView(); view.panel.left = 2;
  assert.throws(() => assertChatSurface(view, { width: 360, height: 480 }), /填满/);
});

test('聊天拒绝更新进入消息、输入扩出面板和发送内容偏心', () => {
  for (const [mutate, message] of [
    [view => { view.updateInMessages = true; }, /更新提示不进入/],
    [view => { view.update.height = 48; }, /独立 36px/],
    [view => { view.input.height = 132; }, /40 至 106/],
    [view => { view.inputScroll = 106; }, /四行/],
    [view => { view.sendLabel.left -= 8; }, /水平居中/],
    [view => { view.sendIcon.top -= 5; }, /垂直居中/]
  ]) {
    const view = chatView(); mutate(view);
    assert.throws(() => assertChatSurface(view, { width: 360, height: 480 }, { longInput: true }), message);
  }
});

test('聊天浅深气泡及角色检查不会把色弱自定义色当作标准色', () => {
  const dark = chatView(); dark.roles[0].background = 'rgb(37, 69, 63)';
  assert.doesNotThrow(() => assertChatSurface(dark, { width: 360, height: 480 }, { appearance: 'dark' }));
  assert.throws(() => assertChatSurface(dark, { width: 360, height: 480 }), /认可配色/);
  assert.doesNotThrow(() => assertChatSurface(dark, { width: 360, height: 480 }, { mode: 'accessible' }));
  dark.roles[1].label = '你';
  assert.throws(() => assertChatSurface(dark, { width: 360, height: 480 }, { mode: 'accessible' }), /角色/);
});

function customizeView() {
  return { width: 760, height: 580, scrollWidth: 760, scrollHeight: 580, scrollY: 0,
    bodyPadding: ['0px', '0px', '0px', '0px'], panelBorders: ['0px', '0px', '0px', '0px'],
    panelRadii: ['0px', '0px', '0px', '0px'], panelMaxWidth: 'none',
    panel: rect(0, 0, 760, 580), header: rect(0, 0, 760, 100), reset: rect(634, 48, 95, 34),
    title: rect(22, 44, 160, 27), headerDrag: 'drag', resetDrag: 'no-drag',
    footer: rect(0, 520, 760, 60), save: rect(634, 531, 98, 34), startup: rect(31, 535, 130, 24),
    preview: rect(31, 105, 278, 386), controls: rect(327, 105, 400, 386), stage: rect(31, 178, 278, 286), ball: rect(40, 191, 260, 260),
    controlsScroll: 0, controlsHeight: 910, controlsClient: 386, controlsOverflow: 'auto',
    saves: 1, oldSave: false, saveInFooter: true, startupInFooter: true, footerBorder: '0px', manualTag: 'BUTTON', manualExpanded: 'true',
    sizeLabel: '桌面实际尺寸 · 260 px', shapes: ['经典', '云朵', '幻彩', '方糖'] };
}

test('定制最小 native 内容四边贴合，拒绝额外页面滚动与旧二层容器', () => {
  assert.doesNotThrow(() => assertCustomizeSurface(customizeView(), { width: 760, height: 580 }, { desktopPixels: 260 }));
  const view = customizeView(); view.scrollHeight = 608;
  assert.throws(() => assertCustomizeSurface(view, { width: 760, height: 580 }), /整体页面/);
  assert.throws(() => assertCustomizeSurface(customizeView(), { width: 760, height: 552 }), /native content/);
  const inset = customizeView(); inset.panel = rect(12, 12, 736, 556);
  assert.throws(() => assertCustomizeSurface(inset, { width: 760, height: 580 }), /四边铺满/);
  const radius = customizeView(); radius.panelRadii[0] = '15px';
  assert.throws(() => assertCustomizeSurface(radius, { width: 760, height: 580 }), /卡片圆角/);
  const padding = customizeView(); padding.bodyPadding[0] = '12px';
  assert.throws(() => assertCustomizeSurface(padding, { width: 760, height: 580 }), /外层页面留白/);
  const overlap = customizeView(); overlap.title.top = 14;
  assert.throws(() => assertCustomizeSurface(overlap, { width: 760, height: 580 }), /原生交通灯/);
  const noDrag = customizeView(); noDrag.headerDrag = 'no-drag';
  assert.throws(() => assertCustomizeSurface(noDrag, { width: 760, height: 580 }), /窗口拖动/);
  const unclickable = customizeView(); unclickable.resetDrag = 'drag';
  assert.throws(() => assertCustomizeSurface(unclickable, { width: 760, height: 580 }), /保持可点击/);
});

test('定制拒绝重复保存、恢复按钮裁切、260预览缩小或被裁切', () => {
  for (const [mutate, message] of [
    [view => { view.oldSave = true; }, /strict|false/],
    [view => { view.saves = 2; }, /唯一保存/],
    [view => { view.reset.top = -2; }, /标题行/],
    [view => { view.ball.width = 240; }, /实际尺寸/],
    [view => { view.ball.right = 312; }, /不被裁切/],
    [view => { view.controlsOverflow = 'visible'; }, /独立滚动/]
  ]) {
    const view = customizeView(); mutate(view);
    assert.throws(() => assertCustomizeSurface(view, { width: 760, height: 580 }, { desktopPixels: 260 }), message);
  }
});

function avatarTransition() {
  const before = { pending: false, replacement: false, time: 0 };
  const loading = { pending: true, replacement: true, time: 16, fallbackHidden: true, heldVisible: true, posterVisible: false, riveVisible: false };
  const ready = { pending: false, shape: 'aurora-cloud', engine: 'rive', ready: 'true', active: 'true',
    contour: 'six-lobe', outlineReady: 'true', replacement: true, time: 180,
    fallbackHidden: true, riveVisible: true, heldVisible: false, posterVisible: false };
  return { finished: true, observed: [{ ...before }, { ...loading }, { ...loading }, { ...ready }],
    captures: Array.from({ length: 8 }, (_, index) => ({ before: { ...(index === 0 ? before : index < 4 ? loading : ready) },
      after: { ...(index === 0 ? before : index < 4 ? loading : ready) }, colorRange: 180, purplePixels: index < 4 ? 0 : 100, digest: String(index) })) };
}

test('原生头像保存门禁接受保留旧头像/正确截图到六瓣真实帧的完整交接', () => {
  assert.doesNotThrow(() => assertAvatarSaveTransition(avatarTransition()));
  const poster = avatarTransition(); poster.observed[1].heldVisible = false; poster.observed[1].posterVisible = true;
  assert.doesNotThrow(() => assertAvatarSaveTransition(poster));
  const warm = avatarTransition(); warm.observed = [warm.observed[0], warm.observed.at(-1)];
  warm.captures.slice(1).forEach(frame => { frame.before.pending = false; frame.after.pending = false; });
  assert.doesNotThrow(() => assertAvatarSaveTransition(warm), '暖缓存同步ready不要求出现pending帧');
});

test('原生头像保存门禁拒绝闪现fallback、空档、缺少实际过程帧和metadata空渲染', () => {
  for (const [mutate, message] of [
    [report => { report.observed[1].fallbackHidden = false; }, /fallback/],
    [report => { report.observed[1].heldVisible = false; }, /已绘制头像/],
    [report => { report.observed = report.observed.slice(-1); }, /保存前/],
    [report => { report.observed.at(-1).contour = 'original'; }, /six-lobe/],
    [report => { report.captures.length = 2; }, /八张/],
    [report => { report.captures.forEach(frame => { frame.before.pending = false; frame.after.pending = false; frame.before.time = 300; frame.after.time = 301; }); }, /加载时/],
    [report => { report.captures[0].colorRange = 0; }, /空白背景/],
    [report => { report.captures.forEach(frame => { frame.digest = 'same'; }); }, /旧合成帧/],
    [report => { report.captures.at(-1).purplePixels = 0; }, /幻彩身体/]
  ]) { const report = avatarTransition(); mutate(report); assert.throws(() => assertAvatarSaveTransition(report), message); }
});

async function runChatLauncher(output, { packaged = true, code = 0 } = {}) {
  const runner = path.resolve(__dirname, '../scripts/smoke-chat.js'), sourceRequire = createRequire(runner);
  const processStub = { env: packaged ? { PET_SMOKE_APP_PATH: '/candidate/Qiuqiu.app', PET_SMOKE_EXECUTABLE: 'Candidate' } : {},
    versions: {}, execPath: '/runtime/node', stdout: { write() {} }, exitCode: 0 };
  let launched;
  const completion = new Promise(resolve => {
    const childProcess = { spawn(binary, args, options) {
      launched = { binary, args, options };
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => { child.stdout.emit('data', output); child.emit('close', code); resolve(); }); return child;
    } };
    vm.runInNewContext(fs.readFileSync(runner, 'utf8'), { __dirname: path.dirname(runner), __filename: runner,
      process: processStub, console, setTimeout, clearTimeout,
      require(name) { if (name === 'node:child_process') return childProcess; if (name === 'electron') return '/runtime/electron'; return sourceRequire(name); } });
  });
  await completion; return { launched, exitCode: processStub.exitCode };
}

test('包内聊天入口通过候选 App 的既有隔离烟测运行，要求 UI 与集成两个标记', async () => {
  const passed = await runChatLauncher('PET_CHAT_UI_SMOKE_OK\nPET_CHAT_INTEGRATION_OK');
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.launched.binary, '/runtime/node');
  assert.equal(path.basename(passed.launched.args[0]), 'smoke-electron.js');
  assert.equal(passed.launched.options.env.PET_SMOKE_APP_PATH, '/candidate/Qiuqiu.app');
  assert.equal(passed.launched.options.env.PET_SMOKE_CHAT_ONLY, '1');
  for (const output of ['PET_CHAT_UI_SMOKE_OK', 'PET_CHAT_INTEGRATION_OK', 'PET_CHAT_UI_SMOKE_OK\nPET_CHAT_INTEGRATION_OK\nERR_FILE_NOT_FOUND']) {
    assert.equal((await runChatLauncher(output)).exitCode, 1, output);
  }
  assert.equal((await runChatLauncher('PET_CHAT_UI_SMOKE_OK\nPET_CHAT_INTEGRATION_OK', { code: 1 })).exitCode, 1);
});

test('原生失败 mock 在入库前拒绝下一次发送，重新核验后恢复原历史且不新增消息', async t => {
  const previous = { smoke: process.env.PET_SMOKE_TEST, chat: process.env.PET_SMOKE_CHAT_ONLY };
  process.env.PET_SMOKE_TEST = '1'; process.env.PET_SMOKE_CHAT_ONLY = '1';
  const { createChatCompanion } = require('../lib/chat-companion');
  const { emptyRecord } = require('../lib/chat-store');
  let saved = emptyRecord();
  const companion = createChatCompanion({ workspaceDir: '/tmp/qiuqiu-verifier-only', createRpc: createSmokeChatRpc,
    store: { read: () => structuredClone(saved), write: value => { saved = structuredClone(value); } } });
  t.after(() => {
    companion.close();
    for (const [key, value] of [['PET_SMOKE_TEST', previous.smoke], ['PET_SMOKE_CHAT_ONLY', previous.chat]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  await companion.connect();
  assert.equal((await companion.send('普通模拟验收')).accepted, true);
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(companion.getState().busy, false);
  assert.equal((await companion.send('模拟下一次连接失败')).accepted, true, '已接收消息保留在记录中');
  const before = structuredClone(saved);
  assert.equal((await companion.send('发送失败验收')).accepted, false, '真正未接收消息返回 false');
  assert.deepEqual(saved.messages, before.messages, '失败不把未接收草稿加入历史');
  assert.equal(companion.getState().history.length, 0, '连接未核验时保护历史');
  await companion.connect();
  assert.equal(companion.getState().messages.length, before.messages.length);
  assert.equal(companion.getState().history.length, 1);
});
