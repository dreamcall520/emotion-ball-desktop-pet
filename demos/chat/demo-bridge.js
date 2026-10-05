/* Synthetic chat sessions, no Codex connection or storage. */
(() => {
  'use strict';
  const states = new Set(), colors = new Set(), avatars = new Set();
  let appearance='light',colorMode='standard',avatar=null,activeId='demo-today',busy=false,selection='auto',sequence=0,timer=null;
  const now=Date.now();
  const chats=[{id:'demo-today',title:'给今天留一点空隙',updatedAt:now,messages:[{id:'seed-1',role:'user',text:'今天有点忙，想先把事情理清楚。',status:'complete'},{id:'seed-2',role:'assistant',text:'先挑最重要的一件，剩下的慢慢来。我在这里陪你。',status:'complete'}]},{id:'demo-earlier',title:'周末的小计划',updatedAt:now-86400000,messages:[{id:'seed-3',role:'user',text:'周末想去散个步。',status:'complete'},{id:'seed-4',role:'assistant',text:'给自己留一段没有安排的时间，也很好。',status:'complete'}]}];
  const current=()=>chats.find(chat=>chat.id===activeId);
  function snapshot() { const chat=current();return {messages:chat?.messages||[],history:chats.map(({id,title,updatedAt})=>({id,title,updatedAt})),activeChatId:activeId,busy,connection:'connected',error:null,hasConversation:Boolean(chat),canStartNewChat:Boolean(chat),modelsStatus:'ready',modelSelection:selection,models:[{id:'demo-fast',displayName:'轻量模型 · 示例'},{id:'demo-strong',displayName:'分析模型 · 示例'}],activeModel:{automatic:selection==='auto',displayName:'轻量模型 · 示例'}}; }
  const emit=()=>states.forEach(fn=>fn(snapshot()));
  const subscribe=(set,fn)=>{set.add(fn);return()=>set.delete(fn);};
  function theme() { const root=document.documentElement;root.dataset.appearance=appearance;root.dataset.accessibleAppearance=appearance;root.dataset.colorMode=colorMode;colors.forEach(fn=>fn(colorMode,appearance)); }
  window.qiuqiuChat={
    getState:async()=>snapshot(),onState:fn=>subscribe(states,fn),onColorMode:fn=>{fn(colorMode,appearance);return subscribe(colors,fn);},onAppearance:fn=>{if(avatar)fn(avatar);return subscribe(avatars,fn);},
    send:async text=>{
      if(typeof text!=='string'||!text.trim()||text.length>2000) return {accepted:false,error:'请输入 1–2000 字的消息。'};
      if(busy) return {accepted:false,error:'请等待当前示例回复。'};
      if(!current()){activeId='demo-new-'+(++sequence);chats.unshift({id:activeId,title:text.trim().slice(0,24),updatedAt:Date.now(),messages:[]});}
      const chat=current(),answer={id:'answer-'+(++sequence),role:'assistant',text:'',status:'streaming'};
      chat.messages.push({id:'user-'+(++sequence),role:'user',text:text.trim(),status:'complete'},answer);chat.updatedAt=Date.now();busy=true;emit();
      timer=setTimeout(()=>{answer.text='先慢一点，挑一件想说的事，我们接着聊。';answer.status='complete';busy=false;timer=null;emit();},700);
      return {accepted:true};
    },
    stop:async()=>{clearTimeout(timer);timer=null;const answer=current()?.messages.at(-1);if(answer?.status==='streaming')answer.status='interrupted';busy=false;emit();return {accepted:true};},
    newChat:async()=>{if(busy)return {accepted:false};activeId=null;emit();return {accepted:true};},
    selectChat:async id=>{if(busy||!chats.some(chat=>chat.id===id))return {accepted:false};activeId=id;emit();return {accepted:true};},
    setModel:async id=>{if(!['auto','demo-fast','demo-strong'].includes(id))return {accepted:false};selection=id;emit();return {accepted:true};},
    refreshModels:async()=>{emit();return snapshot();},openUpdate:async()=>({accepted:false}),
    close:()=>{document.querySelector('.chat-panel').hidden=true;document.getElementById('demo-closed').hidden=false;parent.postMessage({type:'qiuqiu-demo-chat-closed'},location.origin);}
  };
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==location.origin)return;
    const data=event.data;
    if(data?.type==='qiuqiu-demo-theme'&&['light','dark'].includes(data.appearance)&&['standard','accessible'].includes(data.colorMode)){appearance=data.appearance;colorMode=data.colorMode;theme();}
    else if(data?.type==='qiuqiu-demo-avatar'&&data.appearance&&typeof data.appearance==='object'&&!Array.isArray(data.appearance)){
      avatar=window.PetCustomization.normalizeAppearance(data.appearance);avatars.forEach(fn=>fn(avatar));
    }else if(data?.type==='qiuqiu-demo-motion'){window.QiuqiuDemoPaused=data.paused===true;document.documentElement.dataset.demoPaused=String(window.QiuqiuDemoPaused);window.dispatchEvent(new Event('qiuqiu-demo-motion'));}
  });
  document.addEventListener('DOMContentLoaded',()=>{
    theme();
    document.getElementById('demo-reopen').addEventListener('click',()=>{document.querySelector('.chat-panel').hidden=false;document.getElementById('demo-closed').hidden=true;document.getElementById('message-input').focus();});
    document.querySelector('#empty-state p').textContent='发送第一句话，开始聊天。';
    parent.postMessage({type:'qiuqiu-demo-ready'},location.origin);
    parent.postMessage({type:'qiuqiu-demo-resize',height:520},location.origin);
  });
  window.QiuqiuChatDemo=Object.freeze({getState:()=>Object.freeze({appearance,colorMode,avatar,busy,selection,activeChatId:activeId,historyCount:chats.length,paused:Boolean(window.QiuqiuDemoPaused)})});
})();
