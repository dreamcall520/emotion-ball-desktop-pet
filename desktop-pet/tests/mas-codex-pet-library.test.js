const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {deflateSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {createCodexPetStore}=require('../lib/codex-pets');
const {createMasCodexPetLibrary}=require('../lib/mas-codex-pet-library');
function image(){
 const chunk=(name,bytes)=>{const type=Buffer.from(name),data=Buffer.concat([type,bytes]);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(bytes.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(1536);head.writeUInt32BE(1872,4);head[8]=8;head[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.alloc((1536*4+1)*1872))),chunk('IEND',Buffer.alloc(0))]);
}
const png=image();
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mas-pet-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'.codex','pets'),own=path.join(root,'container','codex-pets'),stateFile=path.join(root,'container','library.json');fs.mkdirSync(source,{recursive:true});
 const selections=[],pickers=[],scopes=[];let expired=false,stops=0;
 const app={getPath:()=>root,startAccessingSecurityScopedResource:bookmark=>{scopes.push(bookmark);if(expired)throw Error('expired');return()=>{stops++;};}};
 const dialog={showOpenDialog:async options=>{pickers.push(options);return selections.shift()||{canceled:true};}};
 const store=createCodexPetStore({sourceRoot:own,importRoot:own});
 const make=()=>createMasCodexPetLibrary({app,dialog,store,stateFile});const library=make();
 function add(name){const folder=path.join(source,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'pet.json'),JSON.stringify({displayName:name,spritesheetPath:'sheet.png'}));fs.writeFileSync(path.join(folder,'sheet.png'),png);return folder;}
 const select=()=>selections.push({canceled:false,filePaths:[source],bookmarks:['synthetic-pets-only']});
 return{root,source,own,stateFile,selections,pickers,scopes,store,library,make,add,select,setExpired:v=>expired=v,get stops(){return stops;}};
}
function snapshot(root){const rows=[];function visit(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file);rows.push([path.relative(root,file),s.ino,s.mode,s.mtimeMs,s.size]);if(s.isDirectory())visit(file);else if(s.isFile())rows.at(-1).push(createHash('sha256').update(fs.readFileSync(file)).digest('hex'));}}visit(root);return rows;}
test('首次读取不弹权限；本人选择后只读导入，书签释放且重启刷新复用',async t=>{
 const f=setup(t);f.add('第一只');
 assert.deepEqual(await f.library.sync(),{status:'needs-authorization'});assert.equal(f.pickers.length,0);assert.equal(f.scopes.length,0);
 const sourceBefore=snapshot(f.source);f.select();assert.deepEqual(await f.library.sync({interactive:true}),{status:'connected',imported:1,skipped:0});
 assert.equal(f.pickers[0].defaultPath,path.join(f.root,'.codex','pets'));assert.equal(f.pickers[0].securityScopedBookmarks,true);assert.equal(f.stops,1);assert.deepEqual(snapshot(f.source),sourceBefore);
 assert.equal(fs.statSync(f.stateFile).mode&0o777,0o600);assert.equal(f.store.listImported().pets.length,1);
 f.add('第二只');const refreshed=await f.make().sync();assert.equal(refreshed.imported,2);assert.equal(f.pickers.length,1);assert.equal(f.stops,2);assert.equal(f.store.listImported().pets.length,2);
 fs.rmSync(f.source,{recursive:true});assert.equal(f.store.listImported().pets.length,2,'imported copies survive source removal');
});
test('取消、更换失败、书签失效保持既有内容；刷新不自动弹系统选择器',async t=>{
 const f=setup(t);f.add('保留');f.select();await f.library.sync({interactive:true});const imported=snapshot(f.own),grant=fs.readFileSync(f.stateFile);
 assert.deepEqual(await f.library.sync({interactive:true}),{status:'cancelled'});assert.deepEqual(snapshot(f.own),imported);assert(fs.readFileSync(f.stateFile).equals(grant));
 f.setExpired(true);assert.deepEqual(await f.make().sync(),{status:'needs-authorization'});assert.equal(f.pickers.length,2);assert.deepEqual(snapshot(f.own),imported);
 f.setExpired(false);fs.rmSync(f.source,{recursive:true});assert.deepEqual(await f.make().sync(),{status:'needs-authorization'});assert.equal(f.stops,2,'failed directory validation releases scope too');assert.deepEqual(snapshot(f.own),imported);
});
test('只接收pets目录，拒绝父目录及缺书签，取消迟到选择不保存；跳过符号链接和非法包',async t=>{
 const f=setup(t);f.add('有效');fs.mkdirSync(path.join(f.source,'无效'));fs.writeFileSync(path.join(f.root,'.codex','auth.json'),'synthetic-secret');fs.symlinkSync(f.root,path.join(f.source,'link'));
 f.selections.push({canceled:false,filePaths:[path.dirname(f.source)],bookmarks:['wrong-scope']});assert.deepEqual(await f.library.sync({interactive:true}),{status:'invalid-directory'});assert.equal(f.scopes.length,0);
 f.selections.push({canceled:false,filePaths:[f.source],bookmarks:[]});assert.deepEqual(await f.library.sync({interactive:true}),{status:'invalid-directory'});assert.equal(f.scopes.length,0);
 let current=true;f.selections.push({canceled:false,filePaths:[f.source],bookmarks:['late']});const pending=f.library.sync({interactive:true,isCurrent:()=>current});current=false;assert.deepEqual(await pending,{status:'cancelled'});assert.equal(fs.existsSync(f.stateFile),false);
 f.select();const result=await f.library.sync({interactive:true});assert.equal(result.imported,1);assert.equal(result.skipped,2);assert.equal(fs.readdirSync(f.own).length,1);assert.equal(f.stops,1);
});


test('目录书签入口只对真实MAS及原生API开放，普通Electron候选不构造原生库',()=>{
 const {supportsMasCodexPetLibrary}=require('../lib/mas-codex-pet-library');
 const native={startAccessingSecurityScopedResource:()=>{throw Error('capability detection must not open a scope');}};
 assert.equal(supportsMasCodexPetLibrary({app:native,mas:true}),true);
 for(const mas of [false,undefined,'true',1])assert.equal(supportsMasCodexPetLibrary({app:native,mas}),false);
 assert.equal(supportsMasCodexPetLibrary({app:{},mas:true}),false);
 assert.equal(supportsMasCodexPetLibrary({mas:true}),false);
 assert.equal(supportsMasCodexPetLibrary(),false);
 const main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 assert.match(main,/if\(IS_STORE_BUILD&&require\('\.\/lib\/mas-codex-pet-library'\)\.supportsMasCodexPetLibrary\(\{app,mas:process\.mas\}\)\)masCodexPetLibrary=/);
});
