const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const root = path.join(__dirname, '../assets/sheep');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const sourceFrames = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sheep-source-frames.json')));
const ids = ['greet', 'idle', 'joy', 'sleep', 'walk', 'working', 'complete'];
const themeActions = { none: ['ear','bell','stretch'], halloween: ['candy','magic','pumpkin'], christmas: ['gift','receive-gift','scarf','snow'], 'spring-festival': ['fortune','firecrackers','dumplings'] };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function png(bytes, pixels = false) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6); assert.equal(bytes[28], 0);
  if (!pixels) return { width, height };
  const chunks = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.subarray(at + 4, at + 8).toString();
    if (type === 'IDAT') chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const scan = zlib.inflateSync(Buffer.concat(chunks)), stride = width * 4;
  assert.equal(scan.length, (stride + 1) * height);
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = scan[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[y * stride + x - 4] : 0;
      const up = y ? data[(y - 1) * stride + x] : 0;
      const corner = y && x >= 4 ? data[(y - 1) * stride + x - 4] : 0;
      const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
      const predict = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3
        ? Math.floor((left + up) / 2) : a <= b && a <= c ? left : b <= c ? up : corner;
      data[y * stride + x] = scan[y * (stride + 1) + x + 1] + predict;
    }
  }
  return { width, height, data };
}

test('小羊保留41动作、恰好两个B待机及六个姿势衔接及两个近身道具，及五元素，共60资源', () => {
  assert.equal(manifest.version, 1); assert.equal(manifest.width, 320); assert.equal(manifest.height, 320);
  assert.deepEqual(Object.keys(manifest.themes).sort(), ['christmas', 'halloween', 'none', 'spring-festival']);
  for (const [id, theme] of Object.entries(manifest.themes)) assert.deepEqual(Object.keys(theme.actions).sort(), [...ids,...themeActions[id]].sort());
  assert.deepEqual(Object.entries(manifest.themes).filter(([,theme])=>theme.idleAlternate).map(([name])=>name).sort(),['none','spring-festival']);
  assert.deepEqual(Object.entries(manifest.themes).filter(([,t])=>t.idleTransition).map(([id])=>id).sort(),['none','spring-festival']);
  assert.ok(Object.values(manifest.themes).every(t=>t.workingTransition));
  const files = fs.readdirSync(root, { recursive: true }).filter(file => fs.statSync(path.join(root, file)).isFile());
  const expected = ['manifest.json', 'props/candy.png', 'props/gift.png', ...['reindeer','tree','santa','snowman','gift'].map(id=>`buddies/${id}.png`)];
  for (const [theme, spec] of Object.entries(manifest.themes)) {
    for (const clip of Object.values(spec.actions)) expected.push(clip.file);
    for(const key of ['idleAlternate','idleTransition','workingTransition','sleepTransition'])if(spec[key])expected.push(spec[key].file);
    if (theme !== 'none') expected.push(spec.staticFile);
  }
  assert.equal(files.length,60);assert.equal(expected.length,60);
  assert.deepEqual(files.sort(), expected.sort(), 'Only runtime PNGs and manifest belong in the App');
});

test('日常保留三秒安静眨眼，重绘动作有完整关键姿态与合理时长', () => {
  const idle = manifest.themes.none.actions.idle;
  assert.equal(idle.frameCount, 3); assert.equal(idle.durations.reduce((a, b) => a + b, 0), 3220);
  for (const id of ['walk', 'greet', 'joy', 'sleep']) {
    const clip = manifest.themes.none.actions[id];
    assert.ok(clip.frameCount >= 4, `${id} has real motion poses`);
    assert.ok(clip.durations.reduce((a, b) => a + b, 0) >= 700);
  }
  assert.match(sourceFrames.none.actions.walk.sourcePngSha256, /^[a-f\d]{64}$/, '整身重绘步态使用已逐帧核验的APNG');
});

test('全部图集解码后逐帧RGBA等于设计源GIF/APNG，尾格透明且时长完整', () => {
  for (const [theme, spec] of Object.entries(manifest.themes)) {
    for (const [id, clip] of [...Object.entries(spec.actions), ...['idleAlternate','idleTransition','workingTransition','sleepTransition'].filter(key=>spec[key]).map(key=>[key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),spec[key]])]) {
      assert.match(clip.file, new RegExp(`^${theme}/${id}\\.png$`));
      assert.equal(clip.cellSize, 320); assert.equal(clip.frameCount, clip.durations.length);
      assert.ok(Number.isInteger(clip.columns) && clip.columns >= 1 && clip.columns <= 16);
      assert.ok(clip.durations.every(ms => Number.isInteger(ms) && ms >= 10 && ms <= 60000));
      assert.ok(clip.durations.reduce((a, b) => a + b, 0) <= 60000);
      const peer={'idle-alternate':'idleAlternate','idle-transition':'idleTransition','working-transition':'workingTransition','sleep-transition':'sleepTransition'}[id];
      const source = peer ? sourceFrames[theme][peer] : sourceFrames[theme].actions[id];
      assert.equal(clip.startsAtIdle,source.frames[0]===sourceFrames[theme].actions.idle.frames[0]);
      assert.equal(clip.startsAtWorking,id!=='idle'&&source.frames[0]===sourceFrames[theme].actions.working.frames[0]);
      if(id.endsWith('-transition')){
        assert.ok(clip.frameCount>=3&&clip.frameCount<=16&&clip.durations.reduce((a,b)=>a+b,0)<=1500);
        assert.equal(source.frames[0],sourceFrames[theme].actions.idle.frames[0]);
        assert.equal(source.frames.at(-1),id==='idle-transition'?sourceFrames[theme].idleAlternate.frames[0]:id==='sleep-transition'?sourceFrames[theme].actions.sleep.frames[0]:sourceFrames[theme].actions.working.frames[0]);
        assert.ok(new Set(source.frames).size>=3,'完整中间动作不能由重复端点冒充');
      }
      if (id === 'idle-alternate') assert.equal(clip.durations.reduce((a,b)=>a+b,0),spec.actions.idle.durations.reduce((a,b)=>a+b,0));
      assert.deepEqual(clip.durations, source.durations);
      const bytes = fs.readFileSync(path.join(root, clip.file)); assert.equal(hash(bytes), clip.sha256);
      const image = png(bytes, true), rows = Math.ceil(clip.frameCount / clip.columns);
      assert.equal(image.width, clip.columns * 320); assert.equal(image.height, rows * 320);
      for (let index = 0; index < rows * clip.columns; index++) {
        const frame = Buffer.alloc(320 * 320 * 4), x = index % clip.columns * 320, y = Math.floor(index / clip.columns) * 320;
        for (let row = 0; row < 320; row++) image.data.copy(frame, row * 1280, ((y + row) * image.width + x) * 4, ((y + row) * image.width + x + 320) * 4);
        if (index < clip.frameCount) {
          assert.equal(hash(frame), source.frames[index], `${theme}/${id}/${index}`);
          for (const pixel of [0, 319, 319 * 320, 320 * 320 - 1]) assert.equal(frame[pixel * 4 + 3], 0);
          for(let e=0;e<320;e++)for(const pixel of [e,e+319*320,e*320,e*320+319])assert.ok(frame[pixel*4+3]<=128,`${theme}/${id}/${index} 实心耳蹄不能裁到画布边缘`);
          assert.ok(frame.some((value, byte) => byte % 4 === 3 && value > 0));
        } else assert.ok(frame.every(value => value === 0));
      }
    }
  }
});

test('节日fallback使用对应1254原图，不使用旧拼装素材', () => {
  for (const theme of ['halloween', 'christmas', 'spring-festival']) {
    const file = manifest.themes[theme].staticFile;
    assert.equal(file, `${theme}/static.png`);
    const bytes = fs.readFileSync(path.join(root, file));
    assert.deepEqual(png(bytes), { width: 1254, height: 1254 });
    assert.equal(hash(bytes), sourceFrames[theme].staticSha256);
  }
});


test('日常万圣春节安静待机与日常/春节B只改变双眼，身体和服饰逐像素固定', () => {
  const regions = {
    none: [[93,83,144,130],[165,83,216,130]],
    halloween: [[104,113,141,148],[164,119,201,155]],
    'spring-festival': [[104,96,146,138],[175,96,217,138]]
  };
  for (const [theme, boxes] of Object.entries(regions)) {
    const spec=manifest.themes[theme];
    const poses=[['primary',spec.actions.idle],...(spec.idleAlternate ? [['alternate',spec.idleAlternate]] : [])];
    const padding=theme==='halloween'?4:0;
    for(const [pose,clip] of poses) {
      assert.ok(clip,`${theme}/${pose} exists`);assert.equal(clip.frameCount,3);
      assert.deepEqual(clip.durations, [2600,120,500]);
      const image = png(fs.readFileSync(path.join(root, clip.file)), true);
      let changed = 0;
      for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) {
        const base = (y * image.width + x) * 4;
        const closed = (y * image.width + x + 320) * 4;
        const last = (y * image.width + x + 640) * 4;
        const openPixel = image.data.subarray(base, base+4);
        assert.deepEqual(image.data.subarray(last,last+4),openPixel,`${theme}/${pose} loop ${x}/${y}`);
        if (!boxes.some(([l,t,r,b]) => x >= l-padding && x < r+padding && y >= t-padding && y < b+padding)) {
          assert.deepEqual(image.data.subarray(closed,closed+4),openPixel,`${theme}/${pose} body ${x}/${y}`);
        } else if (!image.data.subarray(closed,closed+4).equals(openPixel)) changed++;
      }
      assert.ok(changed > 0, `${theme}/${pose} actually blinks`);
    }
  }
});

test('日常/春节A/B闭眼均清除上下虹膜边缘，不残留双眼线', () => {
  const remnants={
    none:[[108,118,128,124],[180,118,200,124],[102,95,107,106],[174,95,179,106]],
    // Leave the intended closed-lid line at y117..123; old round iris above/below must disappear.
    'spring-festival':[[109,101,142,116],[180,101,213,116],[109,124,142,133],[180,124,213,133]]
  };
  for(const [theme,rectangles] of Object.entries(remnants)) {
    const spec=manifest.themes[theme];
    for(const [pose,clip] of [['primary',spec.actions.idle],...(spec.idleAlternate?[['alternate',spec.idleAlternate]]:[])]) {
      assert.ok(clip,`${theme}/${pose} exists`);
      const image=png(fs.readFileSync(path.join(root,clip.file)),true);
      for(const [left,top,right,bottom] of rectangles) {
        let open=0,closed=0;
        for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)for(const frame of [0,1]) {
          const at=(y*image.width+x+frame*320)*4;
          const dark=image.data[at]<90&&image.data[at+1]<80&&image.data[at+2]<80&&image.data[at+3]>128;
          if(dark){if(frame)closed++;else open++;}
        }
        assert.ok(open>0,`${theme}/${pose} 原睁眼虹膜存在 ${left}/${top}`);
        assert.equal(closed,0,`${theme}/${pose} 闭眼后旧虹膜必须全部被替换 ${left}/${top}`);
      }
    }
    if(spec.idleAlternate)assert.notEqual(sourceFrames[theme].actions.idle.frames[0],sourceFrames[theme].idleAlternate.frames[0],`${theme} A/B有真实不同站姿`);
  }
});


test('日常走路头眼自然配合且手脚确实交替，避免再次锁死头部', () => {
  const clip=manifest.themes.none.actions.walk;
  const image=png(fs.readFileSync(path.join(root,clip.file)),true);
  function region(index,x,y,width,height) {
    const output=Buffer.alloc(width*height*4);
    const cellX=index%clip.columns*320,cellY=Math.floor(index/clip.columns)*320;
    for(let row=0;row<height;row++)image.data.copy(output,row*width*4,
      ((cellY+y+row)*image.width+cellX+x)*4,((cellY+y+row)*image.width+cellX+x+width)*4);
    return hash(output);
  }
  const heads=new Set(),steps=new Set();
  for(let index=0;index<clip.frameCount;index++){
    heads.add(region(index,80,25,160,120));
    steps.add(region(index,50,170,220,140));
  }
  assert.ok(heads.size>=2,'整段不能复用同一张固定头');
  assert.ok(steps.size>=4,'有多张真实步态而非仅静止站姿');
});


test('送糖/礼物道具使用独立透明RGBA原画，边缘透明且内容非空', () => {
  for (const kind of ['candy', 'gift']) {
    const image = png(fs.readFileSync(path.join(root, 'props', `${kind}.png`)), true);
    assert.ok(image.width >= 24 && image.height >= 24);
    assert.ok(image.data.some((value, byte) => byte % 4 === 3 && value > 0));
    for (let x=0;x<image.width;x++) for (const y of [0,image.height-1]) assert.equal(image.data[(y*image.width+x)*4+3],0);
    for (let y=0;y<image.height;y++) for (const x of [0,image.width-1]) assert.equal(image.data[(y*image.width+x)*4+3],0);
  }
});

test('圣诞恢复v17专属原动作时序，保留真表演且不混入白羊新图',()=>{
 const theme=manifest.themes.christmas,C=sourceFrames.christmas;
 assert.equal(theme.sleepTransition,undefined);assert.equal(C.actions.idle.standingCorrection,undefined);
 for(const [id,clip]of Object.entries(theme.actions)){
  const source=C.actions[id];assert.equal(source.motionSource,'v17-original-performance-disconnected-ground-gift-only');
  assert.equal(source.originalFrames.length,clip.frameCount);assert.equal(source.removedGroundGiftPixels.length,clip.frameCount);
  for(let i=0;i<clip.frameCount;i++)if(source.removedGroundGiftPixels[i]===0&&!source.redrawnIdleAnchor?.[i]&&!source.workingEyePatches?.some(p=>p.clipFrame===i))assert.equal(source.frames[i],source.originalFrames[i],id+'/'+i+' retains exact source RGBA');
 }
 assert.equal(theme.actions.sleep.frameCount,81);assert.equal(theme.actions.sleep.durations.reduce((a,b)=>a+b,0),8100);
 assert.ok(theme.actions.walk.frameCount>=4);assert.ok(theme.actions.greet.frameCount>=4);assert.ok(theme.actions.working.frameCount>=4);
 assert.equal(C.workingTransition.frames[0],C.actions.idle.frames[0]);assert.equal(C.workingTransition.frames.at(-1),C.actions.working.frames[0]);
 assert.equal(theme.actions.complete.uprightRegions.length,theme.actions.complete.frameCount);assert.ok(theme.actions.complete.uprightRegions.some(Boolean));
});

test('春节步态不再首末重复卡住，万圣idle保留PNG真实半透明毛边',()=>{
 const walk=manifest.themes['spring-festival'].actions.walk;assert.equal(walk.frameCount,4);assert.equal(walk.durations.reduce((a,b)=>a+b,0),960);
 const s=sourceFrames['spring-festival'].actions.walk;assert.notEqual(s.frames[0],s.frames.at(-1));
 const clip=manifest.themes.halloween.actions.idle,image=png(fs.readFileSync(path.join(root,clip.file)),true);
 const alpha=new Set();let partial=0;for(let y=0;y<320;y++)for(let x=0;x<320;x++){const a=image.data[(y*image.width+x)*4+3];if(a>0&&a<255){alpha.add(a);partial++;}}
 assert.ok(alpha.size>32,'不能退回GIF二值透明硬边');assert.ok(partial>100,'原画细毛/软边仍存在');
});


test('圣诞新正常待机只替换原待机锚点，闭眼外保持新原画',()=>{
 const C=sourceFrames.christmas;if(!C.actions.idle.idleRedraw)return;
 const clip=manifest.themes.christmas.actions.idle;assert.deepEqual(clip.durations,[2600,120,500]);
 if(C.actions.idle.idleRedraw.mouthPatch){const mouth=C.actions.idle.idleRedraw.mouthPatch;assert.equal(mouth.outsideROIChangedRGBAPixels,0);assert.equal(mouth.closedOutsideROIChangedRGBAPixels,0);assert.equal(mouth.noseChangedRGBAPixels,0);assert.deepEqual(mouth.ROI,[540,556,684,614]);}
 assert.equal(C.actions.idle.idleRedraw.registration.method,'uniform scale and position only');
 if(C.actions.idle.idleRedraw.handPatch){assert.equal(C.actions.idle.idleRedraw.handPatch.outsideROIChangedRGBAPixels,0);assert.deepEqual(C.actions.idle.idleRedraw.handPatch.ROI,[325,850,500,1035]);}
 assert.ok(C.actions.idle.redrawnIdleAnchor.every(Boolean));
 const image=png(fs.readFileSync(path.join(root,clip.file)),true);let changed=0;
 const redraw=C.actions.idle.idleRedraw,registration=redraw.registration;assert.equal(redraw.eyeComposite.outsideEyeChangedRGBAPixels,0);
 const eyeBoxes=redraw.eyeComposite.eyeRegions.map(([l,t,r,b])=>[l*registration.scale+registration.position[0]-3,t*registration.scale+registration.position[1]-3,r*registration.scale+registration.position[0]+3,b*registration.scale+registration.position[1]+3]);
 for(let y=0;y<320;y++)for(let x=0;x<320;x++){
  const base=(y*image.width+x)*4,closed=(y*image.width+x+320)*4,last=(y*image.width+x+640)*4;
  assert.deepEqual(image.data.subarray(base,base+4),image.data.subarray(last,last+4));
  const inEye=eyeBoxes.some(([l,t,r,b])=>x>=l&&x<r&&y>=t&&y<b);
  if(!image.data.subarray(base,base+4).equals(image.data.subarray(closed,closed+4))){assert.ok(inEye,`eye edit leaked to body ${x}/${y}`);changed++;}
 }
 assert.ok(changed>0);
});


test('圣诞working双眼开合一致，右眼局部修复不改变书手身体，工作桥端点一致',()=>{
 const clip=manifest.themes.christmas.actions.working,source=sourceFrames.christmas.actions.working;
 assert.deepEqual(source.workingEyePatches.map(p=>p.clipFrame),[1,2]);assert.deepEqual(clip.durations,[720,520,420,650,120,650,520]);
 const image=png(fs.readFileSync(path.join(root,clip.file)),true);
 function frame(index){const result=Buffer.alloc(320*320*4),x=index%clip.columns*320,y=Math.floor(index/clip.columns)*320;for(let row=0;row<320;row++)image.data.copy(result,row*1280,((y+row)*image.width+x)*4,((y+row)*image.width+x+320)*4);return result;}
 function dark(pixels,l,t,r,b){let count=0;for(let y=t;y<b;y++)for(let x=l;x<r;x++){const n=(y*320+x)*4;if(pixels[n]<90&&pixels[n+1]<85&&pixels[n+2]<80&&pixels[n+3]>128)count++;}return count;}
 for(const patch of source.workingEyePatches){const pixels=frame(patch.clipFrame);assert.equal(patch.sourceRightEyeFrame,0);assert.equal(patch.outsideEyeChangedRGBAPixels,0);const[l,t,r,b]=patch.roi;for(let y=t;y<b;y++)pixels.fill(0,(y*320+l)*4,(y*320+r)*4);assert.equal(hash(pixels),patch.originalOutsideEyeRGBA,'眼区外书/手/身体原RGBA不变');const f=frame(patch.clipFrame),left=dark(f,...patch.leftEyeROI),right=dark(f,...patch.rightEyeROI);assert.ok(right/left>.85&&right/left<1.15,`frame${patch.clipFrame}双眼开合比例 ${right}/${left}`);}
 const blink=frame(4);assert.ok(dark(blink,99,162,129,179)<150);assert.ok(dark(blink,164,164,194,181)<150,'原120ms同步双眼眨眼保留');
 assert.equal(sourceFrames.christmas.workingTransition.frames.at(-1),source.frames[0]);
});
