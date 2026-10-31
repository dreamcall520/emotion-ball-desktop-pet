const test = require('node:test');
const assert = require('node:assert/strict');
const Player = require('../lib/codex-pet-player');

const descriptor = { id: 'imported-hash', name: '测试宠物', version: 1, rows: 9, imageURL: 'file:///tmp/test-sprite.webp' };
function harness() {
  let now = 0, sequence = 0;
  const requests = new Map(), images = [], draws = [], listeners = new Map(), changes = new Set();
  const media = { matches: false,
    addEventListener(_name, fn) { changes.add(fn); }, removeEventListener(_name, fn) { changes.delete(fn); } };
  const view = {
    requestAnimationFrame(fn) { const id = ++sequence; requests.set(id, fn); return id; },
    cancelAnimationFrame(id) { requests.delete(id); }, matchMedia: () => media,
    Image: class { constructor() { images.push(this); } }
  };
  const document = { defaultView: view, hidden: false,
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    createElement() { return { width: 0, height: 0, style: {}, dataset: {}, attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      getContext: () => ({ clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args) { draws.push(args); } }),
      remove() { container.children = container.children.filter(child => child !== this); } }; }
  };
  const container = { ownerDocument: document, children: [], appendChild(child) { this.children.push(child); } };
  return { container, document, media, requests, listeners, changes, images, draws,
    load(rows = 9, scale = 1) { const image = images.at(-1); image.naturalWidth = 1536 * scale; image.naturalHeight = rows * 208 * scale; image.onload?.(); },
    step(ms) { now += ms; const callbacks = [...requests.values()]; requests.clear(); callbacks.forEach(fn => fn(now)); },
    hidden(value) { document.hidden = value; listeners.get('visibilitychange')?.(); },
    reduce(value) { media.matches = value; changes.forEach(fn => fn()); }
  };
}

test('nine original actions crop their real rows, skip unused columns, and retain per-frame timing', () => {
  const h = harness(), player = Player.create(h.container, { descriptor, size: 120, opacity: 0.58 });
  assert.equal(player.element.dataset.codexReady, 'loading');
  assert.equal(h.requests.size, 0);
  h.load();
  assert.equal(player.element.style.height, '120px');
  assert.equal(parseFloat(player.element.style.width), 120 * 192 / 208);
  assert.equal(player.element.style.opacity, '0.58');
  assert.equal(player.element.attributes['aria-label'], '测试宠物');
  for (const action of Player.ACTIONS) {
    player.setAction(action.id); h.step(0);
    assert.equal(player.element.dataset.codexAction, action.id);
    for (let frame = 0; frame < action.frameDurations.length; frame++) {
      const crop = h.draws.at(-1).slice(1);
      assert.deepEqual(crop, [frame * 192, action.row * 208, 192, 208, 0, 0, 192, 208]);
      h.step(action.frameDurations[frame] - 1);
      assert.equal(Number(player.element.dataset.codexFrame), frame);
      h.step(1);
      assert.equal(Number(player.element.dataset.codexFrame), (frame + 1) % action.frameDurations.length);
    }
  }
  player.destroy(); assert.equal(h.requests.size, 0);
});

test('HD atlases retain native backing pixels through all display sizes and Retina changes', () => {
  for (const version of [1, 2]) for (const scale of [1, 2, 3]) {
    const h = harness(), rows = version === 1 ? 9 : 11;
    h.document.defaultView.devicePixelRatio = 2;
    const player = Player.create(h.container, { descriptor: { ...descriptor, version, rows }, size: 260 });
    h.load(rows, scale);
    assert.equal(player.element.dataset.codexReady, 'ready');
    assert.deepEqual([player.element.width, player.element.height], [192 * scale, 208 * scale]);
    for (const size of [60, 80, 108, 120, 180, 260, 300]) {
      assert.equal(player.setSize(size), true);
      assert.equal(player.element.style.height, `${size}px`);
      assert.equal(parseFloat(player.element.style.width), size * 192 / 208);
      for (const action of Player.ACTIONS) {
        player.setAction(action.id); h.step(0);
        assert.deepEqual(h.draws.at(-1).slice(1), [0, action.row * 208 * scale,
          192 * scale, 208 * scale, 0, 0, 192 * scale, 208 * scale]);
      }
    }
    h.document.defaultView.devicePixelRatio = 3;
    player.setSize(260);
    assert.deepEqual([player.element.width, player.element.height], [192 * scale, 208 * scale], 'changing displays must not discard native source pixels');
    player.destroy();
  }
});

test('HD load rejects inconsistent or unsupported grids and resets backing dimensions for old pets', () => {
  const h = harness(), failures = [];
  const player = Player.create(h.container, { descriptor, onError: error => failures.push(error) });
  for (const [width, height] of [[2304, 2808], [6144, 7488], [4608, 1872], [1536, 5616]]) {
    player.setPet({ ...descriptor, id: `${width}-${height}` });
    const image = h.images.at(-1); image.naturalWidth = width; image.naturalHeight = height; image.onload();
    assert.equal(player.element.dataset.codexReady, 'error');
  }
  assert.equal(failures.length, 4);
  player.setPet({ ...descriptor, id: 'hd' }); h.load(9, 3);
  assert.equal(player.element.height, 624);
  player.setPet({ ...descriptor, id: 'legacy' }); h.load();
  assert.equal(player.element.height, 208); assert.equal(player.element.dataset.codexReady, 'ready');
  player.destroy();
});

test('Codex idle takes 6.6 seconds while the wave retains its 700ms cycle', () => {
  const h = harness(), player = Player.create(h.container, { descriptor });
  h.load(); h.step(0);
  // At the old 1.1s loop boundary Codex must still hold the first idle pose.
  h.step(1100); assert.equal(player.element.dataset.codexFrame, '0');
  h.step(579); assert.equal(player.element.dataset.codexFrame, '0');
  h.step(1); assert.equal(player.element.dataset.codexFrame, '1');
  for (const [ms, frame] of [[660,2],[660,3],[840,4],[840,5],[1919,5],[1,0]]) {
    h.step(ms); assert.equal(Number(player.element.dataset.codexFrame), frame);
  }
  player.setAction('wave'); h.step(0);
  h.step(699); assert.equal(player.element.dataset.codexFrame, '3');
  h.step(1); assert.equal(player.element.dataset.codexFrame, '0');
  player.destroy();
});

test('pause, hidden, reduced motion and destroy cancel scheduling without restarting paused frames', () => {
  const h = harness(), player = Player.create(h.container, { descriptor });
  h.load(); h.step(0); h.step(1680);
  assert.equal(player.element.dataset.codexFrame, '1');
  player.setAction('idle');
  assert.equal(player.element.dataset.codexFrame, '1', 'repeated state updates do not restart the animation');
  player.pause(); assert.equal(h.requests.size, 0);
  h.step(50000); assert.equal(player.element.dataset.codexFrame, '1');
  player.pause(false); assert.equal(h.requests.size, 1);
  h.step(0); h.step(660); assert.equal(player.element.dataset.codexFrame, '2');
  h.hidden(true); assert.equal(h.requests.size, 0);
  h.hidden(false); assert.equal(h.requests.size, 1);
  h.reduce(true); assert.equal(h.requests.size, 0); assert.equal(player.element.dataset.codexFrame, '0');
  player.setAction('wave'); assert.equal(h.requests.size, 0);
  h.reduce(false); assert.equal(h.requests.size, 1);
  const lateLoad = h.images.at(-1).onload, count = h.draws.length;
  player.destroy(); lateLoad(); h.step(50000);
  assert.equal(h.draws.length, count); assert.equal(h.requests.size, 0);
  assert.equal(h.listeners.size, 0); assert.equal(h.changes.size, 0); assert.equal(h.container.children.length, 0);
});

test('descriptor and dimensions reject remote images, inconsistent versions and wrong grids; v2 reload works', () => {
  for (const change of [{ imageURL: 'https://example.com/sprite.webp' }, { imageURL: 'file://server/sprite.webp' },
    { version: 2, rows: 9 }, { rows: 100 }]) {
    assert.equal(Player.validDescriptor({ ...descriptor, ...change }), false);
    assert.throws(() => Player.create(harness().container, { descriptor: { ...descriptor, ...change } }), TypeError);
  }
  assert.equal(Player.validDescriptor({ ...descriptor, imageURL: 'data:image/png;base64,AA==' }), true);
  const h = harness(), failures = [];
  const player = Player.create(h.container, { descriptor, onError: error => failures.push(error) });
  h.load(11); assert.equal(failures.length, 1); assert.equal(h.requests.size, 0);
  assert.equal(player.element.dataset.codexReady, 'error');
  const oldLoad = h.images.at(-1).onload;
  player.setPet({ ...descriptor, id: 'second', version: 2, rows: 11 }); oldLoad();
  assert.equal(player.element.dataset.codexReady, 'loading', 'old image completion cannot replace the new sprite');
  h.load(11); assert.equal(player.element.dataset.codexReady, 'ready');
  assert.equal(player.setAction(8), true); assert.equal(player.element.dataset.codexAction, 'checking');
  assert.equal(player.setAction('unknown'), false); assert.equal(player.setSize(-1), false);
  assert.equal(player.setOpacity(2), false); player.destroy();
});

test('mapped actions crop contiguous cells across rows with their native per-frame durations', () => {
  const h = harness();
  const frameMap = { idle: { start: 0, count: 8, durations: Array(8).fill(150) },
    'run-right': { start: 8, count: 16, durations: Array(16).fill(75) },
    'run-left': { start: 8, count: 16, durations: Array(16).fill(90), flipX: true },
    wave: { start: 24, count: 32, durations: Array(32).fill(60) },
    sleep: { start: 56, count: 16, durations: Array(16).fill(100) },
    wakeup: { start: 72, count: 8, durations: Array(8).fill(75), loop: false } };
  const mapped = { ...descriptor, version: 2, rows: 11, frameMap };
  const player = Player.create(h.container, { descriptor: mapped, size: 260 }); h.load(11, 3);
  assert.equal(Player.getActions(mapped).find(a => a.id === 'idle').durationMs, 1200);
  for (const [id, entry] of Object.entries(frameMap)) {
    player.setAction(id); h.step(0);
    for (let frame = 0; frame < entry.count; frame++) {
      const cell = entry.start + frame;
      assert.deepEqual(h.draws.at(-1).slice(1), [cell % 8 * 576, Math.floor(cell / 8) * 624, 576, 624, 0, 0, 576, 624]);
      assert.equal(Number(player.element.dataset.codexFrame), frame);
      h.step(entry.durations[frame]);
    }
  }
  player.destroy();
});

test('non-looping mapped actions finish once, hold their last frame and allow a later action', () => {
  const h = harness(), finished = [];
  const mapped = { ...descriptor, version: 2, rows: 11, frameMap: {
    wakeup: { start: 72, count: 3, durations: [50, 80, 120], loop: false } } };
  const player = Player.create(h.container, { descriptor: mapped, onActionComplete: id => finished.push(id) });
  h.load(11); player.setAction('wakeup'); h.step(0); h.step(250);
  assert.equal(player.element.dataset.codexFrame, '2'); assert.deepEqual(finished, ['wakeup']);
  assert.equal(h.requests.size, 0); h.step(1000); player.pause(); player.pause(false);
  assert.deepEqual(finished, ['wakeup']); assert.equal(h.requests.size, 0);
  player.setAction('idle'); assert.equal(player.element.dataset.codexFrame, '0'); assert.equal(h.requests.size, 1);
  player.destroy();
});

test('frame maps reject unknown fields, invalid timing and ranges beyond the actual atlas', () => {
  const valid = { sleep: { start: 56, count: 8, durations: Array(8).fill(100) } };
  assert.equal(Player.validDescriptor({ ...descriptor, frameMap: valid }), true);
  for (const map of [null, [], { unknown: valid.sleep }, { sleep: { ...valid.sleep, start: -1 } },
    { sleep: { ...valid.sleep, start: 68 } }, { sleep: { ...valid.sleep, count: 0 } },
    { sleep: { ...valid.sleep, durations: [100] } }, { sleep: { ...valid.sleep, durations: Array(8).fill(15) } },
    { sleep: { ...valid.sleep, durations: Array(8).fill(10001) } }, { sleep: { ...valid.sleep, loop: 'false' } }, { sleep: { ...valid.sleep, flipX: 1 } },
    { sleep: { ...valid.sleep, url: 'https://invalid/' } }, { sleep: { ...valid.sleep, durations: Array(8).fill(10000) } }]) {
    assert.equal(Player.validDescriptor({ ...descriptor, frameMap: map }), false, JSON.stringify(map));
  }
  const normalized = Player.normalizeFrameMap(valid, 9); valid.sleep.durations[0] = 999;
  assert.equal(normalized.sleep.durations[0], 100); assert.equal(Object.isFrozen(normalized.sleep.durations), true);
});

test('v3 loads sheets lazily, retains at most two and ignores stale decoded resources',()=>{
 const h=harness(),map=Object.fromEntries([...Player.ACTIONS.map(a=>a.id),'sleep','wakeup'].map(id=>[id,{sheet:'base',start:0,count:1,durations:[100],loop:true}]));
 for(const [id,sheet]of [['wave','motion'],['tail','extra']])map[id]={sheet,start:0,count:id==='wave'?33:8,durations:Array(id==='wave'?33:8).fill(100),loop:false};
 const sheets=Object.fromEntries(['base','motion','extra'].map(id=>[id,{rows:id==='motion'?5:1,imageURL:`file:///tmp/${id}.webp`}]));
 const p=Player.create(h.container,{descriptor:{...descriptor,version:3,rows:1,sheets,frameMap:map}});assert.equal(h.images.length,1);h.load(1,3);
 p.setAction('wave');const late=h.images.at(-1).onload;assert.equal(h.images.length,2);
 p.setAction('tail');assert.equal(h.images.length,3);assert.equal(h.images[0].src,'');
 h.load(1,3);assert.equal(p.element.dataset.codexAction,'tail');assert.equal(p.element.dataset.codexCachedSheets,'2');
 h.images[1].naturalWidth=4608;h.images[1].naturalHeight=3120;late();assert.equal(p.element.dataset.codexAction,'tail');
 p.setAction('idle');h.load(1,3);assert.equal(p.element.dataset.codexAction,'idle');assert.equal(p.element.dataset.codexCachedSheets,'2');p.destroy();assert.equal(h.requests.size,0);
});

test('generic uploaded interaction choices exclude idle aliases and duplicated resource ranges',()=>{
 assert.deepEqual(Player.getInteractionActions(descriptor),['wave','jump','fail','checking']);
 const map=Object.fromEntries([...Player.ACTIONS.map(a=>a.id),'sleep','wakeup'].map(id=>[id,{sheet:'base',start:0,count:1,durations:[100],loop:true}]));
 map.wave={sheet:'motion',start:0,count:3,durations:[100,100,100],loop:false};map.jump={...map.wave};map.groom={sheet:'motion',start:3,count:2,durations:[100,100],loop:false};
 assert.deepEqual(Player.getInteractionActions({...descriptor,version:3,rows:1,sheets:{base:{rows:1},motion:{rows:1}},frameMap:map}),['wave','groom']);
});
test('a generic one-shot request completes legacy row animations once without changing default looping',()=>{
 const h=harness(),done=[],p=Player.create(h.container,{descriptor,onActionComplete:id=>done.push(id)});h.load();p.setAction('wave',{once:true});h.step(0);h.step(2000);assert.deepEqual(done,['wave']);assert.equal(h.requests.size,0);p.setAction('idle');h.step(0);h.step(12000);assert.equal(h.requests.size,1);assert.deepEqual(done,['wave']);p.destroy();
});

function variedDescriptor(){return {...descriptor,frameMap:{sleep:{start:40,count:8,durations:Array(8).fill(400),variation:{initialDelayMs:[1000,3000],intervalMs:[45000,75000],clips:[{start:48,count:8,durations:Array(8).fill(375)},{start:56,count:8,durations:Array(8).fill(375)},{start:64,count:8,durations:Array(8).fill(375)}]}}}};}
test('variation is a bounded generic frame-map field and rejects malformed timing or unsafe clip ranges',()=>{
 const d=variedDescriptor();assert.equal(Player.validDescriptor(d),true);
 for(const change of [v=>v.initialDelayMs=[-1,1000],v=>v.initialDelayMs=[2000,1000],v=>v.initialDelayMs=[0,60001],v=>v.intervalMs=[0,5000],v=>v.intervalMs=[1000,3600001],v=>v.intervalMs=['1000',5000],v=>v.clips=[],v=>v.clips=Array(9).fill(v.clips[0]),v=>v.clips[0].start=70,v=>v.clips[0].durations=[375],v=>v.clips[0].url='https://bad',v=>v.extra=true]){const bad=structuredClone(d);change(bad.frameMap.sleep.variation);assert.equal(Player.validDescriptor(bad),false)}
 const normalized=Player.normalizeFrameMap(d.frameMap,9);d.frameMap.sleep.variation.clips[0].durations[0]=500;assert.equal(normalized.sleep.variation.clips[0].durations[0],375);assert(Object.isFrozen(normalized.sleep.variation.clips));
});
test('variation draws an initial random clip once, waits from its end, and avoids consecutive repeats including re-entry',()=>{
 const h=harness(),p=Player.create(h.container,{descriptor:variedDescriptor(),random:()=>0});h.load();p.setAction('sleep');h.step(0);h.step(999);assert.equal(p.element.dataset.codexVariant,'base');h.step(1);assert.equal(p.element.dataset.codexVariant,'0');assert.equal(h.draws.at(-1)[1],0);assert.equal(h.draws.at(-1)[2],6*208);h.step(3000);assert.equal(p.element.dataset.codexVariant,'base');h.step(44999);assert.equal(p.element.dataset.codexVariant,'base');h.step(1);assert.equal(p.element.dataset.codexVariant,'1');p.setAction('idle');p.setAction('sleep');h.step(0);h.step(1000);assert.equal(p.element.dataset.codexVariant,'0');p.destroy();assert.equal(h.requests.size,0);
});
test('same-action synchronization does not reset variation, while pause/hide/reduced motion clear the clip and restart first delay',()=>{
 for(const mode of ['pause','hidden','reduce']){const h=harness(),p=Player.create(h.container,{descriptor:variedDescriptor(),random:()=>0});h.load();p.setAction('sleep');h.step(0);h.step(500);p.setAction('sleep');h.step(500);assert.equal(p.element.dataset.codexVariant,'0');
 if(mode==='pause')p.pause(true);if(mode==='hidden')h.hidden(true);if(mode==='reduce')h.reduce(true);assert.equal(p.element.dataset.codexVariant,'base');assert.equal(h.requests.size,0);
 if(mode==='pause')p.pause(false);if(mode==='hidden')h.hidden(false);if(mode==='reduce')h.reduce(false);h.step(0);h.step(999);assert.equal(p.element.dataset.codexVariant,'base');h.step(1);assert.equal(p.element.dataset.codexVariant,'1');p.destroy();}
});

test('preview keeps unique clips and both walking directions, excluding timing-only aliases',()=>{
 const map=Object.fromEntries([...Player.ACTIONS.map(a=>a.id),'sleep','wakeup'].map(id=>[id,{sheet:'base',start:0,count:2,durations:[100,100],loop:true}]));
 map.fail={...map.idle,durations:[30,30],loop:false};
 map.wave={sheet:'motion',start:0,count:3,durations:[100,100,100],loop:false};
 map.tail={...map.wave,start:3,count:2,durations:[100,100]};map.groom={...map.tail,start:5};
 map['run-right']={sheet:'walk',start:0,count:3,durations:[100,100,100],loop:true};map['run-left']={...map['run-right'],flipX:true};map.running={...map['run-right']};
 map.sleep={...map.idle,variation:{initialDelayMs:[1000,2000],intervalMs:[1000,2000],clips:[{start:3,count:2,durations:[100,100]}]}};
 const d={...descriptor,version:3,rows:1,sheets:{base:{rows:1},motion:{rows:1},walk:{rows:1}},frameMap:map};
 assert.deepEqual(Player.getPreviewActions(d).map(a=>a.id),['idle','wave','tail','groom','run-right','run-left','sleep']);
 assert.deepEqual(Player.getPreviewActions(d).filter(a=>['tail','groom'].includes(a.id)).map(a=>a.name),['摇尾','舔爪']);
 assert.equal(Player.getActions(d).length,13,'runtime action routing stays available');
});

test('legacy sheets retain all nine distinct preview rows',()=>{
 assert.equal(Player.getPreviewActions(descriptor).length,9);
 assert.deepEqual(new Set(Player.getPreviewActions(descriptor).map(a=>a.id)),new Set(Player.ACTIONS.map(a=>a.id)));
});
