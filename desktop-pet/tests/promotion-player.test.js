const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {frameAt,resolveClip,create}=require('../lib/promotion-player'),cases=require('../promotion-clips');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('promotion clips reference packaged real sprite sheets with matching frame bounds and character-specific actions',()=>{
 assert.deepEqual(cases.map(p=>p.id),['chuge','spring','xiaobai']);
 for(const pet of cases)for(const [id,clip]of Object.entries(pet.clips)){assert(fs.existsSync(path.resolve(__dirname,'..',clip.image)),pet.id+'/'+id);assert(clip.start+clip.durations.length<=clip.columns*clip.rows);assert(clip.durations.every(ms=>Number.isInteger(ms)&&ms>=16));assert.equal(frameAt(clip,0),0);assert.equal(frameAt(clip,clip.durations.reduce((a,b)=>a+b,0)),0);}
 assert.equal(cases[0].clips.kfc.start,24);assert.equal(resolveClip(cases[0],'sleep',2100).action,'kfc');assert.equal(resolveClip(cases[0],'sleep',5100).action,'sleep');assert(cases[1].clips.dumplings&&cases[1].clips.firecrackers);assert.equal(cases[2].clips.kfc,undefined);
});
test('rapid case changes ignore late image loads and pause/stop cancel every old animation callback',async()=>{
 let now=0;const callbacks=new Map(),pending=new Map(),draws=[],ready=[];let serial=0;
 const ctx={clearRect(){},save(){},translate(){},scale(){},restore(){},drawImage(img){draws.push(img.key)}};const canvas={width:192,height:208,dataset:{},getContext:()=>ctx};
 const player=create({canvas,now:()=>now,requestFrame:fn=>{callbacks.set(++serial,fn);return serial},cancelFrame:id=>callbacks.delete(id),onReady:value=>ready.push(value.pet.id),loadImage:key=>new Promise(resolve=>pending.set(key,resolve))});
 player.play(cases[0],'wave');await flush();player.play(cases[1],'walk');await flush();pending.get(cases[0].clips.wave.image)({key:'old',naturalWidth:1536,naturalHeight:1040});await flush();assert.deepEqual(draws,[]);
 pending.get(cases[1].clips.walk.image)({key:'spring',naturalWidth:1920,naturalHeight:320});await flush();assert.deepEqual(draws,['spring']);assert.deepEqual(ready,['spring']);assert.equal(callbacks.size,1);
 now=350;player.setPaused(true);await flush();assert.equal(callbacks.size,0);const frame=canvas.dataset.promotionFrame;now=9999;await flush();assert.equal(canvas.dataset.promotionFrame,frame);player.setPaused(false);await flush();assert.equal(callbacks.size,1);player.stop();assert.equal(callbacks.size,0);
});
test('local image failure is reported without a renderer crash and can retry independently',async()=>{
 const errors=[];const canvas={width:192,height:208,dataset:{},getContext:()=>({clearRect(){}})};const player=create({canvas,requestFrame:()=>0,cancelFrame(){},loadImage:()=>Promise.reject(Error('missing asset')),onError:error=>errors.push(error)});player.play(cases[0]);await flush();assert.equal(canvas.dataset.promotionReady,'error');assert.equal(errors.length,1);player.stop();
});
test('package staging contains promotion module and exact referenced assets, without exploratory frame exports',()=>{
 const os=require('node:os'),{prepareStaging}=require('../scripts/package-mac'),root=path.resolve(__dirname,'../..'),staging=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-promotion-stage-'));
 try{prepareStaging(root,staging,{weatherNative:false});for(const file of ['promotion.css','promotion-renderer.js','promotion-clips.js','lib/promotion-player.js','assets/promotion/wechat-contact-original.jpg',...cases.flatMap(p=>Object.values(p.clips).map(c=>c.image))])assert.deepEqual(fs.readFileSync(path.join(staging,'desktop-pet',file)),fs.readFileSync(path.join(root,'desktop-pet',file)),file);assert.deepEqual(fs.readdirSync(path.join(staging,'desktop-pet/assets/promotion/chuge')).sort(),['base.webp','sleep.webp','walk.webp','wave.webp']);}
 finally{fs.rmSync(staging,{recursive:true,force:true});}
});
