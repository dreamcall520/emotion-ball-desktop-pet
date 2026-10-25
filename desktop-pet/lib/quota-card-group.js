const IDS = ['codex', 'api', 'zcode', 'workbuddy'];
function normalizeQuotaCards(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const order = [...new Set((Array.isArray(value.order) ? value.order : []).filter(id => IDS.includes(id)))];
  return { order: order.concat(IDS.filter(id => !order.includes(id))), pinned: IDS.filter(id => Array.isArray(value.pinned) && value.pinned.includes(id)) };
}
function createQuotaCardGroup({ getState, getCursor, getBounds, onChange, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
  let expanded = false, keyboard = false, blocked = false, outsideAt = null, timer = null, stopped = false, previous = '', interactionBridge = null, interactionTargets = [], layoutContext = null;
  const contains = (b,p) => b && p && p.x >= b.x-5 && p.y >= b.y-5 && p.x < b.x+b.width+5 && p.y < b.y+b.height+5;
  function state() {
    const input=getState(), config=normalizeQuotaCards(input.config), eligible=config.order.filter(id=>input.eligible.includes(id));
    const active=!input.suppressed, bar=active && !input.dragging && eligible.length>1 && eligible.some(id=>!config.pinned.includes(id));
    if(!bar) { expanded=false;keyboard=false;blocked=false;outsideAt=null; }
    if(!bar||!expanded){interactionBridge=null;interactionTargets=[];}
    return { eligible, order:config.order, bar, expanded:bar && expanded, visible:active ? eligible.filter(id=>eligible.length<=1 || config.pinned.includes(id) || expanded) : [] };
  }
  function sync() { const value=state(), key=JSON.stringify(value);if(key!==previous){previous=key;onChange(value);}if(!value.bar){cancel(timer);timer=null;}else if(timer===null&&!stopped)timer=schedule(tick,80);return value; }
  function tick(){timer=null;if(stopped)return;const current=state(), point=getCursor();
    if(interactionBridge&&interactionTargets.some(b=>contains(b,point))){interactionBridge=null;interactionTargets=[];}
    const inside=current.bar && ([...getBounds(current.expanded),...(current.expanded&&interactionBridge?[interactionBridge]:[])].some(b=>contains(b,point)));
    if(!inside)blocked=false;
    if(inside&&!blocked){expanded=true;outsideAt=null;}else if(!keyboard && expanded){outsideAt ??= now();if(now()-outsideAt>=220){expanded=false;outsideAt=null;}}
    sync();
  }
  function retainLayout(previous,next,context) {
    if(context!==layoutContext){layoutContext=context;interactionBridge=null;interactionTargets=[];return;}
    if(!state().expanded||!previous?.cards||!next?.cards)return;
    const before=Object.values(previous.cards).filter(Boolean),after=Object.values(next.cards).filter(Boolean);
    if(!Object.keys(previous.cards).some(id=>{const a=previous.cards[id],b=next.cards[id];return a&&b&&(a.width!==b.width||a.height!==b.height)}))return;
    const rows=[...before,...after];interactionTargets=after;
    if(!rows.length)return;
    const x=Math.min(...rows.map(b=>b.x)),y=Math.min(...rows.map(b=>b.y));
    interactionBridge={x,y,width:Math.max(...rows.map(b=>b.x+b.width))-x,height:Math.max(...rows.map(b=>b.y+b.height))-y};outsideAt=null;
  }
  return { sync, getState:state, retainLayout, activate(options={keyboard:true}){if(!state().bar)return;if(options.keyboard===false){keyboard=false;expanded=true;blocked=false;}else{keyboard=!keyboard;expanded=keyboard;blocked=!expanded;}outsideAt=null;sync();},
    dismiss(){keyboard=false;expanded=false;blocked=true;outsideAt=null;sync();}, start(){if(stopped)return;if(timer===null)tick();},
    close(){stopped=true;cancel(timer);timer=null;expanded=false;keyboard=false;interactionBridge=null;} };
}
module.exports={normalizeQuotaCards,createQuotaCardGroup};
