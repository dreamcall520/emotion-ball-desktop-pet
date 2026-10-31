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
  const x=anchor.x+(anchor.width-width)/2;
  // The painted 7px capsule starts 6.5px inside its 20px native hit target.
  const below=anchor.y+anchor.height+.5, above=Math.min(anchor.y,visual.y)-height-.5;
  const stackAbove=cards.length>0&&anchor.y+anchor.height<=visual.y;
  const preferAbove=presentation.quotaPreferredPlacement==='above';
  const y=!preferAbove&&!stackAbove&&below+height<=area.y+area.height?below:above;

  const clampBounds=(x,y)=>({x:Math.round(Math.max(area.x,Math.min(x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(y,area.y+area.height-height))),width,height});
  const preferred=clampBounds(x,y);
  const bubble=presentation.bubbleBounds;
  const overlaps=(a,b)=>b&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  if(!overlaps(preferred,bubble))return preferred;
  // A side stack can leave its top capsule inside the dialogue. Keep the
  // capsule beside the same stack rather than splitting its x/y anchors.
  const candidates=[clampBounds(x,below),clampBounds(x,above),
    clampBounds(anchor.x+anchor.width+8,y),clampBounds(anchor.x-width-8,y),
    clampBounds(x,bubble.y-height-8),clampBounds(x,bubble.y+bubble.height+8)];
  return candidates.find(b=>![visual,bubble,...cards].some(o=>overlaps(b,o)))||preferred;
}
function createQuotaCardGroupWindow({BrowserWindow,screen,getPetWindow,getPresentation,onActivate,onDismiss,ipcMain,getAlwaysOnTop=()=>true,onLayout=()=>{}}) {
  let win=null,shown=false,currentState=null,lastBounds=null,topmost=null,ignoring=null;
  let layoutBatchDepth=0,pendingNative=false;
  const live=()=>win&&!win.isDestroyed();
  function applyNativeLayout(loaded=false){
    if(!live()||!shown||!lastBounds)return;
    const actual=win.getBounds();
    if(['x','y','width','height'].some(key=>actual?.[key]!==lastBounds[key]))win.setBounds(lastBounds,false);
    // Native move callbacks may synchronously hide or replace this presentation.
    if(live()&&shown&&(loaded||!win.webContents.isLoading?.())&&!win.isVisible())win.showInactive();
  }
  ipcMain.on('pet:quota-card-group-action',(event,action)=>{if(!live()||event.sender!==win.webContents||!win.isVisible())return;if(action==='dismiss')onDismiss();else if(['activate','keyboard','pointer'].includes(action))onActivate(action!=='pointer');});
  function ensure(){if(live())return;topmost=null;ignoring=null;win=new BrowserWindow({width:48,height:20,show:false,frame:false,transparent:true,resizable:false,skipTaskbar:true,alwaysOnTop:getAlwaysOnTop(),hasShadow:false,webPreferences:{preload:path.join(__dirname,'../quota-card-group-preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false}});win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.loadFile(path.join(__dirname,'../quota-card-group.html'));win.on('closed',()=>{win=null;pendingNative=false;});win.webContents.on('did-finish-load',()=>{if(shown){win.webContents.send('pet:quota-card-group-state',currentState);if(!layoutBatchDepth){applyNativeLayout(true);onLayout();}}});}
  return {
    show(state){
      currentState={expanded:state.expanded,count:state.eligible.length,transitioning:state.transitioning===true};shown=true;ensure();
      const top=getAlwaysOnTop(),ignore=state.expanded===true||state.transitioning===true;
      if(top!==topmost){win.setAlwaysOnTop(top,'floating');topmost=top;}
      if(ignore!==ignoring){win.setIgnoreMouseEvents?.(ignore,{forward:true});ignoring=ignore;}
      const pet=getPetWindow();if(!pet||pet.isDestroyed())return;
      if((!state.expanded&&!state.keepBounds)||!lastBounds)lastBounds=quotaCardBarBounds(pet.getBounds(),screen.getDisplayMatching(pet.getBounds()).workArea,getPresentation());
      win.webContents.send('pet:quota-card-group-state',currentState);
      if(layoutBatchDepth&&!state.expanded){pendingNative=true;return;}
      pendingNative=false;applyNativeLayout();
    },
    // Shortcut restoration synchronously settles several cards. Plan against
    // the requested anchor, then commit only the final collapsed bar position.
    batchCollapsedLayout(callback){
      layoutBatchDepth++;let failed=false;
      try{return callback();}
      catch(error){failed=true;throw error;}
      finally{
        layoutBatchDepth--;
        if(!layoutBatchDepth){const apply=pendingNative;pendingNative=false;if(apply&&shown&&!failed)applyNativeLayout();}
      }
    },
    hide(){shown=false;pendingNative=false;if(live()&&win.isVisible())win.hide();},
    getBounds(){return shown&&live()?(layoutBatchDepth&&pendingNative?{...lastBounds}:win.isVisible()?win.getBounds():null):null;},
    getWindow(){return live()?win:null;},
    destroy(){shown=false;pendingNative=false;if(live())win.destroy();win=null;}
  };
}
module.exports={quotaCardBarBounds,createQuotaCardGroupWindow};
