const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const toggle = { id: '/codex-menu/codex-enabled', label: '启用 Codex 联动', type: 'checkbox', checked: true, enabled: true, actionable: true };
const taskId = '/codex-menu/codex-tasks-open';
const refreshId = '/codex-menu/codex-status/codex-refresh';
const snapshot = { version: 'test', codexStatus: { enabled: true, connection: 'connected', quota: [{ label: '5小时', remaining: 47.6, resetsAt: 1800000000000 }], updatedAt: 1790000000000, tasks: { active: 2, waiting: 1 }, taskActionId: taskId }, entries: [
  { id: '/codex-menu', label: 'Codex 与 API', children: [toggle,
    { id: '/codex-menu/openai-api-menu', label: 'OpenAI API', children: [{ id: '/codex-menu/openai-api-menu/openai-api-usage', label: 'API 费用与用量', enabled: true, actionable: true }] },
    { id: '/codex-menu/codex-trend-open', label: '额度与趋势', enabled: true, actionable: true },
    { id: taskId, label: '打开 Codex 任务', enabled: true, actionable: true },
    { id: '/codex-menu/codex-status', label: 'Codex 状态', children: [
      { id: '/codex-menu/codex-status/codex-tasks', label: '任务列表', children: [{ id: '/task-secret', label: '不应该逐条展示的任务', enabled: true, actionable: true }] },
      { id: refreshId, label: '刷新状态（至少间隔10秒）', enabled: true, actionable: true },
      { id: '/disabled', label: '额度：已连接', enabled: false }
    ] }
  ] }, { id: '/zcode-menu', label: 'ZCode 联动', children: ['enabled','quota-visible','quota-size','quota-fun','quota-detail','trend','tasks','refresh'].map(kind => ({ id: `/zcode-menu/zcode-${kind}`, label: ({enabled:'启用 ZCode 联动','quota-visible':'显示 ZCode 额度','quota-size':'额度卡片大小','quota-fun':'额度趣味互动','quota-detail':'额度明细',trend:'额度趋势',tasks:'进行中任务',refresh:'刷新 ZCode 状态'})[kind], enabled: true, actionable: true, checked:true, type: ['enabled','quota-visible','quota-fun'].includes(kind) ? 'checkbox' : 'normal', ...(kind === 'quota-size' ? {children:['standard','compact'].map(size=>({id:`/zcode-menu/zcode-quota-size/zcode-size-${size}`,label:size==='standard'?'标准':'小巧',enabled:true,actionable:true,type:'radio',checked:size==='compact'}))} : {}) })) }, { id: '/general', label: '常规设置', children: [] }, { id: '/workbuddy-enabled', label: '启用 WorkBuddy 联动', enabled: true, actionable: true, type: 'checkbox' }
] };

if (process.versions.electron && process.argv.includes('--settings-dom-child')) {
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1080, height: 820, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    const sourceRoot = process.env.PET_SETTINGS_SOURCE_ROOT || path.resolve(__dirname, '../..');
    await win.loadFile(path.join(sourceRoot, 'desktop-pet/global-settings.html'));
    const run = code => win.webContents.executeJavaScript(code);
    await run(`window.calls=[];window.snapshot=${JSON.stringify(snapshot)};window.EmotionBall ||= {config:{get:()=>({raw:{}}),register(){}},create:()=>({destroy(){}})};window.qiuqiuSettings={get:async()=>window.snapshot,act:async(id,checked)=>{calls.push({id,checked});return {snapshot:window.snapshot}},onNavigate(){}};true;`);
    await run("document.getElementById('brand-pet').replaceChildren()");
    await run(fs.readFileSync(path.join(sourceRoot, 'desktop-pet/global-settings-renderer.js'), 'utf8'));
    await run('new Promise(resolve=>setTimeout(resolve,20))');
    const nav = await run("[...document.querySelectorAll('#navigation button')].map(n=>n.textContent)");
    for (const name of ['Codex','API','WorkBuddy','快捷键','常规设置']) assert(nav.includes(name), name);
    assert(!nav.includes('API 费用与用量')); assert(!nav.includes('Codex 与 API'));
    assert.equal(await run("[...document.querySelectorAll('.nav-group')].find(n=>n.textContent.includes('快捷与常规')).querySelectorAll('button').length"), 2);
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click()");
    assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), ['额度展示设置', '额度与任务']);
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
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='API').click()");
    assert.equal(await run("document.getElementById('section-title').textContent"), 'API');
    await capture('api.png');
    await run("document.querySelector('#content button.action').click()");
    await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal((await run('calls.at(-1).id')), '/codex-menu/openai-api-menu/openai-api-usage');
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='ZCode 联动').click()");
    assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), ['额度展示设置', '额度与任务']);
    assert.equal(await run("[...document.querySelectorAll('#content > section:first-child [data-action]')].every(n=>/zcode-(enabled|quota-visible|quota-size|quota-fun)$/.test(n.dataset.action))"), true);
    assert.equal(await run("document.querySelectorAll('#content > section:last-child [data-action]').length"), 4);
    await capture('zcode.png');
    await run("snapshot.codexStatus.tasks={active:null,waiting:null};snapshot.codexStatus.quota=[];snapshot.codexStatus.updatedAt=null;window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,10))');
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click()");
    assert.equal(await run("document.querySelector('.status-tasks').textContent"), '本机最近任务 · 处理中 待更新 · 待确认 待更新');
    assert.equal(await run("document.querySelectorAll('.codex-status dd')[1].textContent"), '待更新');
    win.destroy(); process.stdout.write('SETTINGS_DOM_OK\n'); app.exit(0);
  }).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
} else {
  require('node:test')('settings renderer splits providers and preserves summary actions in real Chromium DOM', { timeout: 30000 }, () => {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--settings-dom-child'], { encoding: 'utf8', timeout: 25000 });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /SETTINGS_DOM_OK/);
  });
}
