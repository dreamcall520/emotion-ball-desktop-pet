'use strict';
const os=require('node:os');
// SMAppService.mainApp through Electron's public API. Never installs a helper,
// writes LaunchAgents, starts a shell, or changes login items during startup.
function createLoginItemController({app,platform=process.platform,darwinMajor=Number(os.release().split('.')[0])}={}){
 if(!app||typeof app.getLoginItemSettings!=='function'||typeof app.setLoginItemSettings!=='function')throw new TypeError('Electron app login item methods required');
 const supported=()=>platform==='darwin'&&app.isPackaged===true&&darwinMajor>=22&&(!app.isReady||app.isReady());
 function getState(){
  if(!supported())return{supported:false,enabled:false,pendingApproval:false,status:'unavailable',errorCode:null,message:platform==='darwin'&&darwinMajor<22?'开机启动需要 macOS 13 或更高版本。':'请在已安装的球球中设置开机启动。'};
  try{
   const value=app.getLoginItemSettings({type:'mainAppService'});
   if(!value||typeof value.openAtLogin!=='boolean'||!['not-registered','enabled','requires-approval','not-found'].includes(value.status))throw Error();
   const enabled=value.status==='enabled'&&value.openAtLogin===true;
   return{supported:true,enabled,pendingApproval:value.status==='requires-approval',status:value.status,errorCode:null,
    message:value.status==='requires-approval'?'请在系统设置的登录项中允许球球；尚未确认开机启动生效。':value.status==='not-found'?'系统尚未识别当前安装的启动项，请完成安装后重试。':enabled?'已启用开机启动。':'开机启动未启用。'};
  }catch(_){return{supported:true,enabled:false,pendingApproval:false,status:'unknown',errorCode:'LOGIN_ITEM_READ_FAILED',message:'暂时无法读取开机启动状态，请稍后重试。'};}
 }
 function setEnabled(enabled,{userInitiated=false}={}){
  if(userInitiated!==true||typeof enabled!=='boolean')return{accepted:false,supported:supported(),enabled:false,pendingApproval:false,status:'unchanged',errorCode:'LOGIN_ITEM_EXPLICIT_ACTION_REQUIRED',message:'请本人在设置中选择是否开机启动。'};
  const before=getState();
  if(!before.supported||before.errorCode)return{...before,accepted:false};
  if(before.enabled===enabled&&!before.pendingApproval)return{...before,accepted:true};
  try{app.setLoginItemSettings({type:'mainAppService',openAtLogin:enabled});}
  catch(_){return{...getState(),accepted:false,errorCode:'LOGIN_ITEM_CHANGE_FAILED',message:'开机启动未能更改，请检查系统登录项设置。'};}
  const after=getState(),accepted=!after.errorCode&&!after.pendingApproval&&after.enabled===enabled&&after.status!=='not-found';
  return{...after,accepted,...(!accepted&&!after.pendingApproval&&!after.errorCode?{errorCode:'LOGIN_ITEM_CHANGE_UNCONFIRMED',message:'系统尚未确认更改，当前显示实际启动状态。'}:{})};
 }
 return{getState,setEnabled};
}
module.exports={createLoginItemController};
