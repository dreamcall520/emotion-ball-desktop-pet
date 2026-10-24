(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./sheep-theme') : root.SheepTheme,
    typeof module === 'object' && module.exports ? require('./christmas-buddy-rotation').createRotation : root.createBuddyRotation,
    typeof module === 'object' && module.exports ? require('./sheep-fireworks') : root.SheepFireworks);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SheepSkin = api;
}(typeof window !== 'undefined' ? window : this, function (Theme, createBuddyRotation, Fireworks) {
  'use strict';

  const ACTIONS = Object.freeze({ walk: 1120, greet: 1580, joy: 1060, sleep: 3060 });
  const THEME_ACTIONS = Object.freeze({
    none: Object.freeze({ ...ACTIONS, ear: 3000, bell: 3000, stretch: 3000, working: 3000, complete: 3000 }),
    halloween: Object.freeze({ ...ACTIONS, candy: 3000, magic: 3000, pumpkin: 3000, working: 3000, complete: 3000 }),
    christmas: Object.freeze({ ...ACTIONS, gift: 3000, 'receive-gift': 1960, scarf: 3000, snow: 3000, working: 3000, complete: 3000 }),
    'spring-festival': Object.freeze({ ...ACTIONS, fortune: 3000, firecrackers: 3000, dumplings: 3000, working: 3000, complete: 3000 })
  });
  // Legacy requests reuse these real clips; they are not separate animations.
  const MOTIONS = Object.freeze({ bow: 'greet', jelly: 'joy', spin: 'joy', proud: 'joy',
    hop: 'joy', sway: 'joy', peek: 'idle', nuzzle: 'greet', land: 'idle', stretch: 'greet',
    packet: 'greet', lantern: 'greet', fortune: 'greet', bleat: 'greet', drag: 'idle', dizzy: 'joy', turn: 'greet' });
  const CLIPS = Object.freeze(['idle', ...Object.keys(ACTIONS)]);
  // Measured at foot height: gift on the left, companions on the right; mirror the whole layout.
  const BUDDY_X = Object.freeze({ reindeer: 256, tree: 243, santa: 246, snowman: 238, gift: 0 });
  // Match Halloween's face and body volume; a tall holiday hat must not shrink the sheep.
  const THEME_FIT = Object.freeze({ none: [.844, 304], halloween: [1, 303], christmas: [1, 303], 'spring-festival': [.893, 298] });
  const manifestURL = typeof document === 'undefined' ? '' : new URL('../assets/sheep/manifest.json', document.currentScript.src).href;
  let manifestPromise = null, desktopBuddyState = null;

  function getActions(theme) { return THEME_ACTIONS[Theme.normalizeTheme(theme)] || THEME_ACTIONS.none; }
  function supportsAction(action, theme) { return typeof action === 'string' && Object.hasOwn(getActions(theme), action); }
  function resolveAction(action, theme, owner) {
    if (typeof action !== 'string') return null;
    if (owner === 'codex' && ['hop', 'spin'].includes(action)) return 'complete';
    return action === 'idle' || supportsAction(action, theme) ? action : Object.hasOwn(MOTIONS, action) ? MOTIONS[action] : null;
  }
  function validFile(file) {
    return typeof file === 'string' && /^[a-z0-9_/-]+\.png$/i.test(file) && !file.startsWith('/') && file.split('/').every(Boolean);
  }
  function validateManifest(raw) {
    if (!raw || raw.version !== 1 || raw.width !== 320 || raw.height !== 320) throw new Error('小羊动画清单尺寸或版本不合法');
    for (const theme of ['none', 'halloween', 'christmas', 'spring-festival']) {
      if (raw.themes?.[theme]?.staticFile !== undefined && !validFile(raw.themes[theme].staticFile)) throw new Error('小羊静态造型路径不合法');
      const data = raw.themes?.[theme];
      const clips = ['idle', ...Object.keys(getActions(theme))].map(id => [id, data?.actions?.[id]]);
      if (data?.idleAlternate !== undefined) clips.push(['idleAlternate', data.idleAlternate]);
      if (data?.idleTransition !== undefined) {
        if (!data.idleAlternate) throw new Error(`小羊站姿过渡缺少B待机：${theme}`);
        if (!Array.isArray(data.idleTransition?.durations) || data.idleTransition.durations.length < 3 ||
          data.idleTransition.durations.length > 16 || data.idleTransition.durations.reduce((a, b) => a + b, 0) > 1500) {
          throw new Error(`小羊站姿过渡时长不合法：${theme}`);
        }
        clips.push(['idleTransition', data.idleTransition]);
      }
      if (data?.workingTransition !== undefined) {
        if (!Array.isArray(data.workingTransition?.durations) || data.workingTransition.durations.length < 3 ||
          data.workingTransition.durations.length > 16 || data.workingTransition.durations.reduce((a, b) => a + b, 0) > 1500) {
          throw new Error(`小羊阅读过渡时长不合法：${theme}`);
        }
        clips.push(['workingTransition', data.workingTransition]);
      }
      if (data?.sleepTransition !== undefined) {
        if (!Array.isArray(data.sleepTransition?.durations) || data.sleepTransition.durations.length < 3 ||
          data.sleepTransition.durations.length > 16 || data.sleepTransition.durations.reduce((a, b) => a + b, 0) > 1500) {
          throw new Error(`小羊睡眠过渡时长不合法：${theme}`);
        }
        clips.push(['sleepTransition', data.sleepTransition]);
      }
      for (const [id, clip] of clips) {
        if (!clip || !validFile(clip.file) ||
          !Number.isInteger(clip.columns) || clip.columns < 1 || clip.columns > 16 ||
          !Array.isArray(clip.durations) || clip.durations.length < 1 || clip.durations.length > 256 ||
          (clip.frameCount !== undefined && clip.frameCount !== clip.durations.length) ||
          (clip.cellSize !== undefined && clip.cellSize !== 320) ||
          clip.durations.some(ms => !Number.isInteger(ms) || ms < 10 || ms > 60000) ||
          clip.durations.reduce((sum, ms) => sum + ms, 0) > 60000 ||
          ['startsAtIdle', 'startsAtWorking'].some(key => clip[key] !== undefined && typeof clip[key] !== 'boolean') ||
          (clip.resultFrame !== undefined && (!Number.isInteger(clip.resultFrame) || clip.resultFrame < 0 || clip.resultFrame >= clip.durations.length))) throw new Error(`小羊动画清单不合法：${theme}/${id}`);
        if (clip.uprightRegions !== undefined && (!Array.isArray(clip.uprightRegions) ||
          clip.uprightRegions.length !== clip.durations.length || clip.uprightRegions.some(rect => rect !== null &&
            (!Array.isArray(rect) || rect.length !== 4 || rect.some(v => !Number.isInteger(v)) ||
              rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 || rect[0]+rect[2] > 320 || rect[1]+rect[3] > 320)))) {
          throw new Error(`小羊符号区域不合法：${theme}/${id}`);
        }
      }
      if (data.idleAlternate && data.idleAlternate.durations.reduce((sum, ms) => sum + ms, 0) !==
        data.actions.idle.durations.reduce((sum, ms) => sum + ms, 0)) throw new Error(`小羊待机姿态时长不一致：${theme}`);
    }
    return raw;
  }
  function loadManifest(view) {
    if (!manifestPromise) {
      manifestPromise = new Promise((resolve, reject) => {
        const request = new view.XMLHttpRequest();
        request.open('GET', manifestURL, true);
        request.timeout = 15000;
        request.onload = () => {
          try {
            if (request.status !== 0 && (request.status < 200 || request.status >= 300)) throw new Error('小羊动画清单无法读取');
            resolve(validateManifest(JSON.parse(request.responseText)));
          } catch (error) { reject(error); }
        };
        request.onerror = request.ontimeout = () => reject(new Error('小羊动画清单无法读取'));
        request.send();
      }).catch(error => { manifestPromise = null; throw error; });
    }
    return manifestPromise;
  }

  function create(target, options = {}) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) throw new Error('小羊缺少显示容器');
    if (!Theme) throw new Error('请先加载 sheep-theme.js');
    const doc = target.ownerDocument || document, view = doc.defaultView || window;
    const canvas = doc.createElement('canvas');
    canvas.className = 'sheep-skin'; canvas.width = canvas.height = 320;
    canvas.dataset.buddyLayout = String(options.christmasBuddies === true);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', options.label || '咩咩');
    canvas.style.opacity = String(1 - Math.min(60, Math.max(0, Number(options.auroraTransparency) || 0)) / 100);
    target.appendChild(canvas);
    const context = canvas.getContext('2d');
    const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    const fireworks = options.ambientFireworks === true ? Fireworks?.create() : null;
    let fireworksDay = '', fireworksInSeason = false;
    function inFireworksSeason() {
      const date = new Date(), day = `${date.getFullYear()}/${date.getMonth()}/${date.getDate()}`;
      if (day !== fireworksDay) {
        fireworksDay = day;
        fireworksInSeason = Theme.resolveTheme('auto', date) === 'spring-festival';
      }
      return fireworksInSeason;
    }
    const listeners = new Map(), images = new Map();
    const selection = Theme.normalizeTheme(options.sheepTheme);
    let theme = Theme.resolveTheme(selection, new Date()), manifest = null, clip = null, image = null, clipReady = Promise.resolve(false);
    let active = options.autostart !== false, destroyed = false, explicit = null, hostOwned = false;
    let elapsed = 0, startedAt = null, request = null, endTimer = null, revision = 0, clockRevision = 0, painted = -1;
    let direction = options.facing === 'right' ? 'right' : 'left', idlePose = 'primary', idleTheme = theme, readyResolved = false, readyResolve;
    canvas.dataset.facing = direction;
    let lead = null, entryOffset = 0, pendingFrom = null;
    const buddyState = options.christmasBuddies === true && createBuddyRotation
      ? (desktopBuddyState ||= { rotation: createBuddyRotation(), selected: false, buddy: null, deadline: 0 }) : null;
    const buddyRotation = buddyState?.rotation;
    let buddy = null, buddyImage = null, buddyTimer = null, buddyDeadline = 0, buddyInitialized = false, buddySwitching = false, buddyRevision = 0;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const now = () => view.performance.now();
    const emotionAction = () => ['00', '56'].includes(api.emotionId) ? 'sleep' : api.emotionId === '51' ? 'working' : 'idle';
    const selectedAction = () => explicit || emotionAction();
    function buddyBounds() {
      if (!buddyImage || theme !== 'christmas' || !Object.hasOwn(BUDDY_X, buddy) || buddy === 'gift' ||
          !['idle', 'greet', 'joy', 'gift', 'scarf', 'snow', 'receive-gift'].includes(selectedAction()) || canvas.dataset.transition) return null;
      const height = buddy === 'reindeer' ? 72 : 230 / 3;
      return { x: BUDDY_X[buddy], y: 296-height, width: buddyImage.naturalWidth / buddyImage.naturalHeight * height, height };
    }
    const emit = (event, payload) => { for (const callback of listeners.get(event) || []) callback(payload); };
    const settleReady = value => { if (!readyResolved) { readyResolved = true; readyResolve(value); } };
    function pauseClock() {
      clockRevision++;
      if (startedAt !== null) elapsed += Math.max(0, now() - startedAt);
      startedAt = null;
      if (request !== null) view.cancelAnimationFrame(request);
      if (endTimer !== null) view.clearTimeout(endTimer);
      request = endTimer = null;
    }
    function currentElapsed() {
      const time = elapsed + (startedAt === null ? 0 : Math.max(0, now() - startedAt));
      if (!hostOwned || !explicit || !clip || ['idle', 'working', 'sleep'].includes(explicit)) return time;
      // A late host completion must hold the gesture's last frame instead of wrapping to its first.
      const duration = clip.durations.reduce((sum, ms) => sum + ms, 0) + leadDuration() - skipEntry();
      return Math.min(time, duration - .001);
    }
    const leadDuration = () => reduced?.matches ? 0 : lead?.duration || 0;
    const skipEntry = () => reduced?.matches ? 0 : entryOffset;
    function leadingStep(time) {
      let index = 0;
      while (index < lead.steps.length - 1 && time >= lead.steps[index].spec.durations[lead.steps[index].frame]) {
        const step = lead.steps[index++]; time -= step.spec.durations[step.frame];
      }
      return lead.steps[index];
    }
    function paint(force = false) {
      if (!image || destroyed || (!clip && canvas.dataset.ready !== 'static')) return;
      if (options.portraitRaster === true) {
        const side = Math.max(32, Math.min(320, Math.round((target.clientHeight || 32) * (view.devicePixelRatio || 1))));
        if (canvas.width !== side) {
          canvas.width = canvas.height = side;
          context.scale(side / 320, side / 320);
          // Downsample the whole cell once at display resolution instead of CSS sampling a 320px texture.
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          force = true;
        }
      }
      let frame = 0, drawingClip = clip, drawingImage = image;
      if (clip) {
        const duration = clip.durations.reduce((sum, ms) => sum + ms, 0);
        const time = currentElapsed(), transitioning = time < leadDuration();
        canvas.dataset.transition = transitioning ? leadingStep(time).phase : '';
        if (transitioning) {
          const step = leadingStep(time); drawingClip = step.spec; drawingImage = step.image; frame = step.frame;
        } else {
          let t = reduced?.matches ? 0 : (time - leadDuration() + skipEntry()) % duration;
          while (frame < clip.durations.length - 1 && t >= clip.durations[frame]) t -= clip.durations[frame++];
        }
        // Reduced motion acknowledges receipt before the full animation puts the gift away.
        if (reduced?.matches && explicit === 'receive-gift') frame = clip.resultFrame ?? clip.durations.length - 1;
        else if (reduced?.matches && explicit === 'candy') frame = Math.max(0, clip.durations.length - 2);
      }
      const festive = active && !doc.hidden && !reduced?.matches && theme === 'spring-festival' &&
        !['sleep', 'working', 'complete'].includes(selectedAction());
      const festiveIdle = selectedAction() === 'idle' && !canvas.dataset.transition;
      const sparks = fireworks?.frame(now(), festive, festive && inFireworksSeason(), festiveIdle);
      const paintKey = `${canvas.dataset.transition}:${frame}:${buddy || 'none'}:${sparks?.key || ''}`;
      if (!force && paintKey === painted) return;
      painted = paintKey;
      context.clearRect(0, 0, 320, 320);
      if (sparks) Fireworks.draw(context, sparks);
      const [fit, baseline] = THEME_FIT[theme], left = 160 * (1-fit), top = 303-baseline*fit;
      context.save();
      if (direction === 'right') { context.translate(320, 0); context.scale(-1, 1); }
      const companion = buddyBounds();
      if (companion) {
        // Keep the sheep's hands in front when a response reaches toward its companion.
        context.drawImage(buddyImage, 0, 0, buddyImage.naturalWidth, buddyImage.naturalHeight, companion.x, companion.y, companion.width, companion.height);
      }
      if (!clip && manifest?.themes[theme]?.staticFile) {
        const scale = 320 / Math.max(image.naturalWidth, image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, left+(320-width)/2*fit, top+(320-height)/2*fit, width*fit, height*fit);
      } else context.drawImage(drawingImage, (frame % (drawingClip?.columns || 1)) * 320, Math.floor(frame / (drawingClip?.columns || 1)) * 320, 320, 320, left, top, 320*fit, 320*fit);
      context.restore();
      const upright = drawingClip?.uprightRegions?.[frame];
      if (direction === 'right' && upright) {
        // Keep ticks and lettering readable while hands, clothing and the card still face the user.
        const [x, y, width, height] = upright;
        context.clearRect(left+(320-x-width)*fit, top+y*fit, width*fit, height*fit);
        context.drawImage(drawingImage, frame % drawingClip.columns * 320 + x, Math.floor(frame / drawingClip.columns) * 320 + y,
          width, height, left+(320-x-width)*fit, top+y*fit, width*fit, height*fit);
      }
      canvas.dataset.frame = clip ? String(frame) : 'static';
    }
    function finishMotion() {
      if (!explicit || destroyed) return;
      const action = explicit;
      explicit = null; hostOwned = false;
      selectClip(true);
      emit('motionend', { action });
    }
    function tick() {
      request = null;
      if (destroyed || !active || doc.hidden || !clip || reduced?.matches) return;
      paint();
      request = view.requestAnimationFrame(tick);
    }
    function syncPlayback() {
      pauseClock();
      syncBuddyPlayback();
      if (!active || doc.hidden || reduced?.matches) fireworks?.frame(now(), false);
      canvas.dataset.paused = String(!active || Boolean(doc.hidden));
      canvas.dataset.reduced = String(Boolean(reduced?.matches));
      if (destroyed || !active || doc.hidden || !clip) return;
      startedAt = now();
      if (explicit && !hostOwned) {
        const duration = clip.durations.reduce((sum, ms) => sum + ms, 0) + leadDuration() - skipEntry();
        const generation = clockRevision;
        endTimer = view.setTimeout(() => { if (generation === clockRevision) finishMotion(); }, Math.max(0, duration - elapsed));
      }
      paint(true);
      if (!reduced?.matches) request = view.requestAnimationFrame(tick);
    }
    function loadImage(spec, isStatic = false) {
      const url = new URL(spec.file, manifestURL).href;
      if (!images.has(url)) {
        const loading = new Promise((resolve, reject) => {
          const next = new view.Image();
          next.onload = () => {
            next.onload = next.onerror = null;
            if (isStatic ? !(next.naturalWidth > 0 && next.naturalHeight > 0 && next.naturalWidth <= 4096 && next.naturalHeight <= 4096) :
              next.naturalWidth !== spec.columns * 320 || next.naturalHeight !== Math.ceil(spec.durations.length / spec.columns) * 320) {
              reject(new Error('小羊动画图集尺寸不匹配')); return;
            }
            resolve(next);
          };
          next.onerror = () => { next.onload = next.onerror = null; reject(new Error('小羊动画图集无法加载')); };
          next.src = url;
        }).catch(error => { images.delete(url); throw error; });
        images.set(url, loading);
      }
      return images.get(url);
    }
    function syncBuddyPlayback() {
      if (buddyTimer !== null) view.clearTimeout(buddyTimer);
      buddyTimer = null;
      if (!buddyRotation || destroyed) return;
      if (theme !== 'christmas') {
        buddyRevision++; buddyInitialized = buddySwitching = false; buddyDeadline = 0; buddy = buddyImage = null;
        canvas.dataset.buddy = 'none'; delete canvas.dataset.nextBuddyDelay;
        return;
      }
      if (!active || doc.hidden || buddySwitching || explicit) return;
      if (!buddyInitialized) { buddyInitialized = true; buddyDeadline = buddyState.deadline; changeBuddy(!buddyState.selected); return; }
      buddyTimer = view.setTimeout(changeBuddy, Math.max(0, buddyDeadline - now()));
    }
    async function changeBuddy(advance = true, fromClick = false) {
      if (!buddyRotation || destroyed || theme !== 'christmas' || buddySwitching) return false;
      buddySwitching = true;
      const generation = ++buddyRevision, next = advance ? buddyRotation.next(false) : buddyState.buddy;
      let switched = false;
      try {
        const nextImage = next ? await loadImage({ file: `buddies/${next}.png` }, true) : null;
        if (destroyed || generation !== buddyRevision || theme !== 'christmas') return false;
        if (advance) {
          buddyRotation.next();
          if (fromClick) buddyRotation.markClickSwitch(now());
          buddyState.selected = true; buddyState.buddy = next;
          const delay = buddyRotation.delay();
          canvas.dataset.nextBuddyDelay = String(delay); buddyState.deadline = now() + delay;
        } else canvas.dataset.nextBuddyDelay = String(Math.max(0, buddyState.deadline - now()));
        buddyDeadline = buddyState.deadline; switched = true;
        buddy = next; buddyImage = nextImage; canvas.dataset.buddy = buddy || 'none';
        delete canvas.dataset.buddyError;
        paint(true);
        emit('buddychange', { buddy });
        return true;
      } catch (error) {
        if (!destroyed && generation === buddyRevision) {
          canvas.dataset.buddyError = 'true'; emit('error', { error }); options.onError?.(error);
        }
        return false;
      } finally {
        if (!destroyed && generation === buddyRevision) {
          buddySwitching = false;
          // Failed artwork keeps the visible state and click cooldown; initial failure retries without a hot loop.
          if (!switched && buddyDeadline <= now()) buddyDeadline = now() + 15000;
          syncBuddyPlayback();
        }
      }
    }
    async function showFallback(generation, nextTheme) {
      const themeData = manifest?.themes[nextTheme];
      if (!themeData) { settleReady(false); return; }
      try {
        const next = themeData.staticFile ? await loadImage({ file: themeData.staticFile }, true) : await loadImage(themeData.actions.idle);
        if (destroyed || generation !== revision) return;
        image = next; idlePose = 'primary'; pendingFrom = null; canvas.dataset.ready = 'static'; canvas.dataset.action = 'static'; canvas.dataset.idlePose = 'primary'; canvas.dataset.transition = '';
        paint(true); settleReady(true);
      } catch (_) { if (!destroyed && generation === revision) settleReady(false); }
    }
    function selectClip(restart) {
      const previousAction = pendingFrom ? pendingFrom.action : canvas.dataset.action;
      const previousPose = pendingFrom ? pendingFrom.pose : idlePose;
      const inFlight = pendingFrom ? pendingFrom.inFlight : lead && currentElapsed() < leadDuration() ? leadingStep(currentElapsed()) : null;
      // A replacement while loading still starts from the pose that is actually visible.
      pendingFrom = { action: previousAction, pose: previousPose, inFlight };
      pauseClock();
      if (restart) elapsed = 0;
      clip = null; lead = null; entryOffset = 0;
      const generation = ++revision, action = selectedAction(), nextTheme = theme;
      canvas.dataset.action = action; canvas.dataset.theme = nextTheme; canvas.dataset.ready = 'loading';
      syncBuddyPlayback();
      clipReady = loadManifest(view).then(data => {
        if (destroyed || generation !== revision) return null;
        manifest = data;
        const themeData = manifest.themes[nextTheme];
        const sameTheme = idleTheme === nextTheme;
        if (!sameTheme) { idleTheme = nextTheme; idlePose = 'primary'; }
        // Reuse the existing interaction cadence: choose once on returning to idle, never in a frame tick.
        if (action === 'idle' && sameTheme && active && !doc.hidden && previousAction !== 'idle' &&
          Object.hasOwn(themeData.actions, previousAction) && themeData.idleAlternate) {
          idlePose = Math.random() < 0.5 ? 'alternate' : 'primary';
        }
        const spec = action === 'idle' && idlePose === 'alternate' && themeData.idleAlternate
          ? themeData.idleAlternate : themeData.actions[action];
        canvas.dataset.idlePose = action === 'idle' ? idlePose : 'primary';
        const target = action === 'sleep' && themeData.sleepTransition ? 'sleepTransition'
          : action === 'working' || (action !== 'idle' && spec.startsAtWorking) ? 'workingTransition'
          : action === 'idle' && idlePose === 'alternate' ? 'idleTransition' : null;
        const current = inFlight?.kind || (previousAction === 'sleep' && themeData.sleepTransition ? 'sleepTransition'
          : previousAction === 'working' ? 'workingTransition'
          : previousAction === 'idle' && previousPose === 'alternate' ? 'idleTransition' : null);
        const from = inFlight?.frame ?? (themeData[current]?.durations.length - 1 || 0);
        const steps = [];
        function append(kind, start, end) {
          const bridge = themeData[kind];
          if (!bridge || start === end) return;
          const phase = kind === 'idleTransition' ? (start < end ? 'to-alternate' : 'to-primary')
            : kind === 'sleepTransition' ? (start < end ? 'to-sleep' : 'from-sleep')
            : start < end ? 'to-working' : 'from-working';
          for (let frame = start; ; frame += Math.sign(end-start)) {
            steps.push({ kind, spec: bridge, frame, phase });
            if (frame === end) break;
          }
        }
        if (sameTheme && active && !doc.hidden && !reduced?.matches) {
          if (current && current === target) append(current, from, themeData[target]?.durations.length - 1 || 0);
          else {
            if (current) append(current, from, 0);
            if (target) append(target, 0, themeData[target]?.durations.length - 1 || 0);
          }
        }
        if (steps.length) {
          return Promise.all([loadImage(spec), ...steps.map(step => loadImage(step.spec))]).then(([next, ...loaded]) => ({ spec, next,
            lead: { steps: steps.map((step, i) => ({ ...step, image: loaded[i] })),
              duration: steps.reduce((ms, step) => ms + step.spec.durations[step.frame], 0) },
            entryOffset: action !== 'idle' && (target === 'workingTransition' ? spec.startsAtWorking : target === 'sleepTransition' ? false : spec.startsAtIdle) ? spec.durations[0] : 0 }));
        }
        return loadImage(spec).then(next => ({ spec, next }));
      }).then(result => {
        if (!result || destroyed || generation !== revision) return false;
        clip = result.spec; image = result.next; lead = result.lead || null; entryOffset = result.entryOffset || 0; pendingFrom = null; painted = -1;
        canvas.dataset.ready = 'true';
        paint(true); syncPlayback(); settleReady(true); return true;
      }).catch(error => {
        if (destroyed || generation !== revision) return false;
        canvas.dataset.ready = 'error';
        const action = explicit;
        explicit = null; hostOwned = false;
        emit('error', { error }); options.onError?.(error);
        if (action) emit('motionend', { action, reason: 'error' });
        showFallback(generation, nextTheme); return false;
      });
    }
    function syncCalendar() {
      if (destroyed) return;
      const next = Theme.resolveTheme(selection, new Date());
      if (next !== theme) {
        theme = next;
        if (explicit && !CLIPS.includes(explicit) && !supportsAction(explicit, theme)) {
          const action = explicit;
          explicit = null; hostOwned = false;
          selectClip(true); emit('motionend', { action, reason: 'theme-change' });
        } else selectClip(false);
      }
    }
    function visibilityChanged() { syncCalendar(); syncPlayback(); }
    const calendarTimer = selection === 'auto' ? view.setInterval(syncCalendar, 60000) : null;
    const api = {
      emotionId: options.emotion || '50',
      setEmotion(id) {
        if (destroyed) return this;
        const before = selectedAction();
        this.emotionId = id; explicit = null; hostOwned = false;
        canvas.dataset.emotion = id;
        if (selectedAction() !== before || !image) selectClip(true);
        else syncPlayback();
        emit('change', { id }); return this;
      },
      setMotionAction(id, owner) {
        syncCalendar();
        const action = resolveAction(id, theme, owner);
        if (!action || destroyed) return this;
        explicit = action; hostOwned = owner === 'user' || owner === 'codex';
        selectClip(true); return this;
      },
      hitBuddy(clientX, clientY) {
        const bounds = buddyBounds(), rect = canvas.getBoundingClientRect();
        if (!buddyRotation || theme !== 'christmas' || !active || destroyed || doc.hidden || rect.width <= 0 || rect.height <= 0) return null;
        let x = (clientX-rect.left)*320/rect.width;
        const y = (clientY-rect.top)*320/rect.height;
        if (direction === 'right') x = 320-x;
        if (selectedAction() === 'idle' && !canvas.dataset.transition && x >= 34 && x < 99 && y >= 248 && y < 309) return 'gift';
        return bounds && x >= bounds.x && x < bounds.x+bounds.width && y >= bounds.y && y < bounds.y+bounds.height ? buddy : null;
      },
      notifySuccessfulClick() {
        if (!destroyed && theme === 'christmas' && buddyInitialized && !buddySwitching &&
            buddyRotation?.shouldSwitchOnClick(now(), false)) return changeBuddy(true, true);
        return Promise.resolve(false);
      },
      setMotionFrame(frame) { if (frame?.done) this.stopMotion(); return this; },
      stopMotion() {
        if (destroyed || !explicit) return this;
        explicit = null; hostOwned = false; selectClip(true); return this;
      },
      setActive(value) {
        if (destroyed) return this;
        const next = Boolean(value);
        if (active === next) return this;
        active = next; if (active) syncCalendar(); syncPlayback(); return this;
      },
      renderStatic() {
        if (destroyed) return this;
        active = false; explicit = null; hostOwned = false; idlePose = 'primary'; selectClip(true); syncPlayback(); return this;
      },
      // Eyes are painted into the approved frames; there is no independent gaze rig.
      setGaze() { return this; }, clearGaze() { return this; }, setDragDirection() { return this; },
      setFacing(side) {
        direction = side === 'left' ? 'left' : 'right'; paint(true);
        if (canvas.dataset.facing !== direction) canvas.dataset.facing = direction;
        return this;
      },
      spin() { return this.setMotionAction('joy'); }, bounce() { return this.setMotionAction('joy'); },
      resize() { paint(true); return this; },
      getActionDuration(id, owner) {
        const action = resolveAction(id, theme, owner);
        if (!action) return 0;
        const durations = action === 'idle' && idlePose === 'alternate'
          ? manifest?.themes[theme]?.idleAlternate?.durations : manifest?.themes[theme]?.actions[action]?.durations;
        const duration = durations ? durations.reduce((sum, ms) => sum + ms, 0) : getActions(theme)[action] || 3220;
        return duration + (action !== 'idle' && action === selectedAction() ? leadDuration() - skipEntry() : 0);
      },
      whenReady() { return ready; },
      whenMotionReady() { return clipReady; },
      on(event, callback) {
        if (!destroyed && ['change', 'motionend', 'error', 'buddychange'].includes(event) && typeof callback === 'function') {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(callback);
        }
        return this;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; revision++; buddyRevision++; pauseClock();
        if (buddyTimer !== null) view.clearTimeout(buddyTimer);
        if (calendarTimer !== null) view.clearInterval(calendarTimer);
        reduced?.removeEventListener?.('change', syncPlayback);
        doc.removeEventListener('visibilitychange', visibilityChanged);
        listeners.clear(); images.clear(); image = clip = lead = pendingFrom = null; settleReady(false); canvas.remove();
      }
    };
    reduced?.addEventListener?.('change', syncPlayback);
    doc.addEventListener('visibilitychange', visibilityChanged);
    canvas.dataset.emotion = api.emotionId;
    syncPlayback(); selectClip(true);
    return api;
  }

  return Object.freeze({ ACTIONS, MOTIONS, getActions, supportsAction, resolveAction, validateManifest, create });
}));
