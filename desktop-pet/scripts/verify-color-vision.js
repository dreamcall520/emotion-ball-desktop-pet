// Hidden native Electron verification. Synthetic data only; never opens Codex.
// Run with Electron, optionally PET_VISION_ARTIFACT_DIR=/absolute/output/path.
const { app, BrowserWindow, ipcMain } = require('electron');
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtimeRoot = process.env.PET_VISION_APP_ROOT || path.resolve(__dirname, '..');
const { createEdgeNotice } = require(path.join(runtimeRoot, 'lib/edge-notice'));
const { edgeNoticeBounds } = require(path.join(runtimeRoot, 'lib/edge-notice-window'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-vision-'));
app.setPath('userData', profile);
const output = process.env.PET_VISION_ARTIFACT_DIR || path.resolve(__dirname, '../build/color-vision-evidence');
fs.mkdirSync(output, { recursive: true });
const windows = [], results = [], samples = [], screenshots = [];
const modes = ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
const modeLabels = ['原色', '红色觉缺失模拟', '绿色觉缺失模拟', '蓝色觉缺失模拟', '无色觉模拟'];
const baseChat = { messages: [], history: [], busy: false, connection: 'ready', error: null, hasConversation: false };
ipcMain.handle('pet:chat-get', () => baseChat);
const frame = win => win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
const page = (win, code) => win.webContents.executeJavaScript(code);
const statusWord = value => value === 0 ? '已用尽' : value <= 10 ? '紧张' : value <= 20 ? '偏低' : '';

async function windowFor(name, width, height) {
  const win = new BrowserWindow({ width, height, show: false, frame: false, backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(runtimeRoot, `${name}-preload.js`),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  windows.push(win);
  await win.loadFile(path.join(runtimeRoot, `${name}.html`));
  win.webContents.debugger.attach('1.3');
  return win;
}

async function configure(win, appearance, mode) {
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: appearance }, { name: 'prefers-reduced-motion', value: 'no-preference' }
  ] });
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedVisionDeficiency', { type: mode });
  win.webContents.send('pet:color-mode', 'accessible', appearance);
  await frame(win);
}

async function verifyText(win, selector, expected, name) {
  const actual = await page(win, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)}), r = node.getBoundingClientRect();
    return { text: node.textContent, x:r.x, y:r.y, right:r.right, bottom:r.bottom,
      width:innerWidth, height:innerHeight, client:node.clientWidth, scroll:node.scrollWidth,
      visible:node.getClientRects().length > 0 };
  })()`);
  assert.equal(actual.text, expected, `${name}: semantic state`);
  assert.ok(actual.visible && actual.x >= -1 && actual.y >= -1 && actual.right <= actual.width + 1 &&
    actual.bottom <= actual.height + 1 && actual.scroll <= actual.client + 1, `${name}: text is clipped ${JSON.stringify(actual)}`);
  results.push({ name, ...actual });
}

async function save(win, appearance, mode, kind) {
  const file = `${appearance}-${mode}-${kind}.png`;
  fs.writeFileSync(path.join(output, file), (await win.webContents.capturePage()).toPNG());
  screenshots.push({ file, appearance, mode, kind });
}

function edgePayload(remaining, side, appearance, windowMinutes = 300) {
  let payload;
  // Advance the same real notice controller used by the app, with a controlled clock.
  let time = 0;
  const model = { presentation: { mode: 'tucked', side }, visible: true, quotaEnabled: true,
    bubblesEnabled: false, appearance, quotaModel: { state: 'ready', items: [{ remaining, windowMinutes }] } };
  const real = createEdgeNotice({ now: () => time, random: () => 0, onChange: value => { payload = value; } });
  real.tick(model); time = 30000; real.tick(model);
  return payload;
}

function contrast(a, b) {
  const lum = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const values = [lum(a), lum(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

async function verifyPalette(win, appearance, mode) {
  const pairs = [['text','panel'],['muted','panel'],['blue','panel'],['yellow','panel'],
    ['text','surface'],['muted','surface'],['blue','surface'],['text','raised'],['muted','raised'],
    ['blue','raised'],['muted','disabled'],['yellow','warning'],['on-accent','blue'],
    ['blue','track'],['yellow','track'],['line','panel']];
  const palette = await page(win, `(() => {
    const root = getComputedStyle(document.documentElement);
    return Object.fromEntries(${JSON.stringify([...new Set(pairs.flat())])}.map(k => [k, root.getPropertyValue('--accessible-' + k).trim()]));
  })()`);
  const probe = new BrowserWindow({ width: 80, height: pairs.length * 20, show: false, frame: false,
    backgroundColor: '#ffffff', webPreferences: { backgroundThrottling: false } });
  windows.push(probe);
  await probe.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>*{box-sizing:border-box}html,body{margin:0}section{display:flex;height:20px}i{display:block;width:40px;height:20px}</style>` +
    pairs.map(([a,b])=>`<section><i style="background:${palette[a]}"></i><i style="background:${palette[b]}"></i></section>`).join('')));
  probe.webContents.debugger.attach('1.3');
  await probe.webContents.debugger.sendCommand('Emulation.setEmulatedVisionDeficiency', { type: mode });
  await frame(probe);
  const image = await probe.webContents.capturePage();
  // NativeImage bitmap channels are platform-dependent. These tests target macOS,
  // whose native bitmap is BGRA. The unfiltered run verifies that assumption.
  const bitmap = image.toBitmap(), { width, height } = image.getSize();
  const scaleX = width / 80, scaleY = height / (pairs.length * 20);
  const pixel = (x,y) => { const i = (Math.floor(y*scaleY)*width + Math.floor(x*scaleX))*4;
    return [bitmap[i+2], bitmap[i+1], bitmap[i]]; };
  for (const [i, [a,b]] of pairs.entries()) {
    const fg = pixel(20, i*20+10), bg = pixel(60, i*20+10);
    if (mode === 'none') {
      const expected = palette[a].slice(1).match(/../g).map(s=>parseInt(s,16));
      assert.ok(fg.every((c,j)=>Math.abs(c-expected[j])<=1), 'native bitmap channel order / scale must be verified');
    }
    const ratio = contrast(fg,bg), threshold = i < 13 ? 4.5 : 3;
    samples.push({ appearance, mode, pair:`${a}/${b}`, foreground:fg, background:bg, ratio, threshold });
    assert.ok(ratio >= threshold, `${appearance}/${mode}/${a}/${b}: simulated contrast ${ratio}`);
  }
  probe.destroy();
}

async function main() {
  await app.whenReady();
  const quota = await windowFor('quota-label', 196, 128);
  const edge = await windowFor('edge-notice', 284, 44);
  const chat = await windowFor('chat', 440, 580);
  const bubble = await windowFor('bubble', 244, 118);
  for (const appearance of ['light','dark']) for (const mode of modes) {
    for (const win of [quota,edge,chat,bubble]) await configure(win,appearance,mode);
    await verifyPalette(quota,appearance,mode);
    for (const remaining of [74,15,5,0]) for (const expanded of [false,true]) {
      quota.setContentSize(expanded?196:128, expanded?128:32);
      quota.webContents.send('pet:quota-label', { state:'ready', size:'compact', expanded, appearance,
        items:[{label:'Codex',windowMinutes:300,remaining,resetsAt:Date.now()+9000000},
          {label:'Codex',windowMinutes:10080,remaining:74,resetsAt:Date.now()+259200000}], overflow:0, resetCreditsAvailable:2 });
      await frame(quota);
      await verifyText(quota, expanded?'#items .quota-value':'#summary', expanded?`${remaining}%${statusWord(remaining)}`:
        `5h${statusWord(remaining)||'额度'}${remaining}%`, `${appearance}/${mode}/quota/${remaining}/${expanded}`);
      if (remaining===15 && expanded) await save(quota,appearance,mode,'quota');
    }
    for (const remaining of [74,15,5,0,.4,10.4,20.4]) for (const side of ['left','right']) for (const minutes of [300,10080]) {
      const bounds = edgeNoticeBounds({x:0,y:100,width:80,height:80},{x:0,y:0,width:1440,height:900},side,'quota');
      edge.setContentSize(bounds.width,bounds.height);
      edge.webContents.send('pet:edge-notice', edgePayload(remaining,side,appearance,minutes));
      await frame(edge);
      await verifyText(edge,'#text',`${minutes===300?'5 小时':'周额度'} · 剩余 ${Math.round(remaining)}%${statusWord(remaining)?' · '+statusWord(remaining):''}`,
        `${appearance}/${mode}/edge/${remaining}/${side}/${minutes}`);
      const capsule = await page(edge, `(() => {const n=document.getElementById('notice'),t=document.getElementById('text');
        return {width:n.clientWidth,scroll:n.scrollWidth,right:n.getBoundingClientRect().right,textRight:t.getBoundingClientRect().right};})()`);
      assert.ok(capsule.scroll <= capsule.width+1 && capsule.textRight <= capsule.right-10, 'edge text must fit its pill including padding');
      if (remaining===0 && side==='right' && minutes===300) await save(edge,appearance,mode,'edge');
    }
    for (const error of [null,'连接暂时中断，请稍后重试。']) {
      chat.webContents.send('pet:chat-state',{...baseChat,connection:error?'error':'ready',error});
      await frame(chat);
      assert.equal(await page(chat,'document.getElementById("send-message").disabled'),true);
      await verifyText(chat,'#send-message','发送 ↑',`${appearance}/${mode}/chat/disabled`);
      if(error) { await verifyText(chat,'#error-text',error,`${appearance}/${mode}/chat/error`); await save(chat,appearance,mode,'chat'); }
    }
    bubble.webContents.send('pet:bubble',{id:1,placement:'above',tone:'urgent',anchorX:122,
      text:'额度紧张，先把手头这件事收好。',actions:[{id:'codex-open',label:'去看看'},{id:'codex-dismiss',label:'知道啦'}]});
    await frame(bubble);
    await verifyText(bubble,'#message','额度紧张，先把手头这件事收好。',`${appearance}/${mode}/bubble`);
    await save(bubble,appearance,mode,'bubble');
    console.log(`VISION_PROFILE_OK ${appearance}/${mode}`);
  }
  // Standard edge notices also receive the wording; cover both periods/themes.
  for (const appearance of ['light','dark']) {
    await configure(edge,appearance,'none');
    edge.webContents.send('pet:color-mode','standard',appearance);
    for (const minutes of [300,10080]) for (const remaining of [20,10,0]) for (const side of ['left','right']) {
      edge.webContents.send('pet:edge-notice',edgePayload(remaining,side,appearance,minutes));
      await frame(edge);
      await verifyText(edge,'#text',`${minutes===300?'5 小时':'周额度'} · 剩余 ${remaining}% · ${statusWord(remaining)}`,
        `standard/${appearance}/edge/${minutes}/${remaining}/${side}`);
    }
  }
  for(const appearance of ['light','dark']) {
    const before = samples.find(s=>s.appearance===appearance&&s.mode==='none'&&s.pair==='blue/panel');
    for(const mode of modes.slice(1)) assert.notDeepEqual(samples.find(s=>s.appearance===appearance&&s.mode===mode&&s.pair==='blue/panel').foreground,
      before.foreground, `${mode} must alter actual captured pixels, not just acknowledge CDP`);
  }
  const summary = { passed:true, cases:results.length, paletteChecks:samples.length, modes,
    minSimulatedTextContrast:Math.min(...samples.filter(s=>s.threshold===4.5).map(s=>s.ratio)),
    scope:'Synthetic hidden native pages + Chromium color vision simulation; not a human color-vision user acceptance test.' };
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
  const cards=screenshots.map(s=>`<figure><figcaption>${s.appearance==='light'?'浅色':'深色'} · ${modeLabels[modes.indexOf(s.mode)]} · ${s.kind}</figcaption><img src="${s.file}" loading="lazy"></figure>`).join('');
  fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>球球色觉模拟验收</title><style>body{font:15px system-ui;background:#e7eaef;color:#1d2734;margin:28px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}figure{margin:0;padding:16px;background:#fff;border-radius:12px}figcaption{margin-bottom:12px}img{max-width:100%;height:auto}</style><h1>球球色觉模拟验收</h1><p>浅深色 × 原色及四种模拟。使用模拟数据，不读取真实聊天或额度。模拟不能替代真实用户体验。</p><main>${cards}</main></html>`);
  console.log('PET_COLOR_VISION_OK',JSON.stringify(summary));
}
main().catch(error=>{fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({passed:false,error:error.stack},null,2));console.error(error);process.exitCode=1;})
  .finally(()=>{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,samples},null,2));
    for(const win of windows)if(!win.isDestroyed())win.destroy();fs.rmSync(profile,{recursive:true,force:true});app.exit(process.exitCode||0);});
