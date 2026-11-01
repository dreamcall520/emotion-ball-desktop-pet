const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.versions.electron && process.argv.includes('--pomodoro-readability-child')) {
  const { app, BrowserWindow, session } = require('electron');
  app.setPath('userData', process.env.PET_POMODORO_READABILITY_DATA);
  app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    let win;
    try {
      const root = path.resolve(__dirname, '../..');
      session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: /^https?:/.test(details.url) || /\.js(?:\?|$)/.test(details.url) }));
      win = new BrowserWindow({ width:320,height:476,frame:false,show:false,useContentSize:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
      await win.loadFile(path.join(root,'desktop-pet/pomodoro.html'));
      const run = code => win.webContents.executeJavaScript(code);
      await run("document.getElementById('focus-panel').hidden=false;document.body.dataset.view='panel';void 0");
      const checks = [];
      for (const width of [320,300]) for (const theme of ['green','blue','purple']) for (const appearance of ['light','dark']) for (const mode of ['standard','accessible']) for (const face of ['analog','timeline','modules','minutes']) {
        win.setSize(width,face==='analog'?476:384);
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const value = await run(`(() => {
          Object.assign(document.documentElement.dataset,{uiTheme:${JSON.stringify(theme)},appearance:${JSON.stringify(appearance)},notesAppearance:${JSON.stringify(appearance)},accessibleAppearance:${JSON.stringify(appearance)},colorMode:${JSON.stringify(mode)}});
          document.getElementById('blue-style').disabled=${theme!=='blue'};
          document.getElementById('focus-panel').dataset.face=${JSON.stringify(face)};
          document.querySelectorAll('.modes button').forEach((b,i)=>b.classList.toggle('active',i===0));
          const rgb = value => value.match(/[\\d.]+/g).slice(0,3).map(Number);
          const luminance = value => rgb(value).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
          const contrast = (a,b) => {const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
          const backgrounds = node => {
            for(let e=node;e;e=e.parentElement){
              const s=getComputedStyle(e);
              if(s.backgroundImage!=='none')return s.backgroundImage.match(/rgba?\\([^)]*\\)/g);
              if(/^rgb\\(/.test(s.backgroundColor))return [s.backgroundColor];
            }
            throw Error('Missing painted background');
          };
          const rect = e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
          const measure = (e,pseudo) => {const s=getComputedStyle(e,pseudo),background=backgrounds(e);return {text:e.textContent,font:parseFloat(s.fontSize),weight:Number(s.fontWeight),opacity:s.opacity,color:s.color,background,ratio:Math.min(...background.map(bg=>contrast(s.color,bg))),rect:rect(e),client:e.clientWidth,scroll:e.scrollWidth};};
          const input=document.getElementById('intention'),s=getComputedStyle(input,'::placeholder'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=s.fontWeight+' '+s.fontSize+' '+s.fontFamily;
          return {width:innerWidth,height:innerHeight,modes:[...document.querySelectorAll('.modes button')].map(e=>measure(e)),placeholder:{...measure(input,'::placeholder'),textWidth:ctx.measureText(input.placeholder).width},reset:measure(document.getElementById('reset')),
            activeBackground:getComputedStyle(document.querySelector('.modes .active')).backgroundColor,inactiveBackground:getComputedStyle(document.querySelector('.modes button:not(.active)')).backgroundColor,
            panel:{background:getComputedStyle(document.getElementById('focus-panel')).backgroundColor,image:getComputedStyle(document.getElementById('focus-panel')).backgroundImage}};
        })()`);
        const label = `${width}/${theme}/${appearance}/${mode}/${face}`;
        for (const item of [...value.modes,value.placeholder,value.reset]) {
          assert(item.ratio>=4.5,label+' text contrast '+JSON.stringify(item));
          assert.equal(item.opacity,'1',label+' enabled controls look enabled');
          assert(item.rect.x>=0 && item.rect.y>=0 && item.rect.right<=value.width+.5 && item.rect.bottom<=value.height+.5,label+' control clipping '+JSON.stringify(item));
          assert(item.scroll<=item.client+1,label+' horizontal text clipping');
        }
        assert(value.modes.every(m=>m.font>=12),label+' phase labels readable at native width');
        assert(value.placeholder.font>=11 && value.reset.font>=11,label+' input/reset font stays readable');
        assert(value.placeholder.textWidth<=value.placeholder.rect.width,label+' placeholder fits');
        assert(value.modes[0].weight>=600,label+' selected phase is distinguished by weight');
        assert.notEqual(value.activeBackground,value.inactiveBackground,label+' selected phase has a distinct fill');
        if(mode==='accessible'){assert.equal(value.panel.image,'none');assert.match(value.panel.background,/^rgb\(/);}
        assert.equal(win.isVisible(),false);
        checks.push({label,minContrast:Math.min(...[...value.modes,value.placeholder,value.reset].map(v=>v.ratio))});
      }
      const output=process.env.PET_POMODORO_READABILITY_OUTPUT;
      if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'readability.json'),JSON.stringify(checks,null,2));}
      win.destroy();console.log(`POMODORO_READABILITY_OK ${checks.length} native layouts`);app.exit(0);
    } catch(error) {win?.destroy();console.error(error.stack);app.exit(1);}
  });
} else {
  require('node:test')('pomodoro functional text remains readable across themes and compact native layouts',{timeout:30000},()=>{
    const data=fs.mkdtempSync(path.join(os.tmpdir(),'pomodoro-readability-'));
    try{
      const result=require('node:child_process').spawnSync(require('electron'),[__filename,'--pomodoro-readability-child'],{encoding:'utf8',timeout:25000,env:{...process.env,PET_POMODORO_READABILITY_DATA:data}});
      assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/POMODORO_READABILITY_OK 96/);
    }finally{fs.rmSync(data,{recursive:true,force:true});}
  });
}
