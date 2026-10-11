const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

async function verifyQuotaDisplay({ pet, open, settingsFile, sendModel, about, showNumbers, previewSavedQuota, requestConsent, getConsentWindow }) {
  const out = process.env.PET_QUOTA_VERIFY_OUTPUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  const capture = async (win, name) => {
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
  };
  let editor = open(); const errors=[];
  for(const win of [pet,editor])win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
  const until = async probe => { for (let n=0;n<150;n++){if(await probe())return;await wait(50);}throw Error('额度设置运行检查等待超时'); };
  const js = code => editor.webContents.executeJavaScript(code);
  await until(()=>js('Boolean(window.__customizerReady)'));
  const before = JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  assert.equal(before.uiTheme,'blue');
  assert.equal(await js('document.querySelectorAll("#quota-styles button").length'),6);
  await js('document.getElementById("source-quota").click();true');
  assert.equal(await js('document.getElementById("quota-period")'),null,'周期跟随实际额度，无需手动设置');
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
  await until(()=>js('!document.getElementById("save").disabled')).catch(async error=>{
    error.message += JSON.stringify({quota:JSON.parse(fs.readFileSync(settingsFile,'utf8')).quotaDisplay,
      ui:await js('({message:document.querySelector("[role=status]")?.textContent,hidden:document.hidden})'),errors});
    throw error;
  });
  let saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  assert.equal(saved.quotaDisplay.style,'duo');assert.equal(saved.quotaDisplay.showNumbers,true);
  assert.deepEqual(saved.startupAppearance,before.startupAppearance,'额度保存不改启动外观');
  const quotaConfig=saved.quotaDisplay;
  const weeklyWindow = {id:'codex:secondary',label:'Codex',windowMinutes:10080,remaining:90,resetsAt:Date.now()+86400000};
  let desktopLabel = previewSavedQuota([weeklyWindow]);
  await until(()=>desktopLabel.webContents.executeJavaScript('document.querySelectorAll(".quota-reading-value").length===1'));
  assert.equal(await desktopLabel.webContents.executeJavaScript('document.getElementById("quota-numbers").textContent'),'周90%');
  await until(()=>pet.webContents.executeJavaScript('document.querySelector(".quota-effects")?.dataset.style==="ring"'));
  if(out)await capture(desktopLabel, 'saved-weekly-only.png');
  previewSavedQuota([{id:'codex:primary',label:'Codex',windowMinutes:300,remaining:0,resetsAt:Date.now()+3600000},weeklyWindow]);
  await until(()=>pet.webContents.executeJavaScript('document.querySelector(".quota-effects")?.dataset.style==="duo"'));
  assert.equal(await desktopLabel.webContents.executeJavaScript('document.querySelectorAll(".quota-reading-value").length'),2);
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
    if(out&&width===760)await capture(editor, 'settings-small.png');
  }
  for(const state of ['ready','stale']){
    const label=showNumbers({state,items:[{label:'Codex',windowMinutes:300,remaining:0}],display:'numbers',numberPeriods:['fiveHour','weekly'],numberColors:saved.customization.appearance});
    await until(()=>label.webContents.executeJavaScript('document.querySelectorAll(".quota-reading-value").length===2'));
    assert.deepEqual(await label.webContents.executeJavaScript('[...document.querySelectorAll(".quota-reading-value")].map(n=>n.textContent)'),state==='ready'?['0%','—']:['—','—']);
    assert.equal(label.getBounds().height,32);
    const material=await label.webContents.executeJavaScript(`(()=>{const s=getComputedStyle(document.getElementById('quota-label'));return {background:s.backgroundImage,border:s.borderTopWidth,filter:s.backdropFilter};})()`);
    assert.ok(material.background.includes('gradient')&&material.border==='1px'&&material.filter.includes('blur'),'数字复用原额度卡材质与边框');
    if(out&&state==='ready')await capture(label, 'desktop-numbers.png');
  }
  for (const style of ['pool','ring','duo','split','stages']) {
    const model={state:'ready',items:[{label:'Codex',windowMinutes:300,remaining:74},{label:'Codex',windowMinutes:10080,remaining:38}]};
    sendModel({config:{...quotaConfig,style,material:'glass'},model,visible:true});await wait(220);
    assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('.quota-effects')?.dataset.style`),style,'桌面真实效果 '+style);
    if(out)await capture(pet, 'desktop-'+style+'.png');
  }
  if(out){await wait(2000);await js(`document.querySelector('button[data-style="stages"]').click();true`);await wait(160);await capture(editor, 'settings-quota.png');await js(`document.getElementById('source-ball').click();true`);await wait(160);assert.equal(await js('document.querySelector(".quota-preview-numbers").hidden'),true);await capture(editor, 'settings-appearance.png');}
  const win=about();await until(()=>win.webContents.executeJavaScript('Boolean(window.qiuqiuAbout)'));
  assert.equal((await win.webContents.executeJavaScript('window.qiuqiuAbout.getInfo()')).developer,'春野');
  await until(()=>win.isVisible());
  const original=win.getBounds();win.setPosition(original.x+32,original.y+20,false);
  const moved=win.getBounds();about();assert.deepEqual(win.getBounds(),moved,'可见关于窗口再次进入不能跳回旧位置');
  const settingsBeforeConsent=fs.readFileSync(settingsFile,'utf8');
  for(const accepted of [false,true]){
    const pending=requestConsent(),consent=getConsentWindow();
    await until(()=>consent.webContents.executeJavaScript('!document.getElementById("consent-accept").disabled'));
    assert.equal(await consent.webContents.executeJavaScript('document.activeElement.id'),'consent-cancel');
    if(out&&!accepted)await capture(consent, 'codex-consent.png');
    await consent.webContents.executeJavaScript(`document.getElementById('consent-${accepted?'accept':'cancel'}').click();true`);
    assert.equal(await pending,accepted);assert.equal(consent.isDestroyed(),true);
  }
  assert.equal(fs.readFileSync(settingsFile,'utf8'),settingsBeforeConsent,'单独预览确认窗不启动真实Codex或改设置');
  assert.deepEqual(errors,[],'浏览器控制台错误');
  process.stdout.write('PET_QUOTA_DISPLAY_OK\n');
}
module.exports={verifyQuotaDisplay};
