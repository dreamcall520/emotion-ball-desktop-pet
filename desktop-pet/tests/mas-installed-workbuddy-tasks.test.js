'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {execute}=require('../lib/workbuddy-helper.cjs');
const {readWorkBuddyTasks,workBuddyTaskLink}=require('../lib/workbuddy-tasks-reader');
const accountKey='a'.repeat(64);
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'mas-task-root-')),directory=path.join(root,'.workbuddy'),file=path.join(directory,'workbuddy.db');
 fs.mkdirSync(directory);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(file);db.exec('CREATE TABLE sessions(id TEXT,user_id TEXT,title TEXT,custom_title TEXT,status TEXT,unread INTEGER,updated_at INTEGER,deleted_at INTEGER,transport TEXT,body TEXT)');
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?)').run('task-a','synthetic-user','合成标题','','completed',1,1000,null,'local','NEVER_READ_BODY');
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?)').run('task-other','other-user','OTHER_ACCOUNT_SECRET','','completed',1,1000,null,'local','NEVER_READ_BODY');db.close();
 return{root,directory,file};
}
test('helper uses explicit task directory and checks current account before publishing metadata or links',async t=>{
 const f=fixture(t),previous=process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY;process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY=f.directory;
 let calls=0;const authReader=()=>{calls++;return{accountKey,uid:'synthetic-user',scope:'personal'};};
 try{
  const value=await execute('tasks',{expectedAccountKey:accountKey},()=>{},{authReader});assert.equal(value.total,1);assert.equal(value.items[0].title,'合成标题');assert.equal(value.running,null);assert.ok(calls>=2);assert.ok(!JSON.stringify(value).includes('SECRET'));assert.ok(!JSON.stringify(value).includes('BODY'));
  const opened=await execute('task-open',{expectedAccountKey:accountKey,id:'task-a'},()=>{},{authReader});assert.equal(opened.url,'workbuddy://chat/task-a');
  const db=new DatabaseSync(f.file,{readOnly:true});assert.equal(db.prepare('SELECT unread FROM sessions WHERE id=?').get('task-a').unread,1);db.close();
  let owner=0;await assert.rejects(execute('tasks',{expectedAccountKey:accountKey},()=>{},{authReader:()=>({accountKey:owner++?'b'.repeat(64):accountKey,uid:'synthetic-user',scope:'personal'})}),{code:'ACCOUNT_CHANGED'});
 }finally{if(previous===undefined)delete process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY;else process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY=previous;}
});
test('authorized metadata readers reject symlink database or WAL sidecar without reading a different file',t=>{
 const f=fixture(t),outside=path.join(f.root,'outside.db');fs.renameSync(f.file,outside);fs.symlinkSync(outside,f.file);
 assert.throws(()=>readWorkBuddyTasks({uid:'synthetic-user',accountKey,file:f.file}),{code:'TASK_CACHE_UNAVAILABLE'});
 assert.throws(()=>workBuddyTaskLink({uid:'synthetic-user',accountKey,id:'task-a',file:f.file}),{code:'TASK_CACHE_UNAVAILABLE'});
 fs.unlinkSync(f.file);fs.renameSync(outside,f.file);fs.symlinkSync(f.file,f.file+'-wal');
 assert.throws(()=>readWorkBuddyTasks({uid:'synthetic-user',accountKey,file:f.file}),{code:'TASK_CACHE_UNAVAILABLE'});
});
test('explicit unsupported task root fails closed rather than falling back to the default home',t=>{
 const f=fixture(t),previous=process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY;process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY=f.root;
 try{assert.throws(()=>readWorkBuddyTasks({uid:'synthetic-user',accountKey}),{code:'TASK_CACHE_UNAVAILABLE'});}
 finally{if(previous===undefined)delete process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY;else process.env.QIUQIU_WORKBUDDY_TASK_DIRECTORY=previous;}
});
