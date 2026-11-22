'use strict';
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
if (process.versions.electron && process.argv.includes('--zcode-settings-child')) {
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 840, height: 820, show: false, webPreferences: { contextIsolation: false } });
    await win.loadFile(path.join(__dirname, '../global-settings.html'));
    const run = code => win.webContents.executeJavaScript(code);
    await run(`window.zcodeActions=[];window.zcodeSnapshot={firstRelease:true,version:'zcode-settings',initialView:'/zcode-menu',
      firstReleaseZcodeConnection:{enabled:false,connected:false,status:'disconnected',chat:{authorized:false,message:'聊天需完成当前官方账号的连接授权。'},tasks:{authorized:false},notifications:{enabled:false}},
      entries:[{id:'/zcode-menu',label:'ZCode 联动',children:[{id:'/zcode-menu/zcode-enabled',label:'启用 ZCode 联动',type:'checkbox',checked:false,enabled:true,actionable:true},
        {id:'/zcode-menu/zcode-quota-visible',label:'显示 ZCode 额度',type:'checkbox',checked:true,enabled:true,actionable:true}]}]};
      window.qiuqiuSettings={get:async()=>structuredClone(zcodeSnapshot),onNavigate:callback=>window.zcodeNavigate=callback,
        zcodeConnection:async action=>{zcodeActions.push(action);const state=zcodeSnapshot.firstReleaseZcodeConnection;
          if(action==='connect'){Object.assign(state,{enabled:true,connected:true,status:'ready'});state.chat={authorized:true,message:'已同意使用当前 ZCode 账号聊天。'}}
          if(action==='disconnect'){Object.assign(state,{enabled:false,connected:false,status:'disconnected'});state.chat.authorized=false;}
          if(action==='tasks-authorize')state.tasks.authorized=true;if(action==='tasks-revoke')state.tasks.authorized=false;
          if(action==='notifications-enable')state.notifications.enabled=true;if(action==='notifications-disable')state.notifications.enabled=false;
          return {status:action==='app'?'app-authorized':action==='account'?'stored':action==='disconnect'?'disconnected':'ready',snapshot:structuredClone(zcodeSnapshot)}}};true`);
    await run(fs.readFileSync(path.join(__dirname, '../global-settings-renderer.js'), 'utf8'));
    const until = expression => run(`new Promise((resolve,reject)=>{const end=Date.now()+3000;const next=()=>{if(${expression})resolve();else if(Date.now()>end)reject(Error('settings did not settle: '+${JSON.stringify(expression)}));else setTimeout(next,10)};next()})`);
    const click = async selector => { await until(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});return element&&!element.disabled})()`);return run(`window.zcodePriorConnection=document.querySelector('[data-action=store-zcode-connection]');document.querySelector(${JSON.stringify(selector)}).click()`); };
    await until(`document.querySelector('[data-action=store-zcode-connection]')`);
    assert.equal(await run(`document.querySelector('[data-zcode-tasks]')===null`), true);
    await click('[data-action=store-zcode-connection]');
    await click('dialog[open] button[value=cancel]');
    await until(`!document.querySelector('dialog[open]')&&document.querySelector('[data-action=store-zcode-connection]')!==window.zcodePriorConnection`);
    assert.deepEqual(await run('zcodeActions'), []);
    await click('[data-action=store-zcode-connection]');
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('dialog[open] .store-codex-terms')`);
    for (const appearance of ['light', 'dark']) for (const width of [720, 840, 1080]) {
      win.setSize(width, 820);
      await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const layout = await run(`(()=>{const d=document.querySelector('dialog[open]');return {overflow:d.scrollWidth>d.clientWidth,paragraphs:[...d.querySelectorAll('.store-codex-terms p')].map(p=>{const r=document.createRange();r.selectNodeContents(p);return {lines:r.getClientRects().length,overflow:p.scrollWidth>p.clientWidth}})}})()`);
      assert.equal(layout.overflow, false);
      assert(layout.paragraphs.every(row => row.lines === 1 && !row.overflow), JSON.stringify({ appearance, width, layout }));
    }
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-zcode-tasks]')`);
    assert.deepEqual(await run('zcodeActions'), ['app', 'account', 'connect']);
    assert.equal(await run(`document.querySelector('#content > section').classList.contains('store-connected-group')`), true);
    assert.match(await run(`document.querySelector('#content').textContent`), /已同意使用当前 ZCode 账号聊天/);
    await click('[data-action=store-zcode-tasks]');
    await click('dialog[open] button[value=cancel]');
    await until(`!document.querySelector('dialog[open]')&&document.querySelector('[data-action=store-zcode-connection]')!==window.zcodePriorConnection`);
    assert.equal(await run(`zcodeSnapshot.firstReleaseZcodeConnection.tasks.authorized`), false);
    await click('[data-action=store-zcode-tasks]');
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-action=store-zcode-tasks]').textContent==='撤销授权'`);
    await click('[data-action=store-zcode-notifications]');
    assert.match(await run(`document.querySelector('dialog[open]').textContent`), /备份原设置/);
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-action=store-zcode-notifications]').textContent==='关闭提醒'`);
    const aligned = await run(`['store-zcode-connection','store-zcode-tasks','store-zcode-notifications'].map(id=>document.querySelector('[data-action='+id+']').getBoundingClientRect().right)`);
    assert(aligned.every(value => Math.abs(value - aligned[0]) <= .5));
    await click('[data-action=store-zcode-connection]');
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-zcode-tasks]')===null`);
    assert.equal(await run(`zcodeSnapshot.firstReleaseZcodeConnection.connected`), false);
    win.destroy(); process.stdout.write('ZCODE_SETTINGS_DOM_OK\n'); app.exit(0);
  }).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
} else {
  require('node:test')('MAS ZCode settings consent, cancellation, independent tasks and reminders in Chromium', () => {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--zcode-settings-child'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /ZCODE_SETTINGS_DOM_OK/);
  });
}
