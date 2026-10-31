const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createFeedbackReporting } = require('../lib/feedback-reporting');

const payload = (extra = {}) => ({ submissionId: randomUUID(), type: 'problem', title: '无法打开便签', detail: '点击便签后没有反应', contact: '', attachments: [], ...extra });
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-feedback-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'profile'), calls = [], timers = new Map();
  let time = 100000000, serial = 0;
  const config = { directory, version: '0.4.09', now: () => time,
    schedule(fn, delay) { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id; },
    cancel: id => timers.delete(id),
    fetch: async (url, args) => { calls.push({ url, args, body: JSON.parse(args.body) }); return { ok: true, json: async () => ({ id: JSON.parse(args.body).submissionId }) }; }, ...options };
  const service = createFeedbackReporting(config);
  t.after(() => service.dispose());
  return { service, calls, config, directory, timers, file: path.join(directory, 'feedback-outbox.json'),
    setTime(value) { time = value; }, now: () => time,
    async advance(ms) { time += ms; await service.flush(); } };
}

test('disabled by default: no directory, disk write, timer or network and no captured content', async t => {
  const f = fixture(t);
  assert.equal(f.service.capture('天气', new Error('secret')), false);
  await f.service.flush();
  assert.equal(fs.existsSync(f.directory), false);
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.service.getState(), { enabled: false, pending: 0, lastSentAt: null, lastError: '', history: [], historyWarning: '' });
});

test('manual feedback works without automatic consent and takes authoritative environment only when requested', async t => {
  const f = fixture(t);
  const value = payload({ version: 'forged', os: 'secret-machine-name', source: 'website', log: 'secret-log' });
  assert.equal((await f.service.submit(value)).id, value.submissionId);
  assert.equal(f.calls[0].body.version, ''); assert.equal(f.calls[0].body.os, '');
  assert.equal(f.calls[0].body.source, 'app');
  const included = payload({ includeDiagnostics: true, version: 'forged', os: 'secret-machine-name' });
  await f.service.submit(included);
  assert.equal(f.calls[1].body.version, '0.4.09');
  assert.match(f.calls[1].body.detail, /【使用环境】/);
  assert.match(f.calls[1].body.detail, /"architecture"/);
  assert.doesNotMatch(JSON.stringify(f.calls), /forged|secret-machine|secret-log/);
  assert.equal(fs.existsSync(path.join(f.directory, 'feedback-history.json')), true);
  assert.equal(fs.existsSync(f.file), false, 'manual history does not enable automatic reporting');
});

test('manual input validates all trust boundaries and strips extra fields', async t => {
  const f = fixture(t);
  for (const change of [{ submissionId: 'bad' }, { type: 'arbitrary' }, { title: '' }, { title: 'a'.repeat(101) },
    { detail: 'a'.repeat(5001) }, { includeDiagnostics: true, detail: 'a'.repeat(4001) }, { contact: 'x'.repeat(201) },
    { detail: 'bad\0value' }, { attachments: [{ name: '../secret', data: 'a', type: 'image/png' }] },
    { attachments: [{ name: 'x.png', data: Buffer.from('not image').toString('base64'), type: 'image/png' }] },
    { attachments: [{ name: 'x.png', data: 'a'.repeat(1400000), type: 'image/png' }] },
    { attachments: [1, 2, 3, 4] }, { attachments: {} }]) {
    await assert.rejects(f.service.submit(payload(change)));
  }
  assert.equal(f.calls.length, 0);
  const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  await f.service.submit(payload({ attachments: [{ name: 'screen.png', type: 'image/png', data, extra: 'secret' }] }));
  assert.deepEqual(f.calls[0].body.attachments, [{ name: 'screen.png', type: 'image/png', data }]);
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['attachments', 'contact', 'detail', 'os', 'source', 'submissionId', 'title', 'type', 'version']);
});

test('wrong receipt, HTTP failures and raw transport errors cannot become success or leak response content', async t => {
  for (const fetch of [async () => ({ ok: true, json: async () => ({ id: randomUUID() }) }),
    async () => ({ ok: true, json: async () => { throw Error('secret response'); } }),
    async () => ({ ok: false, status: 503 }), async () => { throw Error('secret token'); }]) {
    const f = fixture(t, { fetch });
    await assert.rejects(f.service.submit(payload()), error => !/secret/.test(error.message) && /保留/.test(error.message));
  }
});

test('automatic capture aggregates before sending and uploads no message, stack, custom codes or identity', async t => {
  const f = fixture(t, { enabled: true });
  for (let i = 0; i < 3; i++) assert.equal(f.service.capture('天气', Object.assign(new TypeError('/Users/private secret token'), { code: 'SECRET_KEY', stack: 'secret stack' })), true);
  assert.equal(f.service.getState().pending, 1);
  assert.equal(f.calls.length, 0);
  await f.advance(2000);
  assert.equal(f.calls.length, 1);
  const detail = JSON.parse(f.calls[0].body.detail);
  assert.equal(detail.occurrences, 3); assert.equal(detail.module, '天气'); assert.equal(detail.errorName, 'TypeError');
  assert.equal(detail.errorCode, ''); assert.match(detail.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(f.calls[0].body), /secret|private|Users|stack|SECRET/);
  assert.equal(f.service.getState().pending, 0); assert.equal(f.service.getState().lastSentAt, f.now());
  assert.equal(f.service.capture('天气', new TypeError('different message')), false);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});

test('unknown module/error names are replaced instead of truncating secret strings', async t => {
  const f = fixture(t, { enabled: true });
  f.service.capture('secret-module-path', { name: 'secret-name', code: 'secret-code', message: 'secret' });
  await f.advance(2000);
  assert.equal(JSON.parse(f.calls[0].body.detail).module, '应用运行');
  assert.doesNotMatch(JSON.stringify(f.calls[0].body), /secret/);
});

test('failed automatic request retains exact UUID/body, backs off, and survives restart', async t => {
  const f = fixture(t, { enabled: true, fetch: async () => { throw Error('secret failure'); } });
  f.service.capture('窗口崩溃', new Error('secret'));
  f.setTime(f.now() + 2000); await f.service.flush();
  const stored = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.equal(stored.queue[0].attempts, 1); assert.equal(stored.queue[0].nextAttemptAt, f.now() + 60000);
  assert.equal(f.service.getState().pending, 1); assert.doesNotMatch(f.service.getState().lastError, /secret/);
  f.service.dispose();
  const calls = [];
  const next = createFeedbackReporting({ ...f.config, enabled: true, fetch: async (_url, args) => {
    calls.push(JSON.parse(args.body)); return { ok: true, json: async () => ({ id: calls.at(-1).submissionId }) };
  } });
  t.after(() => next.dispose());
  await next.flush(); assert.equal(calls.length, 0);
  f.setTime(f.now() + 60000); await next.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].submissionId, stored.queue[0].id);
  assert.equal(JSON.parse(calls[0].detail).firstSeenAt, stored.queue[0].firstAt);
  assert.equal(next.getState().pending, 0);
});

test('same pending failure cannot mutate frozen retry body', async t => {
  const bodies = [], f = fixture(t, { enabled: true, fetch: async (_url, args) => { bodies.push(args.body); throw Error(); } });
  f.service.capture('天气', new Error()); await f.advance(2000);
  f.service.capture('天气', new Error()); await f.advance(60000);
  assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
});

test('disabling cancels automatic request, clears persisted queue and does not resurrect it on re-enable', async t => {
  let aborted = false, finish;
  const f = fixture(t, { enabled: true, fetch: (_url, args) => new Promise((_resolve, reject) => {
    finish = () => reject(Error('secret')); args.signal.addEventListener('abort', () => { aborted = true; finish(); });
  }) });
  f.service.capture('天气', new Error()); f.setTime(f.now() + 2000);
  const pending = f.service.flush();
  assert.equal(f.service.getState().pending, 1);
  f.service.setEnabled(false); await pending;
  assert.equal(aborted, true); assert.equal(f.service.getState().pending, 0);
  assert.equal(fs.existsSync(f.file), false);
  f.service.setEnabled(true);
  assert.equal(f.service.getState().pending, 0); assert.equal(f.timers.size, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).queue, []);
});

test('queue is bounded and malformed persisted content is never forwarded', async t => {
  const f = fixture(t, { enabled: true });
  const scopes = ['天气', '窗口崩溃', '窗口无响应', '页面加载失败', '页面脚本错误', '未处理异步错误', '主进程异常', '快捷面板',
    '全局设置', 'API 费用面板', '关于球球', '保存更新提醒', '定制面板加载', '定制面板', '保存我的形象', '导入 Codex 宠物',
    '保存球球定制', 'API 余额账户', 'API 余额卡', 'API 余额趋势', '保存 API 常驻显示'];
  for (const scope of scopes) f.service.capture(scope, new Error());
  assert.equal(f.service.getState().pending, 20); assert.equal(JSON.parse(fs.readFileSync(f.file)).queue.length, 20);
  f.service.dispose();
  fs.writeFileSync(f.file, JSON.stringify({ schema: 1, queue: [{ id: randomUUID(), scope: 'secret-module', detail: 'secret' }], recent: [] }));
  const next = createFeedbackReporting({ ...f.config, enabled: true }); t.after(() => next.dispose());
  await next.flush(); assert.equal(f.calls.length, 0); assert.equal(next.getState().pending, 0);
  assert.match(next.getState().lastError, /无法读取/);
});

test('local persistence errors remain visible and do not send an unpersisted queue', async t => {
  const f = fixture(t, { enabled: true });
  fs.writeFileSync(f.directory, 'not-a-directory');
  f.service.capture('天气', new Error()); await f.advance(2000);
  assert.equal(f.calls.length, 0); assert.match(f.service.getState().lastError, /存储空间或权限/);
});

test('a later capture re-arms queue after a transient local persistence failure', async t => {
  const f = fixture(t, { enabled: true });
  fs.writeFileSync(f.directory, 'not-a-directory');
  f.service.capture('天气', new Error());
  assert.equal(f.timers.size, 0);
  fs.rmSync(f.directory); f.service.capture('天气', new Error());
  assert.equal(f.timers.size, 1);
  await f.advance(2000); assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(f.calls[0].body.detail).occurrences, 2);
});

test('disable and immediate re-enable detach old flight without allowing its completion to clear a new flight', async t => {
  const requests = [];
  const f = fixture(t, { enabled: true, fetch: (_url, args) => new Promise(resolve => {
    requests.push({ resolve: () => resolve({ ok: true, json: async () => ({ id: JSON.parse(args.body).submissionId }) }), body: args.body });
  }) });
  f.service.capture('天气', Object.assign(new Error(), { code: 'WINDOW_UNRESPONSIVE' }));
  f.setTime(f.now() + 2000); const old = f.service.flush();
  f.service.setEnabled(false); f.service.setEnabled(true);
  f.service.capture('窗口崩溃', Object.assign(new Error(), { code: 'RENDER_PROCESS_GONE' }));
  f.setTime(f.now() + 2000); const current = f.service.flush();
  assert.equal(requests.length, 2);
  requests[0].resolve(); await old;
  assert.equal(f.service.getState().pending, 1);
  const joined = f.service.flush(); assert.equal(joined, current); assert.equal(requests.length, 2);
  requests[1].resolve(); await current;
  assert.equal(f.service.getState().pending, 0);
  assert.equal(JSON.parse(JSON.parse(requests[1].body).detail).errorCode, 'RENDER_PROCESS_GONE');
});

test('confirmed manual history survives restart, contains only receipt fields and keeps original timestamp on retry', async t => {
  const f = fixture(t), data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  const value = payload({ includeDiagnostics: true, contact: 'private@example.invalid', attachments: [{ name: 'screen.png', type: 'image/png', data }] });
  const first = await f.service.submit(value), at = f.now();
  assert.deepEqual(first.record, { id: value.submissionId, type: value.type, title: value.title, detail: value.detail,
    submittedAt: at, attachmentCount: 1, version: '0.4.09' });
  f.setTime(at + 5000);
  const retry = await f.service.submit(value);
  assert.equal(retry.record.submittedAt, at); assert.equal(f.service.getState().history.length, 1);
  const historyFile = path.join(f.directory, 'feedback-history.json'), stored = fs.readFileSync(historyFile, 'utf8');
  assert.equal(fs.statSync(historyFile).mode & 0o777, 0o600);
  assert.doesNotMatch(stored, /private@example|screen\.png|【使用环境】|architecture|"data"/);
  assert.equal(stored.includes(data), false);
  f.service.getState().history[0].title = 'modified outside';
  assert.equal(f.service.getState().history[0].title, value.title);
  f.service.dispose();
  const next = createFeedbackReporting(f.config); t.after(() => next.dispose());
  assert.deepEqual(next.getState().history, [first.record]);
  assert.equal(next.getState().enabled, false, 'manual history is independent from automatic reporting');
});

test('failed or unconfirmed manual requests never enter submitted history', async t => {
  for (const fetch of [async () => ({ ok: false, status: 503 }), async () => ({ ok: true, json: async () => ({ id: randomUUID() }) })]) {
    const f = fixture(t, { fetch }); await assert.rejects(f.service.submit(payload()));
    assert.deepEqual(f.service.getState().history, []);
    assert.equal(fs.existsSync(path.join(f.directory, 'feedback-history.json')), false);
  }
});

test('submitted history is newest-first and bounded to 100 distinct receipts', async t => {
  const f = fixture(t), values = [];
  for (let i = 0; i < 102; i++) {
    f.setTime(f.now() + 1); const value = payload({ title: '反馈 ' + i }); values.push(value);
    await f.service.submit(value);
  }
  const history = f.service.getState().history;
  assert.equal(history.length, 100); assert.equal(history[0].id, values[101].submissionId);
  assert.equal(history.at(-1).id, values[2].submissionId);
  f.service.dispose();
  const next = createFeedbackReporting(f.config); t.after(() => next.dispose());
  assert.deepEqual(next.getState().history, history);
});

test('automatic delivery and consent toggles do not enter or remove manual submitted history', async t => {
  const f = fixture(t); await f.service.submit(payload()); const history = f.service.getState().history;
  f.service.setEnabled(true); f.service.capture('天气', new Error('private')); await f.advance(2000);
  assert.equal(f.calls.length, 2); assert.match(f.calls[1].body.title, /^\[自动异常\]/);
  assert.deepEqual(f.service.getState().history, history);
  f.service.setEnabled(false); assert.deepEqual(f.service.getState().history, history);
  assert.equal(fs.existsSync(path.join(f.directory, 'feedback-history.json')), true);
});

test('a server-confirmed submission remains successful when local history cannot be written, and retry can persist it', async t => {
  const f = fixture(t), value = payload(); fs.writeFileSync(f.directory, 'not-a-directory');
  const first = await f.service.submit(value);
  assert.equal(first.id, value.submissionId); assert.match(first.historyWarning, /已提交.*保存失败/);
  assert.equal(f.service.getState().history[0].id, value.submissionId);
  assert.equal(f.service.getState().lastError, '', 'manual history failure must not become automatic reporting failure');
  fs.unlinkSync(f.directory); f.setTime(f.now() + 5000);
  const retry = await f.service.submit(value);
  assert.equal(retry.record.submittedAt, first.record.submittedAt); assert.equal(retry.historyWarning, undefined);
  assert.equal(f.service.getState().historyWarning, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'feedback-history.json'))).records.length, 1);
});

test('history load strips extra fields, validates corrupt/oversized files and refuses symlink overwrite', async t => {
  const f = fixture(t), result = await f.service.submit(payload()), file = path.join(f.directory, 'feedback-history.json');
  const stored = { schema: 1, records: [{ ...result.record, contact: 'not-needed', attachments: ['private-image'], path: '/private' }] };
  fs.writeFileSync(file, JSON.stringify(stored));
  const loaded = createFeedbackReporting(f.config); t.after(() => loaded.dispose());
  assert.deepEqual(loaded.getState().history, [result.record]);
  for (const invalid of [{ schema: 1, records: [{ ...result.record, attachmentCount: 4 }] },
    { schema: 1, records: [{ ...result.record, submittedAt: Number.MAX_SAFE_INTEGER }] },
    { schema: 1, records: [{ ...result.record, detail: 'x'.repeat(5001) }] }]) {
    fs.writeFileSync(file, JSON.stringify(invalid)); const service = createFeedbackReporting(f.config);
    assert.deepEqual(service.getState().history, []); assert.match(service.getState().historyWarning, /无法读取/); service.dispose();
  }
  fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1));
  const oversized = createFeedbackReporting(f.config); t.after(() => oversized.dispose());
  assert.deepEqual(oversized.getState().history, []); assert.match(oversized.getState().historyWarning, /无法读取/);
  const target = path.join(path.dirname(f.directory), 'outside.json'); fs.writeFileSync(target, 'must remain');
  fs.unlinkSync(file); fs.symlinkSync(target, file);
  const linked = createFeedbackReporting(f.config); t.after(() => linked.dispose());
  assert.deepEqual(linked.getState().history, []); assert.match(linked.getState().historyWarning, /无法读取/);
  const saved = await linked.submit(payload()); assert.match(saved.historyWarning, /已提交.*保存失败/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'must remain'); assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
});
