const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
if (process.versions.electron && process.argv.includes('--shortcut-settings-dom-child')) {
  const { app, BrowserWindow, session } = require('electron');
  app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => done({ cancel: true }));
    const win = new BrowserWindow({ width: 1080, height: 900, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    const root = process.env.PET_SETTINGS_SOURCE_ROOT || path.resolve(__dirname, '../..');
    await win.loadFile(path.join(root, 'desktop-pet/global-settings.html'));
    const run = code => win.webContents.executeJavaScript(code);
    await run(`window.calls=[];window.recordings=[];window.saveMode='ok';window.getMode='ok';
      window.config={enabled:true,shape:'floating',launcher:'Ctrl+Alt+Q',chat:'',custom:'',note:'',todo:'',pomodoro:'',noteBehavior:'panel',todoBehavior:'panel'};
      window.notesTab='notes';window.actionCalls=[];window.serverSnapshot=()=>({version:'test',initialView:'shortcuts',entries:[{id:'/notes',label:'便签与待办',children:[...['notes-open','notes-new','todo-new'].map((id,index)=>({id:'/notes/'+id,label:['打开主面板','新建便签','添加待办'][index],enabled:true,actionable:true})),{id:'/notes/default-tab',label:'主面板默认显示',enabled:true,children:['notes','todos'].map(id=>({id:'/notes/default-tab/'+id,label:id==='notes'?'便签':'待办',type:'radio',enabled:true,actionable:true,checked:notesTab===id}))}]}],shortcuts:{...config}});
      window.EmotionBall={config:{get:()=>({raw:{}}),register(){}},create:()=>({destroy(){}})};
      window.qiuqiuSettings={get:async()=>{const value=serverSnapshot();if(getMode==='defer'){getMode='ok';return new Promise(resolve=>window.resolveRefresh=()=>resolve(value));}return value;},
        act:async id=>{actionCalls.push(id);if(id.startsWith('/notes/default-tab/'))notesTab=id.split('/').at(-1);return {snapshot:serverSnapshot()};},onNavigate:fn=>window.navigate=fn,recordShortcuts:value=>recordings.push(value),
        saveShortcuts:async value=>{calls.push({...value});
          if(saveMode==='defer')return new Promise(resolve=>window.resolveSave=()=>{config={...value};resolve({ok:true,config:{...config}});});
          if(saveMode==='throw')throw Error('disk');
          if(saveMode==='conflict')return {ok:false,config:{...config},errors:[{accelerator:'Meta+K',message:'已被其他应用占用'}]};
          config={...value};return {ok:true,config:{...config}};}};
      document.getElementById('brand-pet').replaceChildren();true;`);
    await run(fs.readFileSync(path.join(root, 'desktop-pet/global-settings-shortcuts.js'), 'utf8'));
    await run(fs.readFileSync(path.join(root, 'desktop-pet/global-settings-renderer.js'), 'utf8'));
    const settle = () => run('new Promise(resolve=>setTimeout(resolve,20))'); await settle();
    const capture = async name => {
      if (!process.env.PET_SMOKE_ARTIFACT_DIR) return;
      fs.mkdirSync(process.env.PET_SMOKE_ARTIFACT_DIR,{recursive:true});
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await new Promise(resolve=>setTimeout(resolve,150));
      fs.writeFileSync(path.join(process.env.PET_SMOKE_ARTIFACT_DIR,name),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
    };
    await run(`window.control=label=>document.querySelector('[aria-label="'+label+'"]');window.change=(label,value)=>{const c=control(label);c.value=value;c.dispatchEvent(new Event('change'));};
      window.key=(key,code,extra={})=>document.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true,...extra}));true;`);
    assert.equal(await run("document.querySelectorAll('.shortcut-footer,.shortcut-save-controls').length"), 0);
    assert.equal(await run("document.getElementById('content').textContent.includes('保存更改')"), false);
    await run("control('启用快捷面板').click()"); await settle();
    assert.equal(await run('config.enabled'), false);
    for (const [label, field, value] of [['面板形态','shape','list']]) {
      await run(`change(${JSON.stringify(label)},${JSON.stringify(value)})`); await settle();
      assert.equal(await run(`config.${field}`), value);
    }
    assert.equal(await run("control('便签启动方式')===null && control('待办启动方式')===null"),true,'shortcuts page owns only panel and bindings');
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='便签与待办').click()");
    assert.equal(await run("document.querySelectorAll('.binding-button').length"),0,'notes page does not duplicate key bindings');
    for(const [label,field] of [['便签启动方式','noteBehavior'],['待办启动方式','todoBehavior']]) {
      await run(`change(${JSON.stringify(label)},'create')`);await settle();assert.equal(await run(`config.${field}`),'create');
    }
    await run("saveMode='conflict';change('便签启动方式','panel')");await settle();
    assert.equal(await run("control('便签启动方式').value"),'create','notes behavior failure rolls back');
    assert.match(await run("document.querySelector('.shortcut-settings-group [role=status]').textContent"),/占用/);
    await run("saveMode='ok';getMode='defer';window.dispatchEvent(new Event('focus'))");await settle();
    await run("change('便签启动方式','panel')");await settle();await run('resolveRefresh()');await settle();
    assert.equal(await run("control('便签启动方式').value"),'panel','late old snapshot cannot revert notes behavior');
    await run(`document.querySelector('[data-action="/notes/notes-open"]').click()`);await settle();assert.equal(await run('actionCalls.at(-1)'),'/notes/notes-open');
    await run("const tab=control('主面板默认显示');tab.value='/notes/default-tab/todos';tab.dispatchEvent(new Event('change'))");await settle();assert.equal(await run('notesTab'),'todos');
    await run("navigate('shortcuts')");await settle();
    await run("control('和球球聊聊快捷键').click();key('k','KeyK',{metaKey:true})"); await settle();
    assert.equal(await run('config.chat'), 'Meta+K'); assert.equal(await run('recordings.at(-1)'), false);
    const count = await run('calls.length');
    await run("control('便签快捷键').click();key('k','KeyK',{metaKey:true})"); await settle();
    assert.equal(await run('calls.length'), count);
    assert.match(await run("document.querySelector('.shortcut-settings-group [role=status]').textContent"), /其他功能/);
    await run("key('Escape','Escape')"); await settle(); assert.equal(await run('calls.length'), count);
    await run("control('和球球聊聊快捷键').click();key('Backspace','Backspace')"); await settle(); assert.equal(await run('config.chat'), '');
    await run("control('和球球聊聊快捷键').click();key('j','KeyJ',{metaKey:true})"); await settle();
    await run("control('删除和球球聊聊快捷键').click()"); await settle(); assert.equal(await run('config.chat'), '');
    await run("saveMode='conflict';control('和球球聊聊快捷键').click();key('k','KeyK',{metaKey:true})"); await settle();
    assert.equal(await run('config.chat'), '');
    assert.match(await run("document.querySelector('.shortcut-settings-group [role=status]').textContent"), /Meta\+K.*占用/);
    assert.equal(await run("control('和球球聊聊快捷键').textContent"), '设置快捷键');
    await run("saveMode='throw';change('面板形态','floating')"); await settle();
    assert.equal(await run("control('面板形态').value"), 'list');
    assert.match(await run("document.querySelector('.shortcut-settings-group [role=status]').textContent"), /恢复原设置/);
    await run("saveMode='ok';change('面板形态','floating')"); await settle(); assert.equal(await run('config.shape'), 'floating');
    // A refresh started before the save cannot apply its late stale snapshot afterward.
    await run("getMode='defer';window.dispatchEvent(new Event('focus'))"); await settle();
    await run("change('面板形态','list')"); await settle();
    await run('resolveRefresh()'); await settle();
    assert.equal(await run("control('面板形态').value"), 'list');
    // Queued handler calls are guarded as well as disabled native controls; returning
    // to this page during an outstanding save paints the actual result on its new DOM.
    await run(`saveMode='defer';change('面板形态','floating');window.oldSection=document.querySelector('.shortcut-settings-group');
      control('启用快捷面板').onclick();control('面板形态').value='list';control('面板形态').onchange();
      document.getElementById('content').replaceChildren();navigate('shortcuts');true;`);
    assert.equal(await run("control('启用快捷面板').disabled"), true);
    const pendingCount = await run('calls.length');
    await run("resolveSave();saveMode='ok'"); await settle();
    assert.equal(await run('calls.length'), pendingCount);
    assert.equal(await run('oldSection.isConnected'), false);
    assert.equal(await run("control('面板形态').value"), 'floating');
    assert.equal(await run('config.noteBehavior'), 'panel');
    assert.equal(await run("control('启用快捷面板').disabled"), false);
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='便签与待办').click();saveMode='defer';change('待办启动方式','panel');navigate('shortcuts')");await settle();
    assert.equal(await run("control('启用快捷面板').disabled"),true,'cross-page pending save blocks stale edits');
    await run("resolveSave();saveMode='ok'");await settle();
    assert.equal(await run('config.todoBehavior'),'panel');assert.equal(await run("control('便签启动方式')===null"),true);
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='便签与待办').click()");await settle();
    assert.equal(await run("control('待办启动方式').value"),'panel','new notes DOM paints the saved result');
    await capture('notes-startup-behaviors.png');
    await run("navigate('shortcuts')");await settle();
    await run("control('天气快捷键').click();key('w','KeyW',{ctrlKey:true,altKey:true})");await settle();
    assert.equal(await run('config.weather'),'Ctrl+Alt+W');
    await run("control('删除天气快捷键').click()");await settle();assert.equal(await run('config.weather'),'');
    const geometry = await run(`[...document.querySelectorAll('.binding-clear')].map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,visibility:getComputedStyle(n).visibility}))`);
    assert(geometry.length === 7 && geometry.every(r => r.width === 28 && Math.abs(r.x - geometry[0].x) < 1), JSON.stringify(geometry));
    assert(geometry.some(r => r.visibility === 'visible') && geometry.some(r => r.visibility === 'hidden'));
    const out = process.env.PET_SMOKE_ARTIFACT_DIR;
    if (out) {
      fs.mkdirSync(out,{recursive:true});
      fs.writeFileSync(path.join(out,'shortcuts-autosave.png'), (await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
      fs.writeFileSync(path.join(out,'shortcuts-autosave-report.json'),JSON.stringify({passed:true,sourceRoot:root,nativeWindowHidden:!win.isVisible(),fixtureApi:true,
        checks:['no-save-footer','enabled-and-shape-autosave','notes-page-exclusive-behavior-controls','note-and-todo-behavior-autosave','notes-open-and-default-tab-preserved','notes-behavior-failure-rollback','notes-behavior-stale-refresh-rejected','notes-to-shortcuts-pending-save-preserved','record-and-clear-autosave','duplicate-guard','conflict-feedback-and-rollback','exception-rollback-and-retry','stale-refresh-rejected','pending-events-blocked','pending-remount-updated','clear-column-aligned'],geometry},null,2));
    }
    assert.equal(win.isVisible(), false); win.destroy();
    process.stdout.write('SHORTCUT_SETTINGS_AUTOSAVE_DOM_OK\n'); app.exit(0);
  }).catch(error => { process.stderr.write(error.stack+'\n'); app.exit(1); });
} else {
  require('node:test')('settings shortcuts save each change immediately, rollback failures, ignore stale refreshes and align clear controls', { timeout:30000 }, () => {
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename,'--shortcut-settings-dom-child'], {encoding:'utf8',timeout:25000,env});
    assert.equal(result.status,0,result.stdout+result.stderr); assert.match(result.stdout,/SHORTCUT_SETTINGS_AUTOSAVE_DOM_OK/);
  });
}
