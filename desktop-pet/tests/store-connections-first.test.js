const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../lib/provider-connection-guide');
const file = path.join(__dirname, '../store-connections-first-renderer.js');
function fixture(state) {
  const elements = new Map(), commands = [], events = {};
  const element = id => { if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false, replaceChildren(...children) { this.children = children; } }); return elements.get(id); };
  const buttons = ['connect', 'refresh-quota', 'open-chat', 'connect-tasks', 'revoke-consent', 'disconnect'].map(element);
  const document = { getElementById: element, querySelectorAll: () => buttons, createElement: () => ({ textContent: '' }) };
  let changed;
  const window = { ProviderConnectionGuide: model, storeConnections: { command: async (action, payload) => { commands.push({ action, payload }); return { ok: true, state }; }, onChange: callback => { changed = callback; return () => {}; } }, addEventListener: (name, callback) => { events[name] = callback; } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window, document, Date, console });
  return { element, commands, events, changed, settle: () => new Promise(resolve => setImmediate(resolve)) };
}
const disconnected = () => ({ codex: { directory: 'needs-authorization' }, managedCodexQuota: { status: 'needs-login', snapshot: null }, onboarding: { codex: { status: 'idle', chat: { status: 'needs-login' } } } });
test('首次连接本机Codex复用登录，不请求任务只读目录；任务由独立按钮按需授权', async () => {
  const f = fixture(disconnected()); await f.settle();
  assert.equal(f.element('connect').textContent,'连接本机 Codex');
  await f.element('connect').onclick();
  let command = f.commands.at(-1); assert.equal(command.action, 'enable-provider'); assert.equal(command.payload.provider, 'codex'); assert.equal(command.payload.capability, 'chat');
  await f.element('connect-tasks').onclick();
  command = f.commands.at(-1); assert.equal(command.action, 'enable-provider-data'); assert.equal(command.payload.provider, 'codex'); assert.equal(command.payload.capability, 'data');
  assert.equal(f.commands.some(c => /send|plugin|zcode|workbuddy/.test(c.action)), false);
});
test('同账号额度无任务只读目录也可读，聊天可直接进入；失效历史任务明确不当实时', async () => {
  const state = disconnected(); state.managedCodexQuota = { status: 'ready', snapshot: { windows: [{ windowMinutes: 300, usedPercent: 25 }], updatedAt: 1000 } };
  state.providerChats = { codex: { connection: 'ready', modelsStatus: 'ready' } };
  state.codex = { directory: 'stored' }; state.codexSnapshot = { tasks: { state: 'connected', stale: true, items: [{ title: '历史任务', state: 'completed' }] } };
  const f = fixture(state); await f.settle();
  assert.match(f.element('codex-quota').textContent, /75%/); assert.equal(f.element('open-chat').disabled, false);
  assert.match(f.element('task-list').children[0].textContent, /上次记录.*当前待核实/);
  await f.element('open-chat').onclick(); assert.equal(f.commands.at(-1).action, 'open-provider-chat');
});
test('刷新及撤销分别使用额度查询刷新和明确撤销动作，不重新登录或发送', async () => {
  const f = fixture(disconnected()); await f.settle();
  await f.element('refresh-quota').onclick(); assert.equal(f.commands.at(-1).action, 'refresh-status');
  await f.element('revoke-consent').onclick(); assert.equal(f.commands.at(-1).action, 'revoke-chat-data-consent');
  assert.equal(f.commands.some(c => c.action === 'enable-provider' || c.action.includes('send')), false);
});
