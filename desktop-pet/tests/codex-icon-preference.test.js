const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: flush } = require('node:timers/promises');
const { readCodexIconPreference, readCodexSystemDark, createCodexIconPreference } = require('../lib/codex-icon-preference');

test('reads only the fixed Codex preference with a bounded process and accepts three exact values', async () => {
  for (const value of ['app-default','codex-system','space-system']) {
    const signal = new AbortController().signal;
    const result = await readCodexIconPreference({ platform:'darwin', signal, exec(file,args,options,done) {
      assert.equal(file,'/usr/bin/defaults'); assert.deepEqual(args,['read','com.openai.codex','DockIconPreference']);
      assert.equal(options.timeout,2000); assert.equal(options.maxBuffer,256); assert.equal(options.signal,signal);
      done(null,`${value}\n`);
    } });
    assert.equal(result,value);
  }
  for (const stdout of ['other','../secret','https://example.com/icon.png','app-default\nspace-system',' '.repeat(257)+'app-default',null])
    assert.equal(await readCodexIconPreference({platform:'darwin',exec(_f,_a,_o,done){done(null,stdout);}}),null);
  assert.equal(await readCodexIconPreference({platform:'darwin',exec(_f,_a,_o,done){done(Error('timeout or missing'),'app-default');}}),null);
  assert.equal(await readCodexIconPreference({platform:'darwin',exec(){throw Error('spawn failed');}}),null);
  assert.equal(await readCodexIconPreference({platform:'linux',exec(){assert.fail('unsupported platform must not spawn');}}),null);
});

test('polls one read at a time, publishes changes only, and preserves the last valid preference on failure', async () => {
  const timers=new Map(), changes=[]; let serial=0, calls=0, result='app-default';
  const monitor=createCodexIconPreference({readDark:async()=>false,read:async()=>{calls++;return result;},onChange:value=>changes.push(value),
    schedule(fn,delay){assert.equal(delay,5000);timers.set(++serial,fn);return serial;},cancel:id=>timers.delete(id)});
  assert.equal(monitor.getPreference(),'codex-system');
  const initial=monitor.start(); assert.equal(monitor.start(),initial); await initial;
  assert.equal(calls,1); assert.deepEqual(changes,['app-default']); assert.equal(timers.size,1);
  const poll=async()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();await flush();};
  await poll(); assert.equal(calls,2); assert.equal(changes.length,1);
  result=null; await poll(); assert.equal(monitor.getPreference(),'app-default');
  result='space-system'; await poll(); assert.deepEqual(changes,['app-default','space-system']);
  monitor.close(); assert.equal(timers.size,0); await monitor.start(); assert.equal(calls,4);
});

test('pause and close abort pending reads and discard late results; resume immediately refreshes', async () => {
  const requests=[],changes=[],timers=new Map(); let serial=0;
  const monitor=createCodexIconPreference({readDark:async()=>false,read:({signal})=>new Promise(resolve=>requests.push({signal,resolve})),onChange:value=>changes.push(value),
    schedule(fn){timers.set(++serial,fn);return serial;},cancel:id=>timers.delete(id)});
  const stale=monitor.start(); await flush(); monitor.pause(); assert.equal(requests[0].signal.aborted,true);
  const resumed=monitor.start(); await flush(); assert.equal(requests.length,2);
  requests[0].resolve('app-default'); await stale; assert.equal(monitor.getPreference(),'codex-system');
  assert.equal(timers.size,0);
  requests[1].resolve('space-system'); await resumed; assert.equal(monitor.getPreference(),'space-system'); assert.equal(timers.size,1);
  monitor.pause(); assert.equal(timers.size,0);
  const closing=monitor.start(); await flush(); monitor.close(); assert.equal(requests[2].signal.aborted,true);
  requests[2].resolve('app-default'); await closing; assert.equal(monitor.getPreference(),'space-system');
  assert.deepEqual(changes,['space-system']); assert.equal(timers.size,0);
});


test('system appearance reads only the global key; standard absent key is light, failures keep unknown', async () => {
  const sample = (error,stdout,stderr) => readCodexSystemDark({platform:'darwin',exec(file,args,options,done){
    assert.equal(file,'/usr/bin/defaults');assert.deepEqual(args,['read','-g','AppleInterfaceStyle']);
    assert.equal(options.timeout,2000);assert.equal(options.maxBuffer,256);done(error,stdout,stderr);
  }});
  assert.equal(await sample(null,'Dark\n'),true);assert.equal(await sample(null,'Light\n'),false);
  assert.equal(await sample({code:1},'', 'The domain/default pair of (kCFPreferencesAnyApplication, AppleInterfaceStyle) does not exist'),false);
  assert.equal(await sample({code:1},'', "Error: Could not find key 'AppleInterfaceStyle' in domain 'kCFPreferencesAnyApplication'.\n"),false);
  for (const [error,stdout,stderr] of [[null,'Other',''],[null,'Dark'+' '.repeat(256),''],[{code:1},'','permission denied'],
    [{code:'ETIMEDOUT',killed:true},'',''],[{code:1,killed:true},'','The domain/default pair of (kCFPreferencesAnyApplication, AppleInterfaceStyle) does not exist']])
    assert.equal(await sample(error,stdout,stderr),null);
});

test('unchanged icon family still publishes real system color changes and preserves either field on read errors', async () => {
  const changes=[],timers=[];let preference='app-default',dark=false;
  const monitor=createCodexIconPreference({read:async()=>preference,readDark:async()=>dark,onChange:(p,d)=>changes.push([p,d]),schedule:fn=>(timers.push(fn),timers.length),cancel(){}});
  await monitor.start();assert.deepEqual(changes,[['app-default',false]]);
  dark=true;timers.shift()();await flush();assert.deepEqual(changes.at(-1),['app-default',true]);
  dark=null;preference=null;timers.shift()();await flush();assert.equal(monitor.getPreference(),'app-default');assert.equal(monitor.getSystemDark(),true);
  preference='space-system';timers.shift()();await flush();assert.deepEqual(changes.at(-1),['space-system',true]);
  monitor.close();
});


test('pausing before the initial microtask prevents even a cancelled external read from starting', async () => {
  let calls=0;
  const monitor=createCodexIconPreference({read:async()=>{calls++;return 'app-default';},readDark:async()=>{calls++;return false;}});
  const pending=monitor.start();monitor.pause();await pending;
  assert.equal(calls,0);assert.equal(monitor.getPreference(),'codex-system');monitor.close();
});


test('real macOS absent global key changes an existing dark icon back to light', async () => {
  const timers=[],changes=[];let dark=true;
  const monitor=createCodexIconPreference({read:async()=> 'codex-system',readDark:()=>readCodexSystemDark({platform:'darwin',exec(_file,_args,_options,done){
    if(dark) done(null,'Dark\n','');
    else done({code:1},'',"Error: Could not find key 'AppleInterfaceStyle' in domain 'kCFPreferencesAnyApplication'.\n");
  }}),onChange:(p,d)=>changes.push([p,d]),schedule:fn=>(timers.push(fn),timers.length),cancel(){}});
  await monitor.start();assert.equal(monitor.getSystemDark(),true);
  dark=false;timers.shift()();await flush();
  assert.equal(monitor.getSystemDark(),false);assert.deepEqual(changes,[['codex-system',true],['codex-system',false]]);
  monitor.close();
});
