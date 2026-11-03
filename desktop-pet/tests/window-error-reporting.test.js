const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {trackWindowErrors}=require('../lib/window-error-reporting');
test('window observer distinguishes console, preload, network and crash without uploading raw event data',()=>{
 const root=path.resolve(__dirname,'..'),win=new EventEmitter(),contents=win.webContents=new EventEmitter();contents.getURL=()=>pathToFileURL(path.join(root,'weather.html')).href;
 const records=[];let quitting=false;trackWindowErrors(win,{root,capture:(...args)=>records.push(args),isQuitting:()=>quitting});
 contents.emit('console-message',{level:'error',message:'sk-secret private chat',sourceId:pathToFileURL(path.join(root,'weather-renderer.js')).href,lineNumber:28});
 contents.emit('preload-error',{},path.join(root,'weather-preload.js'),new TypeError('private stack'));
 contents.emit('did-fail-load',{},-105,'secret description','https://secret/account',true);
 contents.emit('render-process-gone',{}, {reason:'oom',exitCode:99,secret:'private'});
 assert.equal(records.length,4);assert.equal(records[0][0],'页面控制台错误');assert.equal(records[0][2].line,28);assert.equal(records[0][2].page,'weather.html');
 assert.equal(records[1][2].process,'preload');assert.equal(records[2][2].netErrorCode,-105);assert.equal(records[3][2].reason,'oom');
 assert.doesNotMatch(JSON.stringify(records),/secret|private|Users|https/);
 contents.emit('did-fail-load',{},-3,'cancelled','',true);contents.emit('render-process-gone',{}, {reason:'clean-exit'});contents.emit('console-message',{level:'warning'});
 quitting=true;win.emit('unresponsive');assert.equal(records.length,4);
});
test('external console source never becomes a file or line location',()=>{
 const win=new EventEmitter(),contents=win.webContents=new EventEmitter();contents.getURL=()=> 'https://private.example/?token=secret';const records=[];
 trackWindowErrors(win,{capture:(...args)=>records.push(args),isQuitting:()=>false});contents.emit('console-message',{level:'error',sourceId:'https://private/token',lineNumber:5});
 assert.equal(records[0][2].source,undefined);assert.equal(records[0][2].line,undefined);assert.equal(records[0][2].page,undefined);
});
