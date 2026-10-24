const path = require('node:path');
const SIZE = 44, HANDLE = 32, INSET = 6, GAP = 10;
const APPEAR_MIN = 2 * 60000, APPEAR_MAX = 5 * 60000, STAY_MIN = 5 * 60000, STAY_MAX = 10 * 60000;
const kindFor = theme => theme === 'halloween' ? 'candy' : theme === 'christmas' ? 'gift' : null;
function handleHit(x,y){if(![x,y].every(Number.isFinite)||x<INSET||y<INSET||x>SIZE-INSET||y>SIZE-INSET)return false;return Math.hypot(x-Math.max(15,Math.min(29,x)),y-Math.max(15,Math.min(29,y)))<=9;}
function normalizeState(value) {
  if (!value || typeof value.eligible !== 'boolean' || !kindFor(value.theme) ||
      !['left','right'].includes(value.facing)) return null;
  const b=value.ink;
  const transient=value.transient===true&&value.eligible===false&&value.playing!==true;
  if(!b&&transient)return {theme:value.theme,eligible:false,transient:true,playing:false,hideSource:false,facing:value.facing,ink:null};
  if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.x<0||b.y<0||b.width<=0||b.height<=0||b.x+b.width>1.001||b.y+b.height>1.001)return null;
  return {theme:value.theme,eligible:value.eligible,transient,playing:value.playing===true,dragging:value.dragging===true,hideSource:value.hideSource===true,facing:value.facing,ink:{x:b.x,y:b.y,width:b.width,height:b.height}};
}
function placement(pet,area,state) {
  if(!pet||!area||!state||![pet.x,pet.y,pet.width,pet.height,area.x,area.y,area.width,area.height].every(Number.isFinite)||pet.width<=0||pet.height<=0)return null;
  const ink={x:pet.x+state.ink.x*pet.width,y:pet.y+state.ink.y*pet.height,width:state.ink.width*pet.width,height:state.ink.height*pet.height};
  const buttonLeft=state.facing==='left'?ink.x-GAP-HANDLE:ink.x+ink.width+GAP;
  const x=Math.round(buttonLeft-INSET), y=Math.round(Math.max(area.y,Math.min(area.y+area.height-SIZE,ink.y+ink.height*.72-SIZE/2)));
  // Never clamp horizontally back over the character. A cramped screen edge uses the menu.
  if(x<area.x||x+SIZE>area.x+area.width)return null;
  return {bounds:{x,y,width:SIZE,height:SIZE},ink,kind:kindFor(state.theme),side:state.facing,gap:GAP};
}
function hit(point,ink) {
  const x=(point.x-ink.x-ink.width*.5)/(ink.width*.5),y=(point.y-ink.y-ink.height*.55)/(ink.height*.48);
  return x*x+y*y<=1;
}
function createSheepOfferingWindow({BrowserWindow,screen,getPetWindow,getTheme,getSuppressed=()=>false,onPointer=()=>{},alwaysOnTop=true,onError=()=>{},random=Math.random,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let win=null,ready=false,current=null,drag=null,hoverWatch=null,top=alwaysOnTop;
  let phase='idle',timer=null,expires=0;
  const delay=(min,max)=>min+Math.floor(Math.max(0,Math.min(1,random()))*(max-min));
  function resetSchedule(){clearTimer(timer);timer=null;phase='idle';expires=0;}
  function environmentAvailable(){const pet=getPetWindow();return pet&&!pet.isDestroyed()&&pet.isVisible()&&!getSuppressed()&&current&&getTheme()===current.theme;}
  function available(){return environmentAvailable()&&current.eligible&&!current.playing&&!current.hideSource;}
  function send(event){onPointer(event);}
  function syncPointer(){if(!win||win.isDestroyed()||!win.isVisible()||drag)return;const p=screen.getCursorScreenPoint?.(),b=win.getBounds();win.setIgnoreMouseEvents(!p||!handleHit(p.x-b.x,p.y-b.y),{forward:true});}
  function hideWindow(){clearInterval(hoverWatch);hoverWatch=null;const hadDrag=Boolean(drag);drag=null;if(win&&!win.isDestroyed()){if(ready)win.webContents.send('pet:offering-view',{reset:true});win.hide();}if(hadDrag)send({type:'cancel'});}
  function hide(){resetSchedule();hideWindow();}
  function expire(){timer=null;if(drag)return;resetSchedule();hideWindow();present();}
  function present(){
    if(!environmentAvailable()){hide();return;}
    if(current.transient){hideWindow();return;}
    if(!available()){hide();return;}
    if(drag)return;
    const pet=getPetWindow().getBounds(),place=placement(pet,screen.getDisplayMatching(pet).workArea,current);
    if(!place){hide();return;}
    if(phase==='idle'){
      phase='waiting';timer=setTimer(()=>{timer=null;if(!environmentAvailable()||(!available()&&!current.transient)){hide();return;}phase='visible';expires=now()+delay(STAY_MIN,STAY_MAX);timer=setTimer(expire,expires-now());present();},delay(APPEAR_MIN,APPEAR_MAX));timer?.unref?.();return;
    }
    if(phase==='waiting')return;
    if(now()>=expires){expire();return;}
    if(!win||win.isDestroyed()) {
      ready=false;const created=new BrowserWindow({width:SIZE,height:SIZE,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,focusable:false,skipTaskbar:true,alwaysOnTop:top,
        webPreferences:{preload:path.join(__dirname,'../sheep-offering-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
      win=created;created.setAlwaysOnTop(top,'floating');created.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});created.setHiddenInMissionControl?.(true);
      created.setIgnoreMouseEvents(true,{forward:true});
      created.webContents.setWindowOpenHandler(()=>({action:'deny'}));created.webContents.on('will-navigate',e=>e.preventDefault());
      created.webContents.on('did-finish-load',()=>{if(win===created){ready=true;present();}});
      created.webContents.on('render-process-gone',()=>{if(win===created){destroy();onError(new Error('送物入口页面退出'));}});
      created.on('closed',()=>{if(win===created){win=null;ready=false;hide();}});
      created.loadFile(path.join(__dirname,'../sheep-offering.html')).catch(error=>{if(win===created)destroy();onError(error);});
    }
    if(ready&&win&&!win.isDestroyed()){win.setBounds(place.bounds,false);win.webContents.send('pet:offering-view',{kind:place.kind,side:place.side});win.showInactive();syncPointer();if(!hoverWatch){hoverWatch=setInterval(syncPointer,75);hoverWatch.unref?.();}}
  }
  function update(value){
    const next=normalizeState(value);if(!next){current=null;hide();return false;}
    if(current?.theme!==next.theme||(!next.eligible&&!next.transient)||next.playing)hide();
    current=next;present();return true;
  }
  function handle(event,input){
    if(!win||win.isDestroyed()||event.sender!==win.webContents||!input||!['hit','approach','begin','move','end','cancel','activate'].includes(input.type))return false;
    if(input.type==='cancel'){hideWindow();present();return true;}
    if(!available()){hide();return false;}
    if(phase!=='visible'||!win.isVisible())return false;
    if(input.type==='hit'){win.setIgnoreMouseEvents(!drag&&!handleHit(input.x,input.y),{forward:true});return true;}
    if(input.type==='approach'){send({type:'approach'});return true;}
    if(input.type==='activate'){resetSchedule();hideWindow();send({type:'drop',kind:kindFor(current.theme),accepted:true});present();return true;}
    const x=input.x,y=input.y;
    if(![x,y].every(Number.isFinite)||Math.abs(x)>8192||Math.abs(y)>8192)return false;
    if(input.type==='begin'){
      if(drag||!win.isVisible()||!handleHit(x,y))return false;
      drag={offset:{x,y},origin:win.getBounds(),kind:kindFor(current.theme)};win.setIgnoreMouseEvents(false);send({type:'begin'});return true;
    }
    if(!drag)return false;
    const bounds=win.getBounds(),pet=getPetWindow().getBounds(),area=screen.getDisplayMatching(pet).workArea;
    const point={x:bounds.x+x,y:bounds.y+y};
    const moved={x:Math.round(Math.max(area.x,Math.min(area.x+area.width-SIZE,point.x-drag.offset.x))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-SIZE,point.y-drag.offset.y))),width:SIZE,height:SIZE};
    win.setBounds(moved,false);
    if(input.type==='end'){
      const kind=drag.kind,place=placement(pet,area,current),clicked=Math.hypot(moved.x-drag.origin.x,moved.y-drag.origin.y)<4;
      const accepted=clicked||Boolean(place&&hit({x:moved.x+SIZE/2,y:moved.y+SIZE/2},place.ink));
      drag=null;if(accepted)resetSchedule();win.hide();send({type:'drop',kind,accepted});present();
    }
    return true;
  }
  function destroy(){hide();current=null;const old=win;win=null;ready=false;if(old&&!old.isDestroyed())old.destroy();}
  return {update,handle,hide,destroy,reposition:present,getWindow:()=>win,setAlwaysOnTop(value){top=value===true;if(win&&!win.isDestroyed())win.setAlwaysOnTop(top,'floating');}};
}
module.exports={createSheepOfferingWindow,placement,normalizeState,handleHit,SIZE,HANDLE,INSET,GAP,APPEAR_MIN,APPEAR_MAX,STAY_MIN,STAY_MAX};
