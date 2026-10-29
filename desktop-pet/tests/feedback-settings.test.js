const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.versions.electron && process.argv.includes('--feedback-dom-child')) {
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const win = new BrowserWindow({width:980,height:760,show:false,webPreferences:{contextIsolation:false,nodeIntegration:false}});
    await win.loadFile(path.join(__dirname,'../global-settings.html'));
    const run = async source => { try { return await win.webContents.executeJavaScript(source); } catch (error) { throw new Error(source.slice(0,160)+' :: '+error.message); } };
    const snapshotFile = process.env.PET_SMOKE_ARTIFACT_DIR && path.join(process.env.PET_SMOKE_ARTIFACT_DIR, 'settings-snapshot.json');
    const previewSnapshot = snapshotFile && fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile,'utf8')) : {entries:[]};
    Object.assign(previewSnapshot,{version:'0.4.09',initialView:'feedback',feedback:{enabled:true,pending:0,lastSentAt:null,lastError:'',context:{diagnostic:{appVersion:'0.4.09',platform:'darwin',systemRelease:'25.0.0',architecture:'arm64',electron:'43.4.1',node:'24'}}}});
    await run(`document.querySelector('#brand-pet').replaceChildren();window.submissions=[];window.autoChanges=[];window.snapshot=${JSON.stringify(previewSnapshot)};
      window.qiuqiuSettings={get:async()=>snapshot,act:async()=>({}),onNavigate:fn=>window.navigate=fn,
        submitFeedback:async value=>{submissions.push(value);if(window.holdSubmit)return new Promise(resolve=>window.finishSubmit=()=>resolve({id:value.submissionId}));if(window.failSubmit)throw Error('提交失败，内容已保留，请稍后重试。');return {id:value.submissionId}},
        setAutoReport:async enabled=>{autoChanges.push(enabled);snapshot.feedback.enabled=enabled;return {ok:true,state:snapshot.feedback}}};void 0;`);
    await run(fs.readFileSync(path.join(__dirname,'../global-settings-renderer.js'),'utf8'));
    const settle = () => run('new Promise(resolve=>setTimeout(resolve,40))'); await settle();
    assert.equal(await run("document.querySelector('#section-title').textContent"),'意见反馈');
    assert.equal(await run("document.querySelector('#report-auto').getAttribute('aria-checked')"),'true');
    assert.equal(await run("document.querySelector('#report-diagnostics').checked"),true);
    await run("document.querySelector('#report-title').value='草稿';document.querySelector('#report-detail').value='操作步骤';document.querySelector('#report-title').focus();window.dispatchEvent(new Event('focus'))");await settle();
    assert.equal(await run("document.querySelector('#report-title').value"),'草稿');
    await run("document.querySelector('[data-view=common]').click();document.querySelector('[data-view=feedback]').click()");
    assert.equal(await run("document.querySelector('#report-title').value"),'草稿','tab navigation preserves draft');
    await run("document.querySelector('#report-auto').click()");await settle();
    assert.equal(await run("document.querySelector('#report-auto').getAttribute('aria-checked')"),'false');
    await run("document.querySelector('#report-auto').click()");await settle();
    assert.deepEqual(await run('autoChanges'),[false,true]);
    await run("document.querySelector('#report-title').value='';document.querySelector('#report-detail').value='';");
    const output = process.env.PET_SMOKE_ARTIFACT_DIR;
    if (output) fs.mkdirSync(output,{recursive:true});
    for (const [theme,appearance,width] of [['blue','light',980],['blue','dark',980],['green','light',980],['green','dark',620]]) {
      win.setSize(width,760);
      await run(`document.documentElement.dataset.uiTheme='${theme}';document.documentElement.dataset.appearance='${appearance}';`);
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await run('document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth'),true,`${theme} ${appearance} ${width} no overflow`);
      assert.equal(await run(`new Set(['report-type','report-title','report-detail','report-dropzone','report-contact'].map(id=>Math.round(document.getElementById(id).getBoundingClientRect().left))).size`),1,'all form controls align');
      assert.equal(await run('getComputedStyle(document.querySelector("#report-detail")).color'),await run('getComputedStyle(document.documentElement).getPropertyValue("--text").trim()').then(color=>run(`(()=>{const e=document.createElement('span');e.style.color=${JSON.stringify(color)};document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c})()`)));
      if(output) {
        fs.writeFileSync(path.join(output,`feedback-${theme}-${appearance}-${width}.png`),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
        await run("document.querySelector('main').scrollTo({top:document.querySelector('main').scrollHeight,behavior:'instant'});void 0");
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(output,`feedback-${theme}-${appearance}-${width}-bottom.png`),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
        await run("document.querySelector('main').scrollTo({top:0,behavior:'instant'})");
      }
    }
    await run("document.querySelector('#report-title').value='草稿';document.querySelector('#report-detail').value='操作步骤';");
    // All three entry points share validation, and plain text paste keeps its native behavior.
    await run(`window.picture=name=>new File([new Uint8Array([137,80,78,71,13,10,26,10])],name,{type:'image/png'});
      window.dropData=new DataTransfer();dropData.items.add(picture('dropped.png'));
      document.querySelector('#report-dropzone').dispatchEvent(new DragEvent('dragover',{dataTransfer:dropData,bubbles:true,cancelable:true}));`);
    assert.equal(await run("document.querySelector('#report-dropzone').classList.contains('is-dragging')"),true);
    await run("document.querySelector('#report-dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:dropData,bubbles:true,cancelable:true}))");
    assert.equal(await run("document.querySelector('#report-files').children.length"),1);
    await run(`window.pasteData=new DataTransfer();pasteData.items.add(picture('pasted.png'));
      document.querySelector('#report-detail').dispatchEvent(new ClipboardEvent('paste',{clipboardData:pasteData,bubbles:true,cancelable:true}));`);
    assert.equal(await run("document.querySelector('#report-files').children.length"),2);
    assert.equal(await run(`(()=>{const data=new DataTransfer();data.setData('text/plain','普通文字');const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});document.querySelector('#report-detail').dispatchEvent(event);return event.defaultPrevented})()`),false);
    await run(`window.badData=new DataTransfer();badData.items.add(new File(['plain'],'notes.txt',{type:'text/plain'}));badData.items.add(new File([new Uint8Array(1048577)],'large.png',{type:'image/png'}));
      document.querySelector('#report-dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:badData,bubbles:true,cancelable:true}));`);
    assert.equal(await run("document.querySelector('#report-files').children.length"),2,'invalid or oversized images are rejected');
    await run(`window.moreData=new DataTransfer();moreData.items.add(picture('third.png'));moreData.items.add(picture('fourth.png'));
      document.querySelector('#report-dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:moreData,bubbles:true,cancelable:true}));`);
    assert.equal(await run("document.querySelector('#report-files').children.length"),3,'combined entries share the three-image limit');
    assert.match(await run("document.querySelector('#report-status').textContent"),/最多/);
    await run("while(document.querySelector('#report-files button'))document.querySelector('#report-files button').click()");
    // Browser-selected attachments are retained across a failed attempt and retries reuse the UUID.
    await run(`window.transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'sample.png',{type:'image/png'}));
      document.querySelector('#report-attachments').files=transfer.files;document.querySelector('#report-attachments').dispatchEvent(new Event('change'));
      document.querySelector('#report-diagnostics').checked=false;window.failSubmit=true;document.querySelector('#report-form').requestSubmit();`);await settle();
    assert.equal(await run('submissions.length'),1);
    await run("document.querySelector('#report-dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:dropData,bubbles:true,cancelable:true}))");
    assert.equal(await run("document.querySelector('#report-files').children.length"),2);
    await run("document.querySelector('#report-files li:last-child button').click()");
    assert.equal(await run('submissions[0].includeDiagnostics'),false);
    assert.equal(await run('submissions[0].attachments[0].name'),'sample.png');
    assert.equal(await run("document.querySelector('#report-title').value"),'草稿');
    assert.equal(await run("document.querySelector('#report-files').children.length"),1);
    await run("window.failSubmit=false;document.querySelector('#report-form').requestSubmit()");await settle();
    assert.equal(await run('submissions[0].submissionId===submissions[1].submissionId'),true);
    assert.equal(await run("document.querySelector('#report-success').hidden"),false);
    assert.match(await run("document.querySelector('#report-receipt').textContent"),/反馈编号/);
    await run("document.querySelector('#report-again').click()");
    assert.equal(await run("document.querySelector('#report-title').value"),'');
    assert.equal(await run("document.querySelector('#report-files').children.length"),0);
    await run("document.querySelector('#report-title').value='<img src=x onerror=alert(1)>';document.querySelector('#report-detail').value='test';document.querySelector('#report-form').requestSubmit()");await settle();
    assert.equal(await run('submissions.at(-1).title'),'<img src=x onerror=alert(1)>');
    assert.equal(await run("document.querySelector('#report-title img')"),null);
    await run("document.querySelector('#report-again').click();document.querySelector('#report-title').value='提交中';document.querySelector('#report-detail').value='测试';window.holdSubmit=true;document.querySelector('#report-form').requestSubmit()");await settle();
    await run("document.querySelector('#report-dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:dropData,bubbles:true,cancelable:true}));document.querySelector('#report-detail').dispatchEvent(new ClipboardEvent('paste',{clipboardData:pasteData,bubbles:true,cancelable:true}))");
    assert.equal(await run("document.querySelector('#report-files').children.length"),0,'sending freezes attachments for both paste and drop');
    await run('finishSubmit()');await settle();
    win.destroy();process.stdout.write('FEEDBACK_SETTINGS_OK\n');app.exit(0);
  }).catch(error=>{process.stderr.write(error.stack+'\n');app.exit(1);});
} else {
  require('node:test')('feedback settings preserve drafts, retry IDs, attachments and shared theme tokens in real Chromium', {timeout:30000},()=>{
    const result=spawnSync(require('electron'),[__filename,'--feedback-dom-child'],{encoding:'utf8',timeout:25000});
    assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/FEEDBACK_SETTINGS_OK/);
  });
}
