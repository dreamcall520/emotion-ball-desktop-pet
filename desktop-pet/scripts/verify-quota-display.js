const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

async function verifyQuotaDisplay({ pet, open, settingsFile, powerMonitor, sendModel, about, showNumbers, previewSavedQuota, requestConsent, getConsentWindow }) {
  const out = process.env.PET_QUOTA_VERIFY_OUTPUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  const capture = async (win, name) => {
    await win.webContents.executeJavaScript('new Promise(resolve => { setTimeout(resolve, 150); requestAnimationFrame(() => requestAnimationFrame(resolve)); })');
    fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
  };
  let editor = open(); const errors=[];
  powerMonitor.emit('lock-screen');
  for(const win of [pet,editor])win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
  const until = async probe => { for (let n=0;n<150;n++){if(await probe())return;await wait(50);}throw Error('额度设置运行检查等待超时'); };
  const js = code => editor.webContents.executeJavaScript(code);
  await until(()=>js('Boolean(window.__customizerReady)'));
  const firstLoad = { locked: { visible: editor.isVisible(),
    ...await js('({ready:window.__customizerReady,saveDisabled:document.getElementById("save").disabled,message:document.getElementById("message").textContent})') } };
  assert.equal(firstLoad.locked.visible,false);
  assert.equal(firstLoad.locked.saveDisabled,true,'首次加载时锁屏，未读取设置不能保存');
  assert.match(firstLoad.locked.message,/读取设置失败/);
  const originalEditor = editor;
  powerMonitor.emit('unlock-screen'); editor=open();
  await until(()=>editor.isVisible()&&js('!document.getElementById("save").disabled'));
  firstLoad.reopened = { sameWindow: editor===originalEditor, visible: editor.isVisible(),
    ...await js('({saveDisabled:document.getElementById("save").disabled,messageHidden:document.getElementById("message").hidden})') };
  assert.equal(firstLoad.reopened.sameWindow,true);
  assert.equal(firstLoad.reopened.messageHidden,true,'重新打开成功后清除读取失败提示');
  if(out)fs.writeFileSync(path.join(out,'first-load-lock-recovery.json'),JSON.stringify(firstLoad,null,2));
  const before = JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  assert.equal(before.uiTheme,'blue');
  assert.equal(await js('document.querySelectorAll("#quota-styles button").length'),6);
  await js('document.getElementById("source-quota").click();true');
  await js(`document.querySelector('button[data-style="ring"]').click();true`);
  const palette = await js(`(() => {
    const root = document.documentElement, selected = document.querySelector('.quota-style[aria-pressed=true]');
    return { theme: root.dataset.uiTheme, mode: root.dataset.colorMode,
      title: getComputedStyle(selected).color, border: getComputedStyle(selected).borderTopColor,
      material: getComputedStyle(document.querySelector('[data-quota-material][aria-pressed=true]')).color };
  })()`);
  assert.deepEqual(palette, { theme: 'blue', mode: 'standard', title: 'rgb(8, 99, 232)',
    border: 'rgb(171, 212, 241)', material: 'rgb(8, 99, 232)' }, '额度样式控件沿用晴空蓝界面主题');
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
  assert.equal(await js('document.getElementById("quota-numbers").checked'),true,'新设置默认显示具体数字');
  assert.equal(await js('getComputedStyle(document.getElementById("quota-numbers")).backgroundColor'),'rgb(9, 136, 247)','数字开关沿用晴空蓝');
  await js(`document.getElementById('quota-numbers').click();document.getElementById('save').click();true`);
  await until(()=>JSON.parse(fs.readFileSync(settingsFile,'utf8')).quotaDisplay.showNumbers===false);
  editor.destroy();editor=open();await until(()=>js('Boolean(window.__customizerReady)'));
  await js('document.getElementById("source-quota").click();true');
  assert.equal(await js('document.getElementById("quota-numbers").checked'),false,'主动关闭数字后重开仍关闭');
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
  assert.equal(await desktopLabel.webContents.executeJavaScript('document.getElementById("quota-numbers").textContent'),'周额度90%');
  await until(()=>pet.webContents.executeJavaScript('document.querySelector(".quota-effects")?.dataset.style==="ring"'));
  if(out)await capture(desktopLabel, 'saved-weekly-only.png');
  previewSavedQuota([{id:'codex:primary',label:'Codex',windowMinutes:300,remaining:0,resetsAt:Date.now()+3600000},weeklyWindow]);
  await until(()=>pet.webContents.executeJavaScript('document.querySelector(".quota-effects")?.dataset.style==="duo"'));
  assert.equal(await desktopLabel.webContents.executeJavaScript('document.querySelectorAll(".quota-reading-value").length'),2);
  editor.destroy();editor=open();await until(()=>js('Boolean(window.__customizerReady)'));
  await js('document.getElementById("source-quota").click();true');
  assert.equal(await js('document.querySelector("button[data-style=duo]").getAttribute("aria-pressed")'),'true');
  assert.equal(await js('document.getElementById("quota-numbers").checked'),true);
  await until(()=>editor.isVisible()&&js('!document.querySelector(".quota-preview-numbers").hidden'));
  const visibilityChecks = [], nativeEvents = [];
  for (const name of ['show','hide','minimize','restore']) editor.on(name, () => nativeEvents.push({
    event: name, at: performance.now(), visible: editor.isVisible(), minimized: editor.isMinimized()
  }));
  const playback = async stage => {
    const state = { stage, visible: editor.isVisible(), minimized: editor.isMinimized(), focused: editor.isFocused(),
      ...await js('({hidden:document.hidden,button:document.getElementById("quota-consume").textContent,values:["fiveHour","weekly"].map(p=>document.getElementById("quota-output-"+p).textContent)})') };
    visibilityChecks.push(state);
    if(out)fs.writeFileSync(path.join(out,'native-visibility.json'),JSON.stringify({checks:visibilityChecks,nativeEvents},null,2));
    return state;
  };
  editor.blur(); await until(()=>!editor.isFocused());
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await until(()=>editor.isVisible()&&js('!document.hidden&&!document.querySelector(".quota-preview-numbers").hidden'));
  await js('document.getElementById("quota-consume").click();true');
  await until(()=>js('Number(document.getElementById("quota-demo-fiveHour").value)<74'));
  const unfocused = await playback('unfocused-before-lock');
  assert.equal(unfocused.focused,false,'锁屏前窗口已失焦');
  assert.equal(unfocused.button,'Ⅱ 暂停消耗','已失焦窗口的演示正在运行，停止不能依赖新的 blur');
  powerMonitor.emit('lock-screen'); await wait(200);
  const locked = await playback('lock-200ms');
  assert.equal(locked.visible,false,'实际锁屏入口隐藏定制窗口');
  assert.equal(locked.button,'▷ 播放消耗','锁屏后停止演示，不依赖 DOM visibilitychange');
  await wait(240);
  assert.deepEqual((await playback('lock-stable')).values,locked.values,'隐藏后额度保持不变');
  powerMonitor.emit('unlock-screen'); await wait(120);
  assert.equal(editor.isVisible(),false,'解锁不自行弹出定制窗口');
  editor=open(); await until(()=>editor.isVisible()&&js('!document.querySelector(".quota-preview-numbers").hidden'));
  assert.equal((await playback('reopen')).button,'▷ 播放消耗','重新打开不自动播放');
  await js('document.getElementById("quota-consume").click();true');
  assert.equal((await playback('before-minimize')).button,'Ⅱ 暂停消耗');
  editor.minimize(); await wait(200);
  if (editor.isMinimized()) {
    const minimized = await playback('minimize-200ms');
    assert.equal(minimized.button,'▷ 播放消耗','实际最小化停止演示');
    await wait(240);
    assert.deepEqual((await playback('minimize-stable')).values,minimized.values);
    editor.restore(); await until(()=>!editor.isMinimized()&&js('!document.querySelector(".quota-preview-numbers").hidden'));
    assert.equal((await playback('restore')).button,'▷ 播放消耗','恢复窗口不自动播放');
  } else {
    visibilityChecks.push({stage:'minimize-unavailable',reason:'原生窗口未进入 minimized 状态'});
    await js('const consume=document.getElementById("quota-consume");if(consume.textContent==="Ⅱ 暂停消耗")consume.click();true');
  }
  if(out)fs.writeFileSync(path.join(out,'native-visibility.json'),JSON.stringify({checks:visibilityChecks,nativeEvents},null,2));
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
    const label=showNumbers({state,items:[{label:'Codex',windowMinutes:300,remaining:0},{label:'Codex',windowMinutes:10080,remaining:38}],display:'numbers',numberPeriods:['fiveHour','weekly'],numberColors:saved.customization.appearance});
    await until(()=>label.webContents.executeJavaScript('document.querySelectorAll(".quota-reading-value").length===2'));
    assert.deepEqual(await label.webContents.executeJavaScript('[...document.querySelectorAll(".quota-reading-value")].map(n=>n.textContent)'),state==='ready'?['0%','38%']:['—','—']);
    const geometry = await label.webContents.executeJavaScript(`(()=>{
      const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      return {card:rect('quota-label'),numbers:rect('quota-numbers'),guard:rect('quota-guard-entry'),
        guardVisible:document.body.dataset.guardEntry==='true',width:innerWidth,height:innerHeight};
    })()`);
    assert.equal(label.getBounds().height,geometry.guardVisible?50:32);
    assert.equal(geometry.card.height,28,'角色入口只扩大原生窗口，不放大数字卡本体');
    for(const box of [geometry.card,geometry.numbers,...(geometry.guardVisible?[geometry.guard]:[])]) {
      assert.ok(box.x>=0&&box.y>=0&&box.right<=geometry.width&&box.bottom<=geometry.height,JSON.stringify(geometry));
    }
    if(geometry.guardVisible)assert.ok(Math.max(geometry.guard.x-geometry.card.right,geometry.card.x-geometry.guard.right)>=8,'数字卡与守护战入口在左右任一侧保持独立间距');
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
  // Rive thumbnails must survive style/material changes without restarting the shape renderer.
  await js(`document.getElementById('source-ball').click();document.querySelector('button[data-shape="aurora-cloud"]').click();document.getElementById('source-quota').click();true`);
  await until(()=>js(`[...document.querySelectorAll('.quota-thumb-body')].every(n=>n.dataset.avatarReady==='true'&&n.querySelector('.eb-rive-aurora.ready'))`));
  await js(`window.__quotaThumbCanvases=[...document.querySelectorAll('.quota-thumb-body')].map(n=>n.querySelector('.eb-rive-aurora'));true`);
  for(const style of ['pool','ring','duo','split','stages','ring']) {
    await js(`document.querySelector('button[data-style="${style}"]').click();true`);
    assert.equal(await js(`[...document.querySelectorAll('.quota-thumb-body')].every((n,i)=>n.dataset.avatarReady==='true'&&n.querySelector('.eb-rive-aurora')===window.__quotaThumbCanvases[i])`),true,'幻彩缩略图切换不得重建留白');
  }
  for(const mode of ['large','desktop','large']) {
    await js(`document.getElementById('preview-${mode}').click();document.querySelector('button[data-style="pool"]').click();true`);
    await until(()=>js(`Boolean(document.querySelector('#preview-ball > .eb-rive-aurora.ready'))`));
    await wait(200);
    if(out)await capture(editor, 'settings-aurora-pool-'+mode+'.png');
  }
  if(out)await capture(editor, 'settings-aurora-thumbnails.png');
  const win=about();await until(()=>win.webContents.executeJavaScript('Boolean(window.qiuqiuAbout)'));
  assert.equal((await win.webContents.executeJavaScript('window.qiuqiuAbout.getInfo()')).developer,'春野');
  await until(()=>win.isVisible());
  const original=win.getBounds();win.setPosition(original.x+32,original.y+20,false);
  const moved=win.getBounds();about();assert.deepEqual(win.getBounds(),moved,'可见关于窗口再次进入不能跳回旧位置');
  await until(()=>win.webContents.executeJavaScript('!document.getElementById("about-check-updates").disabled'));
  await win.webContents.executeJavaScript('document.getElementById("about-check-updates").click();true');
  await wait(100);
  assert.deepEqual(win.getBounds(),moved,'实际点击检查更新不能重置关于窗口位置');
  for(let n=0;n<250&&await win.webContents.executeJavaScript('document.getElementById("about-check-updates").disabled');n++)await wait(50);
  const update=await win.webContents.executeJavaScript('({disabled:document.getElementById("about-check-updates").disabled,status:document.getElementById("about-status").textContent})');
  assert.equal(update.disabled,false,'检查更新正常返回或显示网络失败');
  assert.deepEqual(win.getBounds(),moved,'检查更新结果返回仍保留关于窗口位置');
  if(out){fs.writeFileSync(path.join(out,'about-update-position.json'),JSON.stringify({moved,afterResult:win.getBounds(),...update},null,2));await capture(win,'about-update-position.png');}
  const settingsBeforeConsent=fs.readFileSync(settingsFile,'utf8');
  const consentChecks=[];
  for(const accepted of [false,true]){
    const pending=requestConsent(),consent=getConsentWindow();
    await until(()=>consent.webContents.executeJavaScript('!document.getElementById("consent-accept").disabled'));
    assert.equal(await consent.webContents.executeJavaScript('document.activeElement.id'),'consent-cancel');
    if(out&&!accepted)await capture(consent, 'codex-consent.png');
    require('electron').app.focus({steal:true});consent.focus();consent.webContents.focus();
    await until(()=>consent.isVisible()&&consent.webContents.executeJavaScript('!document.hidden&&document.hasFocus()&&!document.getElementById("consent-accept").disabled'));
    const readConsent=async()=>({visible:consent.isVisible(),focused:consent.isFocused(),...await consent.webContents.executeJavaScript('({hidden:document.hidden,focus:document.hasFocus(),acceptDisabled:document.getElementById("consent-accept").disabled,cancelDisabled:document.getElementById("consent-cancel").disabled,status:document.getElementById("consent-status").textContent})')});
    const check={accepted,before:await readConsent()};consentChecks.push(check);
    await consent.webContents.executeJavaScript(`document.getElementById('consent-${accepted?'accept':'cancel'}').click();true`);
    const result=await Promise.race([pending,wait(2000).then(()=>null)]);
    check.result=result;check.destroyed=consent.isDestroyed();if(!check.destroyed)check.after=await readConsent();
    if(out)fs.writeFileSync(path.join(out,'consent-diagnostic.json'),JSON.stringify(consentChecks,null,2));
    assert.equal(result,accepted);assert.equal(consent.isDestroyed(),true);
  }
  assert.equal(fs.readFileSync(settingsFile,'utf8'),settingsBeforeConsent,'单独预览确认窗不启动真实Codex或改设置');
  assert.deepEqual(errors,[],'浏览器控制台错误');
  process.stdout.write('PET_QUOTA_DISPLAY_OK\n');
}
module.exports={verifyQuotaDisplay};
