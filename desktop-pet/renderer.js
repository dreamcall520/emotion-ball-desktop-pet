(function startDesktopPet() {
  'use strict';

  const petElement = document.getElementById('pet');
  const desktop = window.petDesktop || {
    beginDrag() {},
    dragTo() {},
    endDrag() {},
    bounce() {},
    stopMotion() {},
    playMotion() {},
    codexMotionReady() {},
    codexAvailability() {},
    thought() {},
    say() {},
    showContextMenu() {},
    onCommand() { return () => {}; },
    onActivity() { return () => {}; },
    onSettings() { return () => {}; },
    onMotion() { return () => {}; },
    onCodexSettings() { return () => {}; }
  };

  const companion = new CompanionBehavior.CompanionState();
  const petting = new CompanionBehavior.PettingTracker();

  let ball = null;
  let sheepOffering = null;
  let clickVisual = null;
  let officialAurora = null;
  let codexPet = null;
  let lastAuroraClick = null;
  let customization = PetCustomization.normalizeCustomization();
  const quotaEffects = window.QuotaEffects?.create(petElement);
  let quotaPacket = { config: window.QuotaDisplay?.normalize(), model: null, visible: false };
  function syncQuotaEffects() {
    quotaEffects?.update({ config: quotaPacket.config, appearance: customization.appearance,
      quotas: window.QuotaDisplay?.values(quotaPacket.model),
      theme: document.documentElement?.dataset.appearance === 'dark' ? 'dark' : 'light',
      reducedMotion: reducedMotion(), visible: quotaPacket.visible && !presentationSuppressed && presentationMode !== 'tucked' });
  }
  let presentationSuppressed = false;
  let presentationMode = 'free';
  let presentationPaused = false;
  let presentationFrozen = false;
  let compactMode = null;
  let dragState = null;
  let singleClickTimer = null;
  let wakeOnDoubleClick = false;
  let helloTimer = null;
  let petHovered = false;
  let actionTimer = null;
  let softOrbActionEpoch=0;
  let actionUntil = 0;
  let sheepActionBall = null;
  let lastSheepClick = null;
  let nextSheepAmbientAt = 0;
  let lastSheepAmbient = null;
  let sheepAutoNap = false;
  let sheepLastInteractionAt = performance.now();
  let sheepLastNapAt = null;
  let sheepAutomaticWakeUntil = 0;
  let lastWorkAttempt = 0;
  let lastSample = null;
  let currentState = { mode: 'awake', emotionId: '50', gaze: null };
  let lastSleepState = null, rendererUnloading = false;
  let activeMotion = null;
  let nextMotionToken = 0;
  let lastDoubleMotion = null;
  let codexEnabled = false;
  let focusQuiet = false;
  let codexGeneration = 0;
  let codexPageEpoch = 0;
  let lastCodexAlertId = 0;
  let lastAvailability = null;
  let codexActiveTaskCount = 0;
  let codexThinking = false;
  let codexThinkingVisible = false;
  let codexThinkingTimer = null;
  let facing = null;
  let thoughtSignature = '';
  const listeners = [];
  const CODEX_THINKING_BURST_MS = 6000;
  const thinkingRestMs = () => 25000 + Math.floor(Math.random() * 10001);
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  let uploadedAction = null, lastUploadedAction = null;
  let lastSpriteInkSignature='';
  function reportSpriteEdgeInk() {
    if(!desktop.spriteEdgeInk)return;
    if(customization.appearance.shape!=='codex-pet'||!codexPet?.frameMap){if(lastSpriteInkSignature)desktop.spriteEdgeInk(null);lastSpriteInkSignature='';return;}
    if(!['tucked','peeked'].includes(presentationMode))return;
    const canvas=ball?.getSpriteCanvas?.();if(!canvas||canvas.dataset.codexReady!=='ready')return;
    const signature=[codexPet.id,canvas.dataset.codexAction,canvas.dataset.codexFrame,canvas.width,canvas.height].join(':');if(signature===lastSpriteInkSignature)return;
    try{
      const sample=document.createElement('canvas');sample.width=sample.height=64;const context=sample.getContext('2d',{willReadFrequently:true});context.drawImage(canvas,0,0,64,64);
      const pixels=context.getImageData(0,0,64,64).data,rows=[];
      for(let y=0;y<64;y++){let row='';for(let x=0;x<64;x+=4){let nibble=0;for(let bit=0;bit<4;bit++)if(pixels[(y*64+x+bit)*4+3]>24)nibble|=1<<(3-bit);row+=nibble.toString(16);}rows.push(row);}
      desktop.spriteEdgeInk({id:codexPet.id,columns:64,rows});lastSpriteInkSignature=signature;
    }catch(_){lastSpriteInkSignature='';}
  }
  const weatherEffects = window.WeatherPetEffects?.create(petElement, () => ({
    shape: customization.appearance.shape,
    opacity: 1 - customization.appearance.auroraTransparency / 100,
    visible: !presentationSuppressed && presentationMode !== 'hidden' && !lastSample?.locked,
    sleeping: companion.manualSleep || currentState.mode === 'sleep',
    busy: Boolean(focusQuiet || currentState.mode === 'focus' || dragState?.dragged || activeMotion || performance.now() < actionUntil),
    atEdge: presentationMode === 'tucked' || presentationMode === 'peeked',
    reducedMotion: reducedMotion()
  }));

  function syncEdgePeekStyle() {
    const spec=window.EdgePeek?.specFor(customization.appearance.shape);
    petElement.dataset.edgePeek=String(Boolean(spec));
    if(spec){petElement.style.setProperty('--edge-tuck',`${spec.tucked*100}%`);petElement.style.setProperty('--edge-peek',`${spec.peeked*100}%`);}
    else {petElement.style.removeProperty?.('--edge-tuck');petElement.style.removeProperty?.('--edge-peek');}
  }

  function visualFacing() {
    if (!facing) return 'right';
    // The approved aurora face is drawn on the left side of its artwork, the
    // reverse of the engine's normal facing convention. Only the free pet
    // needs this flip; docked artwork has its own mirrored edge presentation.
    if (customization.appearance.shape === 'aurora-cloud' && presentationMode === 'free') {
      return facing === 'left' ? 'right' : 'left';
    }
    return facing;
  }

  function syncFacing() {
    if (dragState || activeMotion || presentationSuppressed || lastSample?.locked) return;
    // The approved aurora artwork bakes its eyes into the right-facing image.
    // Its left-edge presentation mirrors the whole SVG, so both edges keep
    // the same artwork orientation while the cloud peeks out.
    const auroraAtEdge = customization.appearance.shape === 'aurora-cloud' &&
      presentationMode === 'peeked' && ['left', 'right'].includes(petElement.dataset.edge);
    const side=petElement.dataset.edge,naturalEdge=window.EdgePeek?.specFor(customization.appearance.shape);
    if(naturalEdge&&['tucked','peeked'].includes(presentationMode)&&['left','right'].includes(side)){
      facing=side==='left'?'right':'left';
    }else facing = auroraAtEdge ? 'right' : PetFacing.resolve(lastSample?.petBounds, lastSample?.workArea, facing);
    petElement.dataset.facing = facing;
    ball?.setFacing(visualFacing());
  }

  function syncThought(visible, side) {
    const signature = visible ? `${side}:${reducedMotion()}` : '';
    if (signature === thoughtSignature) return;
    thoughtSignature = signature;
    desktop.thought?.({ visible, side, reducedMotion: reducedMotion() });
  }

  function canShowCodex(preparedMotion = null) {
    return !focusQuiet && !presentationSuppressed && codexEnabled && Boolean(lastSample) && !lastSample.locked && !companion.manualSleep &&
      currentState.mode !== 'sleep' && !dragState && !sheepOffering?.isDragging() && !singleClickTimer && !helloTimer &&
      performance.now() >= actionUntil && (!activeMotion || activeMotion === preparedMotion);
  }

  function reportCodexAvailability() {
    if (!codexEnabled) { lastAvailability = null; return; }
    const available = canShowCodex();
    if (available === lastAvailability) return;
    lastAvailability = available;
    desktop.codexAvailability({ generation: codexGeneration, pageEpoch: codexPageEpoch, available });
  }

  function stopCodexThinkingCadence() {
    clearTimeout(codexThinkingTimer);
    codexThinkingTimer = null;
    codexThinkingVisible = false;
    syncThought(false, facing);
  }

  function scheduleCodexThinkingPhase(visible, delay) {
    clearTimeout(codexThinkingTimer);
    codexThinkingTimer = setTimeout(() => {
      codexThinkingTimer = null;
      if (focusQuiet || !codexEnabled || codexActiveTaskCount <= 0) return;
      codexThinkingVisible = visible;
      syncCodexWorking();
      scheduleCodexThinkingPhase(!visible,
        visible ? CODEX_THINKING_BURST_MS : thinkingRestMs());
    }, delay);
  }

  function startCodexThinkingCadence() {
    stopCodexThinkingCadence();
    if (focusQuiet) return;
    codexThinkingVisible = true;
    scheduleCodexThinkingPhase(false, CODEX_THINKING_BURST_MS);
  }

  function syncCodexWorking() {
    const eligible = !focusQuiet && !presentationSuppressed && codexEnabled && codexActiveTaskCount > 0 && Boolean(lastSample) && !lastSample.locked &&
      !companion.manualSleep && currentState.mode !== 'sleep' && !dragState && !sheepOffering?.isDragging() && !singleClickTimer && !helloTimer &&
      performance.now() >= actionUntil && !activeMotion;
    const working = eligible && codexThinkingVisible;
    syncFacing();
    const side = facing || 'right';
    petElement.dataset.codexWorking = working ? 'true' : 'false';
    petElement.dataset.codexActiveTasks = String(codexActiveTaskCount);
    petElement.dataset.codexThoughtSide = side;
    syncThought(working, side);
    if (!ball) return;
    if (working) {
      // 若前一段被摸头、拖动或睡眠挡住，从真正可见时计满一轮。
      if (!codexThinking) scheduleCodexThinkingPhase(false, CODEX_THINKING_BURST_MS);
      codexThinking = true;
      showEmotion('51');
      setBallGaze({ x: side === 'left' ? -1 : 1, y: -1 });
    } else if (codexThinking) {
      codexThinking = false;
      restoreState();
      if (!presentationSuppressed && !lastSample?.locked && !activeMotion && performance.now() >= actionUntil) {
        setBallGaze(!companion.manualSleep ? currentState.gaze : null);
      }
    }
  }

  function reportSleepState() {
    if (rendererUnloading) return;
    const state = companion.manualSleep || sheepAutoNap || currentState.mode === 'sleep' || lastSample?.locked ? 'sleep' : 'awake';
    if (state !== lastSleepState) { lastSleepState = state; desktop.reportSleepState?.(state); }
  }

  function observe(callback) {
    return (...args) => {
      try { return callback(...args); }
      finally { syncCodexWorking(); reportCodexAvailability(); sheepOffering?.update(); reportSleepState(); reportSpriteEdgeInk(); }
    };
  }
  const onPet = (name, callback) => petElement.addEventListener(name, observe(callback));
  const onWindow = (name, callback) => window.addEventListener(name, observe(callback));

  function cancelCodex(request) {
    if (activeMotion?.owner !== 'codex' || (request && (request.generation !== activeMotion.generation ||
      request.pageEpoch !== activeMotion.pageEpoch || request.alertId !== activeMotion.alertId ||
      (request.token !== undefined && request.token !== activeMotion.token)))) return;
    stopMotion(false);
    restoreState();
  }

  function startCodex(request) {
    const motion = InteractionMotion.getMotion(request.motion);
    if (!canShowCodex() || request.generation !== codexGeneration || request.pageEpoch !== codexPageEpoch || !Number.isSafeInteger(request.alertId) ||
      request.alertId <= lastCodexAlertId || !motion) return;
    lastCodexAlertId = request.alertId;
    activeMotion = { token: ++nextMotionToken, action: motion.id, owner: 'codex',
      alertId: request.alertId, generation: request.generation, pageEpoch: request.pageEpoch };
    petElement.dataset.motionOwner = 'codex';
    if (customization.appearance.shape !== 'new-year-sheep') ball.setEmotion(motion.emotion);
    if(customization.appearance.shape==='soft-orb')ball.setMotionAction?.(motion.id,'codex',request.kind);
    else ball.setMotionAction?.(motion.id,'codex');
    ball.setMotionFrame(InteractionMotion.sampleMotion(motion.id, 0));
    petElement.dataset.lastAction = motion.id;
    const preparedBall = ball, preparedMotion = activeMotion;
    const acknowledge = ready => {
      if (activeMotion !== preparedMotion || ball !== preparedBall) return;
      if (ready === false || !canShowCodex(preparedMotion)) { cancelCodex(request); return; }
      const durationMs = ['new-year-sheep','soft-orb'].includes(customization.appearance.shape)
        ? (customization.appearance.shape==='soft-orb'?preparedBall.getActionDuration?.(motion.id,'codex',request.kind):preparedBall.getActionDuration?.(motion.id,'codex')) : undefined;
      desktop.codexMotionReady({ token: preparedMotion.token, action: motion.id,
        alertId: request.alertId, generation: request.generation, pageEpoch: request.pageEpoch,
        ...(Number.isInteger(durationMs) && durationMs >= 10 && durationMs <= 60000 ? { durationMs } : {}) });
    };
    // 完整原画先就绪，宿主再开始同长计时，首播慢加载也不会截断动作。
    if (['new-year-sheep','soft-orb'].includes(customization.appearance.shape) && ball.whenMotionReady) ball.whenMotionReady().then(acknowledge);
    else acknowledge(true);
  }

  // 只调整此桌宠页面的配置，不改变原项目表情库。
  for (const definition of EmotionBall.config.list()) {
    if (definition.antics) EmotionBall.config.register({ ...definition.raw, antics: false });
  }
  EmotionBall.config.register({
    ...EmotionBall.config.get('02').raw,
    id: '50', name: '安静陪伴', group: 'custom', antics: false,
    anims: []
  });
  const thinkingDefinition = EmotionBall.config.get('30').raw;
  EmotionBall.config.register({
    ...thinkingDefinition,
    id: '51', name: 'Codex 思考', group: 'custom', antics: false,
    body: { ...thinkingDefinition.body, orbit: 0 }
  });
  CompanionMotion.registerEmotions(EmotionBall.config);
  EmotionBall.config.register({
    id: '55', name: '靠边陪伴', group: 'custom', gaze: false, antics: false,
    pool: [0], blinkMs: [2500, 5000], transition: 0, anims: [],
    body: { breathe: 0.007 },
    eyes: { both: { scaleX: 0.78, scaleY: 0.78, y: 20 }, left: { x: 10 }, right: { x: 2 } }
  });
  EmotionBall.config.register({
    id: '56', name: '靠边小憩', group: 'custom', gaze: false, antics: false,
    pool: [0], blinkMs: null, transition: 0, anims: [],
    body: { breathe: 0.006 },
    // 沿用靠边清醒眼环的位置，以闭合度表现睡眠，避免原睡眼环跨出半头。
    // 刚收起时可能还留有上一表情的眨眼关键帧，基础眼形也保持闭合。
    eyes: { both: { open: 0.08, scaleX: 0.78, scaleY: 0.78, y: 24, lookY: 2 }, left: { x: 10 }, right: { x: 2 } }
  });

  function registerIdleAppearance() {
    const preset = PetCustomization.EYE_PRESETS[customization.appearance.idleEyes];
    const source = EmotionBall.config.get('02').raw;
    EmotionBall.config.register({
      ...source, id: '50', name: '安静陪伴', group: 'custom', antics: false, anims: [],
      pool: preset === null
        ? (customization.appearance.shape === 'aurora-cloud' ? [0] : [0, 8])
        : [preset]
    });
  }

  // Keep one interaction controller: imported sprites use its existing motion,
  // drag and Codex ownership rules, while drawing the pet's original frames.
  function createCodexBall(emotionId) {
    let active = true, motion = null, direction = facing || 'right';
    const hasMapped = id => Boolean(codexPet.frameMap?.[id]);
    const emotionAction = id => id === '51' ? 'running' :
      ['00', '56'].includes(id) ? (hasMapped('sleep') ? 'sleep' : 'waiting') : ['03', '10', '52'].includes(id) ? 'wave' :
      id === '53' ? 'jump' : id === '54' ? 'checking' : id === '13' ? `run-${direction}` : 'idle';
    const motionAction = (id, owner) => {
      if (owner === 'codex') return { jelly: 'fail', peek: 'waiting', sway: 'running', hop: 'jump', bow: 'checking' }[id] || 'wave';
      return { hop: 'jump', jelly: 'jump', sway: 'wave', peek: 'waiting', bow: 'checking',
        spin: 'wave', dizzy: 'fail', turn: 'checking', nuzzle: 'wave', land: 'checking', stretch: 'jump' }[id] || 'idle';
    };
    const resize = () => player.setSize(Math.min(window.innerWidth, window.innerHeight || window.innerWidth));
    const player = CodexPetPlayer.create(petElement, {
      descriptor: codexPet, size: Math.min(window.innerWidth, window.innerHeight || window.innerWidth),
      opacity: 1 - customization.appearance.auroraTransparency / 100,
      onFrame(action, frame) {
        petElement.dataset.codexAction = action; petElement.dataset.codexFrame = String(frame);reportSpriteEdgeInk();
      },
      onActionComplete(action) {
        if (uploadedAction === action) { uploadedAction=null;clearAction();player.setAction('idle');restoreState(); }
        if (action === 'wakeup' && !['00', '56'].includes(adapter.emotionId)) player.setAction(emotionAction(adapter.emotionId));
      },
      onError() {
        if (ball !== adapter) return;
        clearAction();
        codexPet = null;
        petElement.dataset.codexPetError = 'load';
        createBall(adapter.emotionId);
        restoreState();
      }
    });
    const syncActive = () => player.pause(!active || (['00', '56'].includes(adapter.emotionId) && !hasMapped('sleep')));
    const adapter = {
      emotionId: emotionId || '50',
      cancelMappedAction() { uploadedAction=null; },
      getInteractionActions() { return CodexPetPlayer.getInteractionActions(codexPet); },
      playUploadedAction(id) { return player.setAction(id, { once: true }); },
      setEmotion(id) {
        uploadedAction=null;
        const waking = ['00', '56'].includes(this.emotionId) && !['00', '56'].includes(id);
        this.emotionId = id; motion = null;
        petElement.dataset.emotion = id;
        player.setAction(waking && hasMapped('wakeup') && !reducedMotion() ? 'wakeup' : emotionAction(id)); syncActive(); return this;
      },
      setMotionAction(id, owner, scene) { motion = id; player.setAction(scene === 'wake' && hasMapped('wakeup') ? 'wakeup' : motionAction(id, owner)); return this; },
      setFacing(side) {
        direction = side === 'left' ? 'left' : 'right';
        if (!motion && this.emotionId === '13') player.setAction(`run-${direction}`);
        return this;
      },
      setDragDirection(delta) { if (delta) player.setAction(delta < 0 ? 'run-left' : 'run-right'); },
      setActive(value) { active = Boolean(value); syncActive(); return this; },
      renderStatic() { player.pause(true); return this; },
      stopMotion() { motion = null; player.setAction(emotionAction(this.emotionId)); return this; },
      // Sprite animations already encode their poses. The host still applies
      // the original window offsets; SVG eye/body transformations do not apply.
      setMotionFrame() { return this; }, setGaze() { return this; }, clearGaze() { return this; },
      spin() { player.setAction('wave'); return this; },
      bounce() { if (!presentationSuppressed) desktop.bounce(); return this; },
      getSpriteCanvas() {return player.element;},
      resize, destroy() { player.destroy(); }
    };
    petElement.dataset.engine = 'codex-pet';
    petElement.dataset.spriteEdgeMirror = String(Boolean(codexPet.frameMap));
    petElement.dataset.codexPetId = codexPet.id;
    petElement.setAttribute('aria-label', `可拖动和互动的${codexPet.name}`);
    adapter.setEmotion(adapter.emotionId);
    adapter.setActive(!presentationPaused && presentationMode !== 'hidden' && !lastSample?.locked);
    return adapter;
  }

  function createBall(emotionId) {
    sheepAutoNap = false; sheepLastNapAt = null; sheepAutomaticWakeUntil = 0;
    sheepLastInteractionAt = performance.now();
    petElement.dataset.autoNap = 'false';
    if (quotaEffects) requestAnimationFrame(syncQuotaEffects);
    const nextCompactMode = window.innerWidth <= 120;
    const previousShape = petElement.dataset.shape;
    const previousSvg = previousShape !== 'aurora-cloud' && customization.appearance.shape === 'aurora-cloud'
      ? petElement.querySelector(':scope > svg') : null;
    officialAurora?.destroy();
    officialAurora = null;
    clickVisual?.destroy();
    clickVisual = null;
    if (ball) ball.destroy();
    petElement.replaceChildren();
    petElement.dataset.shape = customization.appearance.shape;
    syncEdgePeekStyle();
    petElement.dataset.avatarAppearance = JSON.stringify(customization.appearance);
    compactMode = nextCompactMode;
    presentationFrozen = false;
    if (customization.appearance.shape === 'codex-pet' && codexPet?.id === customization.appearance.codexPetId &&
        window.CodexPetPlayer?.validDescriptor(codexPet)) {
      delete petElement.dataset.codexPetError;
      ball = createCodexBall(emotionId);
      return;
    }
    if(customization.appearance.shape==='soft-orb'&&window.SoftOrb){
      ball=window.SoftOrb.create(petElement,{appearance:customization.appearance,label:'小宇桌面宠物'});
      petElement.dataset.engine='soft-orb';
      delete petElement.dataset.codexPetId;delete petElement.dataset.codexAction;delete petElement.dataset.codexFrame;
      petElement.setAttribute('aria-label','可拖动和互动的小宇');
      ball.setEmotion(emotionId||'50');
      ball.setFacing(visualFacing());
      ball.setActive(!presentationPaused&&presentationMode!=='hidden'&&!lastSample?.locked);
      return;
    }
    petElement.dataset.engine = 'emotion-ball';
    delete petElement.dataset.codexPetId;
    delete petElement.dataset.codexAction;
    delete petElement.dataset.codexFrame;
    petElement.setAttribute('aria-label', '可拖动和互动的球球桌面宠物');
    const customShape = window.EB_CUSTOM_SHAPES.createShape(customization.appearance);
    const referenceTexture = PetCustomization.auroraReferenceTexture(customization.appearance, customShape);
    ball = EmotionBall.create(petElement, {
      emotion: emotionId || '50',
      shape: customization.appearance.shape,
      customShape,
      auroraBodyTexture: referenceTexture,
      auroraStyle: customization.appearance.auroraStyle,
      auroraTransparency: customization.appearance.auroraTransparency,
      sheepTheme: customization.appearance.sheepTheme,
      christmasBuddies: true,
      ambientFireworks: true,
      // 桌面球球需要每一帧都用可转动的 SVG 眼睛；素材里的静态白眼只用作外观参考。
      liveAuroraEyes: customization.appearance.shape === 'aurora-cloud',
      auroraTurnRing: customization.appearance.shape === 'aurora-cloud'
        ? PetCustomization.auroraTurnRing : null,
      color: customization.appearance.bodyColor,
      eyeColor: customization.appearance.eyeColor,
      glowPinkColor: customization.appearance.glowPinkColor,
      glowGoldColor: customization.appearance.glowGoldColor,
      eyeSpacing: customization.appearance.eyeSpacing,
      eyeHeight: customization.appearance.eyeHeight,
      idle: false,
      eyeScale: (compactMode && !['cloud', 'aurora-cloud'].includes(customization.appearance.shape) ? 1.5 : 1) *
        customization.appearance.eyeScale,
      lite: compactMode,
      liteRibbons: true,
      fallbackId: '50',
      label: '球球桌面宠物'
    });
    if (customization.appearance.shape !== 'aurora-cloud') {
      const svg = petElement.querySelector(':scope > svg');
      if (svg) svg.style.opacity = (1 - customization.appearance.auroraTransparency / 100).toFixed(2);
    }
    ball.bounce = () => {
      if (!presentationSuppressed) desktop.bounce();
      return ball;
    };
    ball.on('change', ({ id }) => { petElement.dataset.emotion = id; });
    const createdBall = ball;
    ball.on('buddychange', () => { if (ball === createdBall) sheepOffering?.update(); });
    ball.on('motionend', () => {
      if (ball !== createdBall || sheepActionBall !== createdBall) return;
      clearAction(); restoreState(); sheepOffering?.update();
    });
    petElement.dataset.emotion = ball.emotionId;
    if (customization.appearance.shape === 'aurora-cloud' &&
        ['tucked', 'peeked'].includes(presentationMode) && ['left', 'right'].includes(petElement.dataset.edge)) {
      facing = 'right';
    }
    ball.setFacing(visualFacing());
    if (customization.appearance.shape === 'new-year-sheep' && typeof createdBall.whenReady === 'function') {
      createdBall.whenReady().then(() => { if (ball === createdBall) sheepOffering?.update(); });
    }
    if (customization.appearance.shape === 'aurora-cloud') {
      officialAurora = window.AuroraRive?.create(petElement, customization.appearance, referenceTexture) || null;
      if (officialAurora) {
        const next = officialAurora;
        const nextSvg = petElement.querySelector(':scope > svg');
        nextSvg.style.visibility = 'hidden';
        if (previousSvg) {
          previousSvg.style.position = 'absolute';
          previousSvg.style.inset = '0';
          petElement.prepend(previousSvg);
        }
        next.whenReady().then(ready => {
          if (officialAurora !== next) return;
          previousSvg?.remove();
          if (!ready) {
            next.destroy();
            officialAurora = null;
            nextSvg.style.visibility = '';
            clickVisual = window.AuroraClickVisual?.create(petElement) || null;
          }
        });
      } else clickVisual = window.AuroraClickVisual?.create(petElement) || null;
    }
  }

  function showEmotion(id) {
    if (ball.emotionId !== id) ball.setEmotion(id);
  }

  function setBallGaze(gaze) {
    if (gaze) ball.setGaze(gaze.x, gaze.y);
    else ball.clearGaze();
  }

  function clearAction() {
    if(customization.appearance.shape==='soft-orb')softOrbActionEpoch++;
    ball?.cancelMappedAction?.();
    sheepOffering?.cancel(false);
    clearTimeout(actionTimer);
    actionTimer = null;
    actionUntil = 0;
    sheepActionBall = null;
  }

  function stopMotion(notifyHost = true, preserveSheepClip = false) {
    activeMotion = null;
    petElement.dataset.motionOwner = 'none';
    delete petElement.dataset.clickVisual;
    clickVisual?.clear();
    if (!preserveSheepClip || customization.appearance.shape !== 'new-year-sheep') ball.stopMotion();
    if (notifyHost) desktop.stopMotion();
  }

  function cancelPendingInteraction() {
    clearTimeout(singleClickTimer);
    singleClickTimer = null;
    clearTimeout(helloTimer);
    helloTimer = null;
    wakeOnDoubleClick = false;
  }

  function restoreState() {
    if (presentationSuppressed) { syncSuppressedAnimation(); return; }
    if (activeMotion || dragState?.dragged || performance.now() < actionUntil) return;
    // Activity/task snapshots must not briefly restore idle while thinking
    // owns the display: observe() would then restart the mapped running clip.
    if (codexThinking && codexThinkingVisible && codexActiveTaskCount > 0 && canShowCodex()) {
      showEmotion('51');
      return;
    }
    showEmotion(companion.manualSleep || sheepAutoNap ? '00' : currentState.emotionId);
  }

  function syncSuppressedAnimation(refresh = false) {
    const quiet = presentationMode === 'tucked' && !presentationPaused && !lastSample?.locked;
    if (!quiet && presentationFrozen && !refresh) return;
    const sleeping = companion.manualSleep || currentState.mode === 'sleep' || lastSample?.locked;
    const naturalEdge=Boolean(window.EdgePeek?.specFor(customization.appearance.shape));
    const emotion = presentationMode === 'tucked' ? (naturalEdge?(sleeping?'00':'50'):(sleeping ? '56' : '55')) :
      (sleeping ? '00' : currentState.emotionId);
    if (!quiet) ball.setActive(false);
    const emotionChanged = ball.emotionId !== emotion;
    showEmotion(emotion);
    ball.clearGaze();
    petElement.dataset.gaze = '0,0';
    // 保留现有引擎的呼吸和眨眼时间线；125ms活动采样不能重排眨眼。
    if (quiet) {
      if (emotionChanged) ball.renderStatic();
      ball.setActive(true);
    } else ball.renderStatic();
    presentationFrozen = !quiet;
  }

  function playEmotion(id, duration, scene) {
    clearAction();
    actionUntil = performance.now() + duration;
    ball.setEmotion(id);
    if (scene) desktop.say(scene);
    actionTimer = setTimeout(observe(() => {
      actionUntil = 0;
      restoreState();
    }), duration);
  }

  function updatePresentation(packet) {
    if (!packet || !['free', 'tucked', 'peeked', 'hidden'].includes(packet.mode)) return;
    const wasSuppressed = presentationSuppressed;
    presentationMode = packet.mode;
    presentationPaused = packet.paused === true;
    presentationSuppressed = packet.suppressed === true || presentationPaused;
    syncQuotaEffects();
    petElement.dataset.presentation = packet.mode;
    petElement.dataset.edge = packet.side === 'left' || packet.side === 'right' ? packet.side : 'none';
    petElement.dataset.dragging = packet.dragging ? 'true' : 'false';
    // 吸边先改宿主位置，活动采样可能尚未到达；由吸附侧直接确定朝向。
    // 仅在朝向实际改变时更新，隐藏/暂停后的重复报文不能重画冻结帧。
    if (['tucked','peeked'].includes(packet.mode) && ['left', 'right'].includes(packet.side)) {
      const inward = customization.appearance.shape === 'aurora-cloud' ? 'right' :
        packet.side === 'left' ? 'right' : 'left';
      if (facing !== inward || customization.appearance.shape==='soft-orb') {
        facing = inward;
        petElement.dataset.facing = facing;
        ball.setFacing(visualFacing());
      }
    }
    // 普通松手确认可能晚于下一次按下；只有明确恢复或隐藏才作废本地拖动。
    if (dragState && (presentationSuppressed || packet.cancelDrag === true)) {
      if (petElement.hasPointerCapture(dragState.pointerId)) petElement.releasePointerCapture(dragState.pointerId);
      dragState = null;
      petElement.classList.remove('dragging');
    }
    if (presentationSuppressed) {
      clearSheepAutoNap();
      cancelPendingInteraction();
      clearAction();
      stopMotion(false);
      stopCodexThinkingCadence();
      petting.reset();
      syncSuppressedAnimation(true);
    } else {
      presentationFrozen = false;
      ball.setActive(!lastSample?.locked);
      if (wasSuppressed) {
        restoreState();
        if (!activeMotion && !dragState) setBallGaze(!companion.manualSleep ? currentState.gaze : null);
      }
      if (codexEnabled && codexActiveTaskCount > 0 && !codexThinkingTimer) startCodexThinkingCadence();
    }
  }

  function clearSheepAutoNap() {
    sheepAutoNap = false;
    petElement.dataset.autoNap = 'false';
  }

  function wakeSheep(quiet = true) {
    if (customization.appearance.shape !== 'new-year-sheep' || presentationSuppressed || lastSample?.locked) return;
    clearSheepAutoNap();
    cancelPendingInteraction(); clearAction(); stopMotion(false);
    companion.setManualSleep(false, performance.now());
    currentState = { ...currentState, mode: 'awake', emotionId: '50', welcome: false };
    petElement.dataset.mode = 'awake';
    sheepAutomaticWakeUntil = performance.now() + 400;
    lastWorkAttempt = performance.now();
    noteInteraction();
    const theme = SheepTheme.resolveTheme(customization.appearance.sheepTheme, new Date());
    startSheepInteraction(theme === 'none' ? 'stretch' : 'greet', true);
    if (!quiet) desktop.say('wake');
  }

  function wakeSheepAutomaticSleep() {
    if (customization.appearance.shape !== 'new-year-sheep' || presentationSuppressed || lastSample?.locked ||
        (!companion.manualSleep && !sheepAutoNap && currentState.mode !== 'sleep')) return false;
    // All sheep sleep modes share the same quiet hover/click wake and real clip lifecycle.
    wakeSheep();
    return true;
  }

  function resetSheepAmbient(now = performance.now()) {
    nextSheepAmbientAt = customization.appearance.shape === 'new-year-sheep'
      ? now + 45000 + Math.floor(Math.random() * 30001) : 0;
  }

  function maybePlaySheepAmbient(now) {
    if (customization.appearance.shape !== 'new-year-sheep' || !['awake', 'spacing', 'tired'].includes(currentState.mode) || sheepAutoNap ||
        codexActiveTaskCount > 0 || focusQuiet || presentationSuppressed || presentationPaused || lastSample?.locked ||
        companion.manualSleep || dragState || sheepOffering?.isDragging() || singleClickTimer || helloTimer || activeMotion ||
        now < actionUntil || reducedMotion()) {
      resetSheepAmbient(now);
      return false;
    }
    if (!nextSheepAmbientAt) { resetSheepAmbient(now); return false; }
    if (now < nextSheepAmbientAt) return false;
    const mayNap = !petHovered && now - sheepLastInteractionAt >= 300000 &&
      (!companion.keepAwake || (Number.isFinite(lastSample?.idleSeconds) && lastSample.idleSeconds >= 300)) &&
      (sheepLastNapAt === null || (now - sheepLastNapAt >= 600000 && Math.random() < .25));
    if (mayNap) {
      resetSheepAmbient(now); clearAction(); stopMotion(false);
      sheepAutoNap = true; sheepLastNapAt = now; petElement.dataset.autoNap = 'true';
      showEmotion('00');
      return true;
    }
    if (currentState.mode !== 'awake') { resetSheepAmbient(now); return false; }
    const theme = SheepTheme.resolveTheme(customization.appearance.sheepTheme, new Date());
    const pools = {
      none: ['ear', 'bell', 'stretch', 'joy'],
      halloween: ['magic', 'joy', 'greet'],
      christmas: ['scarf', 'snow', 'joy'],
      'spring-festival': ['fortune', 'greet', 'joy']
    };
    const actions = pools[theme].filter(action => action !== lastSheepAmbient && SheepSkin.supportsAction(action, theme));
    resetSheepAmbient(now);
    const action = actions[Math.floor(Math.random() * actions.length)];
    if (!action) return false;
    lastSheepAmbient = action;
    // A quiet automatic gesture must not count as human activity or prevent natural sleep.
    runCommand({ command: 'sheep-action', action, ambient: true });
    return true;
  }

  function playUploadedInteraction() {
    if (customization.appearance.shape !== 'codex-pet' || !ball.getInteractionActions || reducedMotion() ||
        presentationSuppressed || presentationPaused || presentationMode !== 'free' || lastSample?.locked || lastSample?.chatVisible ||
        companion.manualSleep || dragState || focusQuiet || codexActiveTaskCount || activeMotion?.owner === 'codex') return false;
    const available = ball.getInteractionActions();
    const choices = available.filter(id => id !== lastUploadedAction);
    const pool = choices.length ? choices : available;
    if (!pool.length) return false;
    cancelPendingInteraction(); clearAction(); stopMotion();
    const id = pool[Math.min(pool.length - 1, Math.floor(Math.random() * pool.length))];
    uploadedAction = id; actionUntil = Number.POSITIVE_INFINITY;
    if (!ball.playUploadedAction(id)) { clearAction(); return false; }
    lastUploadedAction = id; return true;
  }

  function updateActivity(sample) {
    const previouslyLocked = lastSample?.locked === true;
    lastSample = sample;
    syncFacing();
    const now = performance.now();
    const previousMode = currentState.mode;
    currentState = companion.update(sample, now);
    if (uploadedAction && (reducedMotion() || sample.locked || sample.chatVisible || presentationSuppressed || presentationPaused || focusQuiet || companion.manualSleep || currentState.mode === 'sleep')) { clearAction(); ball.stopMotion(); }
    if (sample.locked || presentationSuppressed || presentationPaused || focusQuiet || codexActiveTaskCount > 0) clearSheepAutoNap();
    if (sheepAutoNap && companion.keepAwake && !companion.manualSleep &&
        Number.isFinite(sample.idleSeconds) && sample.idleSeconds >= 0 && sample.idleSeconds <= 2) wakeSheepAutomaticSleep();
    petElement.dataset.mode = companion.manualSleep ? 'manual-sleep' : currentState.mode;
    maybePlaySheepAmbient(now);
    if (presentationSuppressed) {
      syncSuppressedAnimation();
      return;
    }
    if (sample.locked) {
      if (previouslyLocked) return;
      cancelPendingInteraction();
      clearAction();
      stopMotion();
      if (dragState) {
        if (petElement.hasPointerCapture(dragState.pointerId)) petElement.releasePointerCapture(dragState.pointerId);
        dragState = null;
        petElement.classList.remove('dragging');
        desktop.endDrag();
      }
      showEmotion('00');
      ball.clearGaze();
      petElement.dataset.gaze = '0,0';
      ball.setActive(false);
      ball.renderStatic();
      return;
    }
    ball.setActive(true);
    if (currentState.mode === 'sleep' && previousMode !== 'sleep') {
      cancelPendingInteraction();
      clearAction();
      stopMotion();
    }
    if (!sheepAutoNap && !focusQuiet && currentState.welcome && !sheepOffering?.isDragging() && !petHovered && !wakeOnDoubleClick && !activeMotion && !dragState?.dragged && now >= actionUntil) {
      playCompanionReaction('stretch', 'wake');
    } else {
      restoreState();
    }
    if (customization.appearance.shape !== 'new-year-sheep' && !focusQuiet && currentState.mode === 'sleep' && previousMode !== 'sleep' && !companion.manualSleep) {
      desktop.say('sleep');
    }
    if (activeMotion) return;
    if (!dragState?.dragged && !companion.manualSleep && currentState.gaze) {
      setBallGaze(currentState.gaze);
      petElement.dataset.gaze = `${currentState.gaze.x.toFixed(2)},${currentState.gaze.y.toFixed(2)}`;
    } else {
      setBallGaze(null);
      petElement.dataset.gaze = '0,0';
    }
    if (!sheepAutoNap && !focusQuiet && !companion.manualSleep && ['awake', 'focus'].includes(currentState.mode) &&
        now - lastWorkAttempt >= 60000 && !activeMotion && !dragState && !sheepOffering?.isDragging() && now >= actionUntil) {
      lastWorkAttempt = now;
      desktop.say('work');
    }
  }

  function noteInteraction() {
    clearSheepAutoNap();
    sheepLastInteractionAt = performance.now();
    resetSheepAmbient();
    companion.noteInteraction(performance.now());
    if (lastSample) updateActivity(lastSample);
  }

  function wake() {
    if (customization.appearance.shape === 'new-year-sheep') { wakeSheep(false); return; }
    clearSheepAutoNap();
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    companion.setManualSleep(false, performance.now());
    currentState = { ...currentState, mode: 'awake', emotionId: '50' };
    petElement.dataset.mode = 'awake';
    if (customization.appearance.shape === 'codex-pet' && ball.getInteractionActions) { ball.setActive(true); ball.setEmotion('50'); }
    else playCompanionReaction('stretch', 'wake');
  }

  function sleep() {
    clearSheepAutoNap();
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    petting.reset();
    companion.setManualSleep(true, performance.now());
    petElement.dataset.mode = 'manual-sleep';
    ball.clearGaze();
    showEmotion('00');
    desktop.say('sleep');
  }

  function runDoubleClickAction() {
    if (wakeSheepAutomaticSleep() || (customization.appearance.shape === 'new-year-sheep' && performance.now() < sheepAutomaticWakeUntil)) return;
    const shouldWake = wakeOnDoubleClick || companion.manualSleep || ball.emotionId === '00';
    cancelPendingInteraction();
    if (presentationSuppressed || lastSample?.locked) return;
    if (shouldWake) {
      wake();
      return;
    }
    if (customization.appearance.shape === 'new-year-sheep') {
      runSingleClickAction();
      return;
    }
    const motion = InteractionMotion.chooseMotion(Math.random(), lastDoubleMotion);
    lastDoubleMotion = motion.id;
    playReaction(motion.id);
  }

  function playReaction(action, speak = true, withinSequence = false) {
    const motion = InteractionMotion.getMotion(action);
    if (!motion || presentationSuppressed || lastSample?.locked || companion.manualSleep) return;
    if(customization.appearance.shape==='soft-orb'){startSoftOrbInteraction(window.SoftOrbModel.actionForMotion(action,'user'));if(speak)desktop.say({event:'play',motion:action});return;}
    cancelPendingInteraction();
    clearAction();
    stopMotion(!withinSequence, true);
    noteInteraction();
    activeMotion = { token: ++nextMotionToken, action, owner: 'user', side: facing || 'right' };
    petElement.dataset.motionOwner = 'user';
    if (customization.appearance.shape !== 'new-year-sheep') ball.setEmotion(motion.emotion);
    ball.setMotionAction?.(action, 'user');
    const firstFrame = InteractionMotion.sampleMotion(action, 0);
    ball.setMotionFrame(firstFrame);
    if (action === 'dizzy' || action === 'turn') {
      petElement.dataset.clickVisual = action;
      clickVisual?.set(action, 0, firstFrame, facing || 'right');
    }
    petElement.dataset.lastAction = action;
    desktop.playMotion({ ...activeMotion });
    if (speak) desktop.say({ event: 'play', motion: action });
  }

  function playCompanionReaction(action, scene) {
    if (customization.appearance.shape === 'new-year-sheep' && scene === 'wake') { wakeSheep(false); return; }
    const motion = CompanionMotion.getMotion(action);
    if (!motion || presentationSuppressed || lastSample?.locked || companion.manualSleep) return;
    if(customization.appearance.shape==='soft-orb'){startSoftOrbInteraction(window.SoftOrbModel.actionForMotion(action,'user'));if(scene)desktop.say(scene);return;}
    cancelPendingInteraction();
    clearAction();
    stopMotion(true, true);
    syncFacing();
    activeMotion = { token: ++nextMotionToken, action, owner: 'user', side: facing || 'right' };
    petElement.dataset.motionOwner = 'user';
    petElement.dataset.lastAction = action;
    if (customization.appearance.shape !== 'new-year-sheep') ball.setEmotion(reducedMotion() ? '50' : motion.emotion);
    if (!reducedMotion()) ball.setMotionAction?.(action, 'user', scene);
    ball.setMotionFrame(reducedMotion() ? CompanionMotion.neutralFrame() : CompanionMotion.sample(action, 0, activeMotion.side));
    desktop.playMotion({ ...activeMotion, reducedMotion: reducedMotion() });
    if (scene) desktop.say(scene);
  }

  function onMotion(packet) {
    if (!activeMotion || !packet || packet.token !== activeMotion.token ||
        packet.action !== activeMotion.action || !packet.frame) return;
    if (packet.side === 'left' || packet.side === 'right') {
      facing = packet.side;
      petElement.dataset.facing = facing;
      ball.setFacing(visualFacing());
    }
    if (packet.frame.done === true) {
      const finishedOwner = activeMotion.owner;
      activeMotion = null;
      petElement.dataset.motionOwner = 'none';
      delete petElement.dataset.clickVisual;
      clickVisual?.clear();
      if (customization.appearance.shape === 'new-year-sheep') {
        // Clear ownership and restore emotion in one selection; never briefly re-enter stale working art.
        ball.setEmotion(companion.manualSleep || sheepAutoNap ? '00' : currentState.emotionId);
      } else ball.stopMotion();
      restoreState();
      if (finishedOwner === 'codex' && codexEnabled && codexActiveTaskCount > 0) {
        startCodexThinkingCadence();
      }
    } else {
      ball.setMotionFrame(packet.frame);
      if (packet.action === 'dizzy' || packet.action === 'turn') {
        clickVisual?.set(packet.action, packet.frame.progress || 0, packet.frame, facing || 'right');
      }
    }
  }

  function runSingleClickAction(speak = true) {
    if (presentationSuppressed || lastSample?.locked) return;
    if (wakeSheepAutomaticSleep() || (customization.appearance.shape === 'new-year-sheep' && performance.now() < sheepAutomaticWakeUntil)) return;
    if (customization.appearance.shape === 'codex-pet' && ball.getInteractionActions && (companion.manualSleep || currentState.mode === 'sleep')) { wake(); return; }
    if (companion.manualSleep) return;
    if (activeMotion) stopMotion(true, true);
    noteInteraction();
    if (speak && !focusQuiet && codexEnabled && codexActiveTaskCount > 0) {
      clearAction();
      startCodexThinkingCadence();
      desktop.say('thought');
      petElement.dataset.lastAction = 'thought';
      return;
    }
    if (customization.appearance.shape === 'new-year-sheep') {
      const theme = SheepTheme.resolveTheme(customization.appearance.sheepTheme, new Date());
      const actions = Object.keys(SheepSkin.getActions(theme)).filter(action =>
        !['walk', 'sleep', 'working', 'complete', 'receive-gift'].includes(action));
      const previous = actions.indexOf(lastSheepClick);
      const action = actions[previous < 0 ? Math.floor(Math.random() * actions.length) : (previous + 1) % actions.length];
      lastSheepClick = action;
      if (!startSheepInteraction(action, false, true)) return;
      petElement.dataset.lastAction = action;
      if (speak) desktop.say({ event: 'play', sheepAction: action });
      return;
    }
    if(customization.appearance.shape==='soft-orb'){startSoftOrbInteraction('fan');return;}
    if (customization.appearance.shape === 'codex-pet' && ball.getInteractionActions) { if (playUploadedInteraction() && speak) desktop.say('play'); return; }
    if (officialAurora?.click()) {
      petElement.dataset.lastAction = 'official';
      return;
    }
    if (customization.appearance.shape === 'aurora-cloud' && !reducedMotion()) {
      const action = lastAuroraClick === 'dizzy' ? 'turn' : 'dizzy';
      lastAuroraClick = action;
      playReaction(action, false);
      return;
    }
    playEmotion('10', 3200, speak ? 'play' : null);
    const action = PetBehavior.chooseClickAction(Math.random());
    petElement.dataset.lastAction = action;
    if (action === 'bounce') ball.bounce();
    else if (action === 'spin') ball.spin(1);
  }

  function scheduleSingleClick() {
    clearTimeout(singleClickTimer);
    singleClickTimer = setTimeout(observe(() => {
      singleClickTimer = null;
      wakeOnDoubleClick = false;
      runSingleClickAction();
    }), 260);
  }

  function runBuddyClick(buddy) {
    const action = { reindeer: 'greet', tree: 'joy', santa: 'gift', snowman: 'snow' }[buddy];
    if (!action || SheepTheme.resolveTheme(customization.appearance.sheepTheme, new Date()) !== 'christmas' ||
        focusQuiet || (codexEnabled && codexActiveTaskCount > 0) || !startSheepInteraction(action)) return false;
    petElement.dataset.lastAction = `buddy:${buddy}`;
    desktop.say({ event: 'play', sheepAction: action });
    return true;
  }

  function runRandomEmotion() {
    cancelPendingInteraction();
    stopMotion();
    companion.setManualSleep(false, performance.now());
    if(customization.appearance.shape==='soft-orb'){const actions=['draw','fan','flip','scan','beam','shock','flight','ship','love','complete'];startSoftOrbInteraction(actions[Math.floor(Math.random()*actions.length)]);return;}
    if (customization.appearance.shape === 'codex-pet' && ball.getInteractionActions) {
      clearAction(); currentState = { ...currentState, mode: 'awake', emotionId: '50', welcome: false };
      petElement.dataset.mode = 'awake'; ball.setActive(true); ball.setEmotion('50');
      playUploadedInteraction(); return;
    }
    const definitions = EmotionBall.config.list().filter(definition => !['55', '56'].includes(definition.id));
    const selected = definitions[Math.floor(Math.random() * definitions.length)];
    if (selected) playEmotion(selected.id, 5000);
  }

  function startSheepInteraction(action, ambient = false, clicked = false) {
    if (customization.appearance.shape !== 'new-year-sheep' || presentationSuppressed || lastSample?.locked || companion.manualSleep ||
        !SheepSkin.supportsAction(action, SheepTheme.resolveTheme(customization.appearance.sheepTheme, new Date()))) return false;
    cancelPendingInteraction(); clearAction(); stopMotion(true, true);
    sheepActionBall = ball;
    actionUntil = Number.POSITIVE_INFINITY;
    if (!ambient) noteInteraction();
    ball.setMotionAction(action);
    if (clicked) {
      const receiver = ball;
      receiver.whenMotionReady?.().then(ready => {
        if (ready === true && ball === receiver && sheepActionBall === receiver) receiver.notifySuccessfulClick?.();
      });
    }
    return true;
  }

  function startSoftOrbInteraction(action){
    const duration=window.SoftOrbModel?.duration(action);
    if(customization.appearance.shape!=='soft-orb'||!duration||presentationSuppressed||lastSample?.locked||companion.manualSleep)return false;
    cancelPendingInteraction();clearAction();stopMotion();noteInteraction();
    const receiver=ball,epoch=++softOrbActionEpoch;
    actionUntil=Number.POSITIVE_INFINITY;petElement.dataset.lastAction=action;
    receiver.whenMotionReady().then(ready=>{
      if(receiver!==ball||epoch!==softOrbActionEpoch)return;
      if(!ready||presentationSuppressed||lastSample?.locked||companion.manualSleep){clearAction();restoreState();return;}
      actionUntil=performance.now()+duration;receiver.playAction(action);
      actionTimer=setTimeout(observe(()=>{actionUntil=0;receiver.stopMotion();restoreState();}),duration);
      syncCodexWorking();reportCodexAvailability();
    });
    return true;
  }

  function runCommand(command) {
    if (command?.command === 'codex-cancel') { cancelCodex(command); return; }
    if (command?.command === 'codex') { startCodex(command); return; }
    if (command === 'stop') {
      cancelPendingInteraction();
      clearAction();
      stopMotion(false);
      restoreState();
      return;
    }
    if (presentationSuppressed || lastSample?.locked) return;
    if (command?.command === 'soft-orb-action') { startSoftOrbInteraction(command.action); return; }
    if (command?.command === 'sheep-offer') { sheepOffering?.offer(command.kind); return; }
    if (command?.command === 'sheep-action') { startSheepInteraction(command.action, command.ambient === true); return; }
    if (command?.command === 'again') playReaction(command.motion, false);
    else if (command === 'random') runRandomEmotion();
    else if (command === 'sleep') sleep();
    else if (command === 'wake') wake();
    else if (command === 'again') {
      cancelPendingInteraction();
      stopMotion();
      runSingleClickAction(false);
    }
    else if (command === 'rest') {
      cancelPendingInteraction();
      clearAction();
      stopMotion();
      noteInteraction();
      restoreState();
      petElement.dataset.lastAction = 'rest';
    }
  }

  function sheepOfferingState() {
    const ownReceipt = sheepOffering?.isPlaying() && sheepActionBall === ball;
    const drawn = petElement.querySelector?.('canvas.sheep-skin');
    const settled = !drawn || (drawn.dataset.action === 'idle' && drawn.dataset.ready === 'true' && !drawn.dataset.transition);
    const available = customization.appearance.shape === 'new-year-sheep' && !document.hidden &&
      presentationMode === 'free' && !presentationSuppressed && !presentationPaused &&
      !lastSample?.locked && !focusQuiet && codexActiveTaskCount === 0 && !companion.manualSleep &&
      !sheepAutoNap && !['sleep', 'focus'].includes(currentState.mode) && !activeMotion && !dragState && !singleClickTimer;
    const idleReady = settled && !sheepActionBall && performance.now() >= actionUntil;
    return {
      theme: customization.appearance.shape === 'new-year-sheep'
        ? SheepTheme.resolveTheme(customization.appearance.sheepTheme, new Date()) : 'none',
      ink: window.SheepOffering?.measureInk?.(petElement) || null,
      settled,
      hideSource: false,
      transient: available && !ownReceipt && !idleReady,
      eligible: available && (ownReceipt || idleReady)
    };
  }

  function playSheepOffering(kind) {
    const state = sheepOfferingState();
    if (!state.eligible || (kind === 'candy' ? state.theme !== 'halloween' : kind !== 'gift' || state.theme !== 'christmas')) return false;
    const action = kind === 'candy' ? 'candy' : 'receive-gift';
    runCommand({ command: 'sheep-action', action });
    const receiver = ball;
    receiver.whenMotionReady?.().then(ready => {
      if (ready === false && receiver === ball && sheepActionBall === receiver) {
        clearAction(); restoreState(); sheepOffering?.update();
      }
    });
    return sheepActionBall === receiver;
  }

  function eventPoint(event) {
    return { x: event.screenX, y: event.screenY };
  }

  onPet('pointerdown', event => {
    if (event.button !== 0 || presentationSuppressed || lastSample?.locked) return;
    const wokeSheep = wakeSheepAutomaticSleep() ||
      (customization.appearance.shape === 'new-year-sheep' && performance.now() < sheepAutomaticWakeUntil);
    // 第一次松手会刷新系统空闲状态；保留本次双击最初是否睡着。
    const startedSleeping = companion.manualSleep || ball.emotionId === '00' || (singleClickTimer && wakeOnDoubleClick);
    cancelPendingInteraction();
    wakeOnDoubleClick = Boolean(startedSleeping);
    // A click immediately following hover belongs to the same wake, not a new action cancellation.
    if (!wokeSheep) { clearAction(); stopMotion(); }
    petting.reset();
    const point = eventPoint(event);
    dragState = {
      pointerId: event.pointerId,
      start: point,
      dragged: false,
      wokeSheep,
      lastX: point.x
    };
    petElement.setPointerCapture(event.pointerId);
    desktop.beginDrag(point);
  });

  onPet('pointermove', event => {
    if (presentationSuppressed || lastSample?.locked) return;
    const rect = petElement.getBoundingClientRect();
    if (!companion.manualSleep && !activeMotion) {
      if (!dragState && petting.update({
        x: event.clientX, y: event.clientY,
        width: rect.width, height: rect.height, buttons: event.buttons
      }, performance.now())) {
        clearTimeout(helloTimer);
        helloTimer = null;
        noteInteraction();
        playCompanionReaction('nuzzle', 'pet');
      }
    }

    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const point = eventPoint(event);
    if (!dragState.dragged) {
      dragState.dragged = PetBehavior.isDrag(dragState.start, point);
      if (dragState.dragged) {
        petElement.classList.add('dragging');
        clearAction();
        stopMotion();
        if (!companion.manualSleep) {
          noteInteraction();
          showEmotion('13');
          desktop.say('drag');
        }
      }
    }
    if (dragState.dragged) {
      ball.setDragDirection?.(point.x - dragState.lastX);
      petElement.style.setProperty('--drag-tilt', `${Math.max(-5, Math.min(5, (point.x - dragState.lastX) * .4))}deg`);
      dragState.lastX = point.x;
      desktop.dragTo(point);
    }
  });

  function finishPointer(event, cancelled) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const wasDragged = dragState.dragged;
    const wokeSheep = dragState.wokeSheep;
    dragState = null;
    petElement.classList.remove('dragging');
    if (petElement.hasPointerCapture(event.pointerId)) {
      petElement.releasePointerCapture(event.pointerId);
    }
    desktop.endDrag();
    noteInteraction();
    if (wasDragged && !companion.manualSleep) {
      if (!cancelled) playCompanionReaction('land', 'drop');
      else restoreState();
    }
    if (!cancelled && !wasDragged && !wokeSheep && event.button === 0) {
      const buddy = ball.hitBuddy?.(event.clientX, event.clientY);
      if (buddy === 'gift') sheepOffering?.offer('gift');
      else if (!runBuddyClick(buddy)) scheduleSingleClick();
    }
  }

  onPet('pointerup', event => finishPointer(event, false));
  onPet('pointercancel', event => finishPointer(event, true));

  onPet('dblclick', event => {
    if (event.button !== 0) return;
    if (ball.hitBuddy?.(event.clientX, event.clientY) || sheepOffering?.isPlaying()) return;
    runDoubleClickAction();
  });

  onPet('pointerenter', () => {
    petHovered = true;
    if (wakeSheepAutomaticSleep()) return;
    if (presentationSuppressed || companion.manualSleep || lastSample?.locked || activeMotion || sheepOffering?.blocksHover() ||
        (customization.appearance.shape === 'new-year-sheep' && codexEnabled && codexActiveTaskCount > 0)) return;
    noteInteraction();
    clearTimeout(helloTimer);
    helloTimer = setTimeout(observe(() => {
      helloTimer = null;
      if (companion.manualSleep || lastSample?.locked || activeMotion || dragState || performance.now() < actionUntil) return;
      playEmotion('03', 2200, 'hello');
    }), 900);
  });

  onPet('pointerleave', () => {
    petHovered = false;
    clearTimeout(helloTimer);
    helloTimer = null;
    petting.reset();
  });

  onPet('contextmenu', event => {
    event.preventDefault();
    // Opening the seasonal offering menu is deliberate interaction, not a delayed hover greeting.
    if (customization.appearance.shape === 'new-year-sheep' &&
        ['halloween', 'christmas'].includes(SheepTheme.resolveTheme(customization.appearance.sheepTheme, new Date()))) cancelPendingInteraction();
    desktop.showContextMenu();
  });

  onWindow('resize', () => {
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    const shouldBeCompact = window.innerWidth <= 120;
    if (shouldBeCompact !== compactMode && customization.appearance.shape !== 'codex-pet') createBall(ball.emotionId);
    else { compactMode = shouldBeCompact; ball.resize?.(); }
    restoreState();
    if (presentationSuppressed) syncSuppressedAnimation(true);
    sheepOffering?.update();
  });

  onWindow('beforeunload', () => {
    rendererUnloading = true;
    clearSheepAutoNap(); sheepLastNapAt = null; sheepAutomaticWakeUntil = 0;
    sheepOffering?.destroy();
    quotaEffects?.destroy();
    weatherEffects?.destroy();
    codexEnabled = false;
    stopCodexThinkingCadence();
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    listeners.forEach(remove => remove());
    officialAurora?.destroy();
    clickVisual?.destroy();
    if (ball) ball.destroy();
  });

  createBall('50');
  sheepOffering = window.SheepOffering?.create({ target: petElement, getState: sheepOfferingState,
    onReceive: playSheepOffering, onInteract: noteInteraction,
    external: desktop.updateOffering && desktop.onOfferingPointer ? {update:desktop.updateOffering,onPointer:desktop.onOfferingPointer} : null,
    onApproach() { clearTimeout(helloTimer); helloTimer = null; },
    onCancel() { clearAction(); stopMotion(); restoreState(); }
  }) || null;
  petElement.dataset.mode = 'awake';
  petElement.dataset.presentation = 'free';
  petElement.dataset.edge = 'none';
  petElement.dataset.dragging = 'false';
  petElement.dataset.motionOwner = 'none';
  petElement.dataset.codexWorking = 'false';
  petElement.dataset.codexActiveTasks = '0';
  petElement.dataset.codexThoughtSide = 'right';
  if (desktop.onPresentation) listeners.push(desktop.onPresentation(observe(updatePresentation)));
  if (desktop.onWeather) listeners.push(desktop.onWeather(packet => weatherEffects?.update(packet)));
  if (desktop.onQuota) listeners.push(desktop.onQuota(observe(packet => {
    quotaPacket = packet || { visible: false };
    syncQuotaEffects();
  })));
  // color-mode.js resolves the app preference on the same event. Draw after
  // all its listeners have updated the root, including system appearance.
  const refreshQuotaTheme = () => requestAnimationFrame(syncQuotaEffects);
  if (desktop.onColorMode) listeners.push(desktop.onColorMode(refreshQuotaTheme));
  const quotaSystemAppearance = window.matchMedia?.('(prefers-color-scheme: dark)');
  quotaSystemAppearance?.addEventListener?.('change', refreshQuotaTheme);
  listeners.push(() => quotaSystemAppearance?.removeEventListener?.('change', refreshQuotaTheme));
  listeners.push(desktop.onCommand(observe(runCommand)));
  listeners.push(desktop.onMotion(observe(onMotion)));
  listeners.push(desktop.onActivity(observe(updateActivity)));
  listeners.push(desktop.onSettings(observe(settings => {
    const wasQuiet = focusQuiet;
    focusQuiet = settings.focusQuiet === true;
    petElement.dataset.focusQuiet = String(focusQuiet);
    if (focusQuiet) { clearSheepAutoNap(); stopCodexThinkingCadence(); }
    else if (wasQuiet && codexEnabled && codexActiveTaskCount > 0) startCodexThinkingCadence();
    quotaPacket.config = settings.quotaDisplay || quotaPacket.config;
    const next = PetCustomization.normalizeCustomization(settings.customization);
    const nextPet = next.appearance.shape === 'codex-pet' && settings.codexPet?.id === next.appearance.codexPetId &&
      window.CodexPetPlayer?.validDescriptor(settings.codexPet) ? settings.codexPet : null;
    if (JSON.stringify(customization.appearance) !== JSON.stringify(next.appearance) ||
        JSON.stringify(codexPet) !== JSON.stringify(nextPet)) {
      cancelPendingInteraction(); clearAction();
      stopMotion();
      codexPet = nextPet;
      customization = next;
      registerIdleAppearance();
      createBall(ball.emotionId);
    } else customization = next;
    syncQuotaEffects();
    companion.setKeepAwake(settings.keepAwake);
    resetSheepAmbient();
    if (lastSample) updateActivity(lastSample);
  })));
  listeners.push(desktop.onCodexSettings(observe(settings => {
    if (!Number.isSafeInteger(settings?.generation) || settings.generation < codexGeneration ||
      !Number.isSafeInteger(settings.pageEpoch) || settings.pageEpoch <= 0 || settings.pageEpoch < codexPageEpoch ||
      typeof settings.enabled !== 'boolean') return;
    const changed = settings.generation !== codexGeneration || settings.pageEpoch !== codexPageEpoch;
    const wasActive = codexEnabled && codexActiveTaskCount > 0;
    if (changed || !settings.enabled) cancelCodex();
    if (changed) lastCodexAlertId = 0;
    lastAvailability = null;
    codexGeneration = settings.generation;
    codexPageEpoch = settings.pageEpoch;
    codexEnabled = settings.enabled;
    codexActiveTaskCount = Number.isSafeInteger(settings.activeTaskCount) && settings.activeTaskCount >= 0 &&
      settings.activeTaskCount <= 64 ? settings.activeTaskCount : 0;
    const isActive = codexEnabled && codexActiveTaskCount > 0;
    if (isActive) { clearSheepAutoNap(); restoreState(); }
    if (!isActive || presentationSuppressed) stopCodexThinkingCadence();
    else if (changed || !wasActive) startCodexThinkingCadence();
  })));
  window.__petReady = true;
  reportSleepState();
})();
