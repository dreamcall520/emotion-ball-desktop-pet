'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const receiver={endpoint:'http://127.0.0.1:45678/zcode/events',token:'synthetic_local_capability_not_a_real_token_0123456789'};
async function fixture(t,extra={}){
 const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qiuqiu-animation-install-')),root=path.join(base,'.zcode');fs.mkdirSync(root);fs.mkdirSync(path.join(root,'cli'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));let grant=null,stops=0,picks=[],requests=[];
 const storage={load:async()=>grant,save:async(_id,value)=>{grant=value;},remove:async()=>{grant=null;}};
 const create=require('../lib/mas-zcode-event-installation').createMasZcodeEventInstallation;
 const installer=create({app:{startAccessingSecurityScopedResource:()=>()=>{stops++;}},dialog:{showOpenDialog:async options=>{requests.push(options);return picks.shift()||{filePaths:[root],bookmarks:['synthetic-bookmark']};}},storage,mas:true,home:()=>base,assetRoot:path.join(__dirname,'../assets/zcode-desktop-hook'),...extra});
 return{base,root,installer,storage,picks,requests,get grant(){return grant;},get stops(){return stops;},settings:path.join(root,'cli/config.json'),owned:path.join(root,'.qiuqiu-animation-reminders')};
}
test('animation installation requires its independent native purpose and never adopts read-only task authority',async t=>{
 const f=await fixture(t);await f.storage.save('zcode',{purpose:'zcode-task-metadata-v1',directory:f.root,bookmark:'old'});
 assert.equal((await f.installer.ensure({interactive:false})).status,'needs-authorization');
 await assert.rejects(f.installer.install({receiver}),{code:'DIRECTORY_ACCESS_REQUIRED'});
 assert.equal(fs.existsSync(f.settings),false);assert.equal((await f.installer.ensure({interactive:true})).status,'stored');
 assert.notEqual(f.grant.purpose,'zcode-task-metadata-v1');
});
test('standard global hooks are installed atomically with exact backup while unrelated settings and plugins survive',async t=>{
 const f=await fixture(t),original='{"theme":"dark","hooks":{"enabled":true,"events":{"Stop":[{"hooks":[{"type":"command","command":"echo keep"}]}]}},"enabledPlugins":{"other@market":true}}\n';
 fs.writeFileSync(f.settings,original);fs.mkdirSync(path.join(f.root,'plugins'));fs.writeFileSync(path.join(f.root,'plugins/installed_plugins.json'),'keep plugin bytes');
 await f.installer.ensure({interactive:true});const result=await f.installer.install({receiver});assert.equal(result.status,'installed');
 const settings=JSON.parse(fs.readFileSync(f.settings));assert.equal(settings.theme,'dark');assert.equal(settings.enabledPlugins['other@market'],true);assert.equal(settings.hooks.events.Stop[0].hooks[0].command,'echo keep');
 const own=settings.hooks.events.UserPromptSubmit.find(entry=>entry.hooks.some(hook=>hook.command.includes('ZCODE_PLUGIN_ROOT=')));assert.ok(own);assert.match(own.hooks[0].command,/\/bin\/sh/);
 assert.equal(fs.readFileSync(path.join(f.root,'plugins/installed_plugins.json'),'utf8'),'keep plugin bytes');
 assert.equal(fs.statSync(path.join(f.owned,'receiver.json')).mode&0o777,0o600);
 const backups=fs.readdirSync(path.join(f.root,'.qiuqiu-animation-backups')).map(name=>fs.readFileSync(path.join(f.root,'.qiuqiu-animation-backups',name),'utf8'));assert.ok(backups.includes(original));
 assert.ok(!JSON.stringify(f.installer.getState()).includes(receiver.token));
 await f.installer.install({receiver});assert.equal(JSON.parse(fs.readFileSync(f.settings)).hooks.events.UserPromptSubmit.length,1);
});
test('background restore only rotates private pairing of an existing installation and never registers missing hooks',async t=>{
 const f=await fixture(t);await f.installer.ensure({interactive:true});assert.equal((await f.installer.restore({receiver})).status,'not-installed');assert.equal(fs.existsSync(f.settings),false);
 await f.installer.install({receiver});const before=fs.readFileSync(f.settings);const next={...receiver,token:'synthetic_replacement_capability_not_real_0123456789'};
 assert.equal((await f.installer.restore({receiver:next})).status,'installed');assert.deepEqual(fs.readFileSync(f.settings),before);assert.equal(JSON.parse(fs.readFileSync(path.join(f.owned,'receiver.json'))).token,next.token);
 const modified=JSON.parse(before);delete modified.hooks.events.UserPromptSubmit;fs.writeFileSync(f.settings,JSON.stringify(modified));assert.equal((await f.installer.restore({receiver})).status,'not-installed');assert.equal(JSON.parse(fs.readFileSync(f.settings)).hooks.events.UserPromptSubmit,undefined);
});
test('uninstall removes only exact owned entries and files, preserving later user hooks and safe backups',async t=>{
 const f=await fixture(t);await f.installer.ensure({interactive:true});await f.installer.install({receiver});
 const settings=JSON.parse(fs.readFileSync(f.settings));settings.newUserSetting=17;settings.hooks.events.Stop.push({hooks:[{type:'command',command:'echo unrelated'}]});fs.writeFileSync(f.settings,JSON.stringify(settings));
 fs.writeFileSync(path.join(f.owned,'user-note.txt'),'preserve');
 assert.equal((await f.installer.uninstall()).status,'uninstalled');const after=JSON.parse(fs.readFileSync(f.settings));assert.equal(after.newUserSetting,17);assert.deepEqual(after.hooks.events.Stop,[{hooks:[{type:'command',command:'echo unrelated'}]}]);
 assert.equal(fs.existsSync(path.join(f.owned,'receiver.json')),false);assert.equal(fs.readFileSync(path.join(f.owned,'user-note.txt'),'utf8'),'preserve');assert.ok(fs.readdirSync(path.join(f.root,'.qiuqiu-animation-backups')).length>0);
 await f.installer.revoke();assert.equal(f.grant,null);
});
test('unsafe paths, arbitrary receiver addresses and cancelled authorization cannot write official configuration',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort();await assert.rejects(f.installer.ensure({interactive:true,signal:controller.signal}),{code:'CANCELLED'});
 await f.installer.ensure({interactive:true});await assert.rejects(f.installer.install({receiver:{...receiver,endpoint:'https://example.com/events'}}),{code:'INVALID_RECEIVER'});assert.equal(fs.existsSync(f.settings),false);
 const outside=path.join(f.base,'outside.json');fs.writeFileSync(outside,'{}');fs.symlinkSync(outside,f.settings);await assert.rejects(f.installer.install({receiver}),{code:'UNSAFE_PATH'});assert.equal(fs.readFileSync(outside,'utf8'),'{}');
});
test('a failed final settings commit rolls back script/pairing registration and preserves the exact original settings',async t=>{
 let target,failed=false;const io=new Proxy(fs,{get(base,key){if(key==='renameSync')return(from,to)=>{if(to===target&&!failed){failed=true;throw Object.assign(Error('synthetic I/O failure'),{code:'EIO'});}return fs.renameSync(from,to);};return base[key];}});
 const f=await fixture(t,{io});target=f.settings;const original='{"hooks":{"enabled":true,"events":{"Stop":[]}},"keep":true}\n';fs.writeFileSync(target,original);await f.installer.ensure({interactive:true});
 await assert.rejects(f.installer.install({receiver}));assert.equal(fs.readFileSync(target,'utf8'),original);assert.equal(fs.existsSync(path.join(f.owned,'receiver.json')),false);assert.equal(fs.existsSync(path.join(f.owned,'scripts/emit-metadata.sh')),false);
});
test('cancellation while saving the native grant restores the previous grant and never writes hook settings',async t=>{
 const f=await fixture(t),controller=new AbortController(),save=f.storage.save;
 f.storage.save=async(...args)=>{await save(...args);controller.abort();};
 await assert.rejects(f.installer.ensure({interactive:true,signal:controller.signal}),{code:'CANCELLED'});
 assert.equal(f.grant,null);assert.equal(fs.existsSync(f.settings),false);
});
test('clearPending invalidates a still-open native selection before it can persist install authority',async t=>{
 const f=await fixture(t);let finish;
 f.picks.push(new Promise(resolve=>{finish=resolve;}));
 const selecting=f.installer.ensure({interactive:true});await new Promise(resolve=>setImmediate(resolve));f.installer.clearPending();
 finish({filePaths:[f.root],bookmarks:['late-synthetic-bookmark']});
 await assert.rejects(selecting,{code:'CANCELLED'});assert.equal(f.grant,null);assert.equal(fs.existsSync(f.settings),false);
});
test('explicit global hook policy is preserved and never overridden to enable Qiuqiu',async t=>{
 for(const key of ['disableAllHooks','allowManagedHooksOnly']){
  const f=await fixture(t),original=JSON.stringify({[key]:true,keep:'same'});fs.writeFileSync(f.settings,original);await f.installer.ensure({interactive:true});
  await assert.rejects(f.installer.install({receiver}),{code:'HOOKS_DISABLED_BY_POLICY'});assert.equal(fs.readFileSync(f.settings,'utf8'),original);assert.equal(fs.existsSync(path.join(f.owned,'receiver.json')),false);
 }
});
test('uninstall removes our command from a user-extended row without deleting their added command or matcher',async t=>{
 const f=await fixture(t);await f.installer.ensure({interactive:true});await f.installer.install({receiver});
 const settings=JSON.parse(fs.readFileSync(f.settings));settings.hooks.events.Stop[0].matcher='*';settings.hooks.events.Stop[0].hooks.push({type:'command',command:'echo user-added'});fs.writeFileSync(f.settings,JSON.stringify(settings));
 await f.installer.uninstall();const after=JSON.parse(fs.readFileSync(f.settings));assert.deepEqual(after.hooks.events.Stop,[{matcher:'*',hooks:[{type:'command',command:'echo user-added'}]}]);
});
test('repeated authorize/install/restore and disable/re-enable use three fixed files and never duplicate hooks or other plugin settings',async t=>{
 const f=await fixture(t),original={theme:'dark',enabledPlugins:{'other@market':true},hooks:{enabled:true,events:{Stop:[{hooks:[{type:'command',command:'echo keep'}]}]}}};
 fs.writeFileSync(f.settings,JSON.stringify(original));fs.mkdirSync(path.join(f.root,'plugins'));const plugins=path.join(f.root,'plugins/installed_plugins.json');fs.writeFileSync(plugins,'unrelated plugin bytes');
 const files=directory=>fs.existsSync(directory)?fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)).map(name=>entry.name+'/'+name):[entry.name]).sort():[];
 const diskSnapshot=()=>Object.fromEntries(files(f.root).map(name=>[name,fs.readFileSync(path.join(f.root,name),'hex')]));
 const countBackups=()=>files(path.join(f.root,'.qiuqiu-animation-backups')).length;
 const fixedFiles=['installation.json','receiver.json','scripts/emit-metadata.sh'];
 const assertSingleHooks=()=>{const settings=JSON.parse(fs.readFileSync(f.settings));const record=JSON.parse(fs.readFileSync(path.join(f.owned,'installation.json')));
  for(const event of record.events)assert.equal(settings.hooks.events[event].flatMap(entry=>entry.hooks||[]).filter(hook=>hook.command===record.command).length,1,event);
  assert.deepEqual(settings.enabledPlugins,original.enabledPlugins);assert.deepEqual(settings.hooks.events.Stop[0],original.hooks.events.Stop[0]);assert.equal(fs.readFileSync(plugins,'utf8'),'unrelated plugin bytes');
 };
 const before=diskSnapshot();await f.installer.ensure({interactive:true});assert.deepEqual(diskSnapshot(),before,'authorization alone installs no files');assert.equal(Object.hasOwn(f.requests[0],'message'),false);
 await f.installer.install({receiver});assert.deepEqual(files(f.owned),fixedFiles);assert.equal(countBackups(),1);assertSingleHooks();const installed=diskSnapshot();
 for(let repeat=0;repeat<3;repeat++){await f.installer.ensure({interactive:true});await f.installer.install({receiver});await f.installer.restore({receiver});assert.deepEqual(diskSnapshot(),installed);assertSingleHooks();}
 assert.equal(f.requests.length,1,'a valid stored native grant does not reopen the picker');
 const rotated={...receiver,token:'synthetic_new_pairing_not_a_real_secret_0123456789'};const settingsBefore=fs.readFileSync(f.settings);
 await f.installer.restore({receiver:rotated});assert.deepEqual(files(f.owned),fixedFiles);assert.equal(countBackups(),1);assert.deepEqual(fs.readFileSync(f.settings),settingsBefore);assertSingleHooks();
 await f.installer.uninstall();await f.installer.revoke();assert.equal(fs.existsSync(f.owned),false);assert.deepEqual(JSON.parse(fs.readFileSync(f.settings)),original);assert.equal(countBackups(),2);
 const disabled=diskSnapshot();await f.installer.ensure({interactive:true});assert.deepEqual(diskSnapshot(),disabled);assert.equal(f.requests.length,2);
 await f.installer.install({receiver:rotated});assert.deepEqual(files(f.owned),fixedFiles);assert.equal(countBackups(),3);assertSingleHooks();
 const reenabled=diskSnapshot();await f.installer.install({receiver:rotated});assert.deepEqual(diskSnapshot(),reenabled);
 await f.installer.uninstall();assert.deepEqual(JSON.parse(fs.readFileSync(f.settings)),original);assert.equal(countBackups(),4);assert.equal(fs.readFileSync(plugins,'utf8'),'unrelated plugin bytes');
});
test('ZCode runtime wrapper, default enablement and removal preserve unrelated raw config bytes and large integers',async t=>{
 const f=await fixture(t),original='{\n "large":900719925474099312345, "accountConfig" : {"opaque":"keep bytes"}, "tail":true\n}\n';
 fs.writeFileSync(f.settings,original);await f.installer.ensure({interactive:true});await f.installer.install({receiver});
 const installed=fs.readFileSync(f.settings,'utf8');assert.ok(installed.includes('"large":900719925474099312345, "accountConfig" : {"opaque":"keep bytes"}, "tail":true'));
 const hooks=JSON.parse(installed).hooks;assert.equal(hooks.enabled,true);assert.ok(hooks.events.UserPromptSubmit);assert.equal(hooks.UserPromptSubmit,undefined);
 await f.installer.uninstall();assert.equal(fs.readFileSync(f.settings,'utf8'),original);
});
test('a disabled user hook source is not globally enabled when it contains unrelated configured hooks',async t=>{
 const f=await fixture(t),original=JSON.stringify({hooks:{enabled:false,events:{Stop:[{hooks:[{type:'command',command:'echo other disabled hook'}]}]}}});
 fs.writeFileSync(f.settings,original);await f.installer.ensure({interactive:true});
 await assert.rejects(f.installer.install({receiver}),{code:'HOOKS_DISABLED_BY_POLICY'});assert.equal(fs.readFileSync(f.settings,'utf8'),original);
 assert.equal(fs.existsSync(f.owned),false);
});
test('an originally absent config is removed on uninstall and a preexisting disabled empty wrapper is restored',async t=>{
 const absent=await fixture(t);await absent.installer.ensure({interactive:true});await absent.installer.install({receiver});await absent.installer.uninstall();assert.equal(fs.existsSync(absent.settings),false);
 const empty=await fixture(t),original={hooks:{enabled:false,timeoutMs:8000,events:{Stop:[]}},keep:true};fs.writeFileSync(empty.settings,JSON.stringify(original));
 await empty.installer.ensure({interactive:true});await empty.installer.install({receiver});await empty.installer.uninstall();assert.deepEqual(JSON.parse(fs.readFileSync(empty.settings)),original);
});

test('uninstall is idempotent before first authorization and after a completed revoke, while invalid grants still fail',async t=>{
 const f=await fixture(t);assert.equal((await f.installer.uninstall()).status,'uninstalled');assert.equal(f.requests.length,0);assert.equal(fs.existsSync(f.settings),false);
 await f.installer.ensure({interactive:true});await f.installer.install({receiver});await f.installer.uninstall();await f.installer.revoke();
 assert.equal((await f.installer.uninstall()).status,'uninstalled');assert.equal(f.requests.length,1);
 await f.storage.save('zcode',{purpose:'wrong-purpose',directory:f.root,bookmark:'not-an-install-grant'});
 await assert.rejects(f.installer.uninstall(),{code:'DIRECTORY_ACCESS_REQUIRED'});
});
