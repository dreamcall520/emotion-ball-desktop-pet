'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMasDirectoryAccess } = require('./mas-directory-access');
const { createMasCodexConnection } = require('./mas-codex-connection');
const { createCodexChatRpc } = require('./codex-chat-rpc');
const { createZcodeChatWsRpc } = require('./zcode-chat-ws-rpc');
const { loopbackEndpoint } = require('./codex-ws-transport');
const { createMasZcodeProvider } = require('./mas-zcode-provider');
const { createMasWorkBuddyProvider } = require('./mas-workbuddy-provider');
const {createWorkBuddyOfficialConnection,createWorkBuddyIntentStore}=require('./workbuddy-official-connection');
const {createWorkBuddyCliConnection}=require('./workbuddy-cli-connection');
const {createWorkBuddyLocalCliClient}=require('./workbuddy-local-cli-client');
const {createMasWorkBuddyTasks}=require('./mas-workbuddy-tasks');
const PROVIDERS = new Set(['codex', 'zcode','workbuddy']);
const failure = code => Object.assign(new Error(code), { code });
function createDirectoryStorage(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const filename = provider => { if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER'); return path.join(root, provider + '.json'); };
  return {
    async load(provider) {
      let handle;
      try {
        handle = fs.openSync(filename(provider), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(handle);
        if (!stat.isFile() || stat.size > 256 * 1024) throw failure('INVALID_GRANT');
        return JSON.parse(fs.readFileSync(handle, 'utf8'));
      } catch (error) { if (error.code === 'ENOENT') return null; throw failure('GRANT_STORAGE_FAILED'); }
      finally { if (handle !== undefined) fs.closeSync(handle); }
    },
    async save(provider, grant) {
      const destination = filename(provider), temporary = destination + '.' + randomUUID() + '.tmp';
      try { fs.writeFileSync(temporary, JSON.stringify(grant), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, destination); }
      finally { try { fs.unlinkSync(temporary); } catch (_) {} }
    },
    async remove(provider) { try { fs.unlinkSync(filename(provider)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  };
}
function createDiagnosticDirectoryAccess({ dialog, storage, home, purpose='read-data' }) {
  const grant = async provider => {
    const stored = await storage.load(provider);
    if (!stored?.directory || stored.kind !== 'diagnostic-user-selected') throw failure('DIRECTORY_ACCESS_REQUIRED');
    if (!(await fs.promises.stat(stored.directory)).isDirectory()) throw failure('DIRECTORY_ACCESS_REQUIRED');
    return stored;
  };
  return {
    async authorize(provider) {
      if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER');
      const selected = await dialog.showOpenDialog({ title: purpose==='plugin-installation'?'允许球球安装任务同步插件':`选择 ${provider === 'codex' ? 'Codex 的 .codex' : provider==='zcode'?'ZCode 的 .zcode':'WorkBuddy 的 .workbuddy（仅任务缓存）'} 数据目录`,
        buttonLabel:purpose==='plugin-installation'?'允许安装插件':'允许连接', ...(home ? {defaultPath:path.join(home,'.'+provider)} : {}), message: purpose==='plugin-installation'?'允许球球安装自己的任务同步插件，并仅更新插件记录和启用设置。其他配置原样保留，不读取聊天记录或独立登录凭据文件，不发送模型消息。':provider==='workbuddy'?'只读取任务标题、历史状态和未读标记，不读聊天正文或登录凭据。此诊断候选不等同系统沙盒验收。':'读取额度和任务信息；聊天使用球球独立登录，不改原工具设置。此诊断候选不等同系统沙盒验收。', properties: ['openDirectory', 'showHiddenFiles'] });
      if (selected.canceled) return { status: 'cancelled' };
      const directory = selected.filePaths?.[0];
      if (!directory || !path.isAbsolute(directory) || path.basename(directory) !== '.' + provider) throw failure('DIRECTORY_ACCESS_REQUIRED');
      const stat = await fs.promises.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('DIRECTORY_ACCESS_REQUIRED');
      await storage.save(provider, { kind: 'diagnostic-user-selected', directory });
      return { status: 'stored', directory };
    },
    async acquire(provider) { const value = await grant(provider); return { directory: value.directory, release() {} }; },
    async withAccess(provider, operation) { return operation((await grant(provider)).directory); },
    async getStatus(provider) { const value = await storage.load(provider); return value?.kind === 'diagnostic-user-selected' && typeof value.directory === 'string' && path.isAbsolute(value.directory) ? { status: 'stored', directory: value.directory } : { status: 'needs-authorization' }; },
    async revoke(provider) { await storage.remove(provider); return { status: 'needs-authorization' }; }
  };
}
function createWorkbuddyConversationStore(root){
  const storeFor=key=>{if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw failure('INVALID_ACCOUNT');return createWorkBuddyIntentStore(path.join(root,key+'.json'),{maxBytes:512*1024});};
  return{read:key=>storeFor(key).read(),write:value=>storeFor(value.accountKey).write(value)};
}
function createMasProviderRuntime({ app, dialog, BrowserWindow, session, shell, fetch,
  diagnostic = false, onChange = () => {}, onManagedReady = () => {}, resourcesPath = process.resourcesPath,
  startWorkbuddyHost=options=>require('./mas-bundled-workbuddy').startBundledWorkBuddy(options), createWorkbuddyAuthClient=createWorkBuddyLocalCliClient,createPluginInstaller=options=>require('./managed-plugin-installer').createManagedPluginInstaller(options),createPluginHost=()=>require('./plugin-host').createPluginHost() } = {}) {
  let closed = false, runtimeClosing = null, managedLogin = null, managedLoginUrl=null, managedEpoch=0, bundledEnabled=false, directZcodeEnabled=false, zcodeAccountSource='official', managedWorkbuddy=null, workbuddyAuthClient=null, workbuddyAuthFlight=null, workbuddyLoginPending=false, workbuddyAuthenticated=false, workbuddyEpoch=0, externalWorkbuddyService=false;
  const managedAbort=new AbortController();
  const managedProfile=path.join(app.getPath('userData'),'store-codex-profile');
  const managedWorkspace=path.join(app.getPath('userData'),'store-codex-chat-workspace');
  const quotaPorts = new Set();
  const chatServices = Object.fromEntries([...PROVIDERS].map(provider => [provider, { service: null, generation: 0, clients: new Set() }]));
  const chatPreferences=createDirectoryStorage(path.join(app.getPath('userData'),'store-chat-preferences'));
  const chatEnabled={codex:false,zcode:false,workbuddy:false};
  const storage = createDirectoryStorage(path.join(app.getPath('userData'), 'store-directory-grants'));
  const access = diagnostic ? createDiagnosticDirectoryAccess({ dialog, storage, home:app.getPath('home') }) : createMasDirectoryAccess({ app, dialog, storage });
  const pluginStorage=createDirectoryStorage(path.join(app.getPath('userData'),'store-plugin-directory-grants'));
  const pluginAccess=diagnostic?createDiagnosticDirectoryAccess({dialog,storage:pluginStorage,home:app.getPath('home'),purpose:'plugin-installation'}):createMasDirectoryAccess({app,dialog,storage:pluginStorage,purpose:'plugin-installation'});
  const pairingAccess=diagnostic?pluginAccess:createMasDirectoryAccess({app,dialog,storage:pluginStorage,purpose:'receiver-pairing'});
  const pluginFlights=new Map(),pluginAborts=new Map(),pluginWaitStates=new Map();const pluginHost=createPluginHost();
  let sandboxCapabilities={known:false};try{sandboxCapabilities=pluginHost.getSandboxCapabilities?.()||sandboxCapabilities;}catch{}
  const scopedWrite=sandboxCapabilities.known===true&&sandboxCapabilities.sandbox===true&&sandboxCapabilities.userSelectedReadWrite===true&&sandboxCapabilities.appScopeBookmarks===true;
  const executableWrite=scopedWrite&&sandboxCapabilities.userSelectedExecutable===true;
  // Public sandbox capabilities establish technical eligibility, never App Review approval.
  const pluginInstallationPolicy={allowed:diagnostic===true||executableWrite,pairingAllowed:diagnostic===true||scopedWrite,
    mode:diagnostic||executableWrite?'bundled-plugin-install':scopedWrite?'existing-plugin-pairing':'unavailable',
    status:diagnostic?'isolated-candidate':executableWrite?'sandbox-capable-review-pending':scopedWrite?'data-pairing-only':'sandbox-capability-unavailable',
    reviewApproved:false,message:diagnostic?'自动安装为隔离联调候选，尚不代表商店审核通过。':executableWrite?'使用随球球捆绑的固定任务插件；仅在你授权的目录安装，商店审核尚未完成。':scopedWrite?'可连接已安装的球球任务插件；新安装暂不可用，聊天和额度可直接使用。':'当前构建无法安装或配对任务插件；聊天和额度可单独连接。'};
  const workbuddy = createMasWorkBuddyProvider({ BrowserWindow, session, shell, onLoginComplete:()=>{if(!closed)onManagedReady('workbuddy');}, onChange: () => { if (!closed) { for (const notify of quotaPorts) notify(); onChange(); } } });
  const zcode = createMasZcodeProvider({ directoryAccess: access, fetch });
  const workbuddyOfficial=createWorkBuddyOfficialConnection({diagnostic,store:createWorkBuddyIntentStore(path.join(app.getPath('userData'),'workbuddy-official-send-intent.json')),openAuthorizationUrl:url=>shell.openExternal(url),onChange:()=>{if(!closed)onChange();}});
  const workbuddyCli=createWorkBuddyCliConnection({createClient:createWorkBuddyLocalCliClient,store:createWorkBuddyIntentStore(path.join(app.getPath('userData'),'workbuddy-cli-send-intent.json')),conversationStore:createWorkbuddyConversationStore(path.join(app.getPath('userData'),'workbuddy-cli-conversations')),onChange:()=>{if(!closed)onChange();}});
  const desktopTasks=createMasWorkBuddyTasks({directoryAccess:access});
  const desktopIntegration=require('./workbuddy-desktop-integration').createWorkBuddyDesktopIntegration({root:path.join(app.getPath('userData'),'workbuddy-desktop-events'),assetRoot:path.join(__dirname,'../assets/workbuddy-desktop-hook'),onChange:()=>{if(!closed)onChange();}});
  const zcodeDesktopIntegration=require('./zcode-desktop-integration').createZcodeDesktopIntegration({root:path.join(app.getPath('userData'),'zcode-desktop-events'),assetRoot:path.join(__dirname,'../assets/zcode-desktop-hook'),onChange:()=>{if(!closed)onChange();}});
  const pluginInstallers=Object.fromEntries(['zcode','workbuddy'].map(provider=>[provider,createPluginInstaller({provider,directoryAccess:pluginAccess,assertHostStopped:()=>pluginHost.isStopped(provider),getMarketplaceDirectory:()=>provider==='zcode'?zcodeDesktopIntegration.getMarketplaceDirectory():desktopIntegration.getMarketplaceDirectory(),onChange:()=>{if(!closed)onChange();}})]));
  function pluginInstallationState(provider){if(pluginWaitStates.has(provider))return{provider,...pluginWaitStates.get(provider)};const raw=pluginInstallers[provider].getState();const phases={idle:'idle',checking:'checking',working:'installing',staged:'installing',committing:'installing','installed-configured':'installed','not-installed':'idle','needs-authorization':'idle',cancelled:'idle',unavailable:'blocked'};return{...raw,phase:raw.status,status:phases[raw.status]||raw.status};}
  function pluginPurpose(){return pluginInstallationPolicy.allowed?'plugin-installation':'receiver-pairing';}
  function purposeAllows(grant,purpose){return grant?.permissionPurpose==='plugin-installation'||purpose==='receiver-pairing'&&grant?.permissionPurpose==='receiver-pairing';}
  async function ensurePluginAccess(provider,signal){
    const check=()=>{if(closed||signal?.aborted)throw failure('CANCELLED');};check();const purpose=pluginPurpose();
    const previous=await pluginStorage.load(provider);check();
    const save=async grant=>{await pluginStorage.save(provider,{...grant,permissionPurpose:purpose});if(closed||signal?.aborted){if(previous)await pluginStorage.save(provider,previous);else await pluginAccess.revoke(provider);throw failure('CANCELLED');}return{status:'stored'};};
    try{const lease=await pluginAccess.acquire(provider);lease.release();check();if(purposeAllows(previous,purpose))return{status:'stored'};return await save(previous);}catch(e){if(!['DIRECTORY_ACCESS_REQUIRED','ENOENT'].includes(e.code))throw e;}check();
    // The calling native confirmation approves this exact purpose before reuse.
    try{const lease=await access.acquire(provider);lease.release();check();const grant=await storage.load(provider);check();return await save(grant);}catch(e){if(!['DIRECTORY_ACCESS_REQUIRED','ENOENT'].includes(e.code))throw e;}check();
    const selected=await(purpose==='receiver-pairing'?pairingAccess:pluginAccess).authorize(provider);if(closed||signal?.aborted){if(selected.status==='stored'){if(previous)await pluginStorage.save(provider,previous);else await pluginAccess.revoke(provider);}throw failure('CANCELLED');}
    if(selected.status==='stored')return save(await pluginStorage.load(provider));return selected;
  }

  function installProviderPlugin(provider,{approved=false}={}){
    if(!['zcode','workbuddy'].includes(provider))return Promise.reject(failure('INVALID_PROVIDER'));
    if(!approved)return Promise.reject(failure('CONSENT_REQUIRED'));
    if(!pluginInstallationPolicy.allowed&&!pluginInstallationPolicy.pairingAllowed)return Promise.reject(failure('AUTO_INSTALL_STORE_REVIEW_REQUIRED'));
    if(closed)return Promise.reject(failure('CLOSED'));
    if(pluginFlights.has(provider))return pluginFlights.get(provider);
    const abort=new AbortController();pluginAborts.set(provider,abort);
    let reopen=false,completed=false;const flight=Promise.resolve().then(async()=>{
      if(closed||abort.signal.aborted)throw failure('CANCELLED');
      const granted=await ensurePluginAccess(provider,abort.signal);if(granted.status!=='stored')return{status:'cancelled'};
      if(closed||abort.signal.aborted)throw failure('CANCELLED');
      const host=await pluginHost.getStatus(provider);if(!host?.known)throw failure('HOST_STATUS_UNAVAILABLE');if(!host.installed)throw failure('HOST_NOT_INSTALLED');
      if(host.running){pluginWaitStates.set(provider,{status:'installing',phase:'waiting-host',enabled:false,message:'请完成当前任务，切到 '+(provider==='zcode'?'ZCode':'WorkBuddy')+' 按⌘Q退出；球球会自动继续安装，不会强制结束任务。'});onChange();await pluginHost.waitUntilStopped(provider,{signal:abort.signal});reopen=true;pluginWaitStates.delete(provider);}
      if(closed||abort.signal.aborted)throw failure('CANCELLED');
      await(provider==='zcode'?zcodeDesktopIntegration:desktopIntegration).prepare();
      if(closed||abort.signal.aborted)throw failure('CANCELLED');
      if(pluginInstallationPolicy.allowed)await pluginInstallers[provider].install({approved:true,signal:abort.signal});else await pluginInstallers[provider].rePair({approved:true,signal:abort.signal});completed=true;return pluginInstallationState(provider);
    }).finally(async()=>{pluginWaitStates.delete(provider);if(reopen&&completed&&!closed&&!abort.signal.aborted){try{await pluginHost.launch(provider);}catch{/* Installed files remain; the original tool can be reopened normally. */}}pluginFlights.delete(provider);pluginAborts.delete(provider);if(!closed)onChange();});pluginFlights.set(provider,flight);return flight;
  }
  async function restorePluginInstallations(){for(const provider of ['zcode','workbuddy']){if(closed)return;const granted=await pluginAccess.getStatus(provider);if(granted.status!=='stored')continue;if(closed)return;const integration=provider==='zcode'?zcodeDesktopIntegration:desktopIntegration;await integration.restore();if(closed)return;await pluginInstallers[provider].inspect();}}
  async function cancelPluginInstallation(provider){pluginAborts.get(provider)?.abort();await pluginFlights.get(provider)?.catch(()=>{});}
  let desktopCache={partitions:[],probe:null,report:null,error:null,accountAttributionVerified:false};
  async function probeWorkbuddyDesktop(){try{const probe=await desktopTasks.probe(),groups=await desktopTasks.listPartitions();desktopCache={...desktopCache,probe,partitions:groups.partitions,report:null,error:null};}catch(e){desktopCache={...desktopCache,report:null,error:['DIRECTORY_ACCESS_REQUIRED'].includes(e.code)?'请先授权原WorkBuddy任务目录。':'桌面任务缓存暂不能读取，或数据库格式未支持。'};}onChange();return desktopCache;}
  async function readWorkbuddyDesktop(partitionId){try{desktopCache={...desktopCache,report:await desktopTasks.read({partitionId}),error:null};}catch(e){desktopCache={...desktopCache,report:null,error:'所选缓存范围暂不能读取，请重新检查授权。'};}onChange();return desktopCache;}
  async function importWorkbuddyCliService(){
    if(closed)throw failure('CLOSED');
    const selected=await dialog.showOpenDialog({title:'选择本人已启动的 WorkBuddy / CodeBuddy CLI 连接目录',message:'仅导入专用本机服务连接，不预览其中的口令文件。CLI会话不等同原WorkBuddy桌面任务。',properties:['openDirectory'],securityScopedBookmarks:true});
    if(selected.canceled)return{status:'cancelled'};
    let fd,stop;
    try{
      if(closed||!selected.filePaths?.[0]||!path.isAbsolute(selected.filePaths[0]))throw failure('INVALID_PAIRING_FILE');
      if(!diagnostic){if(!selected.bookmarks?.[0])throw failure('INVALID_PAIRING_FILE');stop=app.startAccessingSecurityScopedResource(selected.bookmarks[0]);}
      const file=path.join(selected.filePaths[0],'connection.json'),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw failure('INVALID_PAIRING_FILE');
      fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const opened=fs.fstatSync(fd);
      if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size>16384)throw failure('INVALID_PAIRING_FILE');
      const raw=JSON.parse(fs.readFileSync(fd,'utf8'));
      if(raw.version!==1||raw.provider!=='workbuddy-cli'||typeof raw.password!=='string'||!/^[A-Za-z0-9_-]{16,256}$/.test(raw.password)||typeof raw.workspaceDir!=='string'||!path.isAbsolute(raw.workspaceDir)||raw.workspaceDir.includes('\0'))throw failure('INVALID_PAIRING_FILE');
      if(closed)throw failure('CLOSED');await workbuddyCli.configure(raw);externalWorkbuddyService=true;onChange();return{status:'configured'};
    }catch(e){throw failure(e.code==='CLOSED'?'CLOSED':'INVALID_PAIRING_FILE');}finally{if(fd!==undefined)fs.closeSync(fd);if(typeof stop==='function')stop();}
  }
  async function authorize(provider) {
    if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER');
    const result = await access.authorize(provider);
    if (result.status === 'stored' && path.basename(result.directory) !== '.' + provider) {
      await access.revoke(provider); throw failure('DIRECTORY_ACCESS_REQUIRED');
    }
    onChange(); return { status: result.status };
  }
  async function getState() {
    const [codex, zcodeDirectory] = await Promise.all(['codex', 'zcode'].map(p => access.getStatus(p)));
    const service = chatServices.codex.service, zcodeService = chatServices.zcode.service;
    return { providerLoginPending:{codex:Boolean(managedLogin&&managedLoginUrl),workbuddy:Boolean(workbuddyLoginPending&&workbuddyAuthFlight)},pluginInstallationPolicy:{...pluginInstallationPolicy},pluginInstallations:Object.fromEntries(Object.keys(pluginInstallers).map(provider=>[provider,pluginInstallationState(provider)])),mode: diagnostic ? 'diagnostic-unsandboxed' : 'mas-sandbox',
      codex: { directory: codex.status, serviceConfigured: Boolean(service), endpoint: service?.endpoint || null,
        tasks: 'authorized-session-logs', chat: service ? 'configured-unverified' : 'managed-bundled-runtime' },
      zcode: { directory: zcodeDirectory.status, capabilities: zcode.getCapabilities(),
        serviceConfigured: Boolean(zcodeService), endpoint: zcodeService?.endpoint || null, accountSource:zcodeService?.accountSource || zcodeAccountSource,
        chat: zcodeService ? 'experimental-configured-unverified' : 'needs-experimental-local-service',
        publicApiContractVerified: false }, workbuddy: workbuddy.getState(),workbuddyOfficial:workbuddyOfficial.getState(),workbuddyCli:workbuddyCli.getState(),workbuddyDesktopEvents:desktopIntegration.getState(),zcodeDesktopEvents:zcodeDesktopIntegration.getState(),workbuddyDesktop:{...structuredClone(desktopCache),directory:(await access.getStatus('workbuddy')).status} };
  }
  async function importLocalService(provider) {
    if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER');
    if (closed) throw failure('CLOSED');
    const slot = chatServices[provider];
    const directory = await access.getStatus(provider);
    if (directory.status !== 'stored') throw failure('DIRECTORY_ACCESS_REQUIRED');
    const selected = await dialog.showOpenDialog({ title: `选择已运行 ${provider === 'codex' ? 'Codex' : 'ZCode 实验'}本机服务的连接目录`,
      message: provider === 'codex' ? '选择启动器输出的目录；无需打开或预览其中的配对文件。' :
        '仅供实验候选联调；不代表厂商授权或真实聊天已通过。选择 ZCode 启动器输出的目录，不预览配对文件。',
      properties: ['openDirectory'], securityScopedBookmarks: true });
    if (closed) throw failure('CLOSED');
    if (selected.canceled) return { status: 'cancelled' };
    const selectedDirectory = selected.filePaths?.[0];
    if (selected.filePaths?.length !== 1 || typeof selectedDirectory !== 'string' || !path.isAbsolute(selectedDirectory) || selectedDirectory.includes('\0')) throw failure('INVALID_PAIRING_FILE');
    const file = path.join(selectedDirectory, 'pairing.json'); let stop, handle;
    try {
      if (!diagnostic) {
        if (!selected.bookmarks?.[0]) throw failure('DIRECTORY_ACCESS_REQUIRED');
        stop = app.startAccessingSecurityScopedResource(selected.bookmarks[0]);
        if (typeof stop !== 'function') throw failure('DIRECTORY_ACCESS_REQUIRED');
      }
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw failure('INVALID_PAIRING_FILE');
      handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(handle);
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > 16384) throw failure('INVALID_PAIRING_FILE');
      const raw = JSON.parse(fs.readFileSync(handle, 'utf8'));
      const providerMatches = provider === 'zcode' ? raw.provider === 'zcode' : raw.provider === undefined || raw.provider === 'codex';
      if (!providerMatches || raw.version !== 1 || typeof raw.bearerToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{16,8192}={0,2}$/.test(raw.bearerToken) ||
        raw.hostHome !== path.dirname(directory.directory)) throw failure('INVALID_PAIRING_FILE');
      const selectedService = { endpoint: loopbackEndpoint(raw.endpoint), bearerToken: raw.bearerToken, hostHome: raw.hostHome };
      if(provider==='zcode'){const source=raw.accountSource||'official';if(!['official','configured-custom'].includes(source))throw failure('INVALID_PAIRING_FILE');selectedService.accountSource=source;}
      if (provider === 'zcode' && new URL(selectedService.endpoint).pathname !== '/zcode') throw failure('INVALID_PAIRING_FILE');
      if (closed) throw failure('CLOSED');
      slot.service = selectedService; slot.generation++;
      // A different underlying RPC is a different client to chat-companion: retire
      // the facade so its loaded thread/model identity cannot silently survive.
      await Promise.all([...slot.clients].map(client => client.invalidate()));
      if (closed) throw failure('CLOSED');
      onChange(); return { status: 'configured', endpoint: selectedService.endpoint };
    } catch (error) { throw failure(['DIRECTORY_ACCESS_REQUIRED', 'INVALID_ENDPOINT', 'CLOSED'].includes(error.code) ? error.code : 'INVALID_PAIRING_FILE'); }
    finally { if (handle !== undefined) fs.closeSync(handle); if (typeof stop === 'function') stop(); }
  }
  function localChat(provider, options = {}) {
    if (closed) throw failure('CLOSED');
    const slot = chatServices[provider];
    let target = null, epoch = -1, ended = false, closing = null;
    function retire(code) {
      if (closing) return closing;
      ended = true; slot.clients.delete(facade);
      const previous = target; target = null;
      closing = Promise.resolve().then(() => previous?.close()).catch(() => {});
      if (code) { try { options.onDisconnect?.(code); } catch (_) {} }
      return closing;
    }
    const facade = {
      async start() {
        if (ended || closed) throw failure('CLOSED');
        if (!slot.service && !(provider==='codex'&&bundledEnabled) && !(provider==='zcode'&&directZcodeEnabled)) throw failure('MISSING');
        if (target && epoch !== slot.generation) {
          await retire('DISCONNECTED'); throw failure('DISCONNECTED');
        }
        if (!target) {
          const service = slot.service;
          const callbacks = { onNotification: packet => { if (!ended && !closed) options.onNotification?.(packet); },
            onDisconnect: code => { void retire(code); } };
          target = provider === 'codex'
            ? service ? createCodexChatRpc({ ...options, hostHome: service.hostHome,
              webSocket: { endpoint: service.endpoint, bearerToken: service.bearerToken }, ...callbacks })
              : await require('./mas-bundled-codex').createBundledCodexChatRpc({ ...options, resourcesPath, profileHome:managedProfile, workspaceDir:options.workspaceDir||managedWorkspace, ...callbacks })
            : service ? createZcodeChatWsRpc({ ...options, endpoint: service.endpoint, bearerToken: service.bearerToken,accountSource:service.accountSource, ...callbacks })
              : require('./zcode-direct-chat-rpc').createZcodeDirectChatRpc({...options,directoryAccess:access,workspaceDir:options.workspaceDir,accountSource:'configured-custom',fetch,...callbacks});
          epoch = slot.generation;
        }
        return target.start();
      },
      close() { return retire(); },
      invalidate() { return retire('DISCONNECTED'); }
    };
    for (const method of ['readAccount','getConsentIdentity','startThread','resumeThread','startTurn','listModels','nameThread','readThreadEnvironment','verifyThreadEnvironment','interruptTurn']) {
      facade[method] = (...args) => {
        if (ended || closed) return Promise.reject(failure('CLOSED'));
        if (!slot.service && !(provider==='codex'&&bundledEnabled) && !(provider==='zcode'&&directZcodeEnabled)) return Promise.reject(failure('MISSING'));
        if (epoch !== slot.generation) return Promise.reject(failure('DISCONNECTED'));
        if (!target) return Promise.reject(failure('MISSING'));
        return typeof target[method] === 'function' ? target[method](...args) : Promise.reject(failure('UNSUPPORTED'));
      };
    }
    slot.clients.add(facade);
    return facade;
  }
  async function prepareWorkbuddyChat({interactive=true}={}) {
    if(closed)throw failure('CLOSED');
    const epoch=workbuddyEpoch;
    if(externalWorkbuddyService&&workbuddyCli.getState().configured&&!managedWorkbuddy)return{status:'ready',message:'已有专用连接，正在核验。'};
    if(workbuddyAuthenticated && managedWorkbuddy)return{status:'ready',message:'球球内 WorkBuddy 登录可用。'};
    if(workbuddyAuthFlight)return{status:'needs-login',loginPending:workbuddyLoginPending,message:'请在官方页面完成球球独立登录。'};
    try{
      if(!managedWorkbuddy){
        let ownedHost;
        const created=await startWorkbuddyHost({resourcesPath,profileHome:path.join(app.getPath('userData'),'store-workbuddy-profile'),workspaceDir:path.join(app.getPath('userData'),'store-workbuddy-workspace'),signal:managedAbort.signal,
          onExit:()=>{if(epoch===workbuddyEpoch&&managedWorkbuddy===ownedHost){managedWorkbuddy=null;workbuddyAuthenticated=false;workbuddyLoginPending=false;void workbuddyCli.disconnect();if(!closed)onChange();}}});
        ownedHost=created;
        if(closed||epoch!==workbuddyEpoch){await created.stop();throw failure('CLOSED');}
        managedWorkbuddy=created;
        await workbuddyCli.configure({endpoint:managedWorkbuddy.endpoint,password:managedWorkbuddy.gatewayPassword,workspaceDir:managedWorkbuddy.workspaceDir,cliVersion:managedWorkbuddy.cliVersion});
      }
      const handle=managedWorkbuddy,controller=new AbortController();
      workbuddyAuthClient=createWorkbuddyAuthClient({baseUrl:handle.endpoint,gatewayPassword:handle.gatewayPassword,workspaceDir:handle.workspaceDir,cliVersion:handle.cliVersion});
      const client=workbuddyAuthClient;
      let resolveFirst;const first=new Promise(resolve=>resolveFirst=resolve);
      const abort=()=>controller.abort();managedAbort.signal.addEventListener('abort',abort,{once:true});
      let ownFlight;ownFlight=Promise.resolve().then(async()=>{
        await client.connect();
        const existing=await client.getVendorAccount();
        if(existing.authenticated){if(!closed&&epoch===workbuddyEpoch&&managedWorkbuddy===handle){workbuddyAuthenticated=true;workbuddyLoginPending=false;await workbuddyCli.configure({endpoint:handle.endpoint,password:handle.gatewayPassword,workspaceDir:handle.workspaceDir,cliVersion:handle.cliVersion,accountKey:existing.accountKey});resolveFirst({status:'ready',message:'WorkBuddy 已有登录已恢复。'});}return;}
        if(!interactive){resolveFirst({status:'needs-login',loginPending:false,message:'首次聊天请点启用授权，完成官方登录。'});return;}
        await client.authenticate({signal:controller.signal,onAuthUrl:url=>{
          if(closed||epoch!==workbuddyEpoch||managedWorkbuddy!==handle||controller.signal.aborted){controller.abort();return;}
          if(!interactive){controller.abort();resolveFirst({status:'needs-login',loginPending:false,message:'首次聊天请点启用授权，完成官方登录。'});return;}
          void shell.openExternal(url).then(()=>{if(closed||epoch!==workbuddyEpoch||managedWorkbuddy!==handle||controller.signal.aborted)return;workbuddyLoginPending=true;resolveFirst({status:'needs-login',loginPending:true,message:'请在官方页面完成 WorkBuddy 登录，随后自动连接。'});onChange();}).catch(()=>{controller.abort();resolveFirst({status:'unavailable',message:'官方登录页未打开，请重试启用。'});});
        }});
        const verified=await client.getVendorAccount();
        if(!verified.authenticated)throw failure('UNAUTHENTICATED');
        if(!closed&&epoch===workbuddyEpoch&&managedWorkbuddy===handle&&!controller.signal.aborted){workbuddyAuthenticated=true;workbuddyLoginPending=false;await workbuddyCli.configure({endpoint:handle.endpoint,password:handle.gatewayPassword,workspaceDir:handle.workspaceDir,cliVersion:handle.cliVersion,accountKey:verified.accountKey});resolveFirst({status:'ready',message:'球球内 WorkBuddy 已登录。'});onManagedReady('workbuddy');}
      }).catch(()=>resolveFirst({status:'unavailable',message:'WorkBuddy 官方登录尚未完成，请重试启用。'})).finally(async()=>{resolveFirst({status:'unavailable',message:'连接已结束，请重试启用。'});managedAbort.signal.removeEventListener('abort',abort);await client.close();if(workbuddyAuthClient===client)workbuddyAuthClient=null;if(workbuddyAuthFlight===ownFlight){workbuddyAuthFlight=null;workbuddyLoginPending=false;if(!closed)onChange();}});
      workbuddyAuthFlight=ownFlight;return first;
    }catch(e){return{status:'unavailable',message:'此候选的 WorkBuddy 直接连接尚未就绪；无需自行配置服务。'};}
  }
  async function prepareChat(provider,{interactive=true}={}) {
    if(closed)throw failure('CLOSED');
    if(!PROVIDERS.has(provider))throw failure('INVALID_PROVIDER');
    if(chatServices[provider]?.service)return{status:'ready',message:'已有连接可用，正在验证聊天。'};
    if(provider==='zcode'){
      const saved=await chatPreferences.load('zcode');if(saved?.accountSource==='configured-custom')zcodeAccountSource='configured-custom';
      if(zcodeAccountSource==='configured-custom'){
        if((await access.getStatus('zcode')).status!=='stored')return{status:'needs-data-authorization',message:'读取已有模型配置需要你允许访问ZCode目录；无需填写地址或密钥。'};
        let rpc;try{rpc=require('./zcode-direct-chat-rpc').createZcodeDirectChatRpc({directoryAccess:access,workspaceDir:path.join(app.getPath('userData'),'zcode-chat-workspace'),accountSource:zcodeAccountSource,fetch});await rpc.start();await rpc.listModels();directZcodeEnabled=true;return{status:'ready',message:'使用已有自定义模型，按原API计费。'};}catch(e){directZcodeEnabled=false;return{status:'unavailable',message:e.code==='CODING_PLAN_SCOPE_UNSUPPORTED'?'此通道限定编程用途，尚不能用于球球聊天；不会切换到其他计费来源。':'已有模型配置不包含可直接连接的信息；不会改用其他账号或计费来源。'};}finally{await rpc?.close();}
      }
    }
    if(provider!=='codex')return{status:'unavailable',message:'直接聊天接入尚未完成；无需配置终端或服务。'};
    if(managedLogin){if(interactive&&managedLoginUrl)await shell.openExternal(managedLoginUrl);return{status:'needs-login',loginPending:Boolean(managedLoginUrl),message:'请在已打开的官方页面完成球球独立登录。'};}
    let rpc;
    const epoch=managedEpoch;
    try {
      rpc=await require('./mas-bundled-codex').createBundledCodexChatRpc({resourcesPath,profileHome:managedProfile,workspaceDir:managedWorkspace,
        onNotification:packet=>{
          if(packet?.method==='account/login/completed' && !closed && epoch===managedEpoch){
            const previous=managedLogin;managedLogin=null;managedLoginUrl=null;
            void Promise.resolve(previous?.close()).then(()=>{if(!closed&&epoch===managedEpoch){if(packet.params?.success===true)onManagedReady('codex');else onChange();}}).catch(()=>{});
          }
        }});
      await rpc.start();
      const account=await rpc.readAccount();
      if(account.authenticated){bundledEnabled=true;await rpc.close();return{status:'ready',message:'球球独立登录可用。'};}
      if(!interactive){await rpc.close();return{status:'needs-login',loginPending:false,message:'首次使用聊天请点启用授权，完成官方登录。'};}
      managedLogin=rpc;
      const login=await rpc.startLogin();
      if(closed||epoch!==managedEpoch){await rpc.close();return{status:'unavailable',message:'连接已取消。'};}
      managedLoginUrl=login.authUrl;await shell.openExternal(login.authUrl);
      return{status:'needs-login',loginPending:true,message:'请在官方页面完成一次登录，随后自动连接聊天。'};
    } catch(e) {
      if(managedLogin===rpc){managedLogin=null;managedLoginUrl=null;}
      await rpc?.close().catch(()=>{});
      return{status:'unavailable',message:['BUNDLED_RUNTIME_MISSING','BUNDLED_RUNTIME_INVALID','MODULE_NOT_FOUND'].includes(e.code)?'此候选尚未包含已验证的聊天组件；无需自行配置服务。':'球球聊天连接未完成，请重试启用。'};
    }
  }
  function createWorkBuddyQuotaPort({ onChange: changed = () => {} } = {}) {
    let enabled = false, timer = null, controller = null, ended = false;
    const emit = () => changed(port.getState());
    const port = {
      getState() {
        const raw = workbuddy.getState(), summary = enabled ? raw.summary : null;
        return { enabled, busy: enabled && raw.busy, stale: enabled && raw.stale,
          error: enabled && raw.errorCode ? raw.errorMessage : null,
          errorCode: enabled && raw.errorCode ? raw.status === 'needs-login' ? 'LOGIN_REQUIRED' : 'UPDATE_FAILED' : null,
          report: summary ? { scope: 'website-summary', total: summary.credits.remaining,
            basic: null, reward: null, purchased: null, plan: summary.planNames.join(' / ') || '网站汇总',
            nextRefreshAt: null, expires: [], updatedAt: summary.updatedAt, coverage: summary.coverage } : null,
          accountKey: null, history: [], historyError: null, nextRetryAt: null };
      },
      async refresh() {
        if (!enabled || ended) return port.getState();
        clearTimeout(timer); controller?.abort(); controller = new AbortController();
        try { await workbuddy.readSummary({ signal: controller.signal }); } catch (_) {}
        if (enabled && !ended && workbuddy.getState().status === 'connected') { timer = setTimeout(() => { void port.refresh(); }, 300000); timer.unref?.(); }
        emit(); return port.getState();
      },
      setEnabled(value) { enabled = value === true; clearTimeout(timer); controller?.abort(); emit(); if (enabled) void port.refresh(); },
      recover() { if (enabled) void port.refresh(); },
      close() { ended = true; enabled = false; clearTimeout(timer); controller?.abort(); quotaPorts.delete(emit); }
    };
    quotaPorts.add(emit); return port;
  }
  function unavailableObservation(message) {
    return { getState: () => ({ busy: false, report: null, error: message }), setEnabled() {},
      refresh: async () => ({ busy: false, report: null, error: message }), dismissAll() {}, dismiss() { return false; }, close() {} };
  }
  function close() {
    if (closed) return runtimeClosing;
    closed = true; workbuddyEpoch++; managedAbort.abort();managedEpoch++; void managedLogin?.close();managedLogin=null;managedLoginUrl=null; workbuddy.close();workbuddyOfficial.close();desktopTasks.close(); quotaPorts.clear();
    for(const abort of pluginAborts.values())abort.abort();
    const closing = [...[...pluginFlights.values()].map(flight=>flight.catch(()=>{})),desktopIntegration.close(),zcodeDesktopIntegration.close(),workbuddyCli.close(),workbuddyAuthClient?.close(),managedWorkbuddy?.stop()];
    for (const slot of Object.values(chatServices)) {
      slot.service = null; slot.generation++;
      closing.push(...[...slot.clients].map(client => client.close()));
    }
    runtimeClosing = Promise.all(closing).then(() => undefined);
    return runtimeClosing;
  }
  return { access, authorize, getState,installProviderPlugin,cancelPluginInstallation,restorePluginInstallations,getPluginInstallationPolicy:()=>({...pluginInstallationPolicy}),async getPluginAuthorizationStatus(provider){if(!['zcode','workbuddy'].includes(provider))throw failure('INVALID_PROVIDER');const status=(await pluginAccess.getStatus(provider)).status,grant=await pluginStorage.load(provider);return{status:status==='stored'&&purposeAllows(grant,pluginPurpose())?'stored':'needs-authorization'};},prepareChat,prepareWorkbuddyChat,desktopIntegration,zcodeDesktopIntegration,
    async restoreChatPreferences(fallback={}){for(const provider of PROVIDERS){let saved;try{saved=await chatPreferences.load(provider);}catch(_){saved=null;}chatEnabled[provider]=typeof saved?.enabled==='boolean'?saved.enabled:fallback[provider]===true;}return{...chatEnabled};},
    isChatEnabled:provider=>PROVIDERS.has(provider)&&chatEnabled[provider]===true,
    async setChatEnabled(provider,enabled){if(!PROVIDERS.has(provider))throw failure('INVALID_PROVIDER');const old=await chatPreferences.load(provider);await chatPreferences.save(provider,{...(old||{}),enabled:enabled===true});chatEnabled[provider]=enabled===true;onChange();},async disconnectWorkbuddyChat(){externalWorkbuddyService=false;workbuddyEpoch++;workbuddyAuthenticated=false;workbuddyAuthFlight=null;workbuddyLoginPending=false;await workbuddyAuthClient?.close();workbuddyAuthClient=null;await workbuddyCli.disconnect();const handle=managedWorkbuddy;managedWorkbuddy=null;await handle?.stop();},getZcodeAccountSource:()=>chatServices.zcode.service?.accountSource||zcodeAccountSource,
    async setZcodeAccountSource(source){if(!['official','configured-custom'].includes(source))throw failure('INVALID_INPUT');const preference=await chatPreferences.load('zcode');await chatPreferences.save('zcode',{...(preference||{}),accountSource:source});if(source===zcodeAccountSource)return;zcodeAccountSource=source;directZcodeEnabled=false;const slot=chatServices.zcode;slot.service=null;slot.generation++;await Promise.all([...slot.clients].map(client=>client.invalidate()));onChange();},
    importCodexService: () => importLocalService('codex'), importZcodeService: () => importLocalService('zcode'),
    createCodexChatRpc: options => localChat('codex', options), createZcodeChatRpc: options => localChat('zcode', options),
    async ensureDirectory(provider,{interactive=true}={}) {
      if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER');
      try { const lease=await access.acquire(provider); lease.release(); return {status:'stored'}; } catch(e) { if(!['DIRECTORY_ACCESS_REQUIRED','ENOENT'].includes(e.code))throw e; }
      return interactive ? authorize(provider) : {status:'needs-authorization'};
    },
    async ensureAuthorized(provider) { try {const lease=await access.acquire(provider);lease.release();return true;} catch(e) {if(!['DIRECTORY_ACCESS_REQUIRED','ENOENT'].includes(e.code))throw e;} return (await authorize(provider)).status === 'stored'; },
    createCodexConnection: options => createMasCodexConnection({ ...options, directoryAccess: access, fetch }), zcode, workbuddy,workbuddyOfficial,workbuddyCli,importWorkbuddyCliService,probeWorkbuddyDesktop,readWorkbuddyDesktop, createWorkBuddyQuotaPort, unavailableObservation,
    async revoke(provider) {
      await cancelPluginInstallation(provider);if(['zcode','workbuddy'].includes(provider))await pluginAccess.revoke(provider);
      if(provider==='zcode')directZcodeEnabled=false;
      if(provider==='codex'){bundledEnabled=false;managedEpoch++;await managedLogin?.close();managedLogin=null;managedLoginUrl=null;}
      await access.revoke(provider);
      if(provider==='workbuddy'){workbuddy.revoke();desktopCache={partitions:[],probe:null,report:null,error:null,accountAttributionVerified:false};}
      const slot = chatServices[provider];
      if (slot) { slot.service = null; slot.generation++; await Promise.all([...slot.clients].map(client => client.invalidate())); }
      onChange();
    }, close };

}
module.exports = { createMasProviderRuntime, createDirectoryStorage, createDiagnosticDirectoryAccess };
