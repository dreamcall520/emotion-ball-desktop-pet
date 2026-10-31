const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.versions.electron && process.argv.includes('--bubble-dom-child')) {
  const { app, BrowserWindow, ipcMain, session } = require('electron');
  const root = process.env.PET_BUBBLE_SOURCE_ROOT || path.resolve(__dirname, '../..');
  const { createBubbleWindow } = require(path.join(root, 'desktop-pet/lib/bubble-window'));
  const { DialogueDirector, PHRASES } = require(path.join(root, 'desktop-pet/lib/dialogue'));
  const { MOTIONS } = require(path.join(root, 'desktop-pet/lib/interaction-motion'));
  const { SHAPES } = require(path.join(root, 'desktop-pet/lib/customization'));
  app.setPath('userData', process.env.PET_BUBBLE_USER_DATA);
  app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    let controller;
    try {
      // Exercise real native bounds, page, sandbox preload and IPC without showing a desktop window.
      function HiddenWindow(options) {
        const win = new BrowserWindow(options);
        win.showInactive = () => {};
        return win;
      }
      session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: /^https?:/.test(details.url) }));
      let area = { x: 0, y: 0, width: 1440, height: 900 };
      let pet = { x: 600, y: 400, width: 80, height: 80 };
      let shape = 'blob';
      const errors = [], replies = [], measurements = [], checks = [];
      controller = createBubbleWindow({ BrowserWindow: HiddenWindow,
        screen: { getDisplayMatching: () => ({ workArea: area }) },
        getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => pet }),
        getShape: () => shape,
        onError: error => errors.push(error) });
      ipcMain.on('pet:bubble-resize', (event, payload) => {
        if (event.sender !== controller.getWindow()?.webContents) return;
        measurements.push(payload);
        controller.resize(payload);
      });
      ipcMain.on('pet:bubble-reply', (event, payload) => {
        if (event.sender === controller.getWindow()?.webContents) replies.push(payload);
      });
      const run = code => controller.getWindow().webContents.executeJavaScript(code);
      const frame = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      async function until(predicate) {
        const deadline = Date.now() + 3000;
        while (!await predicate()) {
          if (Date.now() > deadline) throw new Error('Timed out waiting for real bubble page/IPC');
          await wait(10);
        }
      }
      let nextId = 1000;
      async function show(payload) {
        payload = { ...payload, id: ++nextId, durationMs: 12000 };
        controller.show(payload);
        await until(async () => {
          const win = controller.getWindow();
          return !win.webContents.isLoading() && await run(`document.getElementById('bubble').dataset.messageId === '${payload.id}'`);
        });
        await frame(); await wait(25); await frame();
        assert.equal(controller.getWindow().isVisible(), false);
        return payload;
      }
      async function configure(mode, appearance, theme = 'green') {
        controller.getWindow().webContents.send('pet:color-mode', mode, appearance, theme);
        await frame();
        assert.equal(await run('document.documentElement.dataset.appearance'), appearance);
        assert.equal(await run('document.documentElement.dataset.uiTheme'), theme);
      }
      async function layout(name, expectedButtons, allowScroll = false) {
        const value = await run(`(() => {
          const rect = e => { const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,client:e.clientWidth,scroll:e.scrollWidth,clientH:e.clientHeight,scrollH:e.scrollHeight}; };
          const bubble=document.getElementById('bubble'),message=document.getElementById('message');
          const dots=['::before','::after'].map(pseudo=>{const s=getComputedStyle(bubble,pseudo),r=bubble.getBoundingClientRect(),b=getComputedStyle(bubble);
            const w=parseFloat(s.width)+parseFloat(s.borderLeftWidth)+parseFloat(s.borderRightWidth),h=parseFloat(s.height)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth);
            const x=r.x+parseFloat(b.borderLeftWidth)+parseFloat(s.left),y=s.top==='auto'?r.bottom-parseFloat(b.borderBottomWidth)-parseFloat(s.bottom)-h:r.y+parseFloat(b.borderTopWidth)+parseFloat(s.top);
            return {pseudo,content:s.content,x,y,right:x+w,bottom:y+h,width:w,height:h,background:s.backgroundColor,lighting:s.backgroundImage,shadow:s.boxShadow};});
          return {width:innerWidth,height:innerHeight,bubble:rect(bubble),message:rect(message),font:getComputedStyle(message).fontSize,text:message.textContent,
            buttons:[...document.querySelectorAll('#actions button')].map(rect),dots,placement:bubble.dataset.placement};
        })()`);
        const inside = r => r.x >= -1 && r.y >= -1 && r.right <= value.width + 1 && r.bottom <= value.height + 1;
        assert.equal(value.buttons.length, expectedButtons, name);
        assert.equal(value.font, '14px', name + ': font remains readable');
        assert(inside(value.bubble) && inside(value.message), name + ': bubble/message outside native window ' + JSON.stringify(value));
        // Chromium counts centered clamp-ellipsis paint in scrollWidth. Its visible
        // boundary is the measured box; unclamped text must still fit without clipping.
        if (value.message.scrollH <= value.message.clientH) assert(value.message.scroll <= value.message.client + 1, name + ': horizontal text exceeds its box ' + JSON.stringify(value.message));
        else assert.equal(await run("getComputedStyle(document.getElementById('message')).overflowX"), 'hidden', name + ': truncated text must not paint beyond its measured box');
        if (!allowScroll) assert(value.message.scrollH <= value.message.clientH + 1 || value.message.height <= 60, name + ': text exceeds the three-line summary');
        assert.equal(await run("getComputedStyle(document.getElementById('message')).webkitLineClamp"), '3', name + ': uniform three-line limit');
        assert.equal(await run("getComputedStyle(document.getElementById('message')).overflowY"), 'hidden', name + ': no text scrollbar');
        assert.equal(await run("!!document.getElementById('bubble-details')"), false, name + ': no detail entry');
        for (const button of value.buttons) assert(inside(button) && button.scroll <= button.client + 1 && button.scrollH <= button.clientH + 1, name + ': button clipping ' + JSON.stringify(value));
        for (const dot of value.dots) assert(dot.content !== 'none' && dot.width > 0 && inside(dot), name + ': clipped cloud dot ' + JSON.stringify(value));
        assert(value.dots.every(dot => dot.lighting.includes('radial-gradient') && dot.shadow !== 'none'), name + ': both connecting dots retain dimensional lighting');
        checks.push({ name, width: value.width, height: value.height, placement: value.placement, buttons: value.buttons.length });
        return value;
      }
      const createDirector = () => new DialogueDirector({ now: 0, random: () => 0 });
      const events = Object.keys(PHRASES);
      await show(createDirector().offer('hello', 10000));
      for (const appearance of ['light', 'dark']) for (const mode of ['standard', 'accessible']) {
        await configure(mode, appearance, appearance === 'light' ? 'green' : 'blue');
        for (const event of events) {
          const payload = createDirector().offer(event, event === 'work' ? 700000 : 10000);
          assert(payload, event + ': real dialogue payload');
          await show(payload);
          assert.equal(await run("document.getElementById('message').textContent"), payload.text);
          await layout(`${mode}-${appearance}-${event}`, payload.actions.length);
        }
        for (const tone of ['normal', 'strong', 'urgent']) {
          const payload = createDirector().offerCodex({ id: 1, generation: 1, kind: 'quota', text: '额度提醒：剩余 10%，记得留意下一次刷新。', severity: tone, taskIds: ['task-one'] }, 10000);
          await show(payload);
          assert.equal(await run("document.getElementById('bubble').dataset.tone"), tone);
          await layout(`${mode}-${appearance}-codex-${tone}`, 2);
        }
        await show(createDirector().offerUpdate('123.456.789', 10000));
        await layout(`${mode}-${appearance}-update`, 2);
        if (mode === 'accessible') {
          const accessible = await run(`(() => {const s=getComputedStyle(document.getElementById('bubble'));return {background:s.backgroundColor,filter:s.backdropFilter};})()`);
          assert.match(accessible.background, /^rgb\(/, 'accessible bubble must be opaque');
          assert.equal(accessible.filter, 'none', 'accessible disables blur');
          const edges = await run(`(() => {
            const bubble = document.getElementById('bubble'), buttons = [...document.querySelectorAll('#actions button')];
            const style = e => {const s = getComputedStyle(e); return {border:s.borderColor, shadow:s.boxShadow, text:s.color, background:s.backgroundColor};};
            const contrast = (a,b) => {
              const luminance = value => value.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
              const x=luminance(a), y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
            };
            const primary=style(buttons[0]),secondary=style(buttons[1]);
            return {bubble:style(bubble),primary,secondary,textContrast:contrast(primary.text,primary.background),secondaryTextContrast:contrast(secondary.text,secondary.background),controlContrast:contrast(secondary.border,secondary.background)};
          })()`);
          assert.equal(edges.primary.shadow, 'none', 'primary has no duplicate inset stroke');
          assert.equal(edges.primary.border, 'rgba(0, 0, 0, 0)', 'primary fill needs no additional border');
          assert.equal(edges.secondary.shadow, 'none', 'secondary uses one border, no duplicate inset stroke');
          assert(edges.textContrast >= 4.5 && edges.secondaryTextContrast >= 4.5, 'accessible button text remains legible');
          assert(edges.controlContrast >= 3, 'secondary keeps a clear boundary');
          await show({ text: '普通对白外框轻一点。', actions: [] });
          assert.notEqual(await run("getComputedStyle(document.getElementById('bubble')).borderColor"), edges.secondary.border, 'decorative bubble border is lighter than the control boundary');
          await show(createDirector().offerUpdate('123.456.789', 10000));
          const dots = await run("['::before','::after'].map(pseudo=>getComputedStyle(document.getElementById('bubble'),pseudo).backgroundColor)");
          assert(dots.every(color => color === accessible.background), 'both cloud dots follow opaque accessible surface');
          await show({ text: '单按钮也保留主操作层级。', actions: [{ id: 'codex-dismiss', label: '知道啦' }] });
          const primary = await run("getComputedStyle(document.querySelector('#actions button')).backgroundColor");
          await show({ text: '两按钮层级。', actions: [{ id: 'again', label: '再来一次' }, { id: 'rest', label: '你歇会儿' }] });
          assert.equal(await run("getComputedStyle(document.querySelector('#actions button')).backgroundColor"), primary, 'single accessible button is primary');
          assert.notEqual(await run("getComputedStyle(document.querySelector('#actions button + button')).backgroundColor"), primary, 'accessible secondary remains distinct');
        }
      }
      await configure('standard', 'light');
      for (const motion of MOTIONS) {
        const payload = createDirector().offer({ event: 'play', motion: motion.id }, 10000);
        assert(payload, motion.id + ': real action dialogue');
        await show(payload);
        await layout('motion-' + motion.id, 2);
      }
      for (const [sheepTheme, sheepAction] of [['none','ear'],['halloween','candy'],['christmas','gift'],['spring-festival','fortune']]) {
        const payload = createDirector().offer('play', 10000, { shape: 'new-year-sheep', sheepTheme, sheepAction });
        assert(payload, sheepTheme + ': real sheep action dialogue');
        await show(payload);
        await layout('sheep-' + sheepTheme, 2);
      }
      for (const [kind, severity, taskIds] of [['waiting','normal',['one']],['completed','normal',['one','two']],['failed','urgent',['one']],['quota','strong',[]]]) {
        const payload = createDirector().offerCodex({ id: 1, generation: 1, kind, text: '任务与额度提醒保持清晰。', severity, taskIds }, 10000);
        assert(payload, kind + ': real Codex dialogue');
        await show(payload);
        await layout('codex-kind-' + kind, payload.actions.length);
      }
      const signature = () => run(`(() => {const s=getComputedStyle(document.getElementById('bubble'));return s.backgroundColor+'|'+s.backgroundImage+'|'+s.color;})()`);
      await configure('standard', 'light', 'blue'); const light = await signature();
      await configure('standard', 'dark', 'green'); const dark = await signature();
      assert.notEqual(light, dark, 'normal appearance actually changes bubble surface and text');
      for (const appearance of ['light', 'dark']) {
        const colors = [];
        for (const theme of ['green', 'blue', 'purple']) {
          await configure('standard', appearance, theme);
          await show({ text: '主题色跟随当前选择。', actions: [{ id: 'again', label: '再来一次' }, { id: 'rest', label: '你歇会儿' }] });
          colors.push(await run("getComputedStyle(document.querySelector('#actions button')).backgroundImage"));
          await layout(`theme-${theme}-${appearance}`, 2);
        }
        assert.equal(new Set(colors).size, 3, 'all three themes have distinct primary buttons');
      }
      const wc = controller.getWindow().webContents;
      wc.debugger.attach('1.3');
      wc.send('pet:color-mode', 'standard', 'system', 'green');
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await frame();
      assert.equal(await run('document.documentElement.dataset.appearance'), 'light');
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await frame();
      assert.equal(await run('document.documentElement.dataset.appearance'), 'dark', 'system appearance updates live');
      wc.debugger.detach();
      await configure('standard', 'light');
      const allowed = [{ id: 'again', label: '再来一次' }, { id: 'rest', label: '你歇会儿' }, { id: 'codex-dismiss', label: '知道啦' }];
      for (const width of [224, 192]) {
        area = { x: 0, y: 0, width: width + 16, height: 900 };
        pet = { x: 70, y: 400, width: 80, height: 80 };
        for (const count of [0, 1, 2, 3]) {
          await show({ text: '忙了一会儿，要不要休息一下？', actions: allowed.slice(0, count) });
          const result = await layout(`width-${width}-actions-${count}`, count);
          assert.equal(result.width, width);
        }
        await show({ text: '长文案测试：' + '这段内容需要完整换行，按钮仍然清晰可见。'.repeat(8), actions: allowed.slice(0, 2).map(action => ({ ...action, label: action.label + '，稍后继续陪着你' })) });
        await layout(`width-${width}-long-text-and-labels`, 2);
      }
      area = { x: 0, y: 0, width: 208, height: 200 };
      pet = { x: 70, y: 100, width: 80, height: 80 };
      await show({ text: '示例：长文统一最多三行，操作按钮保持可见。'.repeat(15), actions: allowed.slice(0, 2) });
      const compact = await layout('short-work-area-clamps-text-and-keeps-actions', 2, true);
      assert(compact.message.scrollH > compact.message.clientH, 'long message is truncated instead of hiding actions');
      for (const theme of ['green','blue','purple']) for (const appearance of ['light','dark']) for (const mode of ['standard','accessible']) for (const width of [224,192]) {
        area = {x:0,y:0,width:width+16,height:900};
        await configure(mode,appearance,theme);
        const payload = await show({text:'布局参考·示例内容：'+ '较长说明统一展示最多三行，原有按钮保持可见。'.repeat(15),actions:allowed.slice(0,2)});
        const result = await layout(`summary-${theme}-${appearance}-${mode}-${width}`,2,true);
        assert(result.message.height <= 60 && result.message.scrollH > result.message.clientH,'long text is visibly limited to three lines');
        await run("window.summaryAction=document.querySelector('#actions button');void 0");
        controller.show({...payload,text:'短消息。'});await frame();await wait(25);await frame();
        assert.equal(await run("document.querySelector('#actions button')===summaryAction"),true,'same-id short update preserves original button');
        assert.equal(await run("document.getElementById('message').clientHeight"),20,'short text takes only one line');
      }
      area = { x: 0, y: 0, width: 1440, height: 900 };
      for (const x of [0, 1360]) for (const y of [0, 800]) {
        pet = { x, y, width: 80, height: 80 };
        await show({ text: '边角位置也能看清。', actions: [] });
        const result = await layout(`corner-${x}-${y}`, 0);
        assert.equal(result.placement, y === 0 ? 'below' : 'above');
      }
      for (const [index, value] of [...SHAPES, 'codex-pet'].entries()) for (const size of [60, 260]) {
        shape = value;
        pet = { x: index % 2 ? 1440-size : 0, y: size === 60 ? 0 : 900-size, width: size, height: size };
        await show({ text: '不同形态与尺寸也能轻轻说话。', actions: allowed.slice(0, 2) });
        await layout(`shape-${shape}-${size}`, 2);
      }
      shape = 'blob';
      pet = { x: 600, y: 400, width: 80, height: 80 };
      const html = '<img src=x onerror="window.injected=true">';
      await show({ text: html, actions: [{ id: 'untrusted-action', label: '不允许的操作' }] });
      assert.equal(await run("document.getElementById('message').textContent"), html);
      assert.equal(await run("document.querySelector('#message img') === null && !window.injected"), true);
      await layout('text-only-html-and-action-whitelist', 0);
      const clickPayload = await show({ text: '按钮只回应一次。', actions: allowed.slice(0, 2) });
      await run("window.originalButton=document.querySelector('#actions button');originalButton.click();originalButton.click();void 0");
      await wait(20);
      assert.deepEqual(replies, [{ id: clickPayload.id, action: 'again' }]);
      await configure('accessible', 'light');
      assert.equal(await run("getComputedStyle(document.querySelector('#actions button:disabled')).boxShadow"), 'none', 'disabled buttons do not restore duplicate strokes');
      controller.show({ ...clickPayload, text: '同一提醒更新正文。' });
      await frame(); await wait(25); await frame();
      assert.equal(await run("document.getElementById('message').textContent"), '同一提醒更新正文。');
      const stableHeight = controller.getWindow().getBounds().height;
      const beforeMeasurements = measurements.length;
      for (let i = 0; i < 4; i++) { pet.x += 10; controller.reposition(); await frame(); }
      assert.equal(await run("window.originalButton === document.querySelector('#actions button') && [...document.querySelectorAll('#actions button')].every(button => button.disabled)"), true, 'reposition preserves node and disabled state');
      assert.equal(controller.getWindow().getBounds().height, stableHeight, 'natural-height feedback converges');
      assert(measurements.length - beforeMeasurements <= 8, 'no runaway resize IPC');
      checks.push({ name: 'reply-once-stable-buttons-and-height', height: stableHeight });
      const artifacts = process.env.PET_BUBBLE_ARTIFACT_DIR;
      if (artifacts) {
        fs.mkdirSync(artifacts, { recursive: true });
        for (const appearance of ['light', 'dark']) {
          await configure('standard', appearance);
          await show({ text: '忙了一会儿，要不要休息一下？', actions: allowed.slice(0, 2) });
          fs.writeFileSync(path.join(artifacts, `native-bubble-${appearance}.png`), (await controller.getWindow().webContents.capturePage(undefined, { stayHidden: true })).toPNG());
        }
        fs.writeFileSync(path.join(artifacts, 'bubble-renderer-checks.json'), JSON.stringify(checks, null, 2));
      }
      assert.deepEqual(errors, []);
      controller.destroy();
      process.stdout.write(`BUBBLE_RENDERER_DOM_OK ${checks.length} real native layouts\n`);
      app.exit(0);
    } catch (error) { controller?.destroy(); process.stderr.write(error.stack + '\n'); app.exit(1); }
  });
} else {
  require('node:test')('bubble cloud UI uses real native IPC, readable layouts, appearance and stable replies', { timeout: 45000 }, () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-bubble-dom-'));
    try {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--bubble-dom-child'], {
        encoding: 'utf8', timeout: 40000, env: { ...process.env, PET_BUBBLE_USER_DATA: data }
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /BUBBLE_RENDERER_DOM_OK/);
    } finally { fs.rmSync(data, { recursive: true, force: true }); }
  });
}
