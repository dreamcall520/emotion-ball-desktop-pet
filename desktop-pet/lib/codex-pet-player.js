(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CodexPetPlayer = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function isXiaobaiPet(value) {
    return value?.characterId === 'xiaobai';
  }

  const FRAME_WIDTH = 192, FRAME_HEIGHT = 208, COLUMNS = 8;
  // Codex stretches idle frames 6x; other actions keep their base timing.
  // Unused columns are deliberately skipped.
  const durations = [
    [1680,660,660,840,840,1920], [120,120,120,120,120,120,120,220],
    [120,120,120,120,120,120,120,220], [140,140,140,280],
    [140,140,140,140,280], [140,140,140,140,140,140,140,240],
    [150,150,150,150,150,260], [120,120,120,120,120,220],
    [150,150,150,150,150,280]
  ];
  const ids = ['idle','run-right','run-left','wave','jump','fail','waiting','running','checking'];
  const names = ['待机','向右跑','向左跑','挥手','跳跃','失败','等待','处理中','检查'];
  const ACTIONS = Object.freeze(ids.map((id, row) => Object.freeze({ id, row, name: names[row],
    frameDurations: Object.freeze(durations[row]), durationMs: durations[row].reduce((sum, ms) => sum + ms, 0) })));

  function normalizeFrameMap(value, rows, sheets) {
    if (value === undefined) return undefined;
    const invalid = () => { throw new TypeError('Invalid pet frame map'); };
    const record = object => object && Object.prototype.toString.call(object) === '[object Object]';
    if (!record(value) || (!sheets && ![9, 11].includes(rows))) return invalid();
    function normalizeVariation(value, limit) {
      if (!record(value) || Object.keys(value).some(key => !['initialDelayMs','intervalMs','clips'].includes(key))) return invalid();
      const range = (pair, minimum, maximum) => Array.isArray(pair) && pair.length === 2 && pair.every(ms => Number.isInteger(ms) && ms >= minimum && ms <= maximum) && pair[0] <= pair[1];
      if (!range(value.initialDelayMs, 0, 60000) || !range(value.intervalMs, 1000, 3600000) || !Array.isArray(value.clips) || value.clips.length < 1 || value.clips.length > 8) return invalid();
      const seen = new Set();
      const clips = Array.from(value.clips, clip => {
        if (!record(clip) || Object.keys(clip).some(key => !['start','count','durations'].includes(key)) || !Number.isInteger(clip.start) || clip.start < 0 || !Number.isInteger(clip.count) || clip.count < 1 || clip.start + clip.count > limit || !Array.isArray(clip.durations) || clip.durations.length !== clip.count || Array.from(clip.durations).some(ms => !Number.isInteger(ms) || ms < 16 || ms > 10000) || clip.durations.reduce((sum, ms) => sum + ms, 0) > 60000 || seen.has(clip.start + ':' + clip.count)) return invalid();
        seen.add(clip.start + ':' + clip.count);
        return Object.freeze({ start: clip.start, count: clip.count, durations: Object.freeze([...clip.durations]) });
      });
      return Object.freeze({ initialDelayMs: Object.freeze([...value.initialDelayMs]), intervalMs: Object.freeze([...value.intervalMs]), clips: Object.freeze(clips) });
    }
    const allowed = [...ids, 'sleep', 'wakeup', ...(sheets ? ['tail','groom','stretch','bone','spin','happy','sleep-lying','walk-right','walk-left'] : [])], result = {};
    if(sheets && (!record(sheets) || !sheets.base || Object.keys(sheets).length>12 || Object.entries(sheets).some(([id,sheet])=>!/^([a-z][a-z0-9_-]{0,31})$/.test(id)||!record(sheet)||!Number.isInteger(sheet.rows)||sheet.rows<1||sheet.rows>5||(sheet.frameWidth!==undefined&&(!Number.isInteger(sheet.frameWidth)||sheet.frameWidth<192||sheet.frameWidth>320))||(id==='base'&&sheet.frameWidth!==undefined&&sheet.frameWidth!==192)))) return invalid();
    for (const [id, entry] of Object.entries(value)) {
      if (!allowed.includes(id) || !record(entry) ||
          Object.keys(entry).some(key => !['start', 'count', 'durations', 'loop', 'flipX', 'variation', ...(sheets?['sheet']:[])].includes(key)) ||
          !Number.isInteger(entry.start) || entry.start < 0 || !Number.isInteger(entry.count) ||
          entry.count < 1 || entry.start + entry.count > (sheets ? (sheets[entry.sheet]?.rows || 0) : rows) * COLUMNS ||
          !Array.isArray(entry.durations) || entry.durations.length !== entry.count ||
          Array.from(entry.durations).some(ms => !Number.isInteger(ms) || ms < 16 || ms > 10000) ||
          entry.durations.reduce((sum, ms) => sum + ms, 0) > 60000 ||
          (entry.loop !== undefined && typeof entry.loop !== 'boolean') ||
          (entry.flipX !== undefined && typeof entry.flipX !== 'boolean') ||
          (sheets && (typeof entry.sheet!=='string'||!Object.hasOwn(sheets,entry.sheet))) ||
          (['tail','groom','stretch','bone','spin','happy','sleep-lying'].includes(id) && entry.loop!==false)) return invalid();
      if (entry.variation !== undefined && entry.loop === false) return invalid();
      const variation = entry.variation === undefined ? undefined : normalizeVariation(entry.variation, (sheets ? sheets[entry.sheet].rows : rows) * COLUMNS);
      result[id] = Object.freeze({ ...(variation ? { variation } : {}), ...(sheets?{sheet:entry.sheet}:{}), start: entry.start, count: entry.count,
        durations: Object.freeze([...entry.durations]), loop: entry.loop !== false, flipX: entry.flipX === true });
    }
    if(sheets && (![...ids,'sleep','wakeup'].every(id=>result[id]) || result.idle.sheet!=='base')) return invalid();
    return Object.freeze(result);
  }

  function getActions(descriptor) {
    const map = normalizeFrameMap(descriptor.frameMap, descriptor.rows, descriptor.version===3?descriptor.sheets:undefined);
    if (!map) return ACTIONS;
    const base = [...ACTIONS, ...['sleep', 'wakeup','tail','groom','stretch','bone','spin','happy','sleep-lying','walk-right','walk-left'].filter(id => map[id]).map(id =>
      ({ id, row: id === 'sleep' ? 9 : 10, name: ({sleep:'睡觉',wakeup:'醒来',tail:'轻轻摇尾',groom:'舔舔爪',stretch:'伸个懒腰',bone:'玩骨头',spin:'旋转庆祝',happy:'开心庆祝','sleep-lying':'趴着睡','walk-right':'向右走','walk-left':'向左走'})[id] }))];
    return Object.freeze(base.map(action => map[action.id] ? Object.freeze({ ...action,
      ...(map[action.id].sheet?{sheet:map[action.id].sheet}:{}), ...(map[action.id].variation?{variation:map[action.id].variation}:{}), start: map[action.id].start, loop: map[action.id].loop, flipX: map[action.id].flipX,
      frameDurations: map[action.id].durations,
      durationMs: map[action.id].durations.reduce((sum, ms) => sum + ms, 0) }) : action));
  }

  function getPreviewActions(descriptor) {
    const actions = getActions(descriptor);
    const order = ['idle','wave','tail','groom','bone','stretch','jump','spin','happy','walk-right','walk-left','run-right','run-left','running','waiting','checking','fail','sleep','sleep-lying','wakeup'];
    const seen = new Set();
    return Object.freeze(order.flatMap(id => {
      const action = actions.find(item => item.id === id);
      if (!action) return [];
      // Timing and looping alone do not make another visual animation.
      const resource = action.sheet ? descriptor.sheets?.[action.sheet]?.imageURL || action.sheet : descriptor.imageURL || 'single';
      const key = JSON.stringify([resource, action.start ?? action.row * COLUMNS,
        action.frameDurations.length, Boolean(action.flipX),
        action.variation?.clips.map(clip => [clip.start, clip.count]) || []]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [Object.freeze({...action, name: ({tail:'摇尾',groom:'舔爪'})[id] || action.name})];
    }));
  }

  // Existing interaction commands choose real uploaded clips, not unrelated emotion IDs.
  function getInteractionActions(descriptor) {
    const actions = getActions(descriptor);
    const visualKey = item => [item.sheet || 'single', item.start ?? item.row * COLUMNS, item.frameDurations.length, Boolean(item.flipX)].join(':');
    const seen = new Set([visualKey(actions.find(item => item.id === 'idle'))]);
    return Object.freeze(actions.filter(item => {
      if (['idle','sleep','sleep-lying','wakeup','running','waiting',...(!isXiaobaiPet(descriptor)?['run-right','run-left']:[]),...(descriptor.sheets?.spin?.frameWidth>192?['spin']:[])].includes(item.id)) return false;
      const key = visualKey(item); if (seen.has(key)) return false; seen.add(key); return true;
    }).map(item => item.id));
  }

  function validDescriptor(value) {
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 256 ||
        typeof value.name !== 'string' || value.name.length > 200 ||
        !((value.version === 1 && value.rows === 9) || (value.version === 2 && value.rows === 11) || (value.version===3 && value.sheets)) ||
        typeof value.imageURL !== 'string') return false;
    if(value.version===3 && !value.frameMap) return false;
    try { normalizeFrameMap(value.frameMap, value.rows, value.version===3?value.sheets:undefined); } catch (_) { return false; }
    // Only the main process resolves local paths. Never download a sprite URL.
    return /^file:\/\/\//i.test(value.imageURL) || /^data:image\/(?:png|webp);base64,[a-z0-9+/=]+$/i.test(value.imageURL);
  }

  function create(container, options) {
    options = options || {};
    if (!validDescriptor(options.descriptor)) throw new TypeError('Invalid Codex pet descriptor');
    const document = container.ownerDocument;
    const view = document.defaultView;
    const canvas = document.createElement('canvas');
    canvas.className = 'codex-pet-sprite';
    canvas.width = FRAME_WIDTH; canvas.height = FRAME_HEIGHT;
    canvas.setAttribute('role', 'img');
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    canvas.style.maxWidth = '100%'; canvas.style.maxHeight = '100%';
    canvas.style.objectFit = 'contain';
    container.appendChild(canvas);
    const context = canvas.getContext('2d');
    let frameWidth = FRAME_WIDTH, frameHeight = FRAME_HEIGHT;
    const media = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    let image = null, descriptor = null, loaded = false, destroyed = false, paused = false;
    const sheetCache = new Map();
    let imageGeneration = 0;
    let actions = ACTIONS, action = ACTIONS[0], frame = 0, elapsed = 0, previous = null, request = null, completed = false;

    let variationBase = null, variationIndex = null, variationWait = 0, variationDue = null;
    const lastVariations = new Map();
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const draw = maximum => Math.min(maximum - 1, Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * maximum));
    const delay = range => range[0] + draw(range[1] - range[0] + 1);
    function resetVariation() {
      const changed = variationIndex !== null;
      if (variationBase) action = variationBase;
      variationIndex = null; variationWait = 0; variationDue = null;
      if (changed) frame = elapsed = 0;
      return changed;
    }
    function beginVariation() {
      const spec = variationBase.variation, last = lastVariations.get(variationBase.id);
      const available = spec.clips.map((_, index) => index).filter(index => index !== last);
      const choices = available.length ? available : [0];
      variationIndex = choices[draw(choices.length)]; lastVariations.set(variationBase.id, variationIndex);
      const clip = spec.clips[variationIndex];
      action = { ...variationBase, start: clip.start, frameDurations: clip.durations, durationMs: clip.durations.reduce((sum, ms) => sum + ms, 0), loop: false };
      frame = elapsed = 0; paint();
    }
    function stop() {
      if (request !== null) view.cancelAnimationFrame(request);
      request = null; previous = null;
    }
    function paint() {
      if (destroyed || !loaded) return;
      context.clearRect(0, 0, frameWidth, frameHeight);
      const cell = (action.start ?? action.row * COLUMNS) + frame;
      if (action.flipX) { context.save(); context.translate(frameWidth, 0); context.scale(-1, 1); }
      context.drawImage(image, cell % COLUMNS * frameWidth, Math.floor(cell / COLUMNS) * frameHeight,
        frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
      if (action.flipX) context.restore();
      canvas.dataset.codexAction = action.id;
      canvas.dataset.codexFrame = String(frame);canvas.dataset.codexClipStart=String(action.start??action.row*COLUMNS);canvas.dataset.codexDuration=String(action.durationMs);canvas.dataset.codexLoop=String(action.loop!==false);
      canvas.dataset.codexVariant = variationIndex === null ? 'base' : String(variationIndex);
      options.onFrame?.(action.id, frame);
    }
    function canPlay() { return !destroyed && loaded && !paused && !completed && !document.hidden && !media?.matches; }
    function tick(now) {
      request = null;
      if (!canPlay()) { previous = null; return; }
      const delta = previous === null ? 0 : Math.max(0, now - previous);
      elapsed += delta; previous = now;
      if (variationBase && variationIndex === null) {
        if (variationDue === null) variationDue = delay(variationBase.variation.initialDelayMs);
        variationWait += delta;
        if (variationWait >= variationDue) beginVariation();
      }
      // A slow frame advances within one cycle instead of creating a backlog.
      if (action.loop !== false) elapsed %= action.durationMs;
      let changed = false;
      while (elapsed >= action.frameDurations[frame]) {
        elapsed -= action.frameDurations[frame];
        if (action.loop === false && frame === action.frameDurations.length - 1) {
          if (variationIndex !== null) {
            action = variationBase; variationIndex = null; frame = elapsed = variationWait = 0;
            variationDue = delay(variationBase.variation.intervalMs); paint();
            request = view.requestAnimationFrame(tick); return;
          }
          completed = true; paint(); options.onActionComplete?.(action.id); return;
        }
        frame = (frame + 1) % action.frameDurations.length;
        changed = true;
      }
      if (changed) paint();
      request = view.requestAnimationFrame(tick);
    }
    function syncPlayback() {
      stop();
      if ((paused || document.hidden || media?.matches) && resetVariation()) paint();
      if (media?.matches) { frame = elapsed = 0; paint(); }
      if (canPlay()) request = view.requestAnimationFrame(tick);
    }
    function clearSheets() {
      imageGeneration++;
      for(const entry of sheetCache.values()){entry.image.onload=entry.image.onerror=null;entry.image.src='';}
      sheetCache.clear();
    }
    function cachedSheet(key) {
      let entry = sheetCache.get(key);
      if (entry) { sheetCache.delete(key); sheetCache.set(key, entry); return entry; }
      if (!isXiaobaiPet(descriptor)) {
        while (sheetCache.size >= 2) {
          const [oldKey, old] = sheetCache.entries().next().value;
          old.image.onload = old.image.onerror = null;
          old.image.src = '';
          sheetCache.delete(oldKey);
        }
      }
      const sheet = descriptor.sheets[key];
      entry = { image: new view.Image(), ready: false };
      sheetCache.set(key, entry);
      entry.promise = new Promise((resolve, reject) => {
        entry.image.onload = async () => {
          try {
            const scale = entry.image.naturalWidth / ((sheet.frameWidth || FRAME_WIDTH) * COLUMNS);
            if (!Number.isInteger(scale) || scale < 1 || scale > 3 || entry.image.naturalHeight !== FRAME_HEIGHT * sheet.rows * scale) {
              throw new Error('Pet action resource dimensions invalid');
            }
            if (isXiaobaiPet(descriptor) && entry.image.decode) await entry.image.decode();
            entry.ready = true;
            resolve();
            entry.onReady?.();
          } catch (error) { reject(error); entry.onError?.(error); }
        };
        entry.image.onerror = () => {
          const error = new Error('Pet action resource could not be loaded');
          reject(error);
          entry.onError?.(error);
        };
        entry.image.src = sheet.imageURL;
      });
      entry.promise.catch(() => {});
      return entry;
    }
    // Decode local sheets before interaction so switching never waits on a cold image.
    async function preloadSheets() {
      const generation=descriptor;canvas.dataset.codexPreload='loading';
      try{for(const key of Object.keys(descriptor.sheets)){if(destroyed||descriptor!==generation)return;await cachedSheet(key).promise;canvas.dataset.codexCachedSheets=String(sheetCache.size);}if(!destroyed&&descriptor===generation)canvas.dataset.codexPreload='ready';}
      catch(error){if(!destroyed&&descriptor===generation){canvas.dataset.codexPreload='error';options.onError?.(error);}}
    }
    function loadActionSheet() {
      if(descriptor.version!==3)return;
      stop();loaded=false;canvas.dataset.codexReady='loading';
      const key=action.sheet,token=++imageGeneration,entry=cachedSheet(key);image=entry.image;
      const ready=()=>{if(destroyed||token!==imageGeneration)return;const logicalWidth=descriptor.sheets[key].frameWidth||FRAME_WIDTH,scale=image.naturalWidth/(logicalWidth*COLUMNS),width=logicalWidth*scale,height=FRAME_HEIGHT*scale;
        if(canvas.width!==width||canvas.height!==height){frameWidth=canvas.width=width;frameHeight=canvas.height=height;}
        loaded=true;setSize(logicalSize);canvas.dataset.codexReady='ready';canvas.dataset.codexSheet=key;canvas.dataset.codexCachedSheets=String(sheetCache.size);paint();syncPlayback();};
      const failed=error=>{if(destroyed||token!==imageGeneration)return;loaded=false;stop();canvas.dataset.codexReady='error';options.onError?.(error);};
      if(entry.ready)ready();else if(isXiaobaiPet(descriptor))entry.promise.then(ready,failed);else{entry.onReady=ready;entry.onError=failed;}
    }
    function setPet(next) {
      if (destroyed) return false;
      if (!validDescriptor(next)) throw new TypeError('Invalid Codex pet descriptor');
      stop(); resetVariation(); lastVariations.clear(); clearSheets();
      if (image) image.onload = image.onerror = null;
      descriptor = { ...next }; actions = getActions(descriptor);
      action = actions.find(item => item.id === action.id) || actions[0];
      variationBase = action.variation ? action : null;
      loaded = false; completed = false; frame = elapsed = 0;
      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.codexPetId = descriptor.id;
      canvas.dataset.codexReady = 'loading';
      canvas.setAttribute('aria-label', descriptor.name);
      if(descriptor.version===3){loadActionSheet();if(isXiaobaiPet(descriptor))void preloadSheets();return true;}
      const nextImage = new view.Image();
      image = nextImage;
      function failed() {
        if (destroyed || image !== nextImage) return;
        loaded = false; stop(); canvas.dataset.codexReady = 'error';
        options.onError?.(new Error('Codex pet sprite could not be loaded'));
      }
      nextImage.onerror = failed;
      nextImage.onload = function () {
        if (destroyed || image !== nextImage) return;
        const scale = nextImage.naturalWidth / (FRAME_WIDTH * COLUMNS);
        if (!Number.isInteger(scale) || scale < 1 || scale > 3 ||
            nextImage.naturalHeight !== FRAME_HEIGHT * descriptor.rows * scale) { failed(); return; }
        // Preserve the native frame pixels on every display. CSS controls the
        // logical size; a Retina screen never receives a downsampled 192px frame.
        frameWidth = canvas.width = FRAME_WIDTH * scale;
        frameHeight = canvas.height = FRAME_HEIGHT * scale;
        loaded = true; canvas.dataset.codexReady = 'ready'; paint(); syncPlayback();
      };
      nextImage.src = descriptor.imageURL;
      return true;
    }
    function setAction(id, { once = false, loop, clip, preserveProgress = false } = {}) {
      if(destroyed)return false;
      const next=actions.find(item=>item.id===id||item.row===id);if(!next)return false;
      if(clip&&(!Number.isInteger(clip.start)||!Number.isInteger(clip.count)||clip.start<0||clip.count<1||clip.start+clip.count>next.frameDurations.length))return false;
      const start=(next.start??next.row*COLUMNS)+(clip?.start||0),durations=clip?next.frameDurations.slice(clip.start,clip.start+clip.count):next.frameDurations,shouldLoop=once?false:loop??next.loop;
      if(!once&&((next===variationBase&&!clip&&loop===undefined)||(action.id===next.id&&(action.start??action.row*COLUMNS)===start&&action.frameDurations.length===durations.length&&action.loop===shouldLoop)))return true;
      const previousSheet=action.sheet,keep=preserveProgress&&['run-left','run-right'].includes(action.id)&&['run-left','run-right'].includes(next.id),oldFrame=frame,oldElapsed=elapsed;
      action=once||clip||loop!==undefined?{...next,start,frameDurations:durations,durationMs:durations.reduce((sum,ms)=>sum+ms,0),loop:shouldLoop,variation:undefined}:next;
      variationBase=action.variation?action:null;variationIndex=null;variationWait=0;variationDue=null;completed=false;frame=keep?oldFrame%durations.length:0;elapsed=keep?Math.min(oldElapsed,durations[frame]-1):0;
      if(descriptor.version===3&&(previousSheet!==action.sheet||!loaded)){loadActionSheet();return true;}paint();syncPlayback();return true;
    }
    function whenReady() {
      if(destroyed)return Promise.resolve(false);if(loaded)return Promise.resolve(true);
      const generation=imageGeneration;
      return descriptor.version===3?cachedSheet(action.sheet).promise.then(()=>!destroyed&&generation===imageGeneration&&loaded,()=>false):Promise.resolve(false);
    }
    let logicalSize=options.size??120;
    function setSize(value) {
      if (destroyed || !Number.isFinite(value) || value <= 0 || value > 2048) return false;
      logicalSize=value;
      canvas.style.width = `${value * frameWidth / frameHeight}px`;
      canvas.style.height = `${value}px`;
      return true;
    }
    function setOpacity(value) {
      if (destroyed || !Number.isFinite(value) || value < 0 || value > 1) return false;
      canvas.style.opacity = String(value);
      return true;
    }
    function pause(value = true) {
      if (destroyed) return;
      const next = Boolean(value);
      if (paused === next) return;
      paused = next; syncPlayback();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; stop(); clearSheets();
      document.removeEventListener('visibilitychange', syncPlayback);
      media?.removeEventListener?.('change', syncPlayback);
      if(image) image.onload = image.onerror = null;
      image = null; canvas.remove();
    }
    document.addEventListener('visibilitychange', syncPlayback);
    media?.addEventListener?.('change', syncPlayback);
    setSize(options.size ?? 120); setOpacity(options.opacity ?? 1); setPet(options.descriptor);
    return { element: canvas, setPet, setAction, setSize, setOpacity, pause, whenReady, destroy };
  }

  return Object.freeze({ isXiaobaiPet, ACTIONS, FRAME_WIDTH, FRAME_HEIGHT, COLUMNS, normalizeFrameMap, getActions, getPreviewActions, getInteractionActions, validDescriptor, create });
}));
