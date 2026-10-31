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
      window.webContents.on('console-message', (_event, ...args) => console.error('renderer', ...args));
      const root = path.resolve(__dirname, '../..');
      await window.loadFile(path.join(root, 'desktop-pet/store-connections.html'));
      const run = async code => {try{return await window.webContents.executeJavaScript(code);}catch(error){throw new Error(code.slice(0,300)+'\n'+error.message);}};
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
        window.fixtureInstallResolve = null;
        window.storeConnections = {
          async command(action, payload) {
            fixtureCalls.push({ action, payload });
            if (action === 'status') return { ok: true, state: structuredClone(fixtureState) };
            if (window.fixtureFlowMode && ['enable-provider','enable-provider-data'].includes(action)) {
              if(window.fixtureFlowMode==='pending'&&action==='enable-provider')return new Promise(resolve=>window.fixtureFlowResolve=resolve);
              if(window.fixtureFlowMode==='failed')return {ok:false,state:structuredClone(fixtureState),message:'合成取消'};
              if(window.fixtureFlowMode==='cancel-ok')return {ok:true,state:structuredClone(fixtureState),message:'已取消授权'};
              const provider=payload.provider;
              fixtureState.onboarding={...fixtureState.onboarding,[provider]:{status:'ready',chat:{status:'ready'},data:{status:'ready'}}};
              if(provider==='workbuddy')fixtureState.workbuddyDesktop={directory:'stored',partitions:[],report:null};
              else fixtureState[provider]={...fixtureState[provider],directory:'stored'};
              return {ok:true,state:structuredClone(fixtureState)};
            }
            if (action === 'install-provider-plugin') {
              fixtureState.pluginInstallations = { ...fixtureState.pluginInstallations, [payload.provider]: {status:'installing'} };
              return new Promise(resolve => { fixtureInstallResolve = resolve; });
            }
            if (action === 'cancel-provider-plugin') {
              fixtureState.pluginInstallations = { ...fixtureState.pluginInstallations, [payload.provider]: {status:'idle',phase:'cancelled',enabled:false,message:'已取消等待原工具退出，其他连接保持'} };
              const finish=fixtureInstallResolve;fixtureInstallResolve=null;
              finish?.({ok:false,state:structuredClone(fixtureState),message:'已取消本次插件安装'});
              return {ok:true,state:structuredClone(fixtureState),message:'已取消本次插件安装'};
            }
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
      assert.equal(await run('document.getElementById("codex-capability-chat").dataset.status')==='ready', false);
      assert.doesNotMatch(await run('document.getElementById("codex-status").textContent'), /聊天已连接/);
      assert.match(await run('document.getElementById("mode").textContent'), /未启用.*App Sandbox/);
      // Channel choice is explicit and survives unrelated status refreshes until submitted.
      assert.equal(await run('document.getElementById("zcode-account-source").value'), 'configured-custom');
      const beforeSourceChoice = await calls('enable-provider');
      await run(`(() => { const select = document.getElementById('zcode-account-source'); select.value = 'official'; select.dispatchEvent(new Event('change')); })()`);
      await notify();
      assert.equal(await run('document.getElementById("zcode-account-source").value'), 'official');
      assert.equal(await calls('enable-provider'), beforeSourceChoice, 'selecting a source does not connect or fall back');
      // One visible entry opens the guide; no account or permission action is automatic.
      assert.equal(await run(`document.querySelectorAll('button[data-action="enable-provider"]').length`), 3);
      assert.equal(await run(`document.querySelectorAll('[data-provider-card] .capabilities dd').length`), 9);
      assert.equal(await run(`document.querySelectorAll('[data-provider-card] > .tool-advanced[open]').length`), 0);
      assert.equal(await run(`document.querySelectorAll('button[data-action^="import-"], button[data-action^="configure-"], input[type="url"]').length`), 0);
      const beforeGuide=await calls('enable-provider');
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').click()`); await settle();
      assert.equal(await run('document.getElementById("connection-guide").hidden'),false);
      assert.match(await run('document.getElementById("guide-title").textContent'),/Codex/);
      assert.equal(await calls('enable-provider'),beforeGuide,'opening a guide never authenticates');
      await run(`document.querySelector('[data-action="guide-run"][data-step="chat"]').click()`);await settle();
      assert.deepEqual(await run(`fixtureCalls.filter(call => call.action === 'enable-provider').at(-1)`), { action: 'enable-provider', payload: { provider: 'codex' } });
      assert.equal(await calls('enable-provider-data'),0,'one click never chains further system permissions');
      await set({workbuddyCli:{...base.workbuddyCli,connected:false}});
      for (const provider of ['zcode','workbuddy']) {
        await run(`document.querySelector('button[data-action="enable-provider"][data-provider="${provider}"]').click()`); await settle();
        await run(`document.querySelector('[data-action="guide-run"][data-step="chat"]').click()`);await settle();
        assert.equal(await run(`fixtureCalls.filter(call => call.action === 'enable-provider').at(-1).payload.provider`), provider);
      }
      assert.equal(await run(`fixtureCalls.findLast(call => call.action === 'enable-provider' && call.payload.provider === 'zcode').payload.accountSource`), 'official');
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="zcode"]').click()`);await settle();
      await run(`(() => { const select = document.getElementById('zcode-account-source'); select.value = 'configured-custom'; select.dispatchEvent(new Event('change')); })()`);await settle();
      assert.equal(await run(`document.querySelector('[data-action="guide-run"][data-step="chat"]')===null`),true,'returning to already connected source never repeats authorization');
      assert.equal(await calls('send-workbuddy-cli'), beforeReview, 'enabling a provider never submits chat');
      await set({ onboarding: { codex: { status: 'partial', message: '额度已连接', chat: { status: 'unavailable', message: '聊天能力待接入，无需配置服务。' } } }, codex: { ...base.codex, serviceConfigured: false } });
      assert.equal(await run('document.getElementById("codex-capability-chat").dataset.status'),'unavailable');
      assert.match(await run('document.getElementById("codex-detail").textContent'), /额度已连接.*聊天能力待接入/);
      assert.equal(await run(`document.querySelector('button[data-action="open-provider-chat"][data-provider="codex"]').disabled`), true);
      await set({onboarding:{codex:{status:'ready',message:'聊天已连接',chat:{status:'ready'},data:{status:'cancelled',message:'已取消数据授权'}}},codex:{directory:'missing',serviceConfigured:true}});
      assert.equal(await run('document.getElementById("codex-status").textContent'),'已可用');
      assert.equal(await run('document.getElementById("codex-capability-chat").dataset.status'),'ready','cancelled data does not lose chat');
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').click()`);await settle();
      assert.equal(await run(`document.querySelector('#guide-steps [data-step="chat"]').dataset.status`),'ready');
      assert.match(await run('document.getElementById("guide-next").textContent'),/允许读取/);
      const beforeData=await calls('enable-provider-data');await click('guide-skip');
      assert.equal(await calls('enable-provider-data'),beforeData,'skip does not authorize');
      assert.equal(await run('document.getElementById("codex-capability-chat").dataset.status'),'ready');
      await click('guide-close');
      assert.equal(await run('document.getElementById("connection-guide").hidden'),true);
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').click()`);await settle();
      assert.match(await run('document.getElementById("guide-next").textContent'),/允许读取/,'reopening resumes missing grant, not prior skipped memory');
      await click('guide-next');
      assert.deepEqual(await run(`fixtureCalls.filter(call=>call.action==='enable-provider-data').at(-1)`),{action:'enable-provider-data',payload:{provider:'codex'}});
      assert.equal(await calls('enable-provider-data'),beforeData+1,'only the requested step runs');
      await set({ onboarding: { codex: { status: 'working', message: '等待系统授权', chat: { status: 'unavailable' } } } });
      assert.equal(await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').disabled`), true);
      assert.equal(await run(`document.querySelector('button[data-action="enable-provider"][data-provider="codex"]').textContent`), '正在连接…');
      const beforeFocus = await calls('enable-provider');
      await run(`fixtureFocus('zcode')`);
      assert.equal(await run('document.activeElement.id'), 'connection-guide');assert.match(await run('document.getElementById("guide-title").textContent'), /ZCode/);
      await run(`fixtureFocus('workbuddy')`);
      assert.equal(await run('document.activeElement.id'), 'connection-guide');assert.match(await run('document.getElementById("guide-title").textContent'), /WorkBuddy/);
      await run(`fixtureFocus('../codex')`);
      assert.equal(await run('document.activeElement.id'), 'connection-guide');assert.match(await run('document.getElementById("guide-title").textContent'), /WorkBuddy/);
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
      await set({onboarding:{zcode:{status:'partial',chat:{status:'needs-model'}}}});
      assert.equal(await run(`document.querySelector('button[data-action="open-provider-chat"][data-provider="zcode"]').disabled`),false,'model selection remains reachable');
      await set({onboarding:{zcode:{status:'partial',chat:{status:'needs-new-chat'}}}});
      assert.equal(await run(`document.querySelector('button[data-action="open-provider-chat"][data-provider="zcode"]').disabled`),false,'account-change new-chat recovery remains reachable');
      window.setSize(520,800);
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="workbuddy"]').click()`);await settle();
      assert.equal(await run('document.documentElement.scrollWidth <= document.documentElement.clientWidth'),true,'cards and open guide fit a narrow window');
      // The same card exposes task records and keeps data-account boundaries visible.
      for(const provider of ['codex','zcode','workbuddy']){
        assert.equal(await run(`document.getElementById('${provider}-task-list').closest('[data-provider-card]').dataset.providerCard`),provider);
      }
      assert.match(await run(`document.querySelector('[data-provider-card="codex"] .account-scope').textContent`),/独立登录.*账号归属尚未核对/);
      assert.match(await run(`document.querySelector('[data-provider-card="zcode"] .account-scope').textContent`),/官方套餐.*自定义 API.*分别计费/);
      assert.match(await run(`document.querySelector('[data-provider-card="workbuddy"] .account-scope').textContent`),/账号归属.*核/);
      const codexTask={title:'合成任务A',state:'active'};
      await set({codex:{...base.codex},codexSnapshot:{...base.codexSnapshot,tasks:{state:'connected',stale:false,items:[codexTask]}}});
      assert.equal(await run('document.getElementById("codex-task-list").textContent'),'合成任务A · 进行中');
      for(const taskChannel of [{state:'error',stale:false},{state:'disconnected',stale:false},{state:'connected',stale:true}]){
        await set({codexSnapshot:{...base.codexSnapshot,tasks:{...taskChannel,items:[codexTask]}}});
        assert.match(await run('document.getElementById("codex-task-list").textContent'),/合成任务A.*上次记录：进行中.*当前待核实/,'retained items cannot present a current state after failure or staleness');
        assert.equal(await run('document.getElementById("codex-capability-tasks").dataset.status'),'unknown');
      }
      await set({zcodeSnapshot:{...base.zcodeSnapshot,tasks:{state:'connected',items:[{title:'合成ZCode历史任务',state:'active'}]}}});
      assert.match(await run('document.getElementById("zcode-task-list").textContent'),/历史缓存，实时状态待核实/);
      assert.doesNotMatch(await run('document.getElementById("zcode-task-list").textContent'),/进行中/);
      // A remembered plugin installation is a ready connection while its live task state waits for new events.
      await set({workbuddy:{...base.workbuddy,status:'connected',summary:{credits:{remaining:321},updatedAt:1234}},workbuddyDesktop:{directory:'stored',partitions:[],probe:null,report:null},workbuddyDesktopEvents:{enabled:true,pluginInstallationVerified:true,observations:[]},workbuddyCli:{...base.workbuddyCli,configured:true,connected:true},onboarding:{workbuddy:{status:'ready',chat:{status:'ready'},data:{status:'ready'}}}});
      assert.equal(await run('document.getElementById("workbuddy-status").textContent'),'已连接');
      assert.equal(await run('document.getElementById("workbuddy-capability-tasks").dataset.status'),'unknown');
      assert.match(await run('document.getElementById("workbuddy-capability-tasks").textContent'),/等待.*事件/);
      assert.equal(await run(`document.querySelector('button[data-action="enable-provider"][data-provider="workbuddy"]').textContent`),'管理连接');
      const beforeReinstall=await calls('prepare-workbuddy-desktop-events'),beforeWebsiteLogin=await calls('workbuddy-login');
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="workbuddy"]').click()`);await settle();
      assert.equal(await run(`document.querySelector('#guide-steps [data-step="tasks"]').dataset.status`),'ready');
      assert.match(await run(`document.querySelector('#guide-steps [data-step="tasks"] p').textContent`),/已确认插件安装/);
      assert.equal(await run('document.getElementById("guide-next").textContent'),'返回工具卡');
      await click('guide-next');
      assert.equal(await calls('prepare-workbuddy-desktop-events'),beforeReinstall,'returning from a restored guide never asks to reinstall');
      assert.equal(await calls('workbuddy-login'),beforeWebsiteLogin,'restored ready guide never requests another website login');
      await set({workbuddy:{...base.workbuddy,status:'error',stale:true,summary:{credits:{remaining:321},updatedAt:1234}}});
      await run(`document.querySelector('button[data-action="enable-provider"][data-provider="workbuddy"]').click()`);await settle();
      await run(`document.querySelector('[data-action="guide-run"][data-step="quota"]').click()`);await settle();
      assert.equal(await calls('workbuddy-login'),beforeWebsiteLogin,'temporary quota error refreshes the existing session');
      assert.equal(await calls('refresh-workbuddy'),1);
      // Automatic installer is invoked only by the explicit task step; rendering
      // and focusing the provider never install software or send a model message.
      const beforePluginInstall=await calls('install-provider-plugin');
      const beforeAutoModel=await calls('send-workbuddy-cli');
      for(const provider of ['workbuddy','zcode']){
        await set({workbuddy:{...base.workbuddy,status:'connected',summary:{credits:{remaining:321},updatedAt:1234}},onboarding:{[provider]:{status:'ready',chat:{status:'ready'},data:{status:'ready'}}},pluginInstallations:{[provider]:{status:'idle'}},[provider+'DesktopEvents']:{enabled:false,observations:[]}});
        const beforeOpen=await calls('install-provider-plugin');
        await run(`fixtureFocus(${JSON.stringify(provider)})`);await settle();
        assert.match(await run('document.getElementById("guide-title").textContent'),new RegExp(provider==='zcode'?'ZCode':'WorkBuddy'));
        assert.equal(await calls('install-provider-plugin'),beforeOpen,'focus opens the guide without auto-installing');
        assert.match(await run(`document.querySelector('#guide-steps [data-step="tasks"] p').textContent`),/写入许可.*插件.*设置/);
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="tasks"] button').textContent`),'安装并启用');
        await run(`document.querySelector('#guide-steps [data-step="tasks"] button').click()`);await settle();
        assert.deepEqual(await run(`fixtureCalls.filter(call=>call.action==='install-provider-plugin').at(-1)`),{action:'install-provider-plugin',payload:{provider}});
        await notify();
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="tasks"] button').disabled`),true,'pending install cannot be duplicated');
        assert.equal(await run(`document.getElementById('${provider}-capability-chat').dataset.status`),'ready','install progress does not disable a ready chat connection');
        await run(`fixtureState.pluginInstallations[${JSON.stringify(provider)}]={status:'installed',enabled:true,installedVersion:'1.0.0'};fixtureState[${JSON.stringify(provider+'DesktopEvents')}]={enabled:true,observations:[]};fixtureInstallResolve({ok:true,state:structuredClone(fixtureState),message:'插件已安装启用'});void 0;`);await settle();await settle();
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="tasks"]').dataset.status`),'ready');
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="tasks"] button')===null`),true,'installed step has no repeat-install action');
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="task-verification"]').dataset.status`),'unknown','installation alone is not genuine event verification');
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="task-verification"] button')===null`),true,'event verification never sends a test model request');
        assert.equal(await run(`document.getElementById('${provider}-capability-tasks').dataset.status`),'unknown');
        assert.match(await run('document.getElementById("guide-result").textContent'),/安装启用.*正常使用.*无需重复安装/);
        await notify();assert.equal(await calls('install-provider-plugin'),beforeOpen+1,'installed state refresh never reinstalls');
        for(const status of ['blocked','error']){
          await set({pluginInstallations:{[provider]:{status,message:'当前版本或现有插件冲突，请保留已有连接'}}});
          assert.match(await run(`document.querySelector('#guide-steps [data-step="tasks"] p').textContent`),/当前版本.*冲突/);
          assert.equal(await run(`document.getElementById('${provider}-capability-chat').dataset.status`),'ready');
        }
        await set({[provider+'DesktopEvents']:{enabled:true,pluginInstallationVerified:true,observations:[]},pluginInstallations:{[provider]:{status:'idle'}}});
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="tasks"] button')===null`),true,'previous genuine event proof skips installation after restart');
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="task-verification"]').dataset.status`),'ready');
      }
      assert.equal(await calls('install-provider-plugin'),beforePluginInstall+2);
      assert.equal(await calls('send-workbuddy-cli'),beforeAutoModel,'plugin rendering/install never submits model messages');
      // While the backend waits for the user to quit a running host, cancellation
      // remains usable although the install promise and every ordinary action are locked.
      for(const provider of ['zcode','workbuddy']){
        await set({workbuddy:{...base.workbuddy,status:'connected',summary:{credits:{remaining:321},updatedAt:1234}},onboarding:{[provider]:{status:'ready',chat:{status:'ready'},data:{status:'ready'}}},pluginInstallations:{[provider]:{status:'idle'}},[provider+'DesktopEvents']:{enabled:false,observations:[]}});
        await run(`fixtureFocus(${JSON.stringify(provider)})`);await settle();
        const beforeInstall=await calls('install-provider-plugin'),beforeCancel=await calls('cancel-provider-plugin'),beforeMessage=await calls('send-workbuddy-cli');
        await run(`document.querySelector('#guide-steps [data-step="tasks"] button').click()`);await settle();
        await set({pluginInstallations:{[provider]:{status:'installing',phase:'waiting-host',enabled:false,message:'请完成当前任务并退出原工具；球球会自动继续安装'}}});
        assert.equal(await run('document.getElementById("guide-cancel-install").hidden'),false,'waiting-host exposes cancellation');
        assert.equal(await run('document.getElementById("guide-cancel-install").disabled'),false,'cancellation stays enabled while install is pending');
        for(const id of ['guide-next','guide-skip'])assert.equal(await run(`document.getElementById('${id}').disabled`),true,'ordinary guide action '+id+' stays locked');
        assert.equal(await run(`document.querySelector('#guide-steps [data-step="tasks"] button').disabled`),true,'cannot submit another installation while waiting');
        assert.equal(await run(`document.querySelector('button[data-action="open-provider-chat"][data-provider="${provider}"]').disabled`),false,'ready chat navigation remains available while installation is pending');
        assert.equal(await run(`document.getElementById('${provider}-capability-chat').dataset.status`),'ready','pending installation does not revoke chat readiness');
        assert.equal(await run('document.getElementById("guide-chat").disabled'),false,'ready chat remains usable while installation waits');
        await click('cancel-provider-plugin');await settle();await settle();
        assert.deepEqual(await run(`fixtureCalls.filter(call=>call.action==='cancel-provider-plugin').at(-1)`),{action:'cancel-provider-plugin',payload:{provider}});
        assert.equal(await calls('cancel-provider-plugin'),beforeCancel+1,'one cancel click is sent exactly once');
        assert.equal(await calls('install-provider-plugin'),beforeInstall+1,'cancel does not submit a second install');
        assert.equal(await calls('send-workbuddy-cli'),beforeMessage,'cancel does not submit any model message');
        assert.equal(await run(`document.getElementById('${provider}-capability-chat').dataset.status`),'ready','cancel preserves existing chat authorization');
        assert.equal(await run(`fixtureState.pluginInstallations[${JSON.stringify(provider)}].phase`),'cancelled');
        assert.equal(await run('document.getElementById("guide-cancel-install").hidden'),true);
        assert.equal(await run('document.getElementById("guide-cancel-install").disabled'),true);
        await click('cancel-provider-plugin');assert.equal(await calls('cancel-provider-plugin'),beforeCancel+1,'completed cancellation cannot repeat');
      }
      await click('guide-close');
      await set({onboarding:{zcode:{status:'ready',chat:{status:'ready'},data:{status:'ready'}}},pluginInstallations:{zcode:{status:'idle'}},zcodeDesktopEvents:{enabled:true,pluginInstallationVerified:true,observations:[]}});
      await run(`document.querySelector('[data-provider-card="zcode"] > details.tool-advanced').open=true;document.querySelector('button[data-action="install-provider-plugin"][data-provider="zcode"]').click()`);await settle();
      assert.equal(await run('document.getElementById("connection-guide").hidden'),false,'advanced update must reveal guide before its asynchronous operation');
      await set({pluginInstallations:{zcode:{status:'installing',phase:'waiting-host',message:'请退出ZCode，自动继续'}}});
      assert.equal(await run('document.getElementById("guide-cancel-install").hidden'),false,'advanced update must expose the same cancellation path');
      assert.match(await run(`document.querySelector('#guide-steps [data-step="tasks"] p').textContent`),/退出ZCode/);
      await click('cancel-provider-plugin');await settle();await settle();
      assert.equal(await run(`document.querySelector('#authorization-selection input').getBoundingClientRect().width`),18,'checkbox must not inherit full-width text input styling');
      // A selected batch authorizes only chosen tools, skips ready grants, and
      // never converts an unsupported capability into another login prompt.
      await click('guide-close');
      await set({codex:{directory:'none'},zcode:{directory:'none',accountSource:'official'},workbuddyDesktop:{directory:'none',partitions:[],report:null},providerChats:{},chat:null,pluginInstallationPolicy:{allowed:false},pluginInstallations:{},zcodeDesktopEvents:{enabled:false,observations:[]},workbuddyDesktopEvents:{enabled:false,observations:[]},onboarding:Object.fromEntries(['codex','zcode','workbuddy'].map(provider=>[provider,{status:'ready',chat:{status:'ready'},data:{status:'idle'}}]))});
      await run(`window.fixtureFlowMode='success';fixtureCalls=[];document.querySelectorAll('input[name=authorization-provider]').forEach(input=>{input.checked=input.value==='codex';input.dispatchEvent(new Event('change'))});void 0`);
      await click('authorize-selected');for(let i=0;i<10;i++)await settle();
      assert.deepEqual(await run(`fixtureCalls.filter(c=>c.action!=='status').map(c=>[c.action,c.payload?.provider])`),[['enable-provider-data','codex']]);
      assert.equal(await run('document.getElementById("codex-status").textContent'),'已可用');
      await click('select-all-providers');await click('authorize-selected');for(let i=0;i<15;i++)await settle();
      assert.deepEqual(await run(`fixtureCalls.filter(c=>c.action==='enable-provider-data').map(c=>c.payload.provider)`),['codex','zcode','workbuddy']);
      assert.equal(await calls('workbuddy-login'),0,'optional credits never launch automatically');
      assert.equal(await calls('install-provider-plugin'),0,'store-blocked install cannot be auto-authorized');
      assert.equal(await run('document.querySelectorAll("input[name=authorization-provider]:checked").length'),3);
      assert.match(await run('localStorage.getItem("qiuqiu-tool-selection")'),/codex.*zcode.*workbuddy/);
      await set({codex:{directory:'none'},onboarding:{codex:{status:'idle',chat:{status:'idle'},data:{status:'idle'}}}});
      await run(`fixtureCalls=[];window.fixtureFlowMode='failed';document.querySelectorAll('input[name=authorization-provider]').forEach(input=>input.checked=input.value==='codex');void 0`);
      await click('authorize-selected');for(let i=0;i<10;i++)await settle();await notify();
      assert.equal(await calls('enable-provider'),1,'cancelled login does not loop on state refresh');assert.equal(await calls('enable-provider-data'),0,'cancelled tool defers remaining permission steps');
      await run(`fixtureCalls=[];window.fixtureFlowMode='cancel-ok';void 0`);await click('authorize-selected');for(let i=0;i<10;i++)await settle();
      assert.equal(await calls('enable-provider'),1);assert.equal(await calls('enable-provider-data'),0,'successful IPC carrying cancelled authorization cannot trigger the next grant');
      await run(`fixtureCalls=[];window.fixtureFlowMode='pending';void 0`);await click('authorize-selected');
      assert.equal(await calls('enable-provider'),1);await click('authorization-stop');
      await run(`fixtureState.onboarding.codex={status:'ready',chat:{status:'ready'},data:{status:'idle'}};fixtureFlowResolve({ok:true,state:structuredClone(fixtureState)});void 0`);for(let i=0;i<10;i++)await settle();
      assert.equal(await calls('enable-provider-data'),0,'stopped batch cannot continue after a late login result');
      assert.equal(await calls('send-workbuddy-cli'),0,'batch never sends a model message');
      assert.equal(window.isVisible(), false);
      console.log('PASS real Chromium unified cards, guided authorization, source isolation and stale-task boundaries; synthetic state/commands only');
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
