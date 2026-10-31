'use strict';
const CURRENT_CHAT='workbuddy-current';
function createWorkBuddyCliChatCompanion({connection,prepare=async()=>({status:'ready'}),onChange=()=>{}}={}){
  if(!connection||!['getState','connect','send','cancel'].every(method=>typeof connection[method]==='function')||typeof prepare!=='function')throw new TypeError('connection and prepare are required');
  let closed=false,connecting=false,localError=null,flight=null;
  function getState(){
    const raw=connection.getState(),messages=closed?[]:(Array.isArray(raw.messages)?raw.messages:[]).map((message,index)=>({
      id:'workbuddy-message-'+index,role:message.role==='user'?'user':'assistant',text:typeof message.text==='string'?message.text:'',
      status:message.status==='cancelled'?'interrupted':message.status==='unknown'?'error':message.status==='refusal'?'complete':message.status||'complete'
    }));
    const ready=!closed&&raw.connected===true;
    return{messages,busy:!closed&&raw.busy===true,connection:closed?'closed':connecting?'connecting':ready?'ready':raw.error?'error':'idle',
      error:closed?'聊天已关闭。':localError||raw.error||(raw.sendOutcome==='unknown'?'本次回复结果未知，请先核对，暂不重发。':null),
      hasConversation:messages.length>0,canStartNewChat:false,activeChatId:messages.length?CURRENT_CHAT:null,
      history:messages.length?[{id:CURRENT_CHAT,title:messages.find(m=>m.role==='user')?.text.slice(0,80)||'WorkBuddy 专用聊天',current:true}]:[],
      modelSelection:'provider-managed',modelSelectionMode:'provider-managed',models:[],modelsStatus:'provider-managed',modelsError:null,activeModel:null,
      providerModelId:typeof raw.currentModelId==='string'?raw.currentModelId:null,
      capabilities:{modelSelection:false,newChat:false,historySelection:false},
      sourceNote:'使用球球专用 WorkBuddy 会话，沿用工具当前模型；不接管原桌面聊天。',
      liveTask:raw.liveTask||null
    };
  }
  function emit(){if(!closed)onChange(getState());}
  function unavailable(message){return{accepted:false,error:message};}
  function connect(){
    if(closed)return Promise.resolve(unavailable('聊天已关闭。'));
    if(flight)return flight;
    connecting=true;localError=null;emit();
    const promise=Promise.resolve().then(async()=>{
      try{
        const prepared=await prepare({interactive:false});
        if(closed)return unavailable('聊天已关闭。');
        if(prepared?.status!=='ready'){localError=prepared?.message||'请先启用 WorkBuddy 授权，完成官方登录。';return unavailable(localError);}
        await connection.connect();
        if(closed)return unavailable('聊天已关闭。');
        const state=connection.getState();
        if(!state.connected){localError=state.error||'WorkBuddy 尚未连接，请重新启用授权。';return unavailable(localError);}
        return{accepted:true};
      }catch(_){localError='WorkBuddy 尚未连接，请重新启用授权。';return unavailable(localError);}
      finally{connecting=false;if(flight===promise)flight=null;emit();}
    });
    flight=promise;return promise;
  }
  async function send(text){
    if(closed)return unavailable('聊天已关闭。');
    if(typeof text!=='string'||!text.trim()||text.length>2000||text.includes('\0'))return unavailable('请输入 1–2000 字的消息。');
    const before=connection.getState();
    if(before.busy||connecting)return unavailable('球球正在回复，请先等待或停止。');
    if(before.sendOutcome==='unknown')return unavailable('本次回复结果未知，请先核对，暂不重发。');
    if(!before.connected){const result=await connect();if(!result.accepted)return result;}
    if(closed)return unavailable('聊天已关闭。');
    localError=null;
    try{
      await connection.send(text.trim());
      if(closed)return unavailable('聊天已关闭。');
      const next=connection.getState();
      if(!['complete','cancelled','refusal'].includes(next.sendOutcome)){localError=next.error||'本次回复结果尚未确认，请先核对，暂不重发。';return unavailable(localError);}
      return{accepted:true};
    }catch(_){localError=connection.getState().error||'本次回复尚未确认，请先核对后再操作。';return unavailable(localError);}
    finally{emit();}
  }
  async function stop(){
    if(closed)return unavailable('聊天已关闭。');
    try{await connection.cancel();return{accepted:true};}
    catch(_){localError='停止结果尚未确认，请先核对本次会话。';return unavailable(localError);}
    finally{emit();}
  }
  function unsupported(message){return Promise.resolve(unavailable(message));}
  return{getState,connect,send,stop,
    newChat:()=>unsupported('当前仅支持继续这段 WorkBuddy 专用聊天，已有记录已保留。'),
    selectChat:id=>closed?unsupported('聊天已关闭。'):id===CURRENT_CHAT&&!connection.getState().busy?Promise.resolve({accepted:true}):unsupported('当前仅可继续这段 WorkBuddy 专用聊天。'),
    setModel:()=>unsupported('WorkBuddy 沿用工具当前模型，暂不支持在此切换。'),
    refreshModels:()=>unsupported('WorkBuddy 沿用工具当前模型，无需读取模型列表。'),
    ownsThread:()=>false,
    close(){closed=true;connecting=false;localError=null;}
  };
}
module.exports={createWorkBuddyCliChatCompanion};
