const path = require('node:path');
function createQuotaCardTransitionWindow({BrowserWindow,ipcMain,getAlwaysOnTop=()=>true,onError=()=>{}}) {
  let win=null,ready=false,load=null,waiter=null,closed=false,revision=0,prepared=false;
  function rejectPending(error){if(waiter){clearTimeout(waiter.timer);waiter.reject(error);waiter=null;}}
  function conceal(target){if(target&&!target.isDestroyed()){try{target.setOpacity(0);target.hide();target.webContents.send('pet:quota-card-transition-clear');}catch(error){onError(error);}}}
  function own(event){return win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame;}
  const traceStages=new Set(['received','accepted','decoded','raf1','raf2','animating','invalid-bounds','invalid-anchor','invalid-layers','invalid-size']);
  const trace=(event,value)=>{if(!own(event)||!waiter||value?.token!==waiter.token||!traceStages.has(value.stage))return;waiter.trace.push(value.stage);if(waiter.trace.length>16)waiter.trace.shift();};
  ipcMain.on('pet:quota-card-transition-trace',trace);
  const ack=(event,value)=>{if(!own(event)||!value||!waiter||value.token!==waiter.token||value.phase!==waiter.phase){if(waiter&&event.sender===win?.webContents&&value?.token===waiter.token&&value?.phase===waiter.phase)waiter.trace.push('ack-frame-rejected');return;}const current=waiter;waiter=null;clearTimeout(current.timer);value.ok===true?current.resolve():current.reject(Error('额度区过渡画面未就绪'));};
  ipcMain.on('pet:quota-card-transition-ack',ack);
  function ensure(){
    if(closed)throw Error('过渡窗口已关闭');
    if(win&&!win.isDestroyed())return load;
    ready=false;prepared=false;
    const target=win=new BrowserWindow({width:1,height:1,show:false,frame:false,transparent:true,focusable:false,resizable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:getAlwaysOnTop(),webPreferences:{preload:path.join(__dirname,'../quota-card-transition-preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
    target.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});target.setIgnoreMouseEvents(true,{forward:true});
    target.webContents.setWindowOpenHandler(()=>({action:'deny'}));target.webContents.on('will-navigate',event=>event.preventDefault());
    target.on('closed',()=>{if(win===target){win=null;ready=false;prepared=false;rejectPending(Error('过渡窗口已关闭'));}});
    target.webContents.on('render-process-gone',()=>{if(win===target){win=null;ready=false;prepared=false;rejectPending(Error('过渡画面已退出'));if(!target.isDestroyed())target.destroy();}});
    load=Promise.resolve(target.loadFile(path.join(__dirname,'../quota-card-transition.html'))).then(()=>{if(win!==target||target.isDestroyed())throw Error('过渡窗口已失效');ready=true;}).catch(error=>{if(win===target){win=null;ready=false;if(!target.isDestroyed())target.destroy();}throw error;});
    return load;
  }
  function sendAndWait(channel,value,phase){
    rejectPending(Error('过渡已由较新请求替代'));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(waiter?.token===value.token){const stages=waiter.trace.join('>')||'no-ipc-trace';waiter=null;reject(Error(`过渡画面响应超时 (${phase}; ${stages})`));}},800);waiter={token:value.token,phase,timer,resolve,reject,trace:[]};try{win.webContents.send(channel,value);}catch(error){rejectPending(error);}});
  }
  return {
    warm(){return ensure().catch(onError);},
    async prepare(value){
      const current=++revision;prepared=false;
      await ensure();
      if(current!==revision)throw Error('过渡已由较新请求替代或取消');
      if(!ready||!win||win.isDestroyed())throw Error('过渡窗口未就绪');
      const target=win;
      try{
        // Hidden or resized hosts need a transparent live compositor. Weather's
        // same-bounds second prepare must retain its already painted source.
        const bounds=target.getBounds(),stage=!target.isVisible()||target.getOpacity()===0||['x','y','width','height'].some(key=>bounds[key]!==value.bounds[key]);
        target.setAlwaysOnTop(getAlwaysOnTop(),'floating');
        if(stage){target.setOpacity(0);target.setBounds(value.bounds,false);target.showInactive();}
        await sendAndWait('pet:quota-card-transition-prepare',value,'prepared');
        if(current!==revision||win!==target||target.isDestroyed())throw Error('过渡已由较新请求替代或取消');
        prepared=true;
      }catch(error){if(current===revision&&win===target){prepared=false;conceal(target);}throw error;}
    },
    show(){if(prepared&&ready&&win&&!win.isDestroyed()){win.showInactive();win.setOpacity(1);}},
    animate(value){if(!ready||!win||win.isDestroyed())return Promise.reject(Error('过渡窗口未就绪'));return sendAndWait('pet:quota-card-transition-animate',value,'finished');},
    hide(){revision++;prepared=false;rejectPending(Error('过渡已取消'));conceal(win);},
    destroy(){closed=true;revision++;prepared=false;rejectPending(Error('过渡已关闭'));ipcMain.removeListener('pet:quota-card-transition-ack',ack);ipcMain.removeListener('pet:quota-card-transition-trace',trace);const old=win;win=null;ready=false;if(old&&!old.isDestroyed())old.destroy();},
    getWindow:()=>win&&!win.isDestroyed()?win:null
  };
}
module.exports={createQuotaCardTransitionWindow};
