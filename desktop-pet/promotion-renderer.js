(()=>{
  'use strict';
  const $=id=>document.getElementById(id),detail=$('skin-promotion'),contact=$('skin-promo-contact'),canvas=$('skin-promo-canvas'),stage=$('skin-promo-stage'),api=window.petCustomizer,cases=window.SkinPromotionClips;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let paused=reduced.matches,selected=cases[0],action='idle',returnFocus=$('skin-promo-banner'),pendingGhost=null;
  const labels={idle:'待机',wave:'招手',walk:'行走',sleep:'睡眠',kfc:'肯德基梦境',dumplings:'吃饺子',firecrackers:'放烟花',groom:'舔爪',bone:'玩骨头',happy:'开心动作'};
  const player=window.SkinPromotionPlayer.create({canvas,loadImage:url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('案例素材加载失败'));image.src=url;}),onReady:()=>{if(pendingGhost){const ghost=pendingGhost;pendingGhost=null;ghost.animate([{opacity:1},{opacity:0}],{duration:300,easing:'ease-out'}).finished.then(()=>ghost.remove(),()=>ghost.remove());canvas.animate([{opacity:0},{opacity:1}],{duration:300,easing:'ease-out'});}},onError:()=>{ghosts();$('skin-promo-error').textContent='案例暂时无法显示，仍可添加微信咨询。';$('skin-promo-error').hidden=false;}});
  function ghosts(){pendingGhost=null;stage.querySelectorAll('.skin-promo-ghost').forEach(node=>{node.getAnimations().forEach(a=>a.cancel());node.remove();});canvas.getAnimations().forEach(a=>a.cancel());}
  function render(){
    $('skin-promo-error').hidden=true;$('skin-promo-case-name').textContent=selected.name;$('skin-promo-case-type').textContent=selected.type;canvas.setAttribute('aria-label',selected.name+'动态预览');
    document.querySelectorAll('[data-promotion-case]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.promotionCase===selected.id)));
    const select=$('skin-promo-action');select.replaceChildren(...Object.keys(selected.clips).map(id=>{const option=document.createElement('option');option.value=id;option.textContent=labels[id];return option;}));select.value=action;
    $('skin-promo-toggle').textContent=paused?'播放动画':'暂停动画';$('skin-promo-toggle').setAttribute('aria-pressed',String(paused));player.play(selected,action,paused);
  }
  function choose(id){
    const next=cases.find(c=>c.id===id);if(!next||next===selected)return;ghosts();let ghost;
    if(!reduced.matches&&canvas.width>0){ghost=document.createElement('canvas');ghost.width=canvas.width;ghost.height=canvas.height;ghost.getContext('2d').drawImage(canvas,0,0);ghost.className='skin-promo-ghost';ghost.setAttribute('aria-hidden','true');stage.append(ghost);}
    selected=next;if(!selected.clips[action])action='idle';render();
    if(ghost)pendingGhost=ghost;
  }
  function openPromotion(token){
    if(!detail.open){returnFocus=token?$('skin-promo-banner'):document.activeElement instanceof HTMLElement?document.activeElement:$('skin-promo-banner');if(!returnFocus||returnFocus===document.body)returnFocus=$('skin-promo-banner');detail.showModal();render();}
    if(token)api.promotionReady(token);
  }
  $('skin-promo-banner').addEventListener('click',()=>openPromotion());$('skin-promo-badge').addEventListener('click',event=>{event.stopPropagation();openPromotion();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(contact.open||detail.open)){event.preventDefault();event.stopImmediatePropagation();if(contact.open)contact.close();else detail.close();}},true);
  $('skin-promo-close').addEventListener('click',()=>detail.close());
  detail.addEventListener('close',()=>{player.stop();ghosts();if(returnFocus?.isConnected)returnFocus.focus();});
  document.querySelectorAll('[data-promotion-case]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.promotionCase)));
  const promotionActionSelect = $('skin-promo-action');
  promotionActionSelect.addEventListener('pointerdown', () => { promotionActionSelect.dataset.pointerFocus = 'true'; });
  promotionActionSelect.addEventListener('keydown', () => { delete promotionActionSelect.dataset.pointerFocus; });
  promotionActionSelect.addEventListener('blur', () => { delete promotionActionSelect.dataset.pointerFocus; });
  $('skin-promo-action').addEventListener('change',event=>{ghosts();action=event.target.value;render();});
  $('skin-promo-toggle').addEventListener('click',()=>{paused=!paused;player.setPaused(paused);$('skin-promo-toggle').textContent=paused?'播放动画':'暂停动画';$('skin-promo-toggle').setAttribute('aria-pressed',String(paused));});
  $('skin-promo-contact-open').addEventListener('click',()=>{$('skin-promo-contact-status').textContent='';contact.showModal();});
  $('skin-promo-contact-close').addEventListener('click',()=>contact.close());contact.addEventListener('close',()=>{if(detail.open)$('skin-promo-contact-open').focus();});
  async function contactAction(action){const button=$(action==='copy'?'skin-promo-copy':'skin-promo-save');button.disabled=true;try{const result=await api.promotionContact(action);$('skin-promo-contact-status').textContent=result?.ok?(action==='copy'?'微信号已复制':'二维码已保存'):result?.canceled?'已取消保存':result?.error||'操作未完成，请重试';}catch(_){$('skin-promo-contact-status').textContent='操作未完成，请重试';}finally{button.disabled=false;}}
  $('skin-promo-copy').addEventListener('click',()=>contactAction('copy'));$('skin-promo-save').addEventListener('click',()=>contactAction('save-qr'));
  api.onPromotionOpen(token=>openPromotion(token));api.onVisibility(visible=>{if(!visible){player.stop();ghosts();}else if(detail.open)render();});
  reduced.addEventListener('change',event=>{if(event.matches){paused=true;player.setPaused(true);ghosts();$('skin-promo-toggle').textContent='播放动画';$('skin-promo-toggle').setAttribute('aria-pressed','true');}});
  window.addEventListener('beforeunload',()=>{player.stop();ghosts();});
  // The shell is opened before customize-renderer starts its async data loading.
  const query=new URLSearchParams(location.search);if(query.get('promotion')==='1')openPromotion(query.get('request'));
})();
