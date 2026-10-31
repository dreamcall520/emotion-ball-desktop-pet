const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Run the real SVG-particle painter with a controlled clock and attribute nodes.
const source=fs.readFileSync(path.resolve(__dirname,'../../emotion-ball/js/ball.js'),'utf8');
const painter=source.slice(source.indexOf('    function renderZzz('),source.indexOf('    /* ---- 每帧 ---- */'));
function harness(lite=false){
 const nodes=Array.from({length:3},()=>{const a={};return {setAttribute:(k,v)=>a[k]=String(v),getAttribute:k=>a[k],a};});
 const c={zzzNodes:nodes,sleepZzzStartedAt:null,lite,facing:1,HEAD_C:114.2705,r2:v=>Math.round(v*100)/100};vm.createContext(c);vm.runInContext(painter,c);
 return {frame(now,amount=1){c.renderZzz(now,amount);return nodes.map(n=>Number(n.a.opacity));}};
}
for(const lite of [false,true])test(`sleep particles rest between brief appearances, lite=${lite}`,()=>{
 const h=harness(lite),max=a=>Math.max(...a);
 assert.equal(max(h.frame(100000)),0);
 const fadeIn=max(h.frame(100100)),full=max(h.frame(100450));assert.ok(fadeIn>0&&fadeIn<full);
 assert.ok(max(h.frame(105000))>0);
 assert.ok(max(h.frame(105900))<max(h.frame(105450)));
 for(const offset of [6000,10000,20000,29999])assert.equal(max(h.frame(100000+offset)),0);
 assert.equal(max(h.frame(130000)),0);assert.ok(max(h.frame(130450))>0);
 assert.equal(max(h.frame(131000,0)),0);
 assert.equal(max(h.frame(155000)),0);assert.ok(max(h.frame(155450))>0);
 assert.equal(max(h.frame(161000)),0);
});
