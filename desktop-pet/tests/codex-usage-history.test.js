const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCodexUsageHistory } = require('../lib/codex-usage-history');

const NOW = Date.parse('2026-10-06T14:00:00Z');
const RESET = NOW + 86400000;
const window = { id: 'codex:primary', windowMinutes: 10080, resetsAt: RESET };
const metadata = owner => JSON.stringify({ type: 'session_meta', payload: { creator_account_id: owner, secret: 'PRIVATE_METADATA' } });
const sample = (at, changes = {}) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: 'PRIVATE_TOKENS' }, rate_limits: { limit_id: 'codex',
    primary: { window_minutes: 10080, resets_at: RESET / 1000, used_percent: 30, ...changes } } } });
const setup = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-codex-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'sessions/2026/10/06'), { recursive: true });
  fs.mkdirSync(path.join(root, 'archived_sessions'));
  const write = (name, lines, archived = false) => {
    const file = path.join(root, archived ? 'archived_sessions' : 'sessions/2026/10/06', 'rollout-' + name + '.jsonl');
    fs.writeFileSync(file, lines.join('\n') + '\n'); return file;
  };
  return { root, write };
};

test('只回填当前工作区、当前周期真实额度百分比，活跃/归档去重且不带正文与tokens', async t => {
  const { root, write } = setup(t);
  write('a', [metadata('workspace-a'), sample(NOW - 600000), sample(NOW - 120000, { resets_at: RESET / 1000 + 1, used_percent: 34 }),
    sample(NOW + 1), sample(NOW - 60000, { used_percent: 101 }), sample(NOW - 60000, { resets_at: RESET / 1000 + 60 }),
    sample(NOW - 60000, { window_minutes: 300 }), JSON.stringify({ type: 'response_item', payload: 'PRIVATE_MESSAGE' })]);
  write('b', [metadata('workspace-a'), sample(NOW - 600000)], true);
  write('other-account', [metadata('workspace-b'), sample(NOW - 300000)]);
  const rows = await readCodexUsageHistory({ root, accountId: 'workspace-a', windows: [window], now: NOW });
  assert.deepEqual(rows.map(row => [row.at, row.remaining]), [[NOW - 600000, 70], [NOW - 120000, 66]]);
  assert.ok(rows.every(row => row.resetsAt === RESET));
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|workspace|token|email/);
  assert.deepEqual(await readCodexUsageHistory({ root, windows: [window], now: NOW }), []);
});

test('账户缺失/中途变化、损坏行、其他limit和符号链接不混入记录', async t => {
  const { root, write } = setup(t);
  const event = JSON.parse(sample(NOW - 60000)); event.payload.rate_limits.limit_id = 'codex-other';
  write('a', [metadata('workspace-a'), '{broken', JSON.stringify(event), metadata('workspace-b'), sample(NOW - 120000)]);
  write('missing', [JSON.stringify({ type: 'session_meta', payload: {} }), sample(NOW - 60000)]);
  const outside = path.join(root, 'outside.jsonl'); fs.writeFileSync(outside, metadata('workspace-a') + '\n' + sample(NOW - 60000) + '\n');
  fs.symlinkSync(outside, path.join(root, 'archived_sessions/rollout-link.jsonl'));
  assert.deepEqual(await readCodexUsageHistory({ root, accountId: 'workspace-a', windows: [window], now: NOW }), []);
});

test('大日志只取有上限的末尾，跳过截断行仍读取真实采样', async t => {
  const { root, write } = setup(t);
  write('large', [metadata('workspace-a'), 'x'.repeat(5 * 1024 * 1024), sample(NOW - 120000)]);
  const rows = await readCodexUsageHistory({ root, accountId: 'workspace-a', windows: [window], now: NOW });
  assert.equal(rows.length, 1); assert.equal(rows[0].at, NOW - 120000);
});
