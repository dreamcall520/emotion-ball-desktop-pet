const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const toggle = { id: '/codex-menu/codex-enabled', label: '启用 Codex 联动', type: 'checkbox', checked: true, enabled: true, actionable: true };
const taskId = '/codex-menu/codex-tasks-open';
const refreshId = '/codex-menu/codex-status/codex-refresh';
const snapshot = { version: 'test', initialView:'openai-api', codexStatus: { enabled: true, connection: 'connected', quota: [{ label: '5小时', remaining: 47.6, resetsAt: 1800000000000 }], updatedAt: 1790000000000, tasks: { active: 2, waiting: 1 }, taskActionId: taskId }, entries: [
  { id: `/${encodeURIComponent('球球与互动')}`, label: '球球与互动', children: [
    ...['随机表情','立即睡眠','立即唤醒'].map(label=>({id:`/${encodeURIComponent('球球与互动')}/${encodeURIComponent(label)}`,label,enabled:true,actionable:true})),
    {id:`/${encodeURIComponent('球球与互动')}/${encodeURIComponent('咩咩互动')}`,label:'咩咩互动',children:['咩咩问好','开心回应','迈迈小蹄','暖暖打盹','揉揉耳朵','抱住小铃铛','慢半拍伸懒腰'].map(label=>({id:`/sheep/${encodeURIComponent(label)}`,label,enabled:true,actionable:true}))}
  ] },
  { id: '/codex-menu', label: 'Codex 与 API', children: [toggle,
    {id:'/codex-menu/codex-task-names',label:'任务完成提醒显示名称',type:'checkbox',checked:false,enabled:true,actionable:true},
    {id:'/codex-menu/codex-quota-visible',label:'显示 Codex 额度',type:'checkbox',checked:true,enabled:true,actionable:true},
    {id:'/codex-menu/codex-quota-fun',label:'额度趣味互动',type:'checkbox',checked:true,enabled:true,actionable:true},
    { id: '/codex-menu/openai-api-menu', label: 'OpenAI API', children: [{id:'/codex-menu/openai-api-menu/openai-api-visible',label:'显示 API 本月费用卡',type:'checkbox',checked:false,enabled:true,actionable:true},{ id: '/codex-menu/openai-api-menu/openai-api-usage', label: 'API 费用与用量', enabled: true, actionable: true }] },
    { id: '/codex-menu/codex-trend-open', label: '额度与趋势', enabled: true, actionable: true },
    { id: taskId, label: '打开 Codex 任务', enabled: true, actionable: true },
    { id: '/codex-menu/codex-status', label: 'Codex 状态', children: [
      { id: '/codex-menu/codex-status/codex-tasks', label: '任务列表', children: [{ id: '/task-secret', label: '不应该逐条展示的任务', enabled: true, actionable: true }] },
      { id: refreshId, label: '刷新状态（至少间隔10秒）', enabled: true, actionable: true },
      { id: '/disabled', label: '额度：已连接', enabled: false }
    ] }
  ] }, { id: '/zcode-menu', label: 'ZCode 联动', children: ['enabled','quota-visible','quota-size','quota-fun','quota-detail','trend','tasks','refresh'].map(kind => ({ id: `/zcode-menu/zcode-${kind}`, label: ({enabled:'启用 ZCode 联动','quota-visible':'显示 ZCode 额度','quota-size':'额度卡片大小','quota-fun':'额度趣味互动','quota-detail':'额度明细',trend:'额度趋势',tasks:'进行中任务',refresh:'刷新 ZCode 状态'})[kind], enabled: true, actionable: true, checked:true, type: ['enabled','quota-visible','quota-fun'].includes(kind) ? 'checkbox' : 'normal', ...(kind === 'quota-size' ? {children:['standard','compact'].map(size=>({id:`/zcode-menu/zcode-quota-size/zcode-size-${size}`,label:size==='standard'?'标准':'小巧',enabled:true,actionable:true,type:'radio',checked:size==='compact'}))} : {}) })) }, { id: '/general', label: '常规设置', children: [] }, { id: '/workbuddy-enabled', label: '启用 WorkBuddy 联动', checked:false, enabled: true, actionable: true, type: 'checkbox' },
  {id:'/workbuddy-quota-visible',label:'显示 WorkBuddy 积分卡',enabled:true,actionable:true,type:'checkbox',checked:true},
  {id:'/workbuddy-quota-fun',label:'WorkBuddy 积分趣味游戏',enabled:true,actionable:true,type:'checkbox',checked:true}
] };

if (process.versions.electron && process.argv.includes('--settings-dom-child')) {
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1080, height: 820, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    const sourceRoot = process.env.PET_SETTINGS_SOURCE_ROOT || path.resolve(__dirname, '../..');
    await win.loadFile(path.join(sourceRoot, 'desktop-pet/global-settings.html'));
    const run = code => win.webContents.executeJavaScript(code);
    await run(`window.calls=[];window.snapshot=${JSON.stringify(snapshot)};window.EmotionBall ||= {config:{get:()=>({raw:{}}),register(){}},create:()=>({destroy(){}})};window.qiuqiuSettings={get:async()=>window.snapshot,act:async(id,checked)=>{calls.push({id,checked});if(window.actMode==='defer')return new Promise(resolve=>window.resolveAction=resolve);if(window.actMode==='throw')throw Error('保存失败');if(window.actMode==='reject')return {snapshot:window.snapshot,error:'授权已取消'};if(window.actMode==='apply')window.findEntry(id).checked=checked;return {snapshot:window.snapshot}},onNavigate:callback=>window.navigate=callback};true;`);
    await run("document.getElementById('brand-pet').replaceChildren();window.findEntry=id=>{const walk=items=>items.flatMap(item=>[item,...(item.children?walk(item.children):[])]);return walk(snapshot.entries).find(item=>item.id===id)};true");
    await run(fs.readFileSync(path.join(sourceRoot, 'desktop-pet/global-settings-renderer.js'), 'utf8'));
    await run('new Promise(resolve=>setTimeout(resolve,20))');
    const nav = await run("[...document.querySelectorAll('#navigation button')].map(n=>n.textContent)");
    for (const name of ['Codex','WorkBuddy','快捷键','常规设置']) assert(nav.includes(name), name);
    assert(!nav.includes('OpenAI API')); assert(!nav.includes('API 费用与用量')); assert(!nav.includes('Codex 与 API'));
    await run(`Promise.all([...document.querySelectorAll('#navigation img.nav-icon')].map(img=>img.complete?Promise.resolve():new Promise((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error(img.src));})))`);
    const integrationIcons = await run(`[...document.querySelectorAll('#navigation img.nav-icon')].map(img=>({file:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth,alt:img.alt,decorative:img.getAttribute('aria-hidden')}))`);
    assert.deepEqual(integrationIcons.map(icon=>icon.file),['assets/integrations/codex.png','assets/integrations/codex-dark.png','assets/integrations/zcode.png','assets/integrations/workbuddy.png']);
    assert(integrationIcons.every(icon=>icon.complete&&icon.width===64&&icon.alt===''&&icon.decorative==='true'),JSON.stringify(integrationIcons));
    for (const appearance of ['light','dark','light']) {
      await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)}`);
      assert.equal(await run("getComputedStyle(document.querySelector('.codex-light-icon')).display==='none'"),appearance==='dark');
      assert.equal(await run("getComputedStyle(document.querySelector('.codex-dark-icon')).display==='none'"),appearance!=='dark');
      assert.equal(await run("[...document.querySelectorAll('#navigation img.nav-icon')].filter(img=>getComputedStyle(img).display!=='none').every(img=>img.getBoundingClientRect().width===18&&img.getBoundingClientRect().height===18&&getComputedStyle(img).objectFit==='contain')"),true);
    }
    assert.equal(await run("document.getElementById('section-title').textContent"),'Codex','legacy API initialView maps to Codex');
    assert.equal(await run("document.querySelector('[data-settings-section=\"openai-api\"]')!==null"),true);

    assert.equal(await run("[...document.querySelectorAll('.nav-group')].find(n=>n.textContent.includes('快捷与常规')).querySelectorAll('button').length"), 2);
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click()");
    assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), ['启用联动', '任务提醒', '额度显示', '额度趣味互动', '额度与任务信息','OpenAI API']);
    assert.equal(await run(`document.querySelectorAll('[data-action="${taskId}"]').length`), 1);
    const outputDir = process.env.PET_SMOKE_ARTIFACT_DIR || '/tmp/qiuqiu-settings-preview'; fs.mkdirSync(outputDir, {recursive:true});
    const capture = async name => {
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await new Promise(resolve=>setTimeout(resolve,150));
      fs.writeFileSync(path.join(outputDir,name), (await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
    };
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const alignment = await run(`(() => { const status=document.querySelector('.codex-status'); return {title:status.querySelector('h4').getBoundingClientRect().x,row:document.querySelector('#content > section:last-child .row-title').getBoundingClientRect().x,field:status.querySelector('dt').getBoundingClientRect().x,tasks:status.querySelector('.status-tasks').getBoundingClientRect().x,valueAlign:getComputedStyle(status.querySelector('dd')).textAlign}; })()`);
    assert.equal(alignment.title, alignment.row); assert.equal(alignment.field, alignment.row); assert.equal(alignment.tasks, alignment.row); assert.equal(alignment.valueAlign,'left');
    await capture('codex.png');
    const content = await run("document.getElementById('content').textContent");
    for (const value of ['已连接','47.6%','处理中 2','待确认 1','打开任务','刷新状态']) assert(content.includes(value), value);
    assert(!content.includes('不应该逐条展示')); assert(!content.includes('当前不可用')); assert(!content.includes('检查更新'));
    await run(`document.querySelector('[data-action="${taskId}"]').click()`);
    await run('new Promise(resolve=>setTimeout(resolve,10))');
    await run(`document.querySelector('[data-action="${refreshId}"]').click()`);
    await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.deepEqual(await run('calls.map(call=>call.id)'), [taskId, refreshId]);
    await run("actMode='apply';document.querySelector('[data-action=\"/codex-menu/codex-quota-visible\"]').click()"); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("findEntry('/codex-menu/codex-enabled').checked"),true);
    assert.equal(await run("document.querySelectorAll('#content > section').length"),6,'hiding the card does not disable integration modules');
    assert.equal(await run("document.querySelector('.codex-status')!==null"),true);
    await run("document.querySelector('[data-action=\"/codex-menu/codex-quota-visible\"]').click();actMode='log'"); await run('new Promise(resolve=>setTimeout(resolve,10))');

    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click()");
    assert.equal(await run("document.getElementById('section-title').textContent"), 'Codex');
    assert.equal(await run("document.querySelector('[data-settings-section=\"openai-api\"] h3').textContent"),'OpenAI API');
    assert.match(await run("document.querySelector('[data-settings-section=\"openai-api\"] .group-intro').textContent"),/独立于 Codex.*单独计费/);
    await run(`document.querySelector('[data-settings-section="openai-api"]').scrollIntoView({block:'start'})`);
    await capture('api.png');
    await run(`document.querySelector('[data-action="/codex-menu/openai-api-menu/openai-api-usage"]').click()`);
    await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal((await run('calls.at(-1).id')), '/codex-menu/openai-api-menu/openai-api-usage');
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='ZCode 联动').click()");
    assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), ['启用联动', '额度显示', '额度趣味互动', '额度与任务信息']);
    assert.equal(await run("[...document.querySelectorAll('#content > section:first-child [data-action]')].every(n=>/zcode-enabled$/.test(n.dataset.action))"), true);
    assert.equal(await run("document.querySelectorAll('#content > section:last-child [data-action]').length"), 4);
    await capture('zcode.png');
    await run("snapshot.codexStatus.tasks={active:null,waiting:null};snapshot.codexStatus.quota=[];snapshot.codexStatus.updatedAt=null;window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,10))');
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click()");
    assert.equal(await run("document.querySelector('.status-tasks').textContent"), '本机最近任务 · 处理中 待更新 · 待确认 待更新');
    assert.equal(await run("document.querySelectorAll('.codex-status dd')[1].textContent"), '待更新');
    // Provider settings never reveal downstream controls before actual authorization.
    for (const [label,id] of [['Codex','/codex-menu/codex-enabled'],['ZCode 联动','/zcode-menu/zcode-enabled'],['WorkBuddy','/workbuddy-enabled']]) {
      await run(`[...document.querySelectorAll('#navigation button')].find(n=>n.textContent===${JSON.stringify(label)}).click();actMode='apply';`);
      if (await run(`findEntry(${JSON.stringify(id)}).checked===true`)) {
        await run(`document.querySelector('[data-action="${id}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      }
      assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), label==='Codex'?['启用联动','OpenAI API']:['启用联动']);
      assert.equal(await run("document.querySelectorAll('#content [data-action]').length"),label==='Codex'?3:1);
      assert.equal(await run("document.querySelector('.codex-status')===null"),true);
      await run(`actMode='defer';document.querySelector('[data-action="${id}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      assert.equal(await run(`document.querySelector('[data-action="${id}"]').getAttribute('aria-checked')`),'false');
      assert.equal(await run("document.querySelectorAll('#content > section').length"),label==='Codex'?2:1);
      assert.equal(await run(`document.querySelector('[data-action="${id}"]').disabled`),true);
      await run(`findEntry(${JSON.stringify(id)}).checked=true;resolveAction({snapshot});actMode='apply'`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      assert.equal(await run(`document.querySelector('[data-action="${id}"]').getAttribute('aria-checked')`),'true');
      assert(await run("document.querySelectorAll('#content > section').length>1"));
      if (label==='WorkBuddy') {
        assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), ['启用联动','积分卡显示','积分趣味互动']);
        for (const pref of ['quota-visible','quota-fun']) {
          await run(`actMode='apply';document.querySelector('[data-action="/workbuddy-${pref}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
          assert.equal(await run(`findEntry('/workbuddy-${pref}').checked`),false);
          assert.equal(await run("findEntry('/workbuddy-enabled').checked"),true);
        }
      }
      await run(`document.querySelector('[data-action="${id}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      await run(`actMode='reject';document.querySelector('[data-action="${id}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      assert.equal(await run(`document.querySelector('[data-action="${id}"]').getAttribute('aria-checked')`),'false');
      assert.equal(await run("document.querySelectorAll('#content > section').length"),label==='Codex'?2:1);
      assert.match(await run("document.getElementById('feedback').textContent"),/授权已取消/);
      await run(`actMode='throw';document.querySelector('[data-action="${id}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      assert.equal(await run(`document.querySelector('[data-action="${id}"]').getAttribute('aria-checked')`),'false');
      assert.equal(await run("document.querySelectorAll('#content > section').length"),label==='Codex'?2:1);
      assert.match(await run("document.getElementById('feedback').textContent"),/未完成/);

    }
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click();actMode='apply'");
    for (const expected of [true,false]) {
      await run(`document.querySelector('[data-action="/codex-menu/openai-api-menu/openai-api-visible"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      assert.equal(await run("findEntry('/codex-menu/openai-api-menu/openai-api-visible').checked"),expected);
      assert.equal(await run(`document.querySelector('[data-action="/codex-menu/openai-api-menu/openai-api-usage"]')!==null`),true,'connection remains discoverable with card off');
      assert.equal(await run("document.querySelectorAll('[data-settings-section=\"openai-api\"] [role=switch]').length"),1,'API has only a real card visibility switch');
    }
    await capture('api-disabled-connection-accessible.png');
    for (const view of ['api','openai-api','/codex-menu/openai-api-menu']) {
      await run(`navigate(${JSON.stringify(view)})`);
      assert.equal(await run("document.getElementById('section-title').textContent"),'Codex');
      assert.equal(await run("document.querySelector('[data-settings-section=\"openai-api\"]')!==null"),true);
    }
    await run("document.getElementById('search-toggle').click();document.getElementById('search').value='OpenAI API';document.getElementById('search').dispatchEvent(new Event('input'))");
    assert.equal(await run("document.querySelector('[data-settings-section=\"openai-api\"] [data-action]')!==null"),true,'API remains searchable when Codex is off');
    await run("document.getElementById('search-toggle').click()");

    await run("document.getElementById('search-toggle').click();document.getElementById('search').value='额度';document.getElementById('search').dispatchEvent(new Event('input'))");
    assert.equal(await run(`document.querySelectorAll('#content [data-action^="/codex-menu/codex-"]:not([data-action$="-enabled"]),#content [data-action^="/zcode-menu/zcode-"]:not([data-action$="-enabled"])').length`),0,'search cannot expose disabled provider details');
    await run("document.getElementById('search-toggle').click();[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='球球与互动').click()");
    const interactionText=await run("document.getElementById('content').textContent");
    for(const label of ['咩咩互动','咩咩问好','开心回应','迈迈小蹄','暖暖打盹','揉揉耳朵','抱住小铃铛','慢半拍伸懒腰']) assert(!interactionText.includes(label),label+' should not appear in settings');
    for(const label of ['随机表情','立即睡眠','立即唤醒']) assert(interactionText.includes(label),label+' stays available');
    await run("document.getElementById('search-toggle').click();document.getElementById('search').value='咩咩';document.getElementById('search').dispatchEvent(new Event('input'))");
    assert.equal(await run("document.getElementById('content').textContent"),'','sheep-specific group is excluded from search');
    for(const query of ['开心回应','迈迈小蹄','暖暖打盹','揉揉耳朵','抱住小铃铛','慢半拍伸懒腰']) {
      await run(`document.getElementById('search').value=${JSON.stringify(query)};document.getElementById('search').dispatchEvent(new Event('input'))`);
      assert.equal(await run("document.getElementById('content').textContent"),'',query+' remains excluded from search');
    }
    assert.equal(await run("snapshot.entries.find(entry=>entry.label==='球球与互动').children.find(entry=>entry.label==='咩咩互动').children.length"),7,'source actions remain intact');
    await run("document.getElementById('search').value='随机表情';document.getElementById('search').dispatchEvent(new Event('input'))");
    assert.equal(await run("document.querySelectorAll('#content [data-action]').length"),1,'random expression stays searchable');
    await run("document.querySelector('#content [data-action]').click()"); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run('calls.at(-1).id'),`/${encodeURIComponent('球球与互动')}/${encodeURIComponent('随机表情')}`);
    win.destroy(); process.stdout.write('SETTINGS_DOM_OK\n'); app.exit(0);
  }).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
} else {
  require('node:test')('settings renderer splits providers and preserves summary actions in real Chromium DOM', { timeout: 30000 }, () => {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--settings-dom-child'], { encoding: 'utf8', timeout: 25000 });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /SETTINGS_DOM_OK/);
  });
}
