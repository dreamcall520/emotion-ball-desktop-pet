const test = require('node:test'); const assert = require('node:assert/strict');
const { readZcodeTasks, projectZcodeTasks, openZcodeTask } = require('../lib/zcode-tasks');
test('task index preserves recorded completions and only treats fresh running rows as active', () => {
  const now = 1000000;
  const result = projectZcodeTasks([
    { task_id: 's1', title: 'running', task_status: 'running', updated_at: now - 1000 },
    { task_id: 's2', title: 'stale', task_status: 'running', updated_at: now - 300000 },
    { task_id: 's3', title: 'done', task_status: 'completed', updated_at: now - 10000 }
  ], now);
  assert.equal(result.items[0].state, 'active'); assert.equal(result.items[1].state, 'unknown');
  assert.equal(result.results[0].state, 'completed'); assert.equal(result.state, 'unknown');
});
test('an empty durable index does not prove no work is currently running in another process', async () => {
  const result = await readZcodeTasks({ queryRows: async () => [], readRuntime: async () => null, now: 1000 });
  assert.equal(result.state, 'unknown'); assert.equal(result.activity.runningCount, null);
});
test('task query is read only, bounded, ignores foreign provider and exposes no workspace path', async () => {
  let command;
  const result = await readZcodeTasks({ readRuntime: async () => null, queryRows: async (file, query) => { command = query; return [
    { task_id: 's1', title: 'own', task_status: 'waiting', updated_at: 999, provider: 'zcode' },
    { task_id: 's2', title: 'foreign', task_status: 'running', updated_at: 999, provider: 'claude' }
  ]; }, now: 1000 });
  assert.match(command, /SELECT/); assert.match(command, /LIMIT 256/); assert.equal(result.items.length, 1);
  assert.equal(JSON.stringify(result).includes('workspace_path'), false);
  assert.deepEqual(await openZcodeTask('s1'), { opened: false, code: 'UNSUPPORTED' });
});
test('runtime turn usage proves live activity only with a matching current database owner', () => {
  const { projectRuntimeTasks } = require('../lib/zcode-tasks');
  const now = 1000000, owner = { pid: 123, cwd: '/workspace', startedAt: 500000 };
  const running = { task_id: 'sess_1', title: 'work', turn_id: 'turn_1', status: 'running', started_at: 900000, directory: '/workspace', waiting: 0 };
  assert.equal(projectRuntimeTasks([running], [owner], now).items[0].state, 'active');
  assert.equal(projectRuntimeTasks([{ ...running, waiting: 1 }], [owner], now).items[0].state, 'waiting');
  assert.equal(projectRuntimeTasks([running], [{ ...owner, startedAt: 950000 }], now).items[0].state, 'unknown');
  assert.equal(projectRuntimeTasks([running], [], now).state, 'unknown');
  assert.equal(projectRuntimeTasks([], [owner], now).state, 'unknown');
});
test('runtime stopped/completed turns remain terminal and never become live on a reopened process', () => {
  const { projectRuntimeTasks } = require('../lib/zcode-tasks');
  const result = projectRuntimeTasks([{ task_id: 'sess_1', turn_id: 'turn_1', title: 'work', status: 'cancelled',
    started_at: 1000, completed_at: 2000, directory: '/workspace' }], [{ pid: 123, cwd: '/workspace', startedAt: 3000 }], 4000);
  assert.equal(result.items.length, 0); assert.equal(result.results[0].state, 'interrupted'); assert.equal(result.state, 'unknown');
});
test('observed runtime completion keeps its turn ID through unread history and repeated polls', () => {
  const { projectRuntimeTasks } = require('../lib/zcode-tasks');
  const { createZcodeQuotaHistory } = require('../lib/zcode-quota-history');
  const now = 4000, owner = { pid: 123, cwd: '/workspace', startedAt: 500 };
  const row = { task_id: 'sess_1', turn_id: 'turn_1', title: 'work', status: 'running', started_at: 1000, directory: '/workspace' };
  const history = createZcodeQuotaHistory({ now: () => now }); history.setAccount('current');
  history.record({ enabled: true, tasks: projectRuntimeTasks([row], [owner], now) });
  assert.equal(history.getState().results.length, 0);
  const finished = projectRuntimeTasks([{ ...row, status: 'completed', completed_at: 3000 }], [owner], now);
  assert.equal(finished.results[0].turnId, 'turn_1');
  history.record({ enabled: true, tasks: finished }); history.record({ enabled: true, tasks: finished });
  assert.equal(history.getState().results.length, 1); assert.equal(history.getState().results[0].readAt, null);
  history.markAllRead(); history.record({ enabled: true, tasks: finished });
  assert.equal(history.getState().results.length, 1); assert.equal(history.getState().results[0].readAt, now); history.close();
});
