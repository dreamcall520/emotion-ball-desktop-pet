const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(width, height, dpr, webgl = false) {
  const surfaces = [], images = [], transforms = [], glCalls = [];
  const gradient = () => ({ addColorStop() {} });
  function canvas() {
    const c = { width: 340, height: 340, dataset: {}, style: {}, setAttribute() {}, remove() { this.parentNode = null; } };
    const ctx = new Proxy({ canvas: c,
      setTransform(...args) { transforms.push({ canvas: c, args }); },
      drawImage(...args) { images.push({ canvas: c, args }); },
      createRadialGradient: gradient, createConicGradient: gradient, createLinearGradient: gradient,
      getImageData: () => ({ data: new Uint8ClampedArray(340 * 340 * 4) })
    }, { get(obj,key) { return key in obj ? obj[key] : () => {}; } });
    const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:(_p,name)=>name,getExtension:()=>({loseContext(){}}),uniform1f:(name,value)=>glCalls.push([name,value]),viewport:(...args)=>glCalls.push(['viewport',...args])},{get(obj,key){if(key in obj)return obj[key];return ()=>({});}});
    c.getContext = kind => kind === 'webgl' ? (webgl?gl:null) : ctx;
    surfaces.push(c); return c;
  }
  const doc = { createElement: canvas, addEventListener() {}, removeEventListener() {} };
  const source = { width: 320, height: 320, clientWidth: width, clientHeight: height, offsetLeft: 0, offsetTop: 0, dataset:{theme:'none'},style: { scale: '', translate:'', opacity: '' }, classList: { contains: name => name === 'sheep-skin' } };
  const host = { ownerDocument: doc, querySelector: selector => selector.includes('sheep-skin') ? source : null,
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }), appendChild(c) { c.parentNode = this; } };
  const root = { devicePixelRatio: dpr, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, cancelAnimationFrame() {}, performance: { now: () => 0 } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../quota-effects.js'), 'utf8'), { window: root });
  return { effect: root.QuotaEffects.create(host), source, host, root, surfaces, images, transforms, glCalls,
    resize(w,h) { width=w;height=h;source.clientWidth=w;source.clientHeight=h; } };
}

// The former sheep geometry stretched .94*width by height; a square-only matrix missed it.
test('four quota housings stay circular and centred in square and actual rectangular preview hosts at DPR 1/2/3', () => {
  for (const [width,height] of [[80,80],[180,180],[320,320],[436,520],[520,436],[372,288]])
    for (const dpr of [1,2,3]) for (const style of ['ring','duo','split','stages']) for (const material of ['soft','glass']) for(const webgl of [false,true]) {
      const h=fixture(width,height,dpr,webgl);
      h.effect.update({ appearance:{shape:'new-year-sheep'},quotas:{fiveHour:74,weekly:38},config:{style,material},reducedMotion:true });
      const c=h.effect.canvas,w=parseFloat(c.style.width),heightCss=parseFloat(c.style.height);
      assert.equal(w,heightCss,`${width}x${height} ${style} must not stretch a circle into an ellipse`);
      assert.equal(parseFloat(c.style.left)+w/2,width/2);
      assert.equal(parseFloat(c.style.top)+heightCss/2,height/2);
      assert.ok(c.width>=Math.ceil(w*dpr)&&c.height>=Math.ceil(heightCss*dpr),'backing must cover CSS physical pixels');
      assert.equal(c.width,c.height);assert.equal(h.source.style.scale,'0.74');
      const mask=h.images.filter(i=>i.args[0]===h.source);assert.equal(mask.length,2);
      for(const {args} of mask){assert.equal(args[3],args[4],'mask honours object-fit contain');assert.equal(args[1]+args[3]/2,width/2);assert.equal(args[2]+args[4]/2,height/2);}
      for(const {args} of h.images.filter(i=>i.args[0]!==h.source)) {
        assert.ok(args[0].width>=c.width,'intermediate ring cache must not downsample to 340px');
        assert.ok(args.length>=5,'HiDPI intermediates must specify logical destination size');
      }
      assert.ok(h.transforms.some(t=>t.canvas===c&&t.args[0]===c.width/340)||c.width===340);
      if(webgl&&material==='soft') {
        const viewport=h.glCalls.filter(r=>r[0]==='viewport').at(-1);
        if(style!=='stages')assert.ok(viewport&&viewport[3]===c.width*2&&viewport[4]===c.height*2);
        const scale=h.glCalls.filter(r=>r[0]==='backingScale').at(-1);if(scale)assert.equal(scale[1],c.width*2/340);
      }
      h.effect.destroy();assert.equal(h.source.style.scale,'');
    }
});

test('DPR and host resize rebuild high resolution ring caches while card/pool retain original behaviour',()=>{
  const h=fixture(500,420,2),input={appearance:{shape:'new-year-sheep'},quotas:{fiveHour:74,weekly:38},config:{style:'duo',material:'glass'},reducedMotion:true};
  h.effect.update(input);const original=h.effect.canvas.width;assert.ok(original>340);
  h.root.devicePixelRatio=3;h.effect.update(input);assert.ok(h.effect.canvas.width>original);
  h.resize(180,180);h.effect.update(input);assert.ok(h.effect.canvas.width>=540);
  h.effect.update({...input,config:{style:'card'}});assert.equal(h.effect.canvas.parentNode,null);assert.equal(h.source.style.scale,'');
  // Pool itself still uses its unchanged 340-unit raster/sampling pipeline.
  h.host.querySelector=()=>null;h.effect.update({...input,config:{style:'pool'}});assert.equal(h.effect.canvas.width,340);assert.equal(h.effect.canvas.height,340);assert.equal(h.source.style.scale,'');
  h.effect.destroy();assert.equal(h.source.style.opacity,'');
});

test('automatic Christmas theme uses the same body scale as the other sheep themes',()=>{
  const h=fixture(420,300,2);h.source.dataset.theme='christmas';
  h.effect.update({appearance:{shape:'new-year-sheep',sheepTheme:'auto'},quotas:{fiveHour:74,weekly:38},config:{style:'duo'},reducedMotion:true});
  assert.equal(h.source.style.scale,'0.74');assert.equal(h.effect.canvas.style.width,h.effect.canvas.style.height);
  h.effect.destroy();assert.equal(h.source.style.scale,'');
});

test('圣诞桌面六状态与其他主题保持同一圆环缩放，不因伙伴再次缩小主体',()=>{
  const h=fixture(120,120,2);h.source.dataset.theme='christmas';h.source.dataset.buddyLayout='true';
  for(const buddy of ['none','reindeer','tree','santa','snowman','gift'])for(const style of ['ring','duo','split','stages']) {
    h.source.dataset.buddy=buddy;
    h.effect.update({appearance:{shape:'new-year-sheep',sheepTheme:'christmas'},quotas:{weekly:38},config:{style},reducedMotion:true});
    assert.equal(h.source.style.scale,'0.74');assert.equal(h.effect.canvas.style.width,h.effect.canvas.style.height);
  }
  h.effect.destroy();assert.equal(h.source.style.scale,'');
});

test('N/S额度环按真实idle alpha中心对齐H且mask同步，换卡片和销毁恢复原translate',()=>{
 for(const theme of ['none','spring-festival'])for(const style of ['ring','duo','split','stages'])for(const size of [120,260]){
  const h=fixture(size,size,2),top=theme==='none'?64:70,bottom=theme==='none'?304:298;
  Object.assign(h.source.dataset,{theme,action:'idle',ready:'true',idlePose:'primary'});
  const pixels=new Uint8ClampedArray(320*320*4);for(let y=top;y<bottom;y++)pixels[(y*320+160)*4+3]=255;
  let reads=0;h.source.getContext=()=>({getImageData:()=>{reads++;return{data:pixels};}});
  const input={appearance:{shape:'new-year-sheep',sheepTheme:theme},quotas:{fiveHour:74,weekly:38},config:{style},reducedMotion:true};
  h.effect.update(input);const expected=(163.5-(top+bottom)/2)/320*size*.74;
  const translated=(x,y)=>{const parts=h.source.style.translate.split(' ').map(parseFloat);assert.equal(parts[0],x);assert.ok(Math.abs(parts[1]-y)<1e-9);};
  assert.equal(h.source.style.scale,'0.74');translated(0,expected);
  const mask=h.images.filter(row=>row.args[0]===h.source);assert.equal(mask.length,2);
  for(const {args}of mask)assert.ok(Math.abs(args[2]-((size-size*.74)/2+expected))<1e-9,'mask matches shifted body');
  h.source.dataset.facing='left';h.effect.update(input);assert.equal(reads,1,'facing and refresh reuse idle reference');
  h.source.dataset.action='joy';h.effect.update(input);translated(0,expected);
  h.effect.update({...input,config:{style:'card'}});assert.equal(h.source.style.scale,'');assert.equal(h.source.style.translate,'');
  h.source.dataset.action='idle';h.source.style.translate='2px 3px';h.effect.update(input);translated(2,3+expected);
  h.effect.destroy();assert.equal(h.source.style.scale,'');assert.equal(h.source.style.translate,'2px 3px');
 }
});

test('H/C无垂直补偿；N/S resize、换主题、低动态仍保持H参照而不改变环或体量',()=>{
 const h=fixture(120,120,2);Object.assign(h.source.dataset,{theme:'none',action:'idle',ready:'true'});
 const pixels=new Uint8ClampedArray(320*320*4);for(let y=64;y<304;y++)pixels[(y*320+160)*4+3]=255;
 h.source.getContext=()=>({getImageData:()=>({data:pixels})});
 const input={appearance:{shape:'new-year-sheep',sheepTheme:'auto'},quotas:{weekly:38},config:{style:'ring'},reducedMotion:true};
 h.effect.update(input);const before=parseFloat(h.source.style.translate.split(' ')[1]);h.resize(260,260);h.effect.update(input);
 assert.ok(Math.abs(parseFloat(h.source.style.translate.split(' ')[1])-before*260/120)<1e-9);
 for(const theme of ['halloween','christmas']){h.source.dataset.theme=theme;h.effect.update(input);assert.equal(h.source.style.translate,'');assert.equal(h.source.style.scale,'0.74');}
 h.source.dataset.theme='none';h.effect.update(input);assert.ok(parseFloat(h.source.style.translate.split(' ')[1])<0);
 h.effect.update({...input,visible:false});assert.equal(h.source.style.translate,'');h.effect.destroy();
});
