'use strict';
// Development-only, native user-selected empty fixture. Never uses saved account grants.
const fs=require('node:fs/promises'),path=require('node:path');
async function probePluginInstallation({app,dialog,resourcesPath,assetRoot=path.join(__dirname,'../assets')}={}){
 const result={mas:process.mas===true,selected:false,installed:{zcode:false,workbuddy:false},idempotent:{zcode:false,workbuddy:false},releasedLeaseGuardRejected:false,temporaryReceiverRemoved:false,passed:false,errorCode:null};
 let stop,scratch,active=false;
 try{
  if(process.mas!==true)throw Error();
  const selected=await dialog.showOpenDialog({title:'验证球球插件安装到空测试目录',message:'只允许选择球球创建的 qiuqiu-mas-plugin-fixture-r24 空测试目录，不使用原工具配置。',properties:['openDirectory'],securityScopedBookmarks:true});
  if(selected.canceled){result.errorCode='MAS_INSTALL_PROBE_CANCELLED';return result;}
  const root=selected.filePaths?.[0];if(!root||path.basename(root)!=='qiuqiu-mas-plugin-fixture-r24'||selected.bookmarks?.length!==1)throw Error();
  stop=app.startAccessingSecurityScopedResource(selected.bookmarks[0]);active=true;
  const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error();
  const names=await fs.readdir(root);if(names.length!==1||names[0]!=='.qiuqiu-empty-fixture'||await fs.readFile(path.join(root,names[0]),'utf8')!=='qiuqiu-r24-synthetic-only\n')throw Error();
  result.selected=true;scratch=await fs.mkdtemp(path.join(app.getPath('userData'),'mas-installer-probe-'));
  for(const provider of ['zcode','workbuddy']){
   const target=path.join(root,'.'+provider);await fs.mkdir(target,{mode:0o700});
   const factory=provider==='zcode'?require('./zcode-desktop-integration').createZcodeDesktopIntegration:require('./workbuddy-desktop-integration').createWorkBuddyDesktopIntegration;
   const integration=factory({root:path.join(scratch,provider),assetRoot:path.join(assetRoot,provider+'-desktop-hook')});
   try{
    await integration.prepare();const access={withAccess:async(p,fn)=>{if(!active||p!==provider)throw Object.assign(Error(),{code:'DIRECTORY_ACCESS_REQUIRED'});return fn(target);}};
    const installer=require('./managed-plugin-installer').createManagedPluginInstaller({provider,directoryAccess:access,assertHostStopped:()=>true,getMarketplaceDirectory:()=>integration.getMarketplaceDirectory()});
    await installer.install({approved:true});result.installed[provider]=(await installer.inspect()).installedConfigured===true;
    const before=await snapshot(target);await installer.install({approved:true});result.idempotent[provider]=before===await snapshot(target);
    if(provider==='workbuddy'){active=false;await stop();stop=null;const denied=await installer.inspect();result.releasedLeaseGuardRejected=denied.status==='needs-authorization';}
   }finally{await integration.revoke();await integration.close();}
  }
 }catch(_){result.errorCode='MAS_INSTALL_PROBE_FAILED';}
 finally{if(stop)stop();if(scratch){try{await fs.rm(scratch,{recursive:true,force:true});result.temporaryReceiverRemoved=true;}catch{result.errorCode='MAS_INSTALL_PROBE_CLEANUP_FAILED';}}}
 result.passed=result.selected&&Object.values(result.installed).every(Boolean)&&Object.values(result.idempotent).every(Boolean)&&result.releasedLeaseGuardRejected&&result.temporaryReceiverRemoved&&!result.errorCode;return result;
}
async function snapshot(root){const rows=[];async function scan(dir){for(const n of (await fs.readdir(dir)).sort()){const f=path.join(dir,n),s=await fs.lstat(f);if(s.isSymbolicLink())throw Error();if(s.isDirectory())await scan(f);else rows.push([path.relative(root,f),s.mode&0o777,(await fs.readFile(f)).toString('base64')]);}}await scan(root);return JSON.stringify(rows);}
module.exports={probePluginInstallation};
