const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

if (process.versions.electron && process.argv.includes('--store-renderer-child')) {
  const { app, BrowserWindow, session } = require('electron');
  app.setPath('userData', process.env.PET_STORE_RENDERER_TEST_DATA);
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    let window;
    try {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({
        cancel: /^(?:https?|wss?):/.test(details.url) || /\/store-connections-renderer\.js$/.test(details.url)
      }));
      window = new BrowserWindow({ width: 800, height: 900, show: false,
        webPreferences: { contextIsolation: false, nodeIntegration: false } });
      const root = path.resolve(__dirname, '../..');
      await window.loadFile(path.join(root, 'desktop-pet/store-connections.html'));
      const run = code => window.webContents.executeJavaScript(code);
      const base = {
        mode: 'diagnostic-unsandboxed', codex: { directory: 'stored', serviceConfigured: true },
        codexSnapshot: { quota: { windows: [] }, tasks: { state: 'unknown', items: [] } },
        zcode: { directory: 'stored', serviceConfigured: true, accountSource: 'configured-custom' },
        zcodeSnapshot: { quota: { state: 'connected', balanceState: 'empty' } },
        chat: { source: 'zcode', connection: 'ready', modelsStatus: 'ready', error: null, modelsError: null },
        workbuddy: { status: 'needs-login', busy: false, loginVisible: false, summary: null, errorMessage: null },
        workbuddyCli: { configured: false, connected: false, gatewayReachable: false, busy: false,
          sendOutcome: 'idle', error: null, tasks: [], sessions: [], messages: [] },
        workbuddyOfficial: { configured: false, connected: false, busy: false, pending: false,
          sendOutcome: 'idle', assistantOnline: null, anchorMessageId: null, tasks: [], messages: [], error: null }
      };
      await run(`
        window.fixtureState = ${JSON.stringify(base)};
        window.fixtureCalls = [];
        window.fixtureChange = null;
        window.fixtureFocus = null;
        window.fixtureSendResolve = null;
        window.storeConnections = {
          async command(action, payload) {
            fixtureCalls.push({ action, payload });
            if (action === 'status') return { ok: true, state: structuredClone(fixtureState) };
            if (action === 'send-workbuddy-cli') {
              fixtureState.workbuddyCli.busy = true;
              return new Promise(resolve => { fixtureSendResolve = resolve; });
            }
            if (action === 'cancel-workbuddy-cli') {
              fixtureState.workbuddyCli.busy = false;
              fixtureState.workbuddyCli.sendOutcome = 'cancelled';
              return { ok: true, state: structuredClone(fixtureState), message: '合成停止已接收' };
            }
            if (action === 'review-workbuddy-cli-unknown') fixtureState.workbuddyCli.sendOutcome = 'idle';
            if (action === 'review-workbuddy-unknown') fixtureState.workbuddyOfficial.sendOutcome = 'idle';
            return { ok: true, state: structuredClone(fixtureState) };
          },
          onFocusProvider(callback) { fixtureFocus = callback; return () => {}; },
          onChange(callback) { fixtureChange = callback; return () => {}; }
        };
        void 0;
      `);
      await run(fs.readFileSync(path.join(root, 'desktop-pet/store-connections-renderer.js'), 'utf8'));
      const settle = () => run('new Promise(resolve => setTimeout(resolve, 0))');
      const notify = async () => { await run('fixtureChange()'); await settle(); };
      const set = async patch => { await run(`Object.assign(fixtureState, ${JSON.stringify(patch)}); void 0`); await notify(); };
      const input = async (id, value) => run(`(() => { const target = document.getElementById(${JSON.stringify(id)}); target.value = ${JSON.stringify(value)}; target.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const disabled = action => run(`document.querySelector('button[data-action="${action}"]').disabled`);
      const click = async action => { await run(`document.querySelector('button[data-action="${action}"]').click()`); await settle(); };
      const calls = action => run(`fixtureCalls.filter(call => call.action === ${JSON.stringify(action)}).length`);
      await settle();

      // Availability follows the safe state, not whether text happens to be present.
      await input('workbuddy-cli-text', '合成消息');
      assert.equal(await disabled('send-workbuddy-cli'), true, 'not configured cannot send');
      await set({ workbuddyCli: { ...base.workbuddyCli, configured: true, connected: false } });
      assert.equal(await disabled('send-workbuddy-cli'), true, 'imported but disconnected cannot send');
      await set({ workbuddyCli: { ...base.workbuddyCli, configured: true, connected: true } });
      await input('workbuddy-cli-text', '');
      assert.equal(await disabled('send-workbuddy-cli'), true, 'empty message cannot send');
      await input('workbuddy-cli-text', '   \n  ');
      assert.equal(await disabled('send-workbuddy-cli'), true, 'whitespace cannot send');
      await input('workbuddy-cli-text', '合成连通性消息');
      assert.equal(await disabled('send-workbuddy-cli'), false, 'connected plus text can send');
      assert.equal(await calls('send-workbuddy-cli'), 0, 'state and typing never send automatically');

      // The send Promise stays pending while onChange reports the CLI as busy.
      await click('send-workbuddy-cli');
      assert.equal(await calls('send-workbuddy-cli'), 1);
      assert.equal(await run('typeof fixtureSendResolve'), 'function', 'send is deliberately still pending');
      await notify();
      assert.equal(await disabled('cancel-workbuddy-cli'), false, 'busy notification must keep cancel reachable during pending send');
      assert.equal(await disabled('send-workbuddy-cli'), true);
      await click('cancel-workbuddy-cli');
      assert.equal(await calls('cancel-workbuddy-cli'), 1);
      assert.equal(await calls('send-workbuddy-cli'), 1, 'cancel never retries the message');
      assert.equal(await disabled('send-workbuddy-cli'), true, 'pending send remains locked until its own Promise settles');
      await run(`fixtureSendResolve({ ok: false, state: structuredClone(fixtureState), message: '本次合成回复已停止' }); void 0`);
      await settle(); await settle();
      assert.equal(await calls('send-workbuddy-cli'), 1);

      // Unknown is an outcome lock, not an invitation for the renderer to retry.
      await set({ workbuddyCli: { ...base.workbuddyCli, configured: true, connected: true, sendOutcome: 'unknown' } });
      assert.equal(await disabled('send-workbuddy-cli'), true);
      assert.equal(await run('document.getElementById("workbuddy-cli-review").hidden'), false);
      const beforeReview = await calls('send-workbuddy-cli');
      await notify(); await notify();
      assert.equal(await calls('send-workbuddy-cli'), beforeReview);
      await click('review-workbuddy-cli-unknown');
      assert.equal(await calls('review-workbuddy-cli-unknown'), 1);
      assert.equal(await calls('send-workbuddy-cli'), beforeReview, 'review clears the lock but cannot submit');
      assert.equal(await run('document.getElementById("workbuddy-cli-review").hidden'), true);
      assert.equal(await disabled('send-workbuddy-cli'), false, 'only an explicit later click can send');

      // An unconfigured enterprise relay never enables provider operations.
      await input('workbuddy-assistant-text', '合成企业消息');
      for (const action of ['send-workbuddy-assistant', 'read-workbuddy-assistant']) {
        assert.equal(await disabled(action), true, action + ' is disabled before configuration');
      }
      assert.equal(await calls('send-workbuddy-assistant'), 0);
      await set({ workbuddyOfficial: { ...base.workbuddyOfficial, configured: true, connected: true,
        sendOutcome: 'unknown', anchorMessageId: 'synthetic-anchor' } });
      assert.equal(await disabled('send-workbuddy-assistant'), true);
      assert.equal(await run('document.getElementById("workbuddy-review-unknown").hidden'), false);
      assert.match(await run('document.getElementById("workbuddy-send-state").textContent'), /结果未知.*锁定重发/);
      await click('review-workbuddy-unknown');
      assert.equal(await calls('review-workbuddy-unknown'), 1);
      assert.equal(await calls('send-workbuddy-assistant'), 0, 'enterprise review cannot auto-resend either');

      // The selected ZCode API channel is explicit; its readiness is never assigned to Codex.
      assert.match(await run('document.getElementById("zcode-detail").textContent'), /已有自定义模型.*原\s*API\s*计费/);
      assert.equal(await run('document.getElementById("codex-status").textContent'), '目录已授权');
      assert.doesNotMatch(await run('document.getElementById("codex-status").textContent'), /聊天已连接/);
      assert.match(await run('document.getElementById("mode").textContent'), /未启用.*App Sandbox/);
      // Channel choice is explicit and survives unrelated status refreshes until submitted.
      assert.equal(await run('document.getElementById("zcode-account-source").value'), 'configured-custom');
      const beforeSourceChoice = await calls('enable-provider');
      await run(`(() => { const select = document.getElementById('zcode-account-source'); select.value = 'official'; select.dispatchEvent(new Event('change')); })()`);
      await notify();
      assert.equal(await run('document.getElementById("zcode-account-source").value'), 'official');
      assert.equal(await calls('enable-provider'), beforeSourceChoice, 'selecting a source does not connect or fall back');
      // One primary action per provider; internal connection details are not user configuration.
      assert.equal(await run(`document.querySelectorAll('button[data-action="enable-provider"]').length`), 3);
      assert.equal(await run(`document.querySelectorAll('button[data-action^="import-"], button[data-action^="configure-"], input[type="url"]').length`), 0);
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').click()`); await settle();
      assert.deepEqual(await run(`fixtureCalls.filter(call => call.action === 'enable-provider').at(-1)`), { action: 'enable-provider', payload: { provider: 'codex' } });
      for (const provider of ['zcode', 'workbuddy']) {
        await run(`document.querySelector('button[data-action="enable-provider"][data-provider="${provider}"]').click()`); await settle();
        assert.equal(await run(`fixtureCalls.filter(call => call.action === 'enable-provider').at(-1).payload.provider`), provider);
      }
      assert.equal(await run(`fixtureCalls.findLast(call => call.action === 'enable-provider' && call.payload.provider === 'zcode').payload.accountSource`), 'official');
      await run(`(() => { const select = document.getElementById('zcode-account-source'); select.value = 'configured-custom'; select.dispatchEvent(new Event('change')); document.querySelector('button[data-action="enable-provider"][data-provider="zcode"]').click(); })()`); await settle();
      assert.equal(await run(`fixtureCalls.findLast(call => call.action === 'enable-provider' && call.payload.provider === 'zcode').payload.accountSource`), 'configured-custom');
      assert.equal(await calls('send-workbuddy-cli'), beforeReview, 'enabling a provider never submits chat');
      await set({ onboarding: { codex: { status: 'partial', message: '额度已连接', chat: { status: 'unavailable', message: '聊天能力待接入，无需配置服务。' } } }, codex: { ...base.codex, serviceConfigured: false } });
      assert.equal(await run('document.getElementById("codex-status").textContent'), '聊天未就绪');
      assert.match(await run('document.getElementById("codex-detail").textContent'), /额度已连接.*聊天能力待接入/);
      assert.equal(await run(`document.querySelector('button[data-action="open-provider-chat"][data-provider="codex"]').disabled`), true);
      assert.equal(await run(`document.querySelectorAll('button[data-action="enable-provider-data"]').length`), 3);
      await set({onboarding:{codex:{status:'ready',message:'聊天已连接',chat:{status:'ready'},data:{status:'needs-authorization',message:'任务与额度可选授权'}}}});
      assert.equal(await run('document.getElementById("codex-status").textContent'),'聊天已连接');
      assert.equal(await run('document.getElementById("codex-data-state").textContent'),'任务与额度可选授权');
      await run(`document.querySelector('button[data-action="enable-provider-data"][data-provider="codex"]').click()`); await settle();
      assert.deepEqual(await run(`fixtureCalls.filter(call=>call.action==='enable-provider-data').at(-1)`),{action:'enable-provider-data',payload:{provider:'codex'}});
      await set({onboarding:{zcode:{status:'partial',chat:{status:'needs-data-authorization'},data:{status:'needs-authorization',message:'需要读取已有配置'}}}});
      assert.equal(await run(`document.querySelector('button[data-action="enable-provider-data"][data-provider="zcode"]').textContent`),'读取已有模型配置');
      await set({ onboarding: { codex: { status: 'working', message: '等待系统授权', chat: { status: 'unavailable' } } } });
      assert.equal(await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').disabled`), true);
      assert.equal(await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').textContent`), '正在连接…');
      const beforeFocus = await calls('enable-provider');
      await run(`fixtureFocus('zcode')`);
      assert.equal(await run('document.activeElement.dataset.provider'), 'zcode');
      await run(`fixtureFocus('workbuddy')`);
      assert.equal(await run('document.activeElement.dataset.provider'), 'workbuddy');
      await run(`fixtureFocus('../codex')`);
      assert.equal(await run('document.activeElement.dataset.provider'), 'workbuddy');
      assert.equal(await calls('enable-provider'), beforeFocus, 'focus never triggers authorization');
      for(const [live,expected] of [
        [{state:'active',phase:'starting'},'本次回复正在开始'],
        [{state:'active',phase:'running'},'本次回复正在进行'],
        [{state:'active',phase:'cancelling'},'已请求停止，等待确认'],
        [{state:'completed',phase:'terminal'},'本次回复已完成'],
        [{state:'interrupted',phase:'terminal'},'本次回复已中断'],
        [{state:'failed',phase:'terminal'},'本次请求失败'],
        [{state:'unknown',phase:'unknown'},'本次回复状态未知，未确认结束']]){
        await set({workbuddyCli:{...base.workbuddyCli,configured:true,connected:true,liveTask:live,tasks:[{name:'old historical entry',state:'pending'}]}});
        assert.equal((await run("document.getElementById('workbuddy-cli-live-task').textContent")).startsWith(expected),true);
        assert.equal((await run("document.getElementById('workbuddy-cli-tasks').textContent")).includes('历史记录：pending'),true);
      }
      assert.equal((await run("document.getElementById('workbuddy-cli-tasks').closest('details').querySelector('summary').textContent")).includes('非当前回复状态'),true);
      await set({workbuddyDesktopEvents:{enabled:true,observations:[{state:'completed',phase:'final-stop-observed',terminalConfirmed:true,terminalKind:'main-reply',realtime:true}]}});
      assert.equal((await run("document.getElementById('workbuddy-desktop-events-state').textContent")).includes('主回复已完成（不代表后台任务全部结束）'),true);
      await set({workbuddyDesktopEvents:{enabled:true,observations:[{state:'unknown',phase:'final-stop-observed',terminalConfirmed:false,realtime:true}]}});
      assert.equal((await run("document.getElementById('workbuddy-desktop-events-state').textContent")).includes('本轮终态尚未确认'),true);
      assert.equal(window.isVisible(), false);
      console.log('PASS 7 real Chromium store connection scenarios; synthetic state/commands only');
      window.destroy(); app.exit(0);
    } catch (error) {
      console.error(error.stack); window?.destroy(); app.exit(1);
    }
  });
} else {
  require('node:test')('工具连接页真实Chromium：发送/取消/未知结果/来源隔离', { timeout: 60000 }, async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-connections-renderer-'));
    try {
      const env = { ...process.env, PET_STORE_RENDERER_TEST_DATA: temp,
        ELECTRON_OVERRIDE_DIST_PATH: process.env.ELECTRON_OVERRIDE_DIST_PATH || '/Users/allan/Documents/个人创作/emotion-ball-desktop-pet/node_modules/electron/dist' };
      delete env.ELECTRON_RUN_AS_NODE;
      await new Promise((resolve, reject) => {
        const executable = path.join(env.ELECTRON_OVERRIDE_DIST_PATH,
          process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron');
        const child = require('node:child_process').spawn(executable, [__filename, '--store-renderer-child'], { env });
        let output = '', finished = false;
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 50000);
        const finish = error => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(); };
        child.stdout.on('data', value => { output = (output + value).slice(-65536); });
        child.stderr.on('data', value => { output = (output + value).slice(-65536); });
        child.on('error', finish);
        child.on('exit', (code, signal) => code === 0 ? finish() : finish(new Error(output || `Chromium child exited ${code || signal}`)));
      });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
  require('node:test')('工具连接preload仅接受ZCode两种固定聊天来源', async () => {
    const calls = [], listeners = new Map(); let api;
    require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../store-connections-preload.js'), 'utf8'), {
      require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } }, ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve({ ok: true }); }, on(channel,listener) { listeners.set(channel,listener); }, removeListener(channel,listener) { if(listeners.get(channel)===listener)listeners.delete(channel); } } })
    });
    const focused = [], unlisten = api.onFocusProvider(provider => focused.push(provider));
    const receiveFocus = listeners.get('pet:store-focus-provider');
    for(const provider of ['codex','zcode','workbuddy','other','../codex',null])receiveFocus({},provider);
    assert.deepEqual(focused,['codex','zcode','workbuddy']);
    unlisten();assert.equal(listeners.has('pet:store-focus-provider'),false);
    for (const accountSource of ['official', 'configured-custom']) {
      await api.command('enable-provider', { provider: 'zcode', accountSource });
      assert.equal(calls.at(-1)[2].accountSource, accountSource);
    }
    const count = calls.length;
    for (const accountSource of ['custom', '../official', null, {}]) {
      await assert.rejects(api.command('enable-provider', { provider: 'zcode', accountSource }), /INVALID_ACCOUNT_SOURCE/);
    }
    assert.equal(calls.length, count, 'invalid sources never reach main');
    await api.command('enable-provider', { provider: 'codex', accountSource: 'configured-custom' });
    assert.equal(calls.at(-1)[2].accountSource, undefined, 'other providers cannot forward a ZCode source');
  });
}
