(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SheepOffering = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const KIND = Object.freeze({ halloween: 'candy', christmas: 'gift' });
  const inkCache = new WeakMap();
  function measureInk(target) {
    const source=target.querySelector?.('canvas.sheep-skin');
    if(!source||source.dataset.ready!=='true')return null;
    const key=[source.width,source.height,source.dataset.action,source.dataset.theme,source.dataset.facing,source.dataset.idlePose,source.dataset.frame,source.dataset.transition,source.dataset.buddy].join(':');
    let cached=inkCache.get(source);
    if(cached?.key!==key){
      const data=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
      let x0=source.width,y0=source.height,x1=-1,y1=-1;
      for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(data[(y*source.width+x)*4+3]>24){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      if(x1<0)return null;cached={key,x0,y0,x1:x1+1,y1:y1+1};inkCache.set(source,cached);
    }
    const host=target.getBoundingClientRect(),box=source.getBoundingClientRect(),side=Math.min(box.width,box.height);
    if(!(host.width>0&&host.height>0&&side>0))return null;
    const left=box.left+(box.width-side)/2,top=box.top+(box.height-side)/2;
    return {x:(left-host.left+cached.x0/source.width*side)/host.width,y:(top-host.top+cached.y0/source.height*side)/host.height,
      width:(cached.x1-cached.x0)/source.width*side/host.width,height:(cached.y1-cached.y0)/source.height*side/host.height};
  }
  function createExternal({target,getState,onReceive,onCancel,onInteract,onApproach,external}) {
    let playing=false,dragging=false,destroyed=false,starting=false,theme=null,hoverUntil=0;
    const view=target.ownerDocument.defaultView,now=()=>view.performance?.now?.()??Date.now();
    function publish(){if(starting)return;const state=getState()||{};external.update({...state,playing,dragging,facing:target.dataset?.facing==='left'?'left':'right'});}
    function cancel(notify=true){const wasPlaying=playing;playing=false;dragging=false;if(notify&&wasPlaying)onCancel?.();if(!destroyed)publish();}
    function update(){if(destroyed)return;const state=getState()||{};if(theme!==state.theme||!state.eligible){const was=playing;playing=false;dragging=false;if(was)onCancel?.();}theme=state.theme;publish();}
    function offer(kind=KIND[(getState()||{}).theme]){const state=getState()||{};if(destroyed||playing||!state.eligible||!kind||KIND[state.theme]!==kind)return false;dragging=false;hoverUntil=now()+700;onApproach?.();starting=true;let accepted;try{accepted=onReceive(kind)===true;}finally{starting=false;}if(!accepted){update();return false;}playing=true;publish();return true;}
    const remove=external.onPointer(event=>{if(destroyed)return;if(event?.type==='approach'){hoverUntil=now()+700;onApproach?.();}
      else if(event?.type==='begin'){dragging=true;hoverUntil=now()+700;onApproach?.();onInteract?.();publish();}
      else if(event?.type==='drop'){dragging=false;hoverUntil=now()+700;if(event.accepted)offer(event.kind);else update();}
      else if(event?.type==='cancel'){dragging=false;update();}});
    function destroy(){if(destroyed)return;cancel();destroyed=true;external.update({eligible:false});remove?.();view.removeEventListener('pagehide',destroy);}
    view.addEventListener('pagehide',destroy);update();
    return Object.freeze({update,offer,cancel,destroy,isPlaying:()=>playing,isDragging:()=>dragging,blocksHover:()=>playing||dragging||now()<hoverUntil});
  }
  function hitTarget(point, rect) {
    if (![point.x, point.y, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return false;
    const x = ((point.x - rect.left) / rect.width - .5) / .45;
    const y = ((point.y - rect.top) / rect.height - .55) / .42;
    return x * x + y * y <= 1;
  }
  function create({ target, getState, onReceive, onCancel, onInteract, onApproach, external }) {
    if(external?.update&&external?.onPointer)return createExternal({target,getState,onReceive,onCancel,onInteract,onApproach,external});
    const doc = target.ownerDocument, view = doc.defaultView, removers = [], hinted = new Set();
    const button = doc.createElement('button'), art = doc.createElement('img');
    button.type = 'button'; button.className = 'sheep-offering'; button.hidden = true;
    art.alt = ''; art.draggable = false; button.appendChild(art); doc.body.appendChild(button);
    let drag = null, playing = false, destroyed = false, theme = null, hintTimer = null, hintHideTimer = null, hoverUntil = 0;
    const now = () => view.performance?.now?.() ?? Date.now();
    function on(node, type, fn) { node.addEventListener(type, fn); removers.push(() => node.removeEventListener(type, fn)); }
    function stop(event) { event.stopPropagation(); event.preventDefault(); }
    function clearHint() { view.clearTimeout(hintTimer); view.clearTimeout(hintHideTimer); hintTimer = hintHideTimer = null; delete button.dataset.hint; }
    function resetDrag() {
      const previous = drag; drag = null; button.classList.remove('dragging');
      button.style.removeProperty('--offering-x'); button.style.removeProperty('--offering-y');
      if (previous && button.hasPointerCapture?.(previous.id)) button.releasePointerCapture(previous.id);
    }
    function cancel(notify = true) {
      const wasPlaying = playing; playing = false; resetDrag(); clearHint(); delete button.dataset.receiving;
      if (notify && wasPlaying) onCancel?.();
    }
    function state() { return getState() || {}; }
    function approach(event) {
      if (destroyed || button.hidden || playing || !state().eligible) return;
      const rect = button.getBoundingClientRect();
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
          event.clientX < rect.left - 24 || event.clientX > rect.left + rect.width + 24 ||
          event.clientY < rect.top - 24 || event.clientY > rect.top + rect.height + 24) return;
      hoverUntil = now() + 700;
      onApproach?.();
    }
    function update() {
      if (destroyed) return;
      const next = state(), kind = KIND[next.theme];
      if (theme !== next.theme || !next.eligible) cancel();
      theme = next.theme;
      const show = Boolean(kind && next.eligible && Math.min(view.innerWidth, view.innerHeight) >= 108);
      button.hidden = !show || playing;
      button.setAttribute('aria-disabled', String(!next.eligible || playing));
      if (!kind) return;
      button.dataset.kind = kind;
      // Match the rendered face: keep the offering in front, not behind the sheep.
      // Hold its anchor while dragging, even if an activity sample changes facing.
      if (!drag) button.dataset.side = target.dataset?.facing === 'left' ? 'left' : 'right';
      const name = kind === 'candy' ? '糖果' : '礼物';
      button.title = `按住${name}拖给咩咩，也可从「咩咩互动」菜单送出`;
      button.setAttribute('aria-label', `给咩咩送${name}：拖到身上，或按回车、空格`);
      const source = `assets/sheep/props/${kind}.png`;
      if (art.getAttribute('src') !== source) art.src = source;
      if (show && !playing && !drag && !hinted.has(theme) && hintTimer === null) {
        const expectedTheme = theme;
        hintTimer = view.setTimeout(() => {
          hintTimer = null;
          if (destroyed || playing || drag || !state().eligible || theme !== expectedTheme) return;
          hinted.add(theme); button.dataset.hint = 'true';
          hintHideTimer = view.setTimeout(() => { hintHideTimer = null; delete button.dataset.hint; }, 1800);
        }, 2700);
      }
    }
    function offer(kind = KIND[state().theme]) {
      const next = state();
      if (destroyed || playing || !next.eligible || !kind || KIND[next.theme] !== kind) return false;
      hinted.add(next.theme); hoverUntil = now() + 700; resetDrag(); clearHint();
      // Start before claiming receipt; a rejected action keeps the source available.
      if (onReceive(kind) !== true) { update(); return false; }
      playing = true; button.hidden = true; button.dataset.receiving = kind; button.setAttribute('aria-disabled', 'true');
      return true;
    }
    on(button, 'pointerdown', event => {
      stop(event);
      if (event.button !== 0 || event.isPrimary === false || playing || drag || !state().eligible) return;
      const rect = button.getBoundingClientRect();
      hinted.add(theme); hoverUntil = now() + 700; clearHint();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      button.classList.add('dragging');
      try { button.setPointerCapture(event.pointerId); } catch (_) { resetDrag(); }
      if (drag) onInteract?.();
    });
    on(button, 'pointermove', event => {
      stop(event); if (!drag || drag.id !== event.pointerId) return;
      const dx = Math.max(6 - drag.left, Math.min(view.innerWidth - 6 - drag.left - drag.width, event.clientX - drag.x));
      const dy = Math.max(6 - drag.top, Math.min(view.innerHeight - 6 - drag.top - drag.height, event.clientY - drag.y));
      button.style.setProperty('--offering-x', `${dx}px`);
      button.style.setProperty('--offering-y', `${dy}px`);
    });
    on(button, 'pointerup', event => {
      stop(event); if (!drag || drag.id !== event.pointerId) return;
      const r = button.getBoundingClientRect(), accepted = hitTarget({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, target.getBoundingClientRect());
      hoverUntil = now() + 700; resetDrag(); if (accepted) offer(); else update();
    });
    on(button, 'pointercancel', event => { stop(event); if (drag?.id === event.pointerId) { resetDrag(); update(); } });
    on(button, 'lostpointercapture', () => { if (drag) { resetDrag(); update(); } });
    on(button, 'click', event => { stop(event); if (event.detail === 0) offer(); });
    on(button, 'dblclick', stop); on(button, 'contextmenu', stop);
    on(button, 'pointerenter', approach);
    on(view, 'pointermove', approach);
    on(view, 'blur', () => { cancel(); update(); });
    on(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); update(); });
    function destroy() { if (destroyed) return; cancel(); destroyed = true; removers.forEach(remove => remove()); button.remove(); }
    on(view, 'pagehide', destroy);
    update();
    return Object.freeze({ update, offer, cancel, destroy, isPlaying: () => playing, isDragging: () => Boolean(drag), blocksHover: () => playing || Boolean(drag) || now() < hoverUntil });
  }
  return Object.freeze({ hitTarget, create, measureInk });
}));
