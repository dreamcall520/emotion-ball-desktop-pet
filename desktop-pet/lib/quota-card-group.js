const IDS = ['codex', 'api', 'zcode', 'workbuddy'];
function normalizeQuotaCards(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const order = [...new Set((Array.isArray(value.order) ? value.order : []).filter(id => IDS.includes(id)))];
  return { order: order.concat(IDS.filter(id => !order.includes(id))), pinned: IDS.filter(id => Array.isArray(value.pinned) && value.pinned.includes(id)) };
}
function createQuotaCardGroup({ getState, getCursor, getBounds, onChange, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
  let expanded = false, keyboard = false, outsideAt = null, timer = null, stopped = false, previous = '';
  const contains = (b,p) => b && p && p.x >= b.x-5 && p.y >= b.y-5 && p.x < b.x+b.width+5 && p.y < b.y+b.height+5;
  function state() {
    const input=getState(), config=normalizeQuotaCards(input.config), eligible=config.order.filter(id=>input.eligible.includes(id));
    const active=!input.suppressed, bar=active && !input.dragging && eligible.length>1 && eligible.some(id=>!config.pinned.includes(id));
    if(!bar) { expanded=false;keyboard=false;outsideAt=null; }
    return { eligible, order:config.order, bar, expanded:bar && expanded, visible:active ? eligible.filter(id=>eligible.length<=1 || config.pinned.includes(id) || expanded) : [] };
  }
  function sync() { const value=state(), key=JSON.stringify(value);if(key!==previous){previous=key;onChange(value);}if(!value.bar){cancel(timer);timer=null;}else if(timer===null&&!stopped)timer=schedule(tick,80);return value; }
  function tick(){timer=null;if(stopped)return;const current=state(), point=getCursor();
    const inside=current.bar && (getBounds(current.expanded).some(b=>contains(b,point)));
    if(inside){expanded=true;outsideAt=null;}else if(!keyboard && expanded){outsideAt ??= now();if(now()-outsideAt>=220){expanded=false;outsideAt=null;}}
    sync();
  }
  return { sync, getState:state, activate(){if(!state().bar)return;keyboard=!keyboard;expanded=keyboard;outsideAt=null;sync();},
    dismiss(){keyboard=false;expanded=false;outsideAt=null;sync();}, start(){if(stopped)return;if(timer===null)tick();},
    close(){stopped=true;cancel(timer);timer=null;expanded=false;keyboard=false;} };
}
module.exports={normalizeQuotaCards,createQuotaCardGroup};
