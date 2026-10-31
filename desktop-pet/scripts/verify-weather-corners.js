// Real weather document/controller, isolated storage, no remote requests.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;process.exit(require('node:child_process').spawnSync(require('electron'),[__filename],{env,stdio:'inherit'}).status??1);}
const {app,BrowserWindow,ipcMain,screen,session}=require('electron');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'weather-corners-'));app.setPath('userData',path.join(temp,'profile'));
const out=process.env.PET_SMOKE_ARTIFACT_DIR||path.join(temp,'evidence');fs.mkdirSync(out,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let pet,controller;const cases=[];
app.whenReady().then(async()=>{let error;try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
 const city={name:'验收城市',latitude:39,longitude:116},filePath=path.join(temp,'weather.json');
 fs.writeFileSync(filePath,JSON.stringify({enabled:true,city}));fs.writeFileSync(filePath+'.cache',JSON.stringify({city,updatedAt:Date.now(),current:{temperature:8,weatherCode:0,isDay:0},hourly:[],daily:[]}));
 pet=new BrowserWindow({width:80,height:80,show:false,frame:false,skipTaskbar:true});await pet.loadURL('data:text/html,<title>Weather layout fixture</title>');pet.showInactive();
 controller=require('../lib/weather-window').createWeatherWindow({BrowserWindow,ipcMain,screen,filePath,getPetWindow:()=>pet,getPresentation:()=>({mode:'free'}),fetch:async()=>{throw Error('fixture offline');}});controller.start();
 const w=controller.getWindow();while(w.webContents.isLoading())await wait(20);await wait(100);
 const area=screen.getDisplayMatching(pet.getBounds()).workArea;
 const click=async id=>{await w.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`);await wait(300);};
 const snapshot=async id=>{const host=w.getBounds();const dom=await w.webContents.executeJavaScript(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,viewportHeight:innerHeight}})()`);assert(host.y>=area.y&&host.y+host.height<=area.y+area.height);assert(dom.height<=host.height+2,'full DOM content fits native viewport');return{host,dom};};
 for(const [name,x,y] of [['top-left',area.x,area.y],['top-right',area.x+area.width-80,area.y],['bottom-left',area.x,area.y+area.height-80],['bottom-right',area.x+area.width-80,area.y+area.height-80]]){
  pet.setPosition(x,y,false);controller.reposition();await wait(50);const compact=w.getBounds();await click('folded');const details=await snapshot('weather-details');fs.writeFileSync(path.join(out,name+'-details.png'),(await w.webContents.capturePage()).toPNG());await click('city');const picker=await snapshot('city-picker');await click('close-picker');const restored=await snapshot('weather-details');assert.equal(restored.host.y,details.host.y);await click('collapse');assert.deepEqual(w.getBounds(),compact);cases.push({name,compact,details,picker,restored,collapsed:w.getBounds(),metrics:controller.getLayoutMetrics()});
 }
}catch(e){error=e.stack;}finally{controller?.destroy();pet?.destroy();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:!error,error,cases,noNetworkOrAccounts:true},null,2));console.log(JSON.stringify({passed:!error,error,cases:cases.length,out}));app.exit(error?1:0);}});
