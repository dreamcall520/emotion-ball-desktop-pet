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
    await run(`window.zcodeActions=[];window.zcodeEntryActions=[];window.zcodeSnapshot={firstRelease:true,version:'zcode-settings',initialView:'/zcode-menu',
      firstReleaseZcodeConnection:{enabled:false,connected:false,status:'disconnected',chat:{authorized:false,status:'disabled',message:'聊天需完成当前官方账号的连接授权。'},tasks:{authorized:false,status:'needs-authorization'},notifications:{enabled:false,connected:false,status:'disabled',message:'动画提醒尚未启用。'}},
      entries:[{id:'/zcode-menu',label:'ZCode 联动',children:[{id:'/zcode-menu/zcode-enabled',label:'启用 ZCode 联动',type:'checkbox',checked:false,enabled:true,actionable:true},
        {id:'/zcode-menu/zcode-quota-visible',label:'显示 ZCode 额度',type:'checkbox',checked:true,enabled:true,actionable:true},
        ...[['zcode-quota-detail','额度明细'],['zcode-trend','额度趋势'],['zcode-tasks','本机任务'],['zcode-refresh','刷新 ZCode 状态']].map(([id,label])=>({id:'/zcode-menu/'+id,label,enabled:true,actionable:true}))]}]};
      window.qiuqiuSettings={get:async()=>structuredClone(zcodeSnapshot),onNavigate:callback=>window.zcodeNavigate=callback,
        act:async id=>{zcodeEntryActions.push(id);return {snapshot:structuredClone(zcodeSnapshot)}},
        zcodeConnection:async action=>{zcodeActions.push(action);const state=zcodeSnapshot.firstReleaseZcodeConnection;
          if(action==='connect'){Object.assign(state,{enabled:true,connected:true,status:'ready'});state.chat={authorized:true,status:'ready',message:'已同意使用当前 ZCode 账号聊天。'}}
          if(action==='disconnect'){Object.assign(state,{enabled:false,connected:false,status:'disconnected'});state.chat.authorized=false;}
          if(action==='tasks-authorize')state.tasks.authorized=true;if(action==='tasks-revoke')state.tasks.authorized=false;
          if(action==='notifications-enable')Object.assign(state.notifications,{enabled:true,connected:true,status:'ready',message:'已启用；本机新任务可触发处理中，确认本轮结束后提醒。'});
          if(action==='notifications-disable')Object.assign(state.notifications,{enabled:false,connected:false,status:'disabled',message:'动画提醒尚未启用。'});
          return {status:action==='app'?'app-authorized':action==='account'?'stored':action==='disconnect'?'disconnected':'ready',snapshot:structuredClone(zcodeSnapshot)}}};true`);
    // The HTML's first load precedes this isolated fixture API. Remove its
    // partial brand canvas before running the renderer with the injected API.
    await run(`document.getElementById('brand-pet').replaceChildren();true`);
    await run(fs.readFileSync(path.join(__dirname, '../global-settings-renderer.js'), 'utf8'));
    const until = expression => run(`new Promise((resolve,reject)=>{const end=Date.now()+3000;const next=()=>{if(${expression})resolve();else if(Date.now()>end)reject(Error('settings did not settle: '+${JSON.stringify(expression)}));else setTimeout(next,10)};next()})`);
    const click = async selector => { await until(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});return element&&!element.disabled})()`);return run(`window.zcodePriorConnection=document.querySelector('[data-action=store-zcode-connection]');document.querySelector(${JSON.stringify(selector)}).click()`); };
    await until(`document.querySelector('[data-action=store-zcode-connection]')`);
    assert.equal(await run(`document.querySelector('.store-codex-error [role=status]').textContent`),'尚未连接本机 ZCode。');
    await run(`Object.assign(zcodeSnapshot.firstReleaseZcodeConnection,{status:'error',message:'当前目录暂不可读'});window.dispatchEvent(new Event('focus'));true`);
    await until(`document.querySelector('.store-codex-error [role=status]').textContent==='当前目录暂不可读'`);
    await run(`Object.assign(zcodeSnapshot.firstReleaseZcodeConnection,{status:'disconnected',message:''});window.dispatchEvent(new Event('focus'));true`);
    await until(`document.querySelector('.store-codex-error [role=status]').textContent==='尚未连接本机 ZCode。'`);
    assert.equal(await run(`document.querySelector('[data-zcode-tasks]')===null`), true);
    await click('[data-action=store-zcode-connection]');
    await click('dialog[open] button[value=cancel]');
    await until(`!document.querySelector('dialog[open]')&&document.querySelector('[data-action=store-zcode-connection]')!==window.zcodePriorConnection`);
    assert.deepEqual(await run('zcodeActions'), []);
    await click('[data-action=store-zcode-connection]');
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('dialog[open] .store-codex-terms')`);
    assert.match(await run(`document.querySelector('dialog[open]').textContent`),/默认开启本机任务和动画提醒.*安装提醒时另选目录，并备份原设置/s);
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
    assert.equal(await run(`document.querySelector('[data-action=store-zcode-connection]').textContent`), '解除连接');
    assert.equal(await run(`document.querySelector('#content > section .store-codex-state').textContent`), '已连接');
    assert.equal(await run(`document.querySelector('#content > section .store-codex-error')===null`),true);
    assert.doesNotMatch(await run(`document.querySelector('#content').textContent`), /已同意使用当前 ZCode 账号聊天/);
    assert.equal(await run(`document.querySelector('[data-zcode-tasks] .store-codex-state').textContent`), '未授权');
    assert.equal(await run(`document.querySelector('[data-zcode-notifications] .store-codex-state').textContent`), '未开启');
    assert.equal(await run(`document.querySelector('[data-action="/zcode-menu/zcode-tasks"]')===null`), true);
    assert.doesNotMatch(await run(`document.querySelector('#content').textContent`), /额度与任务信息/);
    assert.equal(await run(`[...document.querySelectorAll('#content h3')].some(node=>node.textContent==='额度信息')`),false);
    for(const id of ['zcode-quota-detail','zcode-trend','zcode-refresh'])assert.equal(await run(`document.querySelector('[data-action="/zcode-menu/${id}"]')===null`),true);
    await click('[data-action=store-zcode-tasks]');
    await click('dialog[open] button[value=cancel]');
    await until(`!document.querySelector('dialog[open]')&&document.querySelector('[data-action=store-zcode-connection]')!==window.zcodePriorConnection`);
    assert.equal(await run(`zcodeSnapshot.firstReleaseZcodeConnection.tasks.authorized`), false);
    await click('[data-action=store-zcode-tasks]');
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-action=store-zcode-tasks]').textContent==='撤销授权'`);
    assert.equal(await run(`document.querySelector('[data-zcode-tasks] .store-codex-state').textContent`), '已授权');
    assert.equal(await run(`document.querySelector('[data-zcode-tasks] .store-codex-state').hasAttribute('data-connected')`), true);
    assert.equal(await run(`document.querySelector('[data-zcode-tasks] [data-action="/zcode-menu/zcode-tasks"]').textContent`), '查看任务');
    await run(`zcodeSnapshot.entries[0].children.find(entry=>entry.id.endsWith('/zcode-quota-visible')).checked=false;window.dispatchEvent(new Event('focus'));true`);
    await until(`document.querySelector('[data-action="/zcode-menu/zcode-quota-visible"]').getAttribute('aria-checked')==='false'`);
    assert.equal(await run(`document.querySelector('[data-zcode-tasks] [data-action="/zcode-menu/zcode-tasks"]').textContent`),'查看任务');
    await click('[data-action="/zcode-menu/zcode-tasks"]');
    await until(`zcodeEntryActions.includes('/zcode-menu/zcode-tasks')&&!document.querySelector('[data-action=store-zcode-tasks]').disabled`);
    await click('[data-action=store-zcode-notifications]');
    assert.match(await run(`document.querySelector('dialog[open]').textContent`), /备份原设置/);
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-action=store-zcode-notifications]').textContent==='关闭提醒'`);
    assert.equal(await run(`document.querySelector('[data-zcode-notifications] .store-codex-state').textContent`), '已开启');
    assert.equal(await run(`document.querySelector('[data-zcode-notifications] .store-codex-state').hasAttribute('data-connected')`), true);
    const aligned = await run(`['store-zcode-connection','store-zcode-tasks','store-zcode-notifications'].map(id=>document.querySelector('[data-action='+id+']').getBoundingClientRect().right)`);
    assert(aligned.every(value => Math.abs(value - aligned[0]) <= .5));
    for(const [status,enabled,connected,expected]of [['needs-authorization',true,false,'需授权'],['account-changed',false,false,'需重新授权'],['waiting-account',true,false,'待确认账号'],['error',true,false,'设置异常'],['ready',true,false,'待连接'],['disabled',false,false,'未开启'],['ready',true,true,'已开启']]){
      await run(`Object.assign(zcodeSnapshot.firstReleaseZcodeConnection.notifications,${JSON.stringify({status,enabled,connected,message:''})});window.dispatchEvent(new Event('focus'));true`);
      await until(`document.querySelector('[data-zcode-notifications] .store-codex-state').textContent===${JSON.stringify(expected)}`);
    }
    await run(`zcodeSnapshot.firstReleaseZcodeConnection.chat={authorized:false,status:'account-changed',message:'ZCode 账号已变化，请重新同意启用聊天。'};window.dispatchEvent(new Event('focus'));true`);
    await until(`document.querySelector('[data-action=store-zcode-chat]')`);
    assert.match(await run(`document.querySelector('#content > section').textContent`), /额度已连接，聊天待授权/);
    assert.match(await run(`document.querySelector('#content > section').textContent`), /账号已变化/);
    await run(`zcodeSnapshot.firstReleaseZcodeConnection.chat={authorized:true,status:'ready',message:'已同意使用当前 ZCode 账号聊天。'};window.dispatchEvent(new Event('focus'));true`);
    await until(`document.querySelector('[data-action=store-zcode-chat]')===null`);
    for (const appearance of ['light','dark']) for(const width of [720,840,1080]){
      win.setSize(width,820);await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const layout=await run(`(()=>{const groups=[...document.querySelectorAll('#content > section')].slice(0,3);return {overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth||groups.some(group=>[...group.querySelectorAll('p')].some(p=>p.scrollWidth>p.clientWidth+1)),rights:['store-zcode-connection','store-zcode-tasks','store-zcode-notifications'].map(id=>document.querySelector('[data-action='+id+']').getBoundingClientRect().right)}})()`);
      assert.equal(layout.overflow,false,JSON.stringify({appearance,width,layout}));assert(layout.rights.every(value=>Math.abs(value-layout.rights[0])<=.5));
      const help=await run(`(()=>{const p=document.querySelector('.zcode-quota-description'),text=p.firstChild,second=text.textContent.indexOf('隐藏卡片');const top=index=>{const r=document.createRange();r.setStart(text,index);r.setEnd(text,index+1);return r.getBoundingClientRect().top};return {text:p.textContent,whiteSpace:getComputedStyle(p).whiteSpace,firstTop:top(0),secondTop:top(second),lineHeight:parseFloat(getComputedStyle(p).lineHeight),overflow:p.scrollWidth>p.clientWidth+1}})()`);
      assert.equal(help.text,'独立显示 ZCode 额度卡；\n隐藏卡片不关闭 ZCode 联动。');assert.equal(help.whiteSpace,'pre-line');assert(Math.abs(help.secondTop-help.firstTop-help.lineHeight)<=1,JSON.stringify({appearance,width,help}));assert.equal(help.overflow,false);
    }
    if(process.env.QIUQIU_ZCODE_SETTINGS_CAPTURE_DIR){
      win.setSize(840,820);await run(`document.documentElement.dataset.appearance='light';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      fs.mkdirSync(process.env.QIUQIU_ZCODE_SETTINGS_CAPTURE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QIUQIU_ZCODE_SETTINGS_CAPTURE_DIR,'zcode-settings-connected.png'),(await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(await run(`zcodeSnapshot.entries[0].children.filter(entry=>/\\/zcode-(?:quota-detail|trend|refresh)$/.test(entry.id)).map(entry=>entry.id)`),['/zcode-menu/zcode-quota-detail','/zcode-menu/zcode-trend','/zcode-menu/zcode-refresh']);
    await click('[data-action=store-zcode-tasks]');await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-zcode-tasks] .store-codex-state').textContent==='未授权'`);
    assert.equal(await run(`document.querySelector('[data-action="/zcode-menu/zcode-tasks"]')===null`),true);
    await click('[data-action=store-zcode-notifications]');await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-zcode-notifications] .store-codex-state').textContent==='未开启'`);
    await click('[data-action=store-zcode-connection]');
    await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-zcode-tasks]')===null`);
    assert.equal(await run(`zcodeSnapshot.firstReleaseZcodeConnection.connected`), false);
    assert.equal(await run(`document.querySelector('[data-zcode-notifications]')===null`),true);
    await run(`window.zcodeBaseConnection=window.qiuqiuSettings.zcodeConnection;window.qiuqiuSettings.zcodeConnection=async action=>{const result=await zcodeBaseConnection(action);return action==='connect'?{...result,status:'partial',message:'已连接；动画提醒未完成，可稍后单独开启。'}:result};true`);
    await click('[data-action=store-zcode-connection]');await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('dialog[open] .store-codex-terms')`);await click('dialog[open] button[value=confirm]');
    await until(`document.querySelector('[data-action=store-zcode-connection]').textContent==='解除连接'&&document.querySelector('.store-codex-error')?.textContent.includes('动画提醒未完成')`);
    assert.equal(await run(`zcodeSnapshot.firstReleaseZcodeConnection.connected`),true);
    win.destroy(); process.stdout.write('ZCODE_SETTINGS_DOM_OK\n'); app.exit(0);
  }).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
} else {
  require('node:test')('MAS ZCode settings consent, cancellation, independent tasks and reminders in Chromium', () => {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--zcode-settings-child'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /ZCODE_SETTINGS_DOM_OK/);
  });
}
