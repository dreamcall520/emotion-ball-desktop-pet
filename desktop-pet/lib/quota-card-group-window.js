const path=require('node:path');
const {petVisualBounds}=require('./pet-visual-bounds');
function quotaCardBarBounds(pet,area,presentation={}) {
  const width=48,height=20;
  let visual=petVisualBounds(pet,presentation.shape,{...presentation,quotaAnchor:true});
  const ink=presentation.sheepInk?.ink;
  if(presentation.shape==='new-year-sheep'&&ink&&[ink.x,ink.y,ink.width,ink.height].every(Number.isFinite)&&ink.y>=0&&ink.y+ink.height<=1.001)
    visual={x:pet.x+pet.width*ink.x,y:pet.y+pet.height*ink.y,width:pet.width*ink.width,height:pet.height*ink.height};
  const cards=(presentation.cardStackBounds||[]).filter(b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite));
  const anchor=cards.length?{x:Math.min(...cards.map(b=>b.x)),y:Math.min(...cards.map(b=>b.y)),width:Math.max(...cards.map(b=>b.x+b.width))-Math.min(...cards.map(b=>b.x)),height:Math.max(...cards.map(b=>b.y+b.height))-Math.min(...cards.map(b=>b.y))}:visual;
  const x=visual.x+(visual.width-width)/2;
  // The painted 7px capsule starts 6.5px inside its 20px native hit target.
  const below=anchor.y+anchor.height+.5, above=Math.min(anchor.y,visual.y)-height-.5;
  const stackAbove=cards.length>0&&anchor.y+anchor.height<=visual.y;
  const y=!stackAbove&&below+height<=area.y+area.height?below:above;

  return {x:Math.round(Math.max(area.x,Math.min(x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(y,area.y+area.height-height))),width,height};
}
function createQuotaCardGroupWindow({BrowserWindow,screen,getPetWindow,getPresentation,onActivate,onDismiss,ipcMain,getAlwaysOnTop=()=>true,onLayout=()=>{}}) {
  let win=null,shown=false,currentState=null,lastBounds=null;
  const live=()=>win&&!win.isDestroyed();
  ipcMain.on('pet:quota-card-group-action',(event,action)=>{if(!live()||event.sender!==win.webContents||!win.isVisible())return;if(action==='dismiss')onDismiss();else if(['activate','keyboard','pointer'].includes(action))onActivate(action!=='pointer');});
  function ensure(){if(live())return;win=new BrowserWindow({width:48,height:20,show:false,frame:false,transparent:true,resizable:false,skipTaskbar:true,alwaysOnTop:getAlwaysOnTop(),hasShadow:false,webPreferences:{preload:path.join(__dirname,'../quota-card-group-preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false}});win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.loadFile(path.join(__dirname,'../quota-card-group.html'));win.on('closed',()=>{win=null;});win.webContents.on('did-finish-load',()=>{if(shown){win.webContents.send('pet:quota-card-group-state',currentState);win.showInactive();onLayout();}});}
  return {show(state){currentState={expanded:state.expanded,count:state.eligible.length};shown=true;ensure();win.setAlwaysOnTop(getAlwaysOnTop(),'floating');win.setIgnoreMouseEvents?.(state.expanded===true,{forward:true});const pet=getPetWindow();if(!pet||pet.isDestroyed())return;if((!state.expanded&&!state.keepBounds)||!lastBounds)lastBounds=quotaCardBarBounds(pet.getBounds(),screen.getDisplayMatching(pet.getBounds()).workArea,getPresentation());win.setBounds(lastBounds,false);win.webContents.send('pet:quota-card-group-state',{expanded:state.expanded,count:state.eligible.length});if(!win.webContents.isLoading?.())win.showInactive();},hide(){shown=false;if(live())win.hide();},getBounds(){return shown&&live()&&win.isVisible()?win.getBounds():null;},destroy(){shown=false;if(live())win.destroy();win=null;}};
}
module.exports={quotaCardBarBounds,createQuotaCardGroupWindow};
