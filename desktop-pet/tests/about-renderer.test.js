const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('发现新版只显示新版入口，最新或失败时仍可检查更新', async()=>{
  const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:'',addEventListener(){}});return nodes.get(id)};
  let receive;const bridge={getInfo:async()=>({version:'0.3.31'}),checkUpdates(){},openRelease(){},openWebsite(){},onUpdate(fn){receive=fn;return()=>{}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../about-renderer.js'),'utf8'),{window:{qiuqiuAbout:bridge,PetChatAvatar:{render(){}},addEventListener(){}},document:{getElementById:get,addEventListener(){}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(get('about-check-updates').hidden,false);assert.equal(get('about-open-release').hidden,true);
  receive({state:'ready',hasUpdate:true,latestVersion:'0.3.32'});
  assert.equal(get('about-check-updates').hidden,true);assert.equal(get('about-open-release').hidden,false);
  assert.equal(get('about-status').textContent,'发现新版本 0.3.32');
  receive({state:'checking'});assert.equal(get('about-check-updates').hidden,true);assert.equal(get('about-open-release').disabled,true);
  for(const value of [{state:'ready',hasUpdate:false},{state:'error'}]){receive(value);assert.equal(get('about-check-updates').hidden,false);assert.equal(get('about-open-release').hidden,true)}
});
