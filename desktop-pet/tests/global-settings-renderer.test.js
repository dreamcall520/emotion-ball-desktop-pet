const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const toggle = { id: '/codex-menu/codex-enabled', label: '启用 Codex 联动', type: 'checkbox', checked: true, enabled: true, actionable: true };
const taskId = '/codex-menu/codex-tasks-open';
const refreshId = '/codex-menu/codex-status/codex-refresh';
const snapshot = { quotaCards:{order:['codex','api','zcode','workbuddy','balance','weather'],pinned:[]}, version: 'test', initialView:'openai-api', codexStatus: { enabled: true, connection: 'connected', quota: [{ label: '5小时', remaining: 47.6, resetsAt: 1800000000000 }], updatedAt: 1790000000000, tasks: { active: 2, waiting: 1 }, taskActionId: taskId }, entries: [
  {id:'/weather-enabled',label:'启用天气',enabled:true,actionable:true,type:'checkbox',checked:false},
  {id:'/weather-visible',label:'显示天气卡',enabled:true,actionable:true,type:'checkbox',checked:true},
  {id:'/weather-open',label:'天气与城市设置',enabled:true,actionable:true,type:'normal'},
  { id: `/${encodeURIComponent('球球与互动')}`, label: '球球与互动', children: [
    ...['随机表情','立即睡眠','立即唤醒'].map(label=>({id:`/${encodeURIComponent('球球与互动')}/${encodeURIComponent(label)}`,label,enabled:true,actionable:true})),
    {id:`/${encodeURIComponent('球球与互动')}/${encodeURIComponent('咩咩互动')}`,label:'咩咩互动',children:['咩咩问好','开心回应','迈迈小蹄','暖暖打盹','揉揉耳朵','抱住小铃铛','慢半拍伸懒腰'].map(label=>({id:`/sheep/${encodeURIComponent(label)}`,label,enabled:true,actionable:true}))}
  ] },
  {id:'/edge',label:'贴边与显示',children:[]},
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
  {id:'/workbuddy-quota-fun',label:'WorkBuddy 积分趣味游戏',enabled:true,actionable:true,type:'checkbox',checked:true},
  {id:'/api-balance-menu',label:'API 余额',children:[
    {id:'/api-balance-menu/api-balance-enabled',label:'启用 API 余额监控',enabled:true,actionable:true,type:'checkbox',checked:false},
    {id:'/api-balance-menu/api-balance-visible',label:'显示 API 余额卡',enabled:false,actionable:true,type:'checkbox',checked:true},
    {id:'/api-balance-menu/api-balance-refresh',label:'刷新 API 余额',enabled:false,actionable:true,type:'normal'}
  ]}
] };

if (process.versions.electron && process.argv.includes('--settings-dom-child')) {
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1080, height: 820, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    const sourceRoot = process.env.PET_SETTINGS_SOURCE_ROOT || path.resolve(__dirname, '../..');
    await win.loadFile(path.join(sourceRoot, 'desktop-pet/global-settings.html'));
    const run = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { throw new Error('Renderer test step failed: '+code.slice(0,160), {cause:error}); } };
    async function loadRenderer() {
      // Initial-view cases reuse one document. Release the previous renderer
      // as a real navigation would, so its refresh cannot repaint this view.
      await run(`(() => {
        window.__settingsFixtureScope?.dispose();
        const listeners=[], intervals=new Set(), timeouts=new Set();
        const native={windowAdd:window.addEventListener,documentAdd:document.addEventListener,
          setInterval:window.setInterval,setTimeout:window.setTimeout};
        window.addEventListener=(type,listener,options)=>{listeners.push([window,type,listener,options]);return native.windowAdd.call(window,type,listener,options)};
        document.addEventListener=(type,listener,options)=>{listeners.push([document,type,listener,options]);return native.documentAdd.call(document,type,listener,options)};
        window.setInterval=(...args)=>{const id=native.setInterval.apply(window,args);intervals.add(id);return id};
        window.setTimeout=(...args)=>{const id=native.setTimeout.apply(window,args);timeouts.add(id);return id};
        window.__settingsFixtureScope={listeners,intervals,dispose(){
          window.addEventListener=native.windowAdd;document.addEventListener=native.documentAdd;
          window.setInterval=native.setInterval;window.setTimeout=native.setTimeout;
          for(const [target,type,listener]of listeners)if(target===window&&type==='pagehide')listener.call(window,new Event('pagehide'));
          for(const [target,type,listener,options]of listeners)target.removeEventListener(type,listener,options);
          for(const id of intervals)clearInterval(id);for(const id of timeouts)clearTimeout(id);
          listeners.length=0;intervals.clear();timeouts.clear();
        }};
      })()`);
      const rendererSource=fs.readFileSync(path.join(sourceRoot,'desktop-pet/global-settings-renderer.js'),'utf8');
      await run(rendererSource);
      assert.deepEqual(await run(`({focus:__settingsFixtureScope.listeners.filter(([target,type])=>target===window&&type==='focus').length,
        refreshIntervals:__settingsFixtureScope.intervals.size})`),{focus:1,refreshIntervals:1});
    }
    const connectedAlignments = [];
    const writeAlignmentReport = passed => {
      if (process.env.PET_SETTINGS_ALIGNMENT_REPORT) fs.writeFileSync(process.env.PET_SETTINGS_ALIGNMENT_REPORT, JSON.stringify({ passed,
        scope: 'Isolated hidden Chromium DOM; no actual MAS profile, account or model.', checks: connectedAlignments }, null, 2) + '\n');
    };
    async function verifyConnectedButtonAlignment(provider) {
      const appearance = await run('document.documentElement.dataset.appearance');
      for (const mode of ['light','dark']) for (const width of [720,840,1080]) {
        win.setSize(width,820);
        await run(`document.documentElement.dataset.appearance=${JSON.stringify(mode)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const value = await run(`(()=>{const button=document.querySelector('[data-action=store-${provider}-connection]');
          const references=${provider === 'workbuddy' ? "['store-workbuddy-tasks','store-workbuddy-notifications'].map(id=>document.querySelector('[data-action='+id+']'))" : "[...document.querySelectorAll('#content > section.group:not(:first-child) .row > button, #content > section.group:not(:first-child) .row > select')]"};
          const box=button.getBoundingClientRect(),row=button.closest('.row'),group=row.closest('.group'),tail=getComputedStyle(group,'::after'),outline=getComputedStyle(group,'::before'),next=group.nextElementSibling;
          return {right:box.right,referenceRights:references.filter(Boolean).map(node=>node.getBoundingClientRect().right),bubble:group.classList.contains('store-connected-group'),rowBackground:getComputedStyle(row).backgroundColor,parentBorderColor:getComputedStyle(group).borderBottomColor,outlineMask:outline.maskImage,outlinePointerEvents:outline.pointerEvents,
            tail:{content:tail.content,width:parseFloat(tail.width),height:parseFloat(tail.height),left:parseFloat(tail.left),clip:tail.clipPath,pointerEvents:tail.pointerEvents},gap:next?next.getBoundingClientRect().top-group.getBoundingClientRect().bottom:null,overflow:row.scrollWidth>row.clientWidth+1};})()`);
        const result = { provider, appearance: mode, width, ...value }; connectedAlignments.push(result); writeAlignmentReport(false);
        assert(value.referenceRights.length > 0, provider + ' needs a real following-module control');
        assert(value.referenceRights.every(right=>Math.abs(right-value.right)<=.5), JSON.stringify(result));
        assert(value.bubble && !value.overflow, 'the whole connected group is the parent bubble');
        assert.equal(value.rowBackground,'rgba(0, 0, 0, 0)','no nested row surface');
        assert.equal(value.parentBorderColor,'rgba(0, 0, 0, 0)','geometry retains a transparent border while the decorative outline can open at the tail');
        assert.notEqual(value.outlineMask,'none');assert.equal(value.outlinePointerEvents,'none');
        assert(value.tail.content!=='none'&&value.tail.clip!=='none'&&value.tail.width>0&&value.tail.width<=14&&value.tail.height<=14&&value.tail.left>=24&&value.tail.left<=40,'small left tail exists');
        assert.equal(value.tail.pointerEvents,'none');assert(value.gap>=value.tail.height+4,'tail leaves room before the next module');
        win.webContents.debugger.attach('1.3');
        try {
          await win.webContents.debugger.sendCommand('DOM.enable');
          await win.webContents.debugger.sendCommand('CSS.enable');
          const {root}=await win.webContents.debugger.sendCommand('DOM.getDocument');
          const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'.store-connected-row'});
          await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});
          assert.equal(await run("getComputedStyle(document.querySelector('.store-connected-row')).backgroundColor"),'rgba(0, 0, 0, 0)','hover does not restore a nested card');
          await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
        } finally { win.webContents.debugger.detach(); }
        if (process.env.PET_SETTINGS_ALIGNMENT_SCREENSHOT_DIR && width === 1080) {
          const directory=process.env.PET_SETTINGS_ALIGNMENT_SCREENSHOT_DIR;fs.mkdirSync(directory,{recursive:true});
          const bounds=await run("(()=>{const r=document.querySelector('#content').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width),height:Math.floor(Math.min(r.height,innerHeight-r.y))};})()");
          fs.writeFileSync(path.join(directory,provider+'-'+mode+'.png'),(await win.webContents.capturePage(bounds)).toPNG());
        }
      }
      await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)}`);
    }
    await run(`window.calls=[];window.snapshot=${JSON.stringify(snapshot)};window.EmotionBall ||= {config:{get:()=>({raw:{}}),register(){}},create:()=>({destroy(){}})};window.qiuqiuSettings={saveQuotaCards:async config=>{window.cardCalls||=[];cardCalls.push(config);if(window.cardFail)return {ok:false,config:window.snapshot.quotaCards,error:'保存失败'};window.snapshot.quotaCards=config;return {ok:true,config,snapshot:window.snapshot}},get:async()=>window.snapshot,act:async(id,checked)=>{calls.push({id,checked});if(window.actMode==='defer')return new Promise(resolve=>window.resolveAction=resolve);if(window.actMode==='throw')throw Error('保存失败');if(window.actMode==='reject')return {snapshot:window.snapshot,error:'授权已取消'};if(window.actMode==='apply')window.findEntry(id).checked=checked;return {snapshot:window.snapshot}},onNavigate:callback=>window.navigate=callback,onPetSleepState:callback=>{window.sleepStateChanged=callback;return()=>{}}};true;`);
    await run("document.getElementById('brand-pet').replaceChildren();window.findEntry=id=>{const walk=items=>items.flatMap(item=>[item,...(item.children?walk(item.children):[])]);return walk(snapshot.entries).find(item=>item.id===id)};true");
    await loadRenderer();
    await run('new Promise(resolve=>setTimeout(resolve,20))');
    const originalPalette = await run('({...document.documentElement.dataset})');
    const palettes = {};
    for (const mode of ['standard','accessible']) for (const appearance of ['light','dark']) for (const theme of ['green','blue','purple']) {
      palettes[`${mode}-${appearance}-${theme}`] = await run(`(async () => {
        Object.assign(document.documentElement.dataset, {colorMode:${JSON.stringify(mode)},appearance:${JSON.stringify(appearance)},uiTheme:${JSON.stringify(theme)}});
        await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished));
        const style = selector => getComputedStyle(document.querySelector(selector));
        return {canvas:style('body').backgroundImage,title:style('h1').backgroundImage,brand:style('.brand strong').backgroundImage,
          nav:style('#navigation button').color,caption:style('.nav-group-title').color,
          petFilter:style('#brand-pet').filter,bodyFilter:style('body').filter};
      })()`);
    }
    assert(palettes['standard-light-green'].canvas.includes('rgb(217, 243, 232)'), 'mint light canvas uses mint wash');
    assert(palettes['standard-dark-green'].canvas.includes('rgb(33, 62, 53)'), 'mint dark canvas uses green wash');
    assert(palettes['standard-light-blue'].canvas.includes('rgb(213, 240, 255)'), 'blue canvas keeps its existing wash');
    assert(palettes['standard-dark-blue'].canvas.includes('rgb(36, 64, 84)'), 'blue dark canvas stays unchanged');
    assert(palettes['standard-light-purple'].canvas.includes('rgb(232, 220, 245)'), 'purple light canvas stays unchanged');
    assert(palettes['standard-dark-purple'].canvas.includes('rgb(59, 48, 78)'), 'purple dark canvas stays unchanged');
    for (const appearance of ['light','dark']) {
      const mint = palettes[`standard-${appearance}-green`], blue = palettes[`standard-${appearance}-blue`];
      for (const part of ['canvas','title','nav','caption']) assert.notEqual(mint[part],blue[part], `${appearance}: mint ${part} changes with theme`);
      assert.equal(mint.title,mint.brand,'page and brand titles share the mint palette');
      const accessible = palettes[`accessible-${appearance}-green`];
      for (const theme of ['blue','purple']) assert.deepEqual(accessible,palettes[`accessible-${appearance}-${theme}`], 'accessible visual priority is unchanged by theme');
      assert.equal(accessible.title,'none','accessible titles do not use a decorative gradient');
    }
    assert(Object.values(palettes).every(p=>p.bodyFilter==='none'&&p.petFilter===palettes['standard-light-blue'].petFilter),'theme never recolors the pet with a filter');
    await run(`Object.assign(document.documentElement.dataset,${JSON.stringify(originalPalette)});void 0`);
    await run(`window.measureIcon = img => {
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      const context=canvas.getContext('2d');context.drawImage(img,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      let left=canvas.width,top=canvas.height,right=-1,bottom=-1;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>=16){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
      const rect=img.getBoundingClientRect(),scale=Math.min(rect.width/canvas.width,rect.height/canvas.height);
      return {file:img.getAttribute('src'),frame:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},art:{left,top,right,bottom,width:(right-left+1)*scale,height:(bottom-top+1)*scale}};
    };void 0`);
    if(process.env.PET_SETTINGS_MEASUREMENTS)process.stdout.write('NAV_ART_BASELINE '+JSON.stringify(await run(`[...document.querySelectorAll('#navigation img.nav-icon')].filter(img=>getComputedStyle(img).display!=='none').map(measureIcon)`))+'\n');

    const nav = await run("[...document.querySelectorAll('#navigation button')].map(n=>n.textContent)");
    for (const name of ['Codex','WorkBuddy','API 余额','快捷键','常规设置']) assert(nav.includes(name), name);
    assert(!nav.includes('OpenAI API')); assert(!nav.includes('API 费用与用量')); assert(!nav.includes('Codex 与 API'));
    await run(`Promise.all([...document.querySelectorAll('#navigation img.nav-icon')].map(img=>img.complete?Promise.resolve():new Promise((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error(img.src));})))`);
    const integrationIcons = await run(`[...document.querySelectorAll('#navigation img.nav-icon')].map(img=>({file:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth,alt:img.alt,decorative:img.getAttribute('aria-hidden')}))`);
    assert.deepEqual(integrationIcons.map(icon=>icon.file),['assets/integrations/codex.png','assets/integrations/codex-dark.png','assets/integrations/zcode.png','assets/integrations/workbuddy.png']);
    assert(integrationIcons.every(icon=>icon.complete&&icon.width===256&&icon.alt===''&&icon.decorative==='true'),JSON.stringify(integrationIcons));
    for (const appearance of ['light','dark','light']) {
      await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)}`);
      assert.equal(await run("getComputedStyle(document.querySelector('.codex-light-icon')).display==='none'"),appearance==='dark');
      assert.equal(await run("getComputedStyle(document.querySelector('.codex-dark-icon')).display==='none'"),appearance!=='dark');
      assert.equal(await run("[...document.querySelectorAll('#navigation img.nav-icon')].filter(img=>getComputedStyle(img).display!=='none').every(img=>img.getBoundingClientRect().width===18&&img.getBoundingClientRect().height===18&&getComputedStyle(img).objectFit==='contain')"),true);
    }

    for (const [preference,light,dark] of [['app-default','codex-default','codex-default'],['codex-system','codex','codex-dark'],['space-system','codex-space','codex-space-dark']])
      for(const systemDark of [false,true]) for(const appearance of ['light','dark']) {
        await run(`snapshot.codexIconPreference=${JSON.stringify(preference)};snapshot.codexIconDark=${systemDark};document.documentElement.dataset.appearance=${JSON.stringify(appearance)};window.dispatchEvent(new Event('focus'))`);
        await run('new Promise(resolve=>setTimeout(resolve,10))');
        const icons=await run("[...document.querySelectorAll('#navigation button[data-view=\"/codex-menu\"] img')].map(img=>img.getAttribute('src'))");
        assert.deepEqual(icons,Array(2).fill(`assets/integrations/${systemDark?dark:light}.png`),'Codex actual icon remains independent of Qiuqiu theme');
      }
    await run("snapshot.codexIconPreference='https://example.com/secret.png';snapshot.codexIconDark=false;window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("document.querySelector('.codex-light-icon').getAttribute('src')"),'assets/integrations/codex.png');
    await run("snapshot.codexIconPreference='app-default';window.dispatchEvent(new Event('focus'))");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("document.getElementById('section-title').textContent"),'Codex','legacy API initialView maps to Codex');
    assert.equal(await run("document.querySelector('[data-settings-section=\"openai-api\"]')!==null"),true);
    assert.deepEqual(await run("[...document.querySelectorAll('[role=tab]')].map(n=>[n.textContent,n.getAttribute('aria-selected')])"),[['Codex','false'],['OpenAI API','true']]);
    await run("document.querySelector('[data-codex-tab=api]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))");
    assert.equal(await run("document.querySelector('[data-settings-section=\"openai-api\"]')===null"),true,'Codex tab hides independent API controls');
    assert.equal(await run("document.querySelector('.codex-status')!==null"),true);
    await run("document.querySelector('[data-codex-tab=codex]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
    assert.equal(await run("document.activeElement.dataset.codexTab"),'api');

    assert.equal(await run("[...document.querySelectorAll('.nav-group')].find(n=>n.textContent.includes('快捷与常规')).querySelectorAll('button').length"), 3);
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click()");
    assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), ['启用联动', '任务提醒', '额度显示', '额度趣味互动', '额度与任务信息']);
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
    assert.equal(await run("document.querySelectorAll('#content > section').length"),5,'hiding the card does not disable integration modules');
    assert.equal(await run("document.querySelector('.codex-status')!==null"),true);
    await run("document.querySelector('[data-action=\"/codex-menu/codex-quota-visible\"]').click();actMode='log'"); await run('new Promise(resolve=>setTimeout(resolve,10))');

    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click()");
    assert.equal(await run("document.getElementById('section-title').textContent"), 'Codex');
    await run("document.querySelector('[data-codex-tab=api]').click()");
    assert.equal(await run("document.querySelector('.codex-status')===null"),true,'API tab does not stack Codex settings');
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
      assert.deepEqual(await run("[...document.querySelectorAll('#content > section > h3')].map(n=>n.textContent)"), ['启用联动']);
      assert.equal(await run("document.querySelectorAll('#content [data-action]').length"),1);
      assert.equal(await run("document.querySelector('.codex-status')===null"),true);
      await run(`actMode='defer';document.querySelector('[data-action="${id}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      assert.equal(await run(`document.querySelector('[data-action="${id}"]').getAttribute('aria-checked')`),'false');
      assert.equal(await run("document.querySelectorAll('#content > section').length"),1);
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
      assert.equal(await run("document.querySelectorAll('#content > section').length"),1);
      assert.match(await run("document.getElementById('feedback').textContent"),/授权已取消/);
      await run(`actMode='throw';document.querySelector('[data-action="${id}"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
      assert.equal(await run(`document.querySelector('[data-action="${id}"]').getAttribute('aria-checked')`),'false');
      assert.equal(await run("document.querySelectorAll('#content > section').length"),1);
      assert.match(await run("document.getElementById('feedback').textContent"),/未完成/);

    }
    await run("[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='Codex').click();actMode='apply'");
    await run("document.querySelector('[data-codex-tab=api]').click()");
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
    assert.equal(await run("document.querySelector('[data-pet-sleep-state]').textContent"),'状态待更新');
    await run("sleepStateChanged('sleep')");
    assert.equal(await run("document.querySelector('[data-pet-sleep-state]').textContent"),'当前：睡眠');
    assert.equal(await run("document.querySelector('[data-pet-sleep-state]').getAttribute('role')"),'status');
    await run("sleepStateChanged('awake')");
    assert.equal(await run("document.querySelector('[data-pet-sleep-state]').textContent"),'当前：清醒');
    await run("window.actMode='reject';[...document.querySelectorAll('#content button')].find(e=>e.getAttribute('aria-label')==='立即睡眠').click()");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("document.querySelector('[data-pet-sleep-state]').textContent"),'当前：清醒','a click cannot fabricate a sleeping state');
    await run("window.actMode='defer';window.oldSleepSnapshot=structuredClone(window.snapshot);[...document.querySelectorAll('#content button')].find(e=>e.getAttribute('aria-label')==='立即睡眠').click();sleepStateChanged('sleep');window.resolveAction({snapshot:window.oldSleepSnapshot})");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("document.querySelector('[data-pet-sleep-state]').textContent"),'当前：睡眠','late action snapshot must not overwrite a real status push');
    await run("window.actMode='reject';window.originalGet=qiuqiuSettings.get;qiuqiuSettings.get=()=>new Promise(resolve=>window.resolveGet=resolve);window.dispatchEvent(new Event('focus'));sleepStateChanged('awake');resolveGet({...window.snapshot,petSleepState:'sleep'});qiuqiuSettings.get=originalGet;void 0");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("document.querySelector('[data-pet-sleep-state]').textContent"),'当前：清醒','late polling snapshot must not overwrite the newer push');
    await run("sleepStateChanged('sleep');document.documentElement.dataset.appearance='dark'");
    assert.equal(await run("(()=>{const e=document.querySelector('[data-pet-sleep-state]'),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.scrollWidth<=e.clientWidth+1})()"),true);

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
    await run("[...document.querySelectorAll('#navigation button')].find(e=>e.textContent==='联动样式管理').click()");
    assert.deepEqual(await run("[...document.querySelectorAll('[data-quota-card]')].map(e=>e.dataset.quotaCard)"),['codex','api','zcode','workbuddy','balance','weather']);
    assert.equal(await run("document.querySelector('#content > section').dataset.settingsSection"),'quota-cards','card management is the first section');
    await run("document.querySelector('main').scrollTop=500;navigate('quota-cards')");
    assert.equal(await run("document.querySelector('#navigation [aria-current=page]').textContent"),'联动样式管理');
    assert.equal(await run("document.querySelector('main').scrollTop"),0,'right-click navigation opens card management at the top');
    await run("findEntry('/workbuddy-quota-visible').enabled=false;navigate('quota-cards')");
    assert.equal(await run("document.querySelector('[aria-label=WorkBuddy显示额度卡]').disabled"),true,'visibility keeps source action eligibility');
    assert.equal(await run("document.querySelector('[aria-label=\"API 余额显示额度卡\"]').disabled"),true,'余额监控关闭时不能从卡片设置绕过启用');
    assert.match(await run("document.querySelector('[aria-label=WorkBuddy显示额度卡]').parentElement.title"),/先开启/);
    for (const [name,id] of [['Codex','/codex-menu/codex-quota-visible'],['OpenAI API','/codex-menu/openai-api-menu/openai-api-visible'],['ZCode','/zcode-menu/zcode-quota-visible'],['WorkBuddy','/workbuddy-quota-visible'],['API 余额','/api-balance-menu/api-balance-visible']]) {
      const control=await run(`(()=>{const e=[...document.querySelectorAll('.quota-card-settings input')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(name+'显示额度卡')});return {id:e.dataset.action,checked:e.checked}})()`);
      assert.equal(control.id,id);assert.equal(control.checked,await run(`findEntry(${JSON.stringify(id)}).checked`));
    }
    const apiVisibleBefore=await run("findEntry('/codex-menu/openai-api-menu/openai-api-visible').checked");
    await run(`window.actMode='apply';document.querySelector('[aria-label="OpenAI API显示额度卡"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("findEntry('/codex-menu/openai-api-menu/openai-api-visible').checked"),!apiVisibleBefore);
    assert.deepEqual(await run('window.snapshot.quotaCards.pinned'),[],'visibility cannot overwrite pin config');
    await run(`window.actMode='throw';document.querySelector('[aria-label="OpenAI API显示额度卡"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("document.querySelector('[aria-label=\"OpenAI API显示额度卡\"]').checked"),!apiVisibleBefore,'failed display save restores snapshot state');
    await run(`window.actMode='apply';navigate('api');document.querySelector('[data-action="/codex-menu/openai-api-menu/openai-api-visible"]').click()`); await run('new Promise(resolve=>setTimeout(resolve,10))');
    await run("navigate('quota-cards')");
    assert.equal(await run("document.querySelector('[aria-label=\"OpenAI API显示额度卡\"]').checked"),apiVisibleBefore,'provider page and management share the same setting');


    assert.equal(await run("document.querySelector('[aria-label=Codex上移]').disabled"),true);
    await run("document.querySelector('[aria-label=Codex下移]').click()"); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.deepEqual(await run('cardCalls.at(-1).order'),['api','codex','zcode','workbuddy','balance','weather']);
    await run("document.querySelector('[aria-label=WorkBuddy固定展示]').click()"); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.deepEqual(await run('cardCalls.at(-1).pinned'),['workbuddy']);
    assert.equal(await run("document.querySelector('[aria-label=WorkBuddy固定展示]').checked"),true);
    await run("window.cardFail=true;document.querySelector('[aria-label=WorkBuddy固定展示]').click()"); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("document.querySelector('[aria-label=WorkBuddy固定展示]').checked"),true,'failed save restores real config');
    assert.match(await run("document.getElementById('feedback').textContent"),/保存失败/);
    await run("window.dragCard=(source,target)=>{const from=document.querySelector('[data-quota-card='+source+']'),to=document.querySelector('[data-quota-card='+target+']'),dataTransfer=new DataTransfer();from.querySelector('.quota-card-drag-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));};window.cardFail=false;dragCard('workbuddy','api');void 0"); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.deepEqual(await run("[...document.querySelectorAll('[data-quota-card]')].map(e=>e.dataset.quotaCard)"),['workbuddy','api','codex','zcode','balance','weather'],'drag updates persisted order');
    assert.deepEqual(await run('cardCalls.at(-1).pinned'),['workbuddy'],'drag keeps pinned config');
    await run("window.cardFail=true;dragCard('workbuddy','zcode')"); await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.deepEqual(await run("[...document.querySelectorAll('[data-quota-card]')].map(e=>e.dataset.quotaCard)"),['workbuddy','api','codex','zcode','balance','weather'],'failed drag save restores order');
    await run("window.cardFail=false;dragCard('balance','api')");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.deepEqual(await run("[...document.querySelectorAll('[data-quota-card]')].map(e=>e.dataset.quotaCard)"),['workbuddy','balance','api','codex','zcode','weather']);
    await run("document.querySelector('[aria-label=\"API 余额固定展示\"]').click()");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.deepEqual(await run('cardCalls.at(-1).pinned'),['workbuddy','balance'],'追加固定余额卡不重排原有固定项');
    assert.equal(await run("findEntry('/api-balance-menu/api-balance-enabled').checked"),false,'固定不隐式启用监控');
    assert.equal(await run("(()=>{const event=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()});document.querySelector('[data-quota-card=api] button').dispatchEvent(event);return event.defaultPrevented})()"),true,'buttons do not begin row dragging');
    assert.equal(await run("(()=>{const event=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()});document.querySelector('[data-quota-card=api] input').dispatchEvent(event);return event.defaultPrevented})()"),true,'pin checkbox does not begin dragging');
    assert.equal(await run("(()=>{const row=document.querySelector('[data-quota-card=api]');row.querySelector('input').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const event=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()});row.dispatchEvent(event);return event.defaultPrevented})()"),true,'native ancestor dragstart cannot bypass an interactive pointer origin');

    await run("document.documentElement.dataset.appearance='light'");
    assert.equal(await run("[...document.querySelectorAll('.quota-card-settings .row')].every(e=>{const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.right<=innerWidth})"),true,'card controls stay within the settings panel');

    win.setSize(740,820);await run('new Promise(resolve=>setTimeout(resolve,25))');
    assert.equal(await run("[...document.querySelectorAll('.quota-card-settings .row')].every(e=>e.scrollWidth<=e.clientWidth+1)"),true,'visibility and pin controls wrap inside narrow settings');
    await run("window.snapshot.initialView='quota-cards';window.snapshot.version='initial-alias-test'");
    await loadRenderer();
    await run('new Promise(resolve=>setTimeout(resolve,20))');
    assert.equal(await run("document.querySelector('#navigation [aria-current=page]').textContent"),'联动样式管理','initialView alias opens the real edge category');
    assert.equal(await run("document.querySelector('#content > section').dataset.settingsSection"),'quota-cards');
    await run("navigate('/api-balance-menu')");
    assert.equal(await run("document.querySelector('#navigation [aria-current=page]').textContent"),'API 余额');
    assert.equal(await run("document.querySelector('[data-action=\"/api-balance-menu/api-balance-enabled\"]')!==null"),true);
    await run("window.snapshot.initialView='/api-balance-menu';window.snapshot.version='balance-initial-view'");
    await loadRenderer();
    await run('new Promise(resolve=>setTimeout(resolve,20))');
    assert.equal(await run("document.querySelector('#navigation [aria-current=page]').textContent"),'API 余额');
    await run("navigate('quota-cards');window.actMode='apply'");
    assert.equal(await run("document.querySelector('[data-quota-card=weather] [aria-label=显示天气卡]').checked"),true);
    assert.equal(await run("document.querySelector('[data-quota-card=weather] [aria-label=启用天气]')"),null);
    assert.equal(await run("document.querySelector('[data-quota-card=weather] [aria-label=天气与城市设置]')"),null);
    assert.equal(await run("document.querySelectorAll('[data-quota-card=weather] input').length"),2,'weather card management contains display and pin only');
    assert.equal(await run("document.querySelector('#navigation [data-view=weather-settings]').closest('[role=group]').getAttribute('aria-label')"),'应用与联动');
    await run("document.querySelector('#navigation [data-view=weather-settings]').click()");
    assert.equal(await run("document.querySelector('#navigation [aria-current=page]').textContent"),'天气');
    assert.equal(await run("document.querySelector('[aria-label=启用天气]').getAttribute('role')"),'switch');
    assert.equal(await run("document.querySelector('[aria-label=天气与城市设置]')"),null);
    await run("document.querySelector('[aria-label=启用天气]').click()");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("findEntry('/weather-enabled').checked"),true);
    await run("document.querySelector('[aria-label=天气与城市设置]').click()");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("calls.at(-1).id"),'/weather-open');
    await run("navigate('quota-cards')");
    await run("document.querySelector('[data-quota-card=weather] [aria-label=显示天气卡]').click()");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("findEntry('/weather-visible').checked"),false);
    await run("document.querySelector('[data-quota-card=weather] [aria-label=天气固定展示]').click()");await run('new Promise(resolve=>setTimeout(resolve,10))');
    assert.equal(await run("snapshot.quotaCards.pinned.includes('weather')"),true);
    assert.equal(await run("findEntry('/weather-visible').checked"),false,'pin weather cannot implicitly enable visibility');
    await run("snapshot.firstReleaseConnection={connected:true,chatReady:true,working:false};navigate('/codex-menu')");
    assert.equal(await run("document.querySelector('.store-codex-identity').textContent"),'本机 Codex已连接');
    assert.equal(await run("document.querySelector('[data-action=store-codex-connection]').closest('.row').classList.contains('store-connected-row')"),true);
    assert.equal(await run("document.querySelector('.store-connected-row').closest('.group').classList.contains('store-connected-group')"),true);
    await verifyConnectedButtonAlignment('codex');
    assert.deepEqual(await run("[...document.querySelectorAll('.store-codex-identity button')].map(e=>e.textContent)"), ['解除连接']);
    await run("navigate('codex-reconnect')");
    const consent = await run("document.querySelector('dialog[open]').textContent");
    assert.match(consent,/授权 Codex 联动.*查看额度.*发送消息.*OpenAI.*同意并连接/s);
    assert.equal(await run("document.querySelectorAll('dialog[open] .store-codex-terms dd').length"),2);
    assert.equal(await run("document.activeElement.textContent"),'取消');
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('dialog[open]')"),null);
    assert.equal(await run("document.querySelector('#content').textContent.includes('撤回聊天授权')"),false);
    await run("window.snapshot.firstReleaseConnection={connected:false,chatReady:false,working:false};window.snapshot.version='fresh-link';window.linkActions=[];window.qiuqiuSettings.codexConnection=async action=>{linkActions.push(action);return {status:'app-authorized'}};window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-action=store-codex-connection]').closest('.row').classList.contains('store-connected-row')"),false,'unconnected Codex keeps its original authorization surface');
    assert.equal(await run("document.querySelector('.store-connected-group')"),null);
    await run("document.querySelector('[data-action=store-codex-connection]').click()");
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    const directory = await run("document.querySelector('dialog[open]').textContent");
    assert.match(directory,/查看额度.*发送消息.*同意并选择目录/s);
    assert.equal(await run("document.querySelectorAll('.store-codex-terms > div:last-child dd p').length"),1);
    assert.match(directory,/问天气时可能含城市和天气摘要.*OpenAI.*账号额度/s);
    assert.deepEqual(await run("[...document.querySelectorAll('dialog[open] button')].map(button=>button.textContent)"),['取消','同意并选择目录']);
    assert.doesNotMatch(directory,/~\/\.codex|目录选项/);
    assert.equal(await run("document.querySelector('dialog[open]').scrollWidth <= document.querySelector('dialog[open]').clientWidth"),true);
    assert.equal(await run("[...document.querySelectorAll('.store-codex-terms > div')].every(group=>{const title=group.querySelector('dt').getBoundingClientRect(),body=group.querySelector('dd').getBoundingClientRect();return title.left===body.left&&title.bottom<=body.top})"),true);
    if (process.env.PET_SETTINGS_CONSENT_SCREENSHOT) {
      const rect = await run("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {x:Math.floor(r.x)-12,y:Math.floor(r.y)-12,width:Math.ceil(r.width)+24,height:Math.ceil(r.height)+24}})()");
      fs.writeFileSync(process.env.PET_SETTINGS_CONSENT_SCREENSHOT,(await win.webContents.capturePage(rect)).toPNG());
    }
    await run("window.qiuqiuSettings.codexConnection=async action=>{linkActions.push(action);return {status:'invalid-directory'}};document.querySelector('dialog[open] button[value=confirm]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.match(await run("document.querySelector('.store-codex-error').textContent"),/选错目录.*~\/\.codex/);
    await run("document.querySelector('.store-codex-error button').click()");
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.deepEqual(await run('linkActions'),['app','account','cancel']);
    await run("snapshot.firstReleaseWorkbuddyConnection={connected:false,enabled:false,status:'needs-authorization',message:'',tasks:{authorized:false,status:'needs-authorization',message:''}};snapshot.version='wb-link';window.wbLinkActions=[];window.qiuqiuSettings.workbuddyConnection=async action=>{wbLinkActions.push(action);return {status:action==='app'?'app-authorized':action==='account'?'stored':'ready'}};window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    await run("navigate('workbuddy-settings')");
    assert.equal(await run("document.querySelector('[data-workbuddy-tasks]')"),null,'task module stays hidden until the main connection is authorized');
    await run("snapshot.codexIconPreference='app-default';snapshot.version='wb-art';window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    await run(`Promise.all([...document.querySelectorAll('#navigation img.nav-icon')].map(img=>img.complete?Promise.resolve():new Promise(resolve=>img.onload=resolve)))`);
    for(const width of [720,840,1080]) {
      win.setSize(width,820);
      const icons=await run(`([...document.querySelectorAll('#navigation img.nav-icon')].filter(img=>getComputedStyle(img).display!=='none').map(measureIcon))`);
      const wb=icons.find(i=>i.file.endsWith('/workbuddy.png')),cx=icons.find(i=>i.file.endsWith('/codex-default.png'));
      assert.equal(wb.frame.width,cx.frame.width);assert.equal(wb.frame.height,cx.frame.height);assert.equal(wb.frame.x,cx.frame.x);
      assert(Math.abs(wb.art.width-cx.art.width)<.6&&Math.abs(wb.art.height-cx.art.height)<.6,'WorkBuddy and store Codex artwork have equal visual size at '+width+'px: '+JSON.stringify(icons));
      if(process.env.PET_SETTINGS_MEASUREMENTS)process.stdout.write('NAV_ART_STORE_'+width+' '+JSON.stringify(icons)+'\n');
    }

    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-connection]').textContent"),'连接');
    assert.doesNotMatch(await run("document.querySelector('#content').textContent"),/趣味|游戏/);
    await run("document.querySelector('[data-action=store-workbuddy-connection]').click()");
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/WorkBuddy/);
    const wbAppCopy = await run(`(()=>{const p=document.querySelector('dialog[open] #store-codex-dialog-copy p'),s=getComputedStyle(p);return {text:p.textContent,lines:p.getBoundingClientRect().height/parseFloat(s.lineHeight),overflow:p.scrollWidth>p.clientWidth,whiteSpace:s.whiteSpace};})()`);
    assert.equal(wbAppCopy.text,'使用本机 WorkBuddy 连接当前账号。');
    assert.equal(Math.round(wbAppCopy.lines),1,'WorkBuddy app authorization explanation stays on one natural line');
    assert.equal(wbAppCopy.overflow,false);assert.notEqual(wbAppCopy.whiteSpace,'nowrap');
    if(process.env.PET_SETTINGS_WORKBUDDY_PREVIEWS){await run('new Promise(resolve=>setTimeout(resolve,100))');fs.mkdirSync(process.env.PET_SETTINGS_WORKBUDDY_PREVIEWS,{recursive:true});const rect=await run("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {x:Math.floor(r.x)-12,y:Math.floor(r.y)-12,width:Math.ceil(r.width)+24,height:Math.ceil(r.height)+24}})()");fs.writeFileSync(path.join(process.env.PET_SETTINGS_WORKBUDDY_PREVIEWS,'workbuddy-app-authorization.png'),(await win.webContents.capturePage(rect)).toPNG());}
    for (const width of [720,840,1080]) {
      win.setSize(width,820);
      const lines=await run(`(()=>{const p=document.querySelector('dialog[open] #store-codex-dialog-copy p'),r=document.createRange();r.selectNodeContents(p);return [...r.getClientRects()].filter(rect=>rect.width>0).length;})()`);
      assert.equal(lines,1,'authorization app copy stays on a single line at '+width+'px');
    }


    await run("document.querySelector('dialog[open] button[value=confirm]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    const wbTerms=await run("document.querySelector('dialog[open]').textContent");
    assert.match(wbTerms,/授权 WorkBuddy 联动/);
    assert.deepEqual(await run("[...document.querySelectorAll('dialog[open] .store-codex-terms dt')].map(p=>p.textContent)"),['本机连接','聊天发送','动画提醒']);
    assert.deepEqual(await run("[...document.querySelectorAll('dialog[open] .store-codex-terms p')].map(p=>p.textContent)"),[
      '用所选应用和账号查询积分、消耗，并在球球中聊天。',
      '沿用本机登录，不复制或展示凭据，可随时断开。',
      '你发的消息和当前对话上下文交给 WorkBuddy 官方。',
      '问天气时可附城市和天气摘要，聊天会消耗积分。',
      '默认开启，安装前会选择目录并备份原设置。',
      '事件输入可能含正文，只在本机处理和过滤。',
      '仅向本机球球传任务标识和阶段，不传正文。'
    ]);
    const consentLayouts=[],consentAppearance=await run('document.documentElement.dataset.appearance');
    for(const appearance of ['light','dark']) for(const width of [720,840,1080]) {
      win.setSize(width,820);
      await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const layout=await run(`(()=>{const dialog=document.querySelector('dialog[open]'),r=dialog.getBoundingClientRect(),buttons=[...dialog.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};});return {dialog:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},groups:dialog.querySelectorAll('.store-codex-terms > div').length,overflow:dialog.scrollWidth>dialog.clientWidth||dialog.scrollHeight>dialog.clientHeight,buttons,paragraphs:[...dialog.querySelectorAll('.store-codex-terms p')].map(p=>{const range=document.createRange();range.selectNodeContents(p);const style=getComputedStyle(p);return {text:p.textContent,lines:[...range.getClientRects()].filter(rect=>rect.width>0).length,overflow:p.scrollWidth>p.clientWidth,whiteSpace:style.whiteSpace,color:style.color};})};})()`);
      assert.equal(layout.groups,3);assert.equal(layout.paragraphs.length,7);
      assert(layout.dialog.height<450,'merged consent is substantially shorter than the former 609px dialog');
      assert(layout.paragraphs.every(p=>p.lines===1&&!p.overflow&&p.whiteSpace!=='nowrap'),'each concise WorkBuddy authorization item fits naturally at '+width+'px '+appearance+': '+JSON.stringify(layout.paragraphs));
      assert(!layout.overflow&&layout.dialog.x>=0&&layout.dialog.y>=0&&layout.dialog.x+layout.dialog.width<=layout.viewport.width&&layout.dialog.y+layout.dialog.height<=layout.viewport.height,'consent stays inside the unchanged window: '+JSON.stringify(layout));
      assert(layout.buttons.every(b=>b.top>=layout.dialog.y&&b.bottom<=layout.dialog.y+layout.dialog.height&&b.left>=layout.dialog.x&&b.right<=layout.dialog.x+layout.dialog.width),'both authorization actions stay visible');
      consentLayouts.push({appearance,width,...layout});
      if(process.env.PET_SETTINGS_WORKBUDDY_PREVIEWS){const directory=process.env.PET_SETTINGS_WORKBUDDY_PREVIEWS;fs.mkdirSync(directory,{recursive:true});const r=layout.dialog;fs.writeFileSync(path.join(directory,'workbuddy-main-terms-'+appearance+'-'+width+'.png'),(await win.webContents.capturePage({x:Math.floor(r.x)-12,y:Math.floor(r.y)-12,width:Math.ceil(r.width)+24,height:Math.ceil(r.height)+24},{stayHidden:true})).toPNG());}
    }
    if(process.env.PET_SETTINGS_WORKBUDDY_CONSENT_REPORT)fs.writeFileSync(process.env.PET_SETTINGS_WORKBUDDY_CONSENT_REPORT,JSON.stringify({passed:true,scope:'Isolated hidden Chromium DOM; no actual MAS profile, account or model.',checks:consentLayouts},null,2)+'\n');
    await run(`document.documentElement.dataset.appearance=${JSON.stringify(consentAppearance)}`);

    if(process.env.PET_SETTINGS_WORKBUDDY_PREVIEWS){await run('new Promise(resolve=>setTimeout(resolve,100))');const rect=await run("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {x:Math.floor(r.x)-12,y:Math.floor(r.y)-12,width:Math.ceil(r.width)+24,height:Math.ceil(r.height)+24}})()");fs.writeFileSync(path.join(process.env.PET_SETTINGS_WORKBUDDY_PREVIEWS,'workbuddy-account-authorization.png'),(await win.webContents.capturePage(rect)).toPNG());}
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.deepEqual(await run('wbLinkActions'),['app','cancel']);
    await run("window.qiuqiuSettings.workbuddyConnection=async action=>{wbLinkActions.push(action);return {status:action==='app'?'app-authorized':action==='account'?'invalid-directory':'cancelled'}};document.querySelector('[data-action=store-workbuddy-connection]').click()");
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.match(await run("document.querySelector('.store-codex-error').textContent"),/请选择 WorkBuddy 账号目录/);
    await run("window.qiuqiuSettings.workbuddyConnection=async action=>{wbLinkActions.push(action);if(action==='connect')snapshot.firstReleaseWorkbuddyConnection={connected:true,enabled:true,status:'connecting',message:'已连接，正在查询积分余额…',chat:{enabled:true,authorized:true,status:'ready',message:''}};return {status:action==='account'?'stored':action==='disconnect'?'disconnected':'connecting',snapshot}};document.querySelector('.store-codex-error button').click()");
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.deepEqual(await run('wbLinkActions'),['app','cancel','app','account','account','connect']);
    assert.equal(await run("document.querySelector('.store-codex-error')"),null,'accepted background quota query is not a connection failure');
    await run("snapshot.firstReleaseWorkbuddyConnection={connected:true,enabled:true,status:'error',message:'请在 WorkBuddy 中重新登录',chat:{enabled:true,authorized:true,status:'ready',message:''}};snapshot.version='wb-login-error';window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.match(await run("document.querySelector('#content').textContent"),/请在 WorkBuddy 中重新登录/);
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-retry]').textContent"),'重试连接');
    await run("document.querySelector('[data-action=store-workbuddy-retry]').click()");
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.enabled'),true,'cancelling retry preserves the existing grant');


    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-connection]').textContent"),'解除连接');
    assert.equal(await run("document.querySelector('[data-action=\"/workbuddy-quota-visible\"]')!==null"),true);
    assert.doesNotMatch(await run("document.querySelector('#content').textContent"),/趣味|游戏/);
    await run("snapshot.firstReleaseWorkbuddyConnection.tasks={status:'needs-authorization',message:'尚未授权任务同步',authorized:false};snapshot.version='wb-task-access';window.dispatchEvent(new Event('focus'))");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-tasks]').textContent"),'授权任务');
    assert.match(await run("document.querySelector('[data-workbuddy-tasks]').textContent"),/查看 WorkBuddy 任务和未读结果。/);
    assert.match(await run("document.querySelector('[data-workbuddy-tasks]').textContent"),/只看任务名称、状态和是否已读，不读取聊天内容。/);
    assert.equal(await run("[...document.querySelectorAll('[data-workbuddy-tasks] p')].every(p=>p.className==='description'&&parseFloat(getComputedStyle(p).marginLeft)===0)"),true,'task purpose and read scope use the shared left-aligned hint style');
    await run("document.querySelector('[data-action=store-workbuddy-tasks]').click()");
    const taskTerms=await run("document.querySelector('dialog[open]').textContent");assert.match(taskTerms,/标题.*状态.*未读.*不读取正文/s);
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("wbLinkActions.includes('tasks-authorize')"),false);assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.enabled'),true);
    await run("window.qiuqiuSettings.workbuddyConnection=async action=>{wbLinkActions.push(action);if(action==='tasks-authorize')snapshot.firstReleaseWorkbuddyConnection.tasks={status:'authorized',message:'已授权任务同步',authorized:true};if(action==='tasks-revoke')snapshot.firstReleaseWorkbuddyConnection.tasks={status:'needs-authorization',message:'尚未授权任务同步',authorized:false};return {status:'ready',snapshot}};document.querySelector('[data-action=store-workbuddy-tasks]').click()");
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-tasks]').textContent"),'撤销授权');
    assert.match(await run("document.querySelector('[data-workbuddy-tasks]').textContent"),/已授权/);
    assert.deepEqual(await run("[...document.querySelectorAll('#content > section.group')].map(section=>section.querySelector('h3').textContent)"),['启用联动','任务同步','积分卡显示']);
    assert.equal(await run("document.querySelector('[data-workbuddy-tasks]').parentElement.id"),'content');
    assert.equal(await run("document.querySelector('[data-workbuddy-tasks]').tagName"),'SECTION');
    assert.equal(await run("document.querySelector('[data-workbuddy-tasks]').textContent.split('任务同步').length-1"),1,'task module has one heading without a duplicate row title');
    assert.doesNotMatch(await run("document.querySelector('#content > section.group').textContent"),/任务同步|未读标记|撤销授权/);
    for(const width of [720,840,1080]) {
      win.setSize(width,820);
      const layout=await run(`([...document.querySelectorAll('#content > section.group')].map(section=>{const r=section.getBoundingClientRect(),style=getComputedStyle(section);return {title:section.querySelector('h3').textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,borderRadius:style.borderRadius,background:style.backgroundImage,overflow:section.scrollWidth>r.width};}))`);
      assert(layout.every(row=>!row.overflow&&Math.abs(row.left-layout[0].left)<.1&&Math.abs(row.right-layout[0].right)<.1&&row.borderRadius===layout[0].borderRadius&&row.background===layout[0].background),'separate task module shares the existing surface frame at '+width+'px: '+JSON.stringify(layout));
      assert(layout[0].bottom<layout[1].top&&layout[1].bottom<layout[2].top,'task module sits between connection and card visibility at '+width+'px');
      if(process.env.PET_SETTINGS_TASK_MODULE_PREVIEWS){
        await run("snapshot.firstReleaseWorkbuddyConnection.status='ready';snapshot.firstReleaseWorkbuddyConnection.message='';snapshot.version='wb-task-module-preview';window.dispatchEvent(new Event('focus'))");
        await run('new Promise(resolve=>setTimeout(resolve,100))');
        fs.mkdirSync(process.env.PET_SETTINGS_TASK_MODULE_PREVIEWS,{recursive:true});
        const rect=await run("(()=>{const rows=[...document.querySelectorAll('#content > section.group')].map(row=>row.getBoundingClientRect());return {x:Math.floor(rows[0].left)-8,y:Math.floor(rows[0].top)-8,width:Math.ceil(rows[0].width)+16,height:Math.ceil(rows.at(-1).bottom-rows[0].top)+16}})()");
        fs.writeFileSync(path.join(process.env.PET_SETTINGS_TASK_MODULE_PREVIEWS,'workbuddy-modules-'+width+'.png'),(await win.webContents.capturePage(rect)).toPNG());
      }

    }

    await run("document.querySelector('[data-action=store-workbuddy-tasks]').click()");await run("document.querySelector('dialog[open] button[value=confirm]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.tasks.authorized'),false);assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.enabled'),true);
    for(const status of ['connecting','error']) {
      await run(`snapshot.firstReleaseWorkbuddyConnection.status=${JSON.stringify(status)};snapshot.version='wb-authorized-'+${JSON.stringify(status)};window.dispatchEvent(new Event('focus'))`);
      await run('new Promise(resolve=>setTimeout(resolve,30))');
      assert.equal(await run("document.querySelector('[data-workbuddy-tasks]')!==null"),true,'authorized '+status+' connection keeps task module');
    }

    await run("navigate('workbuddy-tasks-authorization')");
    assert.equal(await run("document.querySelector('#navigation [aria-current=page]').textContent"),'WorkBuddy');
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/授权 WorkBuddy 任务/);
    const taskDialogParagraph=await run(`(()=>{const p=document.querySelector('dialog[open] #store-codex-dialog-copy p'),range=document.createRange();range.selectNodeContents(p);return [...range.getClientRects()].length;})()`);
    assert.equal(taskDialogParagraph,1,'task authorization explanation stays on one natural line');
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.enabled'),true);
    await run("snapshot.firstReleaseWorkbuddyConnection.notifications={enabled:false,connected:false,status:'disabled',message:'尚未启用动画提醒',generation:0,activeCount:0};snapshot.version='wb-notifications';window.dispatchEvent(new Event('focus'))");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-notifications]').textContent"),'启用提醒');
    assert.match(await run("document.querySelector('[data-workbuddy-notifications]').textContent"),/任务处理时显示思考动画，有新结果时提醒你。/);
    await run("document.querySelector('[data-action=store-workbuddy-notifications]').click()");
    const notificationTerms=await run("document.querySelector('dialog[open]').textContent");assert.match(notificationTerms,/WorkBuddy.*安装.*Hook/s);assert.match(notificationTerms,/本机过滤/);assert.match(notificationTerms,/阶段和标识.*不传正文/s);assert.match(notificationTerms,/取消或失败.*不显示成功/s);
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("wbLinkActions.includes('notifications-enable')"),false);
    await run("window.qiuqiuSettings.workbuddyConnection=async action=>{wbLinkActions.push(action);const notifications=snapshot.firstReleaseWorkbuddyConnection.notifications;if(action==='notifications-enable'){notifications.enabled=true;notifications.connected=true;}if(action==='notifications-disable'){notifications.enabled=false;notifications.connected=false;notifications.status='disabled';notifications.message='动画提醒尚未启用。';}return {status:'ready',snapshot}};document.querySelector('[data-action=store-workbuddy-notifications]').click()");
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-notifications]').textContent"),'停用提醒');
    await run("snapshot.firstReleaseWorkbuddyConnection.notifications.status='ready';snapshot.firstReleaseWorkbuddyConnection.notifications.message='已启用；新任务可触发处理中和本轮回复结束提醒。';snapshot.version='wb-reminder-healthy';window.dispatchEvent(new Event('focus'))");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.doesNotMatch(await run("document.querySelector('[data-workbuddy-notifications]').textContent"),/新任务可触发/);
    for(const [status,connected,message] of [['ready',true,'本机提醒连接异常，请重新启用。'],['waiting-account',false,'等待确认当前 WorkBuddy 账号。']]) {
      await run(`Object.assign(snapshot.firstReleaseWorkbuddyConnection.notifications,${JSON.stringify({status,connected,message})});snapshot.version=${JSON.stringify('wb-reminder-'+status)};window.dispatchEvent(new Event('focus'))`);await run('new Promise(resolve=>setTimeout(resolve,30))');
      assert.equal(await run(`document.querySelector('[data-workbuddy-notifications]').textContent.includes(${JSON.stringify(message)})`),true,'health filtering preserves errors and waiting states');
    }
    await run("Object.assign(snapshot.firstReleaseWorkbuddyConnection.notifications,{status:'ready',connected:true,message:'已启用；新任务可触发处理中和本轮回复结束提醒。'});snapshot.version='wb-reminder-restored';window.dispatchEvent(new Event('focus'))");await run('new Promise(resolve=>setTimeout(resolve,30))');
    await run("document.querySelector('[data-action=store-workbuddy-notifications]').click()");await run("document.querySelector('dialog[open] button[value=confirm]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.notifications.enabled'),false);assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.enabled'),true);
    await run("snapshot.firstReleaseWorkbuddyConnection.chat={enabled:false,authorized:false,status:'disabled',message:''};snapshot.firstReleaseWorkbuddyConnection.status='ready';snapshot.firstReleaseWorkbuddyConnection.message='';snapshot.version='wb-chat-authorization';window.dispatchEvent(new Event('focus'))");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-workbuddy-chat]')"),null,'chat joins the main connection rather than a separate module');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-connection]').textContent"),'继续连接');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-connection]').closest('.row').classList.contains('store-connected-row')"),false,'partial quota consent is not a completed chat connection');
    assert.equal(await run("document.querySelector('.store-connected-group')"),null,'partial connection does not show a parent-bubble tail');
    assert.match(await run("document.querySelector('#content > section.group').textContent"),/积分已连接，聊天待授权/);
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-disconnect]').textContent"),'解除连接','existing quota authorization can still be revoked without enabling chat');
    const beforeContinue=await run('wbLinkActions.length');
    await run("document.querySelector('[data-action=store-workbuddy-connection]').click()");
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/授权 WorkBuddy 联动/);
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/你发的消息和当前对话上下文交给 WorkBuddy 官方/);
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/默认开启，安装前会选择目录并备份原设置。/);
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/仅向本机球球传任务标识和阶段，不传正文。/);
    for(const width of [720,840,1080]) {
      win.setSize(width,820);
      const paragraphs=await run(`([...document.querySelectorAll('dialog[open] .store-codex-terms p')].map(p=>{const range=document.createRange();range.selectNodeContents(p);return {text:p.textContent,lines:[...range.getClientRects()].filter(rect=>rect.width>0).length,overflow:p.scrollWidth>p.clientWidth};}))`);
      assert(paragraphs.every(p=>p.lines===1&&!p.overflow),'unified WorkBuddy consent naturally fits at '+width+'px: '+JSON.stringify(paragraphs));
      const cards=await run("[...document.querySelectorAll('#content > section.group')].map(s=>({left:s.getBoundingClientRect().left,right:s.getBoundingClientRect().right,overflow:s.scrollWidth>s.clientWidth+1}))");
      assert(cards.every(card=>!card.overflow&&Math.abs(card.left-cards[0].left)<.1&&Math.abs(card.right-cards[0].right)<.1),'all connected WorkBuddy modules share the same surface at '+width+'px');
    }
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');assert.equal(await run('wbLinkActions.length'),beforeContinue);assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.chat.authorized'),false);
    await run("window.chatAllowed=false;window.qiuqiuSettings.workbuddyConnection=async action=>{wbLinkActions.push(action);if(action==='connect'&&chatAllowed){snapshot.firstReleaseWorkbuddyConnection.chat={enabled:true,authorized:true,status:'ready',message:''};}return {status:chatAllowed?'ready':'error',message:chatAllowed?'':'聊天授权未完成，请重试。',snapshot}};navigate('workbuddy-chat-authorization')");
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/授权 WorkBuddy 联动/);
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-connection]').textContent"),'继续连接');assert.match(await run("document.querySelector('#content > section.group').textContent"),/聊天授权未完成/);
    await run("chatAllowed=true;document.querySelector('[data-action=store-workbuddy-connection]').click()");await run("document.querySelector('dialog[open] button[value=confirm]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');assert.equal(await run("document.querySelector('[data-action=store-workbuddy-connection]').textContent"),'解除连接');assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.enabled'),true);assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.tasks.authorized'),false);
    assert.equal(await run("document.querySelector('[data-action=store-workbuddy-connection]').closest('.row').classList.contains('store-connected-row')"),true);
    await verifyConnectedButtonAlignment('workbuddy');
    for(const width of [720,840,1080]){win.setSize(width,820);assert.equal(await run("(()=>{const row=document.querySelector('.store-connected-row'),group=row.closest('.group'),s=getComputedStyle(group);return row.scrollWidth<=row.clientWidth+1&&s.backgroundColor!=='rgba(0, 0, 0, 0)'&&parseFloat(s.borderRadius)>=15;})()"),true,'connected parent bubble fits '+width+'px');}
    await run("snapshot.entries.push({id:'/quota-fun-enabled',label:'额度趣味互动',enabled:true,actionable:true,type:'checkbox',checked:true});snapshot.version='public-quota-game';window.dispatchEvent(new Event('focus'))");await run('new Promise(resolve=>setTimeout(resolve,30))');
    await run("navigate('/codex-menu')");assert.equal(await run("document.querySelector('[data-action=\"/codex-menu/codex-quota-fun\"]')"),null);
    await run("navigate('workbuddy-settings')");assert.equal(await run("document.querySelector('[data-action=\"/workbuddy-quota-fun\"]')"),null);
    await run("navigate('quota-cards')");
    assert.equal(await run("document.querySelector('[data-settings-section=quota-fun] h3').textContent"),'额度趣味互动');
    assert.match(await run("document.querySelector('[data-settings-section=quota-fun]').textContent"),/最前方.*支持互动.*卡片/);
    await run("actMode='apply';document.querySelector('[data-action=\"/quota-fun-enabled\"]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');assert.equal(await run("findEntry('/quota-fun-enabled').checked"),false);
    await run("navigate('workbuddy-settings')");

    await run("window.qiuqiuSettings.workbuddyConnection=async action=>{wbLinkActions.push(action);if(action==='disconnect')snapshot.firstReleaseWorkbuddyConnection={connected:false,enabled:false,status:'disconnected',message:'',tasks:{authorized:false,status:'needs-connection',message:''}};return {status:action==='disconnect'?'disconnected':'ready',snapshot}};document.querySelector('[data-action=store-workbuddy-connection]').click()");
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/解除后会撤销本地授权，再次使用时需要重新连接。/);
    await run("document.querySelector('dialog[open] button[value=confirm]').click()");
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('[data-workbuddy-tasks]')"),null,'task module hides again after disconnect');
    assert.equal(await run("document.querySelector('[data-workbuddy-chat]')"),null,'chat module hides after disconnect');
    assert.deepEqual(await run('wbLinkActions'),['app','cancel','app','account','account','connect','tasks-authorize','tasks-revoke','notifications-enable','notifications-disable','connect','connect','disconnect']);
    await run("snapshot.initialView='workbuddy-tasks-authorization';snapshot.version='wb-task-initial-view'");
    await loadRenderer();
    await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/授权 WorkBuddy 任务/);
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run('snapshot.firstReleaseWorkbuddyConnection.enabled'),false);
    const beforeInitialChat=await run('wbLinkActions.length');
    await run("snapshot.initialView='workbuddy-chat-authorization';snapshot.version='wb-unified-initial-view'");
    await loadRenderer();await run('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await run("document.querySelector('dialog[open] h2').textContent"),'连接本机应用','a disconnected chat entry starts the existing application connection flow');
    assert.match(await run("document.querySelector('dialog[open]').textContent"),/使用本机 WorkBuddy 连接当前账号/);
    await run("document.querySelector('dialog[open] button[value=cancel]').click()");await run('new Promise(resolve=>setTimeout(resolve,30))');assert.equal(await run('wbLinkActions.length'),beforeInitialChat);

    writeAlignmentReport(true);win.destroy(); process.stdout.write('SETTINGS_DOM_OK\n'); app.exit(0);
  }).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
} else {
  require('node:test')('settings renderer splits providers and preserves summary actions in real Chromium DOM', { timeout: 30000 }, () => {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--settings-dom-child'], { encoding: 'utf8', timeout: 25000 });
    if(process.env.PET_SETTINGS_MEASUREMENTS)process.stdout.write(result.stdout);
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /SETTINGS_DOM_OK/);
  });
}
