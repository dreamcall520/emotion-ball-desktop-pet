const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasDirectoryAccess } = require('../lib/mas-directory-access');

const oldGrant = { directory: '/synthetic/old/.codex', bookmark: 'b2xk' };
const newGrant = { directory: '/synthetic/new/.codex', bookmark: 'bmV3' };
function harness(overrides = {}) {
  const saved = new Map([['codex', { ...oldGrant }]]), calls = [];
  const storage = {
    load: async provider => saved.get(provider),
    save: async (provider, grant) => { calls.push('save'); saved.set(provider, grant); },
    remove: async provider => { calls.push('remove'); saved.delete(provider); },
    ...overrides.storage
  };
  const deps = {
    app: { getPath: name => { assert.equal(name, 'home'); return '/synthetic/home'; }, startAccessingSecurityScopedResource: bookmark => {
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
  assert.equal(options.defaultPath, '/synthetic/home/.codex');
  assert.equal(options.buttonLabel, '允许连接');
  assert.match(options.message, /账号额度.*任务日志.*不会自动发送/);
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

test('显式租约在异步观察期间保持作用域，调用者关闭观察后释放且release幂等', async () => {
  const { access, calls } = harness();
  const lease = await access.acquire('codex');
  assert.equal(lease.directory, oldGrant.directory);
  assert.equal(Object.hasOwn(lease, 'bookmark'), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.includes('stop'), false);
  let watcherOpen = true;
  await Promise.resolve().then(() => { assert.equal(watcherOpen, true); assert.equal(calls.includes('stop'), false); });
  watcherOpen = false;
  lease.release(); lease.release();
  assert.equal(calls.filter(call => call === 'stop').length, 1);
});

test('显式租约的异常清理与withAccess各自只释放一次，不共享释放状态', async () => {
  const stops = [];
  let count = 0;
  const { access } = harness({ app: { startAccessingSecurityScopedResource: () => {
    const id = ++count; return () => stops.push(id);
  } } });
  const first = await access.acquire('codex');
  const second = await access.acquire('codex');
  try { throw new Error('synthetic observer error'); }
  catch (_) { first.release(); }
  finally { first.release(); }
  assert.deepEqual(stops, [1]);
  await assert.rejects(access.withAccess('codex', async () => { throw new Error('synthetic operation error'); }), /synthetic operation error/);
  assert.deepEqual(stops, [1, 3]);
  second.release(); second.release();
  assert.deepEqual(stops, [1, 3, 2]);
});

test('撤销只忘记本地授权，不提前释放并发观察租约，之后拒绝新访问', async () => {
  const stops = [];
  let count = 0;
  const { access, saved } = harness({ app: { startAccessingSecurityScopedResource: () => {
    const id = ++count; return () => stops.push(id);
  } } });
  const [first, second] = await Promise.all([access.acquire('codex'), access.acquire('codex')]);
  assert.deepEqual(stops, []);
  await access.revoke('codex');
  assert.equal(saved.has('codex'), false);
  assert.deepEqual(stops, []);
  await assert.rejects(access.acquire('codex'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
  second.release(); second.release();
  assert.deepEqual(stops, [2]);
  first.release();
  assert.deepEqual(stops, [2, 1]);
});

test('获取过程与撤销串行，迟到的目录验证不复活已撤销授权或误关租约', async () => {
  let finishValidation, validationStarted;
  const started = new Promise(resolve => { validationStarted = resolve; });
  const { access, saved, calls } = harness({ extra: {
    validateDirectory: () => { validationStarted(); return new Promise(resolve => { finishValidation = resolve; }); }
  } });
  const acquiring = access.acquire('codex');
  await started;
  const revoking = access.revoke('codex');
  assert.equal(saved.has('codex'), true);
  finishValidation();
  const lease = await acquiring;
  await revoking;
  assert.equal(saved.has('codex'), false);
  assert.equal(calls.includes('stop'), false);
  lease.release(); lease.release();
  assert.equal(calls.filter(call => call === 'stop').length, 1);
  await assert.rejects(access.acquire('codex'), { code: 'DIRECTORY_ACCESS_REQUIRED' });
});

test('不同工具的租约独立，重新选择只影响之后的访问', async () => {
  const stops = [], starts = [];
  const { access, saved } = harness({ app: { startAccessingSecurityScopedResource: bookmark => {
    const id = starts.push(bookmark); return () => stops.push(id);
  } } });
  saved.set('zcode', { directory: '/synthetic/.zcode', bookmark: 'emNvZGU=' });
  const codex = await access.acquire('codex'), zcode = await access.acquire('zcode');
  await access.authorize('codex');
  // authorize's verification scope is released, existing scopes remain live.
  assert.deepEqual(stops, [3]);
  const replacement = await access.acquire('codex');
  assert.equal(codex.directory, oldGrant.directory);
  assert.equal(replacement.directory, newGrant.directory);
  zcode.release(); replacement.release(); codex.release();
  assert.deepEqual(stops, [3, 2, 4, 1]);
});


test('三家授权均预定位对应目录并清楚说明读取范围', async () => {
  for (const provider of ['codex', 'zcode', 'workbuddy']) {
    let shown;
    const { access, saved } = harness({ dialog: { showOpenDialog: async options => {
      shown = options;
      return { canceled: false, filePaths: ['/synthetic/.' + provider], bookmarks: ['synthetic-bookmark'] };
    } } });
    assert.equal((await access.authorize(provider)).status, 'stored');
    assert.equal(shown.defaultPath, '/synthetic/home/.' + provider);
    assert.equal(shown.buttonLabel, '允许连接');
    if (provider === 'workbuddy') assert.match(shown.message, /只读取.*任务标题.*历史状态.*未读标记.*不读取聊天正文或登录凭据/);
    assert.equal(saved.get(provider).directory, '/synthetic/.' + provider);
  }
});

test('选错工具或上级目录先拒绝，不访问、不保存且保留旧授权', async () => {
  for (const directory of ['/synthetic/.zcode', '/synthetic/home', '/synthetic/.codex-extra']) {
    const { access, calls, saved } = harness({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [directory], bookmarks: ['wrong-bookmark'] }) } });
    await assert.rejects(access.authorize('codex'), { code: 'INVALID_DIRECTORY', reason: 'provider-directory-mismatch' });
    assert.deepEqual(saved.get('codex'), oldGrant);
    assert.deepEqual(calls, [], 'wrong selection cannot open a security scope or save');
  }
});

test('安装用途独立明确写入范围，不复用只读文案',async()=>{const f=harness({extra:{purpose:'plugin-installation'},dialog:{showOpenDialog:async()=>({canceled:true})}});await f.access.authorize('workbuddy');const options=f.calls.find(c=>Array.isArray(c)&&c[0]==='dialog');assert.equal(options,undefined);const seen=[];const second=harness({extra:{purpose:'plugin-installation'},dialog:{showOpenDialog:async options=>{seen.push(options);return{canceled:true};}}});await second.access.authorize('zcode');assert.equal(seen[0].buttonLabel,'允许安装插件');assert.match(seen[0].message,/安装.*插件.*启用设置/);assert.match(seen[0].title,/安装 ZCode/);assert.equal(second.calls.includes('save'),false);});

test('首发Codex任务用途独立说明且只改文案，取消保留原书签，默认三家文案不变',async()=>{
 const {CODEX_TASK_LOG_DISCLOSURE}=require('../lib/mas-directory-access');
 const f=harness({extra:{purpose:'codex-task-logs'}});await f.access.authorize('codex');
 const options=f.calls.find(c=>Array.isArray(c)&&c[0]==='dialog')[1];
 assert.equal(options.title,'允许球球读取 Codex 任务日志');assert.equal(options.buttonLabel,'允许读取任务');
 assert.equal(options.message,CODEX_TASK_LOG_DISCLOSURE.message);
 assert.match(options.message,/本机解析部分任务日志.*仅提取任务标题、状态和更新时间/);
 assert.match(options.message,/额度与聊天继续使用球球内已登录账号/);
 assert.match(options.message,/不会读取此目录的登录凭据、修改原目录或自动发送模型消息/);
 assert.match(options.message,/可取消，已连接的额度与聊天保持/);
 assert.doesNotMatch(options.message,/不读取聊天正文|请直接允许连接/);
 assert.equal(options.defaultPath,'/synthetic/home/.codex');assert.deepEqual(options.properties,['openDirectory','showHiddenFiles']);assert.equal(options.securityScopedBookmarks,true);
 assert.deepEqual(f.saved.get('codex'),newGrant,'purpose label does not expand stored grant schema');
 const cancelled=harness({extra:{purpose:'codex-task-logs'},dialog:{showOpenDialog:async()=>({canceled:true})}});
 assert.deepEqual(await cancelled.access.authorize('codex'),{status:'cancelled'});assert.deepEqual(cancelled.saved.get('codex'),oldGrant);assert.deepEqual(cancelled.calls,[]);
 await assert.rejects(f.access.authorize('zcode'),{code:'INVALID_PROVIDER',reason:'task-log-purpose-mismatch'});
 for(const provider of ['codex','zcode','workbuddy']){
  let observed;const normal=harness({dialog:{showOpenDialog:async value=>{observed=value;return{canceled:true};}}});await normal.access.authorize(provider);
  assert.equal(observed.title,'允许球球连接 '+({codex:'Codex',zcode:'ZCode',workbuddy:'WorkBuddy'}[provider]));assert.equal(observed.buttonLabel,'允许连接');
  if(provider==='codex')assert.equal(observed.message,'球球将读取账号额度和任务日志。不会自动发送消息或执行任务。请直接允许连接。');
 }
});
