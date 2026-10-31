const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasDirectoryAccess } = require('../lib/mas-directory-access');

const oldGrant = { directory: '/synthetic/codex', bookmark: 'b2xk' };
const newGrant = { directory: '/synthetic/selected', bookmark: 'bmV3' };
function harness(overrides = {}) {
  const saved = new Map([['codex', { ...oldGrant }]]), calls = [];
  const storage = {
    load: async provider => saved.get(provider),
    save: async (provider, grant) => { calls.push('save'); saved.set(provider, grant); },
    remove: async provider => { calls.push('remove'); saved.delete(provider); },
    ...overrides.storage
  };
  const deps = {
    app: { startAccessingSecurityScopedResource: bookmark => {
      calls.push(['start', bookmark]); return () => calls.push('stop');
    }, ...overrides.app },
    dialog: { showOpenDialog: async options => {
      calls.push(['dialog', options]);
      return { canceled: false, filePaths: [newGrant.directory], bookmarks: [newGrant.bookmark] };
    }, ...overrides.dialog },
    storage,
    validateDirectory: async directory => calls.push(['validate', directory]),
    ...overrides.extra
  };
  return { saved, calls, deps, access: createMasDirectoryAccess(deps) };
}

test('显式系统目录选择，验证作用域后仅持久化路径与书签，不暴露书签', async () => {
  const { access, calls, saved } = harness();
  assert.deepEqual(await access.authorize('codex'), { status: 'stored', directory: newGrant.directory });
  const options = calls[0][1];
  assert.equal(options.securityScopedBookmarks, true);
  assert.deepEqual(options.properties, ['openDirectory', 'showHiddenFiles']);
  assert.equal(Object.hasOwn(options, 'defaultPath'), false);
  assert.deepEqual(calls.slice(1), [['start', newGrant.bookmark], ['validate', newGrant.directory], 'stop', 'save']);
  assert.deepEqual(saved.get('codex'), newGrant);
  assert.deepEqual(await access.getStatus('codex'), { status: 'stored', directory: newGrant.directory });
});

test('取消选择不覆盖或验证旧授权', async () => {
  const { access, saved, calls } = harness({ dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } });
  assert.deepEqual(await access.authorize('codex'), { status: 'cancelled' });
  assert.deepEqual(saved.get('codex'), oldGrant);
  assert.deepEqual(calls, []);
});

test('新实例从持久化授权恢复，异步操作期间保持scope，成功后释放一次', async () => {
  const { deps, calls } = harness();
  const reopened = createMasDirectoryAccess(deps);
  const value = await reopened.withAccess('codex', async directory => {
    await Promise.resolve();
    assert.equal(calls.includes('stop'), false);
    assert.equal(directory, oldGrant.directory);
    return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(calls, [['start', oldGrant.bookmark], ['validate', oldGrant.directory], 'stop']);
});

test('业务操作失败也释放scope，保留业务错误而不误报授权过期', async () => {
  const { access, calls } = harness();
  const businessError = Object.assign(new Error('fixture missing'), { code: 'ENOENT' });
  await assert.rejects(access.withAccess('codex', async () => { throw businessError; }), error => error === businessError);
  assert.equal(calls.filter(call => call === 'stop').length, 1);
});

test('缺授权、缺书签、系统拒绝和目录失效均要求重新授权', async t => {
  await t.test('缺授权不执行回调', async () => {
    const { access, calls } = harness();
    await assert.rejects(access.withAccess('zcode', () => assert.fail('must not run')), { code: 'DIRECTORY_ACCESS_REQUIRED', reason: 'missing-bookmark' });
    assert.deepEqual(calls, []);
  });
  await t.test('选择结果缺书签不覆盖旧授权', async () => {
    const { access, saved } = harness({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/synthetic/new'] }) } });
    await assert.rejects(access.authorize('codex'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
    assert.deepEqual(saved.get('codex'), oldGrant);
  });
  await t.test('系统拒绝书签不执行回调', async () => {
    const { access } = harness({ app: { startAccessingSecurityScopedResource: () => { throw new Error('stale'); } } });
    await assert.rejects(access.withAccess('codex', () => assert.fail('must not run')), { code: 'DIRECTORY_ACCESS_REQUIRED', reason: 'bookmark-unavailable' });
  });
  await t.test('目录失效仍释放scope', async () => {
    const { access, calls } = harness({ extra: { validateDirectory: async () => { throw new Error('denied'); } } });
    await assert.rejects(access.withAccess('codex', () => assert.fail('must not run')), { code: 'DIRECTORY_ACCESS_REQUIRED', reason: 'directory-unavailable' });
    assert.deepEqual(calls, [['start', oldGrant.bookmark], 'stop']);
  });
});

test('持久化失败不能误报授权或撤销成功；原授权保留', async () => {
  const { access, saved, calls } = harness({ storage: {
    save: async () => { throw new Error('disk full'); }, remove: async () => { throw new Error('disk full'); }
  } });
  await assert.rejects(access.authorize('codex'), { code: 'DIRECTORY_STORAGE_FAILED', reason: 'save-failed' });
  assert.equal(calls.filter(call => call === 'stop').length, 1);
  assert.deepEqual(saved.get('codex'), oldGrant);
  await assert.rejects(access.revoke('codex'), { code: 'DIRECTORY_STORAGE_FAILED', reason: 'remove-failed' });
  assert.deepEqual(saved.get('codex'), oldGrant);
});

test('撤销本地授权后下次操作要求重新授权，不自动弹窗', async () => {
  const { access, calls } = harness();
  assert.deepEqual(await access.revoke('codex'), { status: 'needs-authorization' });
  assert.deepEqual(await access.getStatus('codex'), { status: 'needs-authorization' });
  await assert.rejects(access.withAccess('codex', () => assert.fail('must not run')), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  assert.deepEqual(calls, ['remove']);
});

test('同一工具选择与撤销按顺序完成，避免晚返回选择复活已撤销授权', async () => {
  let finishSelection;
  const { access, saved } = harness({ dialog: { showOpenDialog: () => new Promise(resolve => { finishSelection = resolve; }) } });
  const selection = access.authorize('codex');
  await Promise.resolve(); await Promise.resolve();
  const revocation = access.revoke('codex');
  finishSelection({ canceled: false, filePaths: [newGrant.directory], bookmarks: [newGrant.bookmark] });
  await selection; await revocation;
  assert.equal(saved.has('codex'), false);
});

test('不支持的provider及坏存储明确失败，不能扫描目录', async () => {
  const { access, calls } = harness({ storage: { load: async () => { throw new Error('corrupt'); } } });
  await assert.rejects(access.authorize('../home'), { code: 'INVALID_PROVIDER' });
  await assert.rejects(access.withAccess('codex', () => assert.fail('must not run')), { code: 'DIRECTORY_STORAGE_FAILED', reason: 'load-failed' });
  assert.deepEqual(calls, []);
});
