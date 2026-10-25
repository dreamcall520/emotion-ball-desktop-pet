const path=require('node:path');
function quotaCardBarBounds(pet,area,presentation={}) {
  const width=48,height=20;
  const x=presentation.mode==='peeked' ? presentation.side==='left'?area.x+2:area.x+area.width-width-2 : pet.x+(pet.width-width)/2;
  const y=pet.y+pet.height+height+4<=area.y+area.height?pet.y+pet.height+4:pet.y-height-4;
  return {x:Math.round(Math.max(area.x,Math.min(x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(y,area.y+area.height-height))),width,height};
}
function createQuotaCardGroupWindow({BrowserWindow,screen,getPetWindow,getPresentation,onActivate,onDismiss,ipcMain,getAlwaysOnTop=()=>true,onLayout=()=>{}}) {
  let win=null,shown=false,currentState=null;
  const live=()=>win&&!win.isDestroyed();
  ipcMain.on('pet:quota-card-group-action',(event,action)=>{if(!live()||event.sender!==win.webContents||!win.isVisible())return;if(action==='dismiss')onDismiss();else if(action==='activate')onActivate();});
  function ensure(){if(live())return;win=new BrowserWindow({width:48,height:20,show:false,frame:false,transparent:true,resizable:false,skipTaskbar:true,alwaysOnTop:getAlwaysOnTop(),hasShadow:false,webPreferences:{preload:path.join(__dirname,'../quota-card-group-preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false}});win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.loadFile(path.join(__dirname,'../quota-card-group.html'));win.on('closed',()=>{win=null;});win.webContents.on('did-finish-load',()=>{if(shown){win.webContents.send('pet:quota-card-group-state',currentState);win.showInactive();onLayout();}});}
  return {show(state){currentState={expanded:state.expanded,count:state.eligible.length};shown=true;ensure();win.setAlwaysOnTop(getAlwaysOnTop(),'floating');const pet=getPetWindow();if(!pet||pet.isDestroyed())return;win.setBounds(quotaCardBarBounds(pet.getBounds(),screen.getDisplayMatching(pet.getBounds()).workArea,getPresentation()),false);win.webContents.send('pet:quota-card-group-state',{expanded:state.expanded,count:state.eligible.length});if(!win.webContents.isLoading?.())win.showInactive();},hide(){shown=false;if(live())win.hide();},getBounds(){return shown&&live()&&win.isVisible()?win.getBounds():null;},destroy(){shown=false;if(live())win.destroy();win=null;}};
}
module.exports={quotaCardBarBounds,createQuotaCardGroupWindow};
