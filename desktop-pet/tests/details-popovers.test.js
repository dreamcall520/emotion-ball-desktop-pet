const test = require('node:test');
const assert = require('node:assert/strict');
const { bind } = require('../details-popovers');
function fixture() {
  const help={open:true},connection={open:true},events={},hostEvents={};
  const document={hidden:false,querySelectorAll:selector=>selector==='.chart-help[open]'&&help.open?[help]:[],addEventListener:(name,callback)=>events[name]=callback};
  const api=bind(document,{addEventListener:(name,callback)=>hostEvents[name]=callback});
  return {help,connection,events,hostEvents,document,api};
}
test('hiding a reusable details window closes only help popovers and leaves connection settings untouched',()=>{
  const f=fixture();f.events.visibilitychange();assert.equal(f.help.open,true,'ordinary visible updates keep the chosen popover');
  f.document.hidden=true;f.events.visibilitychange();assert.equal(f.help.open,false);assert.equal(f.connection.open,true);
  f.document.hidden=false;f.events.visibilitychange();assert.equal(f.help.open,false,'showing the same DOM cannot reopen old help');
});
test('owned close click, Escape and pagehide clear help without resetting other settings details',()=>{
  const f=fixture();f.events.click({target:{closest:()=>null}});assert.equal(f.help.open,true);
  f.events.click({target:{closest:selector=>selector==='#details-close'}});assert.equal(f.help.open,false);
  f.help.open=true;f.events.keydown({key:'Escape'});assert.equal(f.help.open,false);
  f.help.open=true;f.hostEvents.pagehide();assert.equal(f.help.open,false);assert.equal(f.connection.open,true);
});
