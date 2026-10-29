// Isolated native renderer check. Fixture amounts only; no real account or settings access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-card-focus-'));
  const env = { ...process.env, PET_QUOTA_FOCUS_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', error => { console.error(error); fs.rmSync(data, { recursive: true, force: true }); process.exitCode = 1; });
  child.on('exit', code => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, session } = require('electron');
  const sourceRoot = path.resolve(process.env.PET_QUOTA_FOCUS_SOURCE_ROOT || path.join(__dirname, '../..'));
  const output = path.resolve(process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-card-focus-artifacts-')));
  const baseline = process.env.PET_QUOTA_FOCUS_BASELINE === '1';
  const windows = [], errors = [], cases = [];
  app.setPath('userData', process.env.PET_QUOTA_FOCUS_DATA); app.setActivationPolicy('accessory'); app.on('window-all-closed', () => {});
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const read = (win, selector) => win.webContents.executeJavaScript(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)}), s = getComputedStyle(e), card = document.getElementById('quota-label');
    const r = card.getBoundingClientRect();
    return { keyboard: document.documentElement.dataset.keyboard, active: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName,
      focused: document.hasFocus(), focusVisible: e.matches(':focus-visible'), outline: s.outlineStyle,
      outlineWidth: parseFloat(s.outlineWidth), color: s.outlineColor,
      cardOutline: getComputedStyle(card).outlineStyle, cardOutlineWidth: parseFloat(getComputedStyle(card).outlineWidth),
      bounds: { x:r.x, y:r.y, width:r.width, height:r.height } };
  })()`);
  const focus = (win, selector) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const key = async (win, keyCode) => {
    if(keyCode==='Tab')await win.webContents.executeJavaScript('document.body.tabIndex=-1;document.body.focus()');
    win.webContents.focus();
    keyCode = {ArrowDown:'Down',ArrowUp:'Up',ArrowLeft:'Left',ArrowRight:'Right'}[keyCode] || keyCode;
    win.webContents.sendInputEvent({ type:'keyDown', keyCode }); win.webContents.sendInputEvent({ type:'keyUp', keyCode }); await wait(30);
  };
  const painted = (style, width) => !['none','hidden'].includes(style) && width > 0;
  const noRing = value => !painted(value.outline,value.outlineWidth) && !painted(value.cardOutline,value.cardOutlineWidth);
  let finished = false;
  const finish = error => {
    if (finished) return; finished = true;
    if (error) errors.push(String(error.stack || error));
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    const report = { passed: !errors.length, baseline, sourceRoot, fixture: true, noRealAccountsOrNetwork: true,
      hiddenRendererFocusChecks: true, actualPetDrag: false, cases, errors, allWindowsDestroyed: windows.every(w => w.isDestroyed()) };
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, baseline, cases: cases.length, errors, output })); app.exit(report.passed ? 0 : 1);
  };
  process.on('uncaughtException', finish); process.on('unhandledRejection', finish);
  app.whenReady().then(async () => {
    try {
      fs.mkdirSync(output, { recursive: true });
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_d, done) => done({ cancel:true }));
      const specs = [
        { name:'kimi', file:'api-balance-label', selector:'#summary' },
        { name:'api', file:'api-usage-label', selector:'#quota-label' },
        { name:'workbuddy', file:'workbuddy-label', selector:'#toggle' },
        { name:'codex', file:'quota-label', selector:'.v20-collapse' },
        { name:'zcode', file:'quota-label', selector:'.v20-collapse' }
      ];
      for (const spec of baseline ? specs.slice(0,1) : specs) {
        const quota = spec.file === 'quota-label';
        const win = new BrowserWindow({ width: quota ? 196 : 128, height: quota ? 120 : 32, frame:false, transparent:true, show:false,
          webPreferences:{ preload:path.join(sourceRoot,'desktop-pet',spec.file+'-preload.js'), additionalArguments:spec.name==='zcode'?['--pet-source=zcode']:[], contextIsolation:true, sandbox:true, nodeIntegration:false, backgroundThrottling:false } });
        windows.push(win); win.webContents.on('render-process-gone', (_event, detail) => errors.push(JSON.stringify(detail)));
        await win.loadFile(path.join(sourceRoot,'desktop-pet',spec.file+'.html'));
        win.webContents.focus();
        let kimiState;
        if (spec.name === 'kimi') {
          const report = { available:44.24, cash:44.24, voucher:0, currency:'CNY', updatedAt:Date.now() };
          kimiState = { enabled:true, expanded:false, appearance:'light', status:'ready',
            accounts:[{id:'a'.repeat(64),name:'测试账户',provider:'moonshot',supported:true,currency:'CNY',status:'ready',report}], selectedAccountId:'a'.repeat(64), report };
          win.webContents.send('pet:api-balance-label',kimiState);
        }
        if (quota) win.webContents.send(spec.name==='zcode'?'pet:zcode-quota-label':'pet:quota-label',{
          state:'ready', sourceId:spec.name, size:'compact', expanded:true, appearance:'light', overflow:0,
          items:[{label:'测试额度',windowMinutes:10080,remaining:37,resetsAt:Date.now()+86400000}]
        });
        await wait(50); await focus(win,spec.selector);
        const initial = await read(win,spec.selector);
        assert(initial.focused && initial.active, spec.name+': renderer really owns focus');
        if (baseline) {
          assert(initial.focusVisible && !noRing(initial), 'old Kimi reproduces blue outline without a keyboard event');
          fs.writeFileSync(path.join(output,'kimi-programmatic-before.png'),(await win.webContents.capturePage()).toPNG());
          cases.push({ name:spec.name, initial }); continue;
        }
        assert(noRing(initial), spec.name+': native/programmatic focus has no mouse ring '+JSON.stringify(initial));
        for (const colorMode of ['standard','accessible']) for (const appearance of ['light','dark']) {
          await win.webContents.executeJavaScript(`Object.assign(document.documentElement.dataset, {appearance:${JSON.stringify(appearance)},accessibleAppearance:${JSON.stringify(appearance)},colorMode:${JSON.stringify(colorMode)}})`);
          await key(win,'Tab'); await focus(win,spec.selector);
          const keyboard = await read(win,spec.selector);
          assert.equal(keyboard.keyboard,'true');
          assert(keyboard.focusVisible && !noRing(keyboard),spec.name+': Tab keeps a visible focus cue');
          const before = keyboard.bounds;
          // Same production preload event sent by the trusted pet drag-start handler.
          win.webContents.send('pet:quota-card-pointer-reset'); await wait(25);
          const drag = await read(win,spec.selector);
          assert.equal(drag.active,keyboard.active,spec.name+': clearing the ring preserves the active control');
          assert(noRing(drag),spec.name+': pet pointer interaction clears the keyboard ring');
          assert.deepEqual(drag.bounds,before,spec.name+': no layout change');
          for (let round=0;round<3;round++) { win.hide(); win.setPosition(100+round*10,100); win.webContents.focus(); await focus(win,spec.selector); }
          const restored = await read(win,spec.selector);
          assert(noRing(restored),spec.name+': reposition/focus restoration keeps pointer mode');
          await key(win,'Tab'); await focus(win,spec.selector);
          assert(!noRing(await read(win,spec.selector)),spec.name+': keyboard navigation resumes');
          win.webContents.sendInputEvent({type:'mouseDown',x:3,y:3,button:'left',clickCount:1});
          win.webContents.sendInputEvent({type:'mouseUp',x:3,y:3,button:'left',clickCount:1}); await wait(30); await focus(win,spec.selector);
          const pointer = await read(win,spec.selector); assert(noRing(pointer),spec.name+': in-card pointer also clears ring');
          cases.push({ name:spec.name, appearance, colorMode, initial, keyboard, drag, restored, pointer });
          if(spec.name==='kimi' && appearance==='light' && colorMode==='standard')fs.writeFileSync(path.join(output,'kimi-pointer-after.png'),(await win.webContents.capturePage()).toPNG());
        }
        if(spec.name==='kimi') {
          win.setSize(196,120); win.webContents.send('pet:api-balance-label',{...kimiState,expanded:true,accounts:[...kimiState.accounts,{...kimiState.accounts[0],id:'b'.repeat(64),name:'第二测试账户'}]});
          await wait(30);
          const point=await win.webContents.executeJavaScript(`(() => {const r=document.getElementById('account-toggle').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
          win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await wait(30);
          const menuMouse=await read(win,'.account-option:focus'); assert(noRing(menuMouse),'mouse-opened account menu has no ring');
          await key(win,'ArrowDown'); const menuKey=await read(win,'.account-option:focus');
          assert.equal(menuKey.keyboard,'true',JSON.stringify(menuKey));assert(!noRing(menuKey),'arrow key in mouse-opened menu restores visible keyboard focus');
          await key(win,'Escape'); assert.equal(await win.webContents.executeJavaScript("document.getElementById('account-menu').hidden"),true);
          win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await wait(30);
          assert.equal((await read(win,'.account-option:focus')).keyboard,'false');
          await key(win,'Escape'); const escape=await read(win,'#account-toggle');
          assert.equal(escape.keyboard,'true');assert.equal(escape.active,'account-toggle');assert(!noRing(escape),'direct Escape restores visible focus to menu trigger');
          cases.push({name:'kimi-account-menu',menuMouse,menuKey,escape});
        }
        win.destroy();
      }
      finish();
    } catch(error) { finish(error); }
  });
}
