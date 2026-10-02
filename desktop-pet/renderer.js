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
  let clickVisual = null;
  let officialAurora = null;
  let lastAuroraClick = null;
  let customization = PetCustomization.normalizeCustomization();
  let presentationSuppressed = false;
  let presentationMode = 'free';
  let presentationPaused = false;
  let presentationFrozen = false;
  let compactMode = null;
  let dragState = null;
  let singleClickTimer = null;
  let wakeOnDoubleClick = false;
  let helloTimer = null;
  let actionTimer = null;
  let actionUntil = 0;
  let lastWorkAttempt = 0;
  let lastSample = null;
  let currentState = { mode: 'awake', emotionId: '50', gaze: null };
  let activeMotion = null;
  let nextMotionToken = 0;
  let lastDoubleMotion = null;
  let codexEnabled = false;
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
    facing = auroraAtEdge ? 'right' : PetFacing.resolve(lastSample?.petBounds, lastSample?.workArea, facing);
    petElement.dataset.facing = facing;
    ball?.setFacing(visualFacing());
  }

  function syncThought(visible, side) {
    const signature = visible ? `${side}:${reducedMotion()}` : '';
    if (signature === thoughtSignature) return;
    thoughtSignature = signature;
    desktop.thought?.({ visible, side, reducedMotion: reducedMotion() });
  }

  function canShowCodex() {
    return !presentationSuppressed && codexEnabled && Boolean(lastSample) && !lastSample.locked && !companion.manualSleep &&
      currentState.mode !== 'sleep' && !dragState && !singleClickTimer && !helloTimer &&
      performance.now() >= actionUntil && !activeMotion;
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
      if (!codexEnabled || codexActiveTaskCount <= 0) return;
      codexThinkingVisible = visible;
      syncCodexWorking();
      scheduleCodexThinkingPhase(!visible,
        visible ? CODEX_THINKING_BURST_MS : thinkingRestMs());
    }, delay);
  }

  function startCodexThinkingCadence() {
    stopCodexThinkingCadence();
    codexThinkingVisible = true;
    scheduleCodexThinkingPhase(false, CODEX_THINKING_BURST_MS);
  }

  function syncCodexWorking() {
    const eligible = !presentationSuppressed && codexEnabled && codexActiveTaskCount > 0 && Boolean(lastSample) && !lastSample.locked &&
      !companion.manualSleep && currentState.mode !== 'sleep' && !dragState && !singleClickTimer && !helloTimer &&
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

  function observe(callback) {
    return (...args) => {
      try { return callback(...args); }
      finally { syncCodexWorking(); reportCodexAvailability(); }
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
    ball.setEmotion(motion.emotion);
    ball.setMotionFrame(InteractionMotion.sampleMotion(motion.id, 0));
    petElement.dataset.lastAction = motion.id;
    // 只准备本地姿态。宿主复核提醒和所有权后才开始移动窗口、显示气泡。
    desktop.codexMotionReady({ token: activeMotion.token, action: motion.id,
      alertId: request.alertId, generation: request.generation, pageEpoch: request.pageEpoch });
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
    pool: [13], blinkMs: null, transition: 0, anims: [],
    body: { breathe: 0.006 },
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

  function createBall(emotionId) {
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
    petElement.dataset.avatarAppearance = JSON.stringify(customization.appearance);
    compactMode = nextCompactMode;
    presentationFrozen = false;
    const customShape = window.EB_CUSTOM_SHAPES.createShape(customization.appearance);
    const referenceTexture = PetCustomization.auroraReferenceTexture(customization.appearance, customShape);
    ball = EmotionBall.create(petElement, {
      emotion: emotionId || '50',
      shape: customization.appearance.shape,
      customShape,
      auroraBodyTexture: referenceTexture,
      auroraStyle: customization.appearance.auroraStyle,
      auroraTransparency: customization.appearance.auroraTransparency,
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
    petElement.dataset.emotion = ball.emotionId;
    if (customization.appearance.shape === 'aurora-cloud' &&
        ['tucked', 'peeked'].includes(presentationMode) && ['left', 'right'].includes(petElement.dataset.edge)) {
      facing = 'right';
    }
    ball.setFacing(visualFacing());
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
    clearTimeout(actionTimer);
    actionTimer = null;
    actionUntil = 0;
  }

  function stopMotion(notifyHost = true) {
    activeMotion = null;
    petElement.dataset.motionOwner = 'none';
    delete petElement.dataset.clickVisual;
    clickVisual?.clear();
    ball.stopMotion();
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
    showEmotion(companion.manualSleep ? '00' : currentState.emotionId);
  }

  function syncSuppressedAnimation(refresh = false) {
    const quiet = presentationMode === 'tucked' && !presentationPaused && !lastSample?.locked;
    if (!quiet && presentationFrozen && !refresh) return;
    const sleeping = companion.manualSleep || currentState.mode === 'sleep' || lastSample?.locked;
    const emotion = presentationMode === 'tucked' ? (sleeping ? '56' : '55') :
      (sleeping ? '00' : currentState.emotionId);
    if (!quiet) ball.setActive(false);
    showEmotion(emotion);
    ball.clearGaze();
    petElement.dataset.gaze = '0,0';
    // 保留现有引擎的呼吸和眨眼时间线；125ms活动采样不能重排眨眼。
    if (quiet) ball.setActive(true);
    else ball.renderStatic();
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
    petElement.dataset.presentation = packet.mode;
    petElement.dataset.edge = packet.side === 'left' || packet.side === 'right' ? packet.side : 'none';
    petElement.dataset.dragging = packet.dragging ? 'true' : 'false';
    // 吸边先改宿主位置，活动采样可能尚未到达；由吸附侧直接确定朝向。
    // 仅在朝向实际改变时更新，隐藏/暂停后的重复报文不能重画冻结帧。
    if (packet.mode === 'tucked' && ['left', 'right'].includes(packet.side)) {
      const inward = customization.appearance.shape === 'aurora-cloud'
        ? 'right' : packet.side === 'left' ? 'right' : 'left';
      if (facing !== inward) {
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

  function updateActivity(sample) {
    const previouslyLocked = lastSample?.locked === true;
    lastSample = sample;
    syncFacing();
    const now = performance.now();
    const previousMode = currentState.mode;
    currentState = companion.update(sample, now);
    petElement.dataset.mode = companion.manualSleep ? 'manual-sleep' : currentState.mode;
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
    if (currentState.welcome && !wakeOnDoubleClick && !activeMotion && !dragState?.dragged && now >= actionUntil) {
      playCompanionReaction('stretch', 'wake');
    } else {
      restoreState();
    }
    if (currentState.mode === 'sleep' && previousMode !== 'sleep' && !companion.manualSleep) {
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
    if (!companion.manualSleep && ['awake', 'focus'].includes(currentState.mode) &&
        now - lastWorkAttempt >= 60000 && !activeMotion && !dragState && now >= actionUntil) {
      lastWorkAttempt = now;
      desktop.say('work');
    }
  }

  function noteInteraction() {
    companion.noteInteraction(performance.now());
    if (lastSample) updateActivity(lastSample);
  }

  function wake() {
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    companion.setManualSleep(false, performance.now());
    currentState = { ...currentState, mode: 'awake', emotionId: '50' };
    petElement.dataset.mode = 'awake';
    playCompanionReaction('stretch', 'wake');
  }

  function sleep() {
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
    const shouldWake = wakeOnDoubleClick || companion.manualSleep || ball.emotionId === '00';
    cancelPendingInteraction();
    if (presentationSuppressed || lastSample?.locked) return;
    if (shouldWake) {
      wake();
      return;
    }
    const motion = InteractionMotion.chooseMotion(Math.random(), lastDoubleMotion);
    lastDoubleMotion = motion.id;
    playReaction(motion.id);
  }

  function playReaction(action, speak = true, withinSequence = false) {
    const motion = InteractionMotion.getMotion(action);
    if (!motion || presentationSuppressed || lastSample?.locked || companion.manualSleep) return;
    cancelPendingInteraction();
    clearAction();
    stopMotion(!withinSequence);
    noteInteraction();
    activeMotion = { token: ++nextMotionToken, action, owner: 'user', side: facing || 'right' };
    petElement.dataset.motionOwner = 'user';
    ball.setEmotion(motion.emotion);
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
    const motion = CompanionMotion.getMotion(action);
    if (!motion || presentationSuppressed || lastSample?.locked || companion.manualSleep) return;
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    syncFacing();
    activeMotion = { token: ++nextMotionToken, action, owner: 'user', side: facing || 'right' };
    petElement.dataset.motionOwner = 'user';
    petElement.dataset.lastAction = action;
    ball.setEmotion(reducedMotion() ? '50' : motion.emotion);
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
      ball.stopMotion();
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
    if (presentationSuppressed || companion.manualSleep || lastSample?.locked) return;
    if (activeMotion) stopMotion();
    noteInteraction();
    if (speak && codexEnabled && codexActiveTaskCount > 0) {
      clearAction();
      startCodexThinkingCadence();
      desktop.say('thought');
      petElement.dataset.lastAction = 'thought';
      return;
    }
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

  function runRandomEmotion() {
    cancelPendingInteraction();
    stopMotion();
    companion.setManualSleep(false, performance.now());
    const definitions = EmotionBall.config.list().filter(definition => !['55', '56'].includes(definition.id));
    const selected = definitions[Math.floor(Math.random() * definitions.length)];
    if (selected) playEmotion(selected.id, 5000);
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

  function eventPoint(event) {
    return { x: event.screenX, y: event.screenY };
  }

  onPet('pointerdown', event => {
    if (event.button !== 0 || presentationSuppressed || lastSample?.locked) return;
    // 第一次松手会刷新系统空闲状态；保留本次双击最初是否睡着。
    const startedSleeping = companion.manualSleep || ball.emotionId === '00' || (singleClickTimer && wakeOnDoubleClick);
    cancelPendingInteraction();
    wakeOnDoubleClick = Boolean(startedSleeping);
    clearAction();
    stopMotion();
    petting.reset();
    const point = eventPoint(event);
    dragState = {
      pointerId: event.pointerId,
      start: point,
      dragged: false,
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
      petElement.style.setProperty('--drag-tilt', `${Math.max(-5, Math.min(5, (point.x - dragState.lastX) * .4))}deg`);
      dragState.lastX = point.x;
      desktop.dragTo(point);
    }
  });

  function finishPointer(event, cancelled) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const wasDragged = dragState.dragged;
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
    if (!cancelled && !wasDragged && event.button === 0) scheduleSingleClick();
  }

  onPet('pointerup', event => finishPointer(event, false));
  onPet('pointercancel', event => finishPointer(event, true));

  onPet('dblclick', event => {
    if (event.button !== 0) return;
    runDoubleClickAction();
  });

  onPet('pointerenter', () => {
    if (presentationSuppressed || companion.manualSleep || lastSample?.locked || activeMotion) return;
    noteInteraction();
    clearTimeout(helloTimer);
    helloTimer = setTimeout(observe(() => {
      helloTimer = null;
      if (companion.manualSleep || lastSample?.locked || activeMotion || dragState || performance.now() < actionUntil) return;
      playEmotion('03', 2200, 'hello');
    }), 900);
  });

  onPet('pointerleave', () => {
    clearTimeout(helloTimer);
    helloTimer = null;
    petting.reset();
  });

  onPet('contextmenu', event => {
    event.preventDefault();
    desktop.showContextMenu();
  });

  onWindow('resize', () => {
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    const shouldBeCompact = window.innerWidth <= 120;
    if (shouldBeCompact !== compactMode) createBall(ball.emotionId);
    restoreState();
    if (presentationSuppressed) syncSuppressedAnimation(true);
  });

  onWindow('beforeunload', () => {
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
  petElement.dataset.mode = 'awake';
  petElement.dataset.presentation = 'free';
  petElement.dataset.edge = 'none';
  petElement.dataset.dragging = 'false';
  petElement.dataset.motionOwner = 'none';
  petElement.dataset.codexWorking = 'false';
  petElement.dataset.codexActiveTasks = '0';
  petElement.dataset.codexThoughtSide = 'right';
  if (desktop.onPresentation) listeners.push(desktop.onPresentation(observe(updatePresentation)));
  listeners.push(desktop.onCommand(observe(runCommand)));
  listeners.push(desktop.onMotion(observe(onMotion)));
  listeners.push(desktop.onActivity(observe(updateActivity)));
  listeners.push(desktop.onSettings(observe(settings => {
    const next = PetCustomization.normalizeCustomization(settings.customization);
    if (JSON.stringify(customization.appearance) !== JSON.stringify(next.appearance)) {
      stopMotion();
      customization = next;
      registerIdleAppearance();
      createBall(ball.emotionId);
    } else customization = next;
    companion.setKeepAwake(settings.keepAwake);
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
    if (!isActive || presentationSuppressed) stopCodexThinkingCadence();
    else if (changed || !wasActive) startCodexThinkingCadence();
  })));
  window.__petReady = true;
})();
