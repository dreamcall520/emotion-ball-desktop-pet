const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

async function verifyQuotaDisplay({ pet, open, settingsFile, sendModel, about, showNumbers }) {
  const out = process.env.PET_QUOTA_VERIFY_OUTPUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  let editor = open(); const errors=[];
  for(const win of [pet,editor])win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
  const until = async probe => { for (let n=0;n<150;n++){if(await probe())return;await wait(50);}throw Error('额度设置运行检查等待超时'); };
  const js = code => editor.webContents.executeJavaScript(code);
  await until(()=>js('Boolean(window.__customizerReady)'));
  const before = JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  assert.equal(before.uiTheme,'blue');
  assert.equal(await js('document.querySelectorAll("#quota-styles button").length'),6);
  await js('document.getElementById("source-quota").click();true');
  await js(`document.getElementById('source-quota').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));true`);
  assert.equal(await js('document.getElementById("source-codex").getAttribute("aria-selected")'),'true');
  await js('document.getElementById("source-quota").click();true');
  const thumb=await js(`(()=>{const host=document.querySelector('button[data-style="card"]'),ball=host.querySelector('.quota-thumb-body').getBoundingClientRect(),card=host.querySelector('.quota-thumb-card').getBoundingClientRect();return {gap:card.top-ball.bottom,ratio:card.width/card.height};})()`);
  assert.ok(thumb.gap>=3&&thumb.ratio===4,'经典额度卡缩略图独立放于球体下方');
  for(const style of ['card','pool','ring','duo','split','stages']) {
    await js(`document.querySelector('button[data-style="${style}"]').click();true`);
    await wait(120);
    assert.equal(await js(`document.querySelector('button[data-style="${style}"]').getAttribute('aria-pressed')`),'true');
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile,'utf8')),before,'预览不能写真实额度或配置');
  }
  await js(`document.querySelector('button[data-style="duo"]').click();document.getElementById('quota-numbers').click();document.getElementById('startup-default').checked=false;document.getElementById('save').click();true`);
  await until(()=>js('!document.getElementById("save").disabled'));
  let saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  assert.equal(saved.quotaDisplay.style,'duo');assert.equal(saved.quotaDisplay.showNumbers,true);
  assert.deepEqual(saved.startupAppearance,before.startupAppearance,'额度保存不改启动外观');
  const quotaConfig=saved.quotaDisplay;
  editor.destroy();editor=open();await until(()=>js('Boolean(window.__customizerReady)'));
  await js('document.getElementById("source-quota").click();true');
  assert.equal(await js('document.querySelector("button[data-style=duo]").getAttribute("aria-pressed")'),'true');
  assert.equal(await js('document.getElementById("quota-numbers").checked'),true);
  await js('document.getElementById("quota-consume").click();true');
  editor.hide();await wait(200);
  assert.equal(await js('document.getElementById("quota-consume").textContent'),'▷ 播放消耗');
  editor.showInactive();await wait(120);
  await js(`document.getElementById('source-ball').click();const n=document.getElementById('body-hex');n.value='#NOPE';n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('source-quota').click();document.querySelector('button[data-style="ring"]').click();document.getElementById('save').click();true`);
  await wait(100);assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile,'utf8')).quotaDisplay,quotaConfig,'无效外观不能部分保存额度');
  await js(`document.getElementById('source-ball').click();document.getElementById('reset-appearance').click();document.getElementById('source-quota').click();true`);
  for (const [width,height] of [[960,700],[760,580],[1180,820]]) {
    editor.setContentSize(width,height);await wait(160);
    const layout=await js(`(()=>{const s=document.getElementById('save').getBoundingClientRect(),p=document.querySelector('.preview-pane').getBoundingClientRect(),d=document.getElementById('quota-demo-tools').getBoundingClientRect();return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,save:s.top>=0&&s.bottom<=innerHeight,preview:d.bottom<=p.bottom+1};})()`);
    assert.ok(layout.scroll<=layout.width&&layout.save&&layout.preview,JSON.stringify(layout));
    if(out&&width===760)fs.writeFileSync(path.join(out,'settings-small.png'),(await editor.webContents.capturePage()).toPNG());
  }
  for(const state of ['ready','stale']){
    const label=showNumbers({state,items:[{label:'Codex',windowMinutes:300,remaining:0}],display:'numbers',numberPeriods:['fiveHour','weekly'],numberColors:saved.customization.appearance});
    await until(()=>label.webContents.executeJavaScript('document.querySelectorAll(".quota-reading-value").length===2'));
    assert.deepEqual(await label.webContents.executeJavaScript('[...document.querySelectorAll(".quota-reading-value")].map(n=>n.textContent)'),state==='ready'?['0%','—']:['—','—']);
    assert.equal(label.getBounds().height,32);
    if(out&&state==='ready')fs.writeFileSync(path.join(out,'desktop-numbers.png'),(await label.webContents.capturePage()).toPNG());
  }
  for (const style of ['pool','ring','duo','split','stages']) {
    const model={state:'ready',items:[{label:'Codex',windowMinutes:300,remaining:74},{label:'Codex',windowMinutes:10080,remaining:38}]};
    sendModel({config:{...quotaConfig,style,material:'glass'},model,visible:true});await wait(220);
    assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('.quota-effects')?.dataset.style`),style,'桌面真实效果 '+style);
    if(out)fs.writeFileSync(path.join(out,'desktop-'+style+'.png'),(await pet.webContents.capturePage()).toPNG());
  }
  if(out){await wait(2000);await js(`document.querySelector('button[data-style="stages"]').click();true`);await wait(160);fs.writeFileSync(path.join(out,'settings-quota.png'),(await editor.webContents.capturePage()).toPNG());await js(`document.getElementById('source-ball').click();true`);await wait(160);assert.equal(await js('document.querySelector(".quota-preview-numbers").hidden'),true);fs.writeFileSync(path.join(out,'settings-appearance.png'),(await editor.webContents.capturePage()).toPNG());}
  const win=about();await until(()=>win.webContents.executeJavaScript('Boolean(window.qiuqiuAbout)'));
  assert.equal((await win.webContents.executeJavaScript('window.qiuqiuAbout.getInfo()')).developer,'春野');
  assert.deepEqual(errors,[],'浏览器控制台错误');
  process.stdout.write('PET_QUOTA_DISPLAY_OK\n');
}
module.exports={verifyQuotaDisplay};
