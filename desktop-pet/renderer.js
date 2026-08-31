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
  const listeners = [];

  function canShowCodex() {
    return codexEnabled && Boolean(lastSample) && !lastSample.locked && !companion.manualSleep &&
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

  function syncCodexWorking() {
    const working = codexEnabled && codexActiveTaskCount > 0 && Boolean(lastSample) && !lastSample.locked &&
      !companion.manualSleep && currentState.mode !== 'sleep' && !dragState && !singleClickTimer && !helloTimer &&
      performance.now() >= actionUntil && !activeMotion;
    petElement.dataset.codexWorking = working ? 'true' : 'false';
    petElement.dataset.codexActiveTasks = String(codexActiveTaskCount);
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

  function createBall(emotionId) {
    const nextCompactMode = window.innerWidth <= 120;
    if (ball) ball.destroy();
    petElement.replaceChildren();
    compactMode = nextCompactMode;
    ball = EmotionBall.create(petElement, {
      emotion: emotionId || '50',
      shape: 'blob',
      // 复用实例主题色：所有表情沿用睡眠灰白，眼睛保持黑色。
      color: '#EEEBE4',
      eyeColor: '#1A1A1A',
      idle: false,
      eyeScale: compactMode ? 1.5 : 1,
      lite: compactMode,
      fallbackId: '50',
      label: '球球桌面宠物'
    });
    ball.bounce = () => {
      desktop.bounce();
      return ball;
    };
    ball.on('change', ({ id }) => { petElement.dataset.emotion = id; });
    petElement.dataset.emotion = ball.emotionId;
  }

  function showEmotion(id) {
    if (ball.emotionId !== id) ball.setEmotion(id);
  }

  function clearAction() {
    clearTimeout(actionTimer);
    actionTimer = null;
    actionUntil = 0;
  }

  function stopMotion(notifyHost = true) {
    activeMotion = null;
    petElement.dataset.motionOwner = 'none';
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
    if (activeMotion || dragState?.dragged || performance.now() < actionUntil) return;
    showEmotion(companion.manualSleep ? '00' : currentState.emotionId);
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

  function updateActivity(sample) {
    lastSample = sample;
    const now = performance.now();
    const previousMode = currentState.mode;
    currentState = companion.update(sample, now);
    petElement.dataset.mode = companion.manualSleep ? 'manual-sleep' : currentState.mode;
    if (sample.locked) {
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
    if (currentState.welcome && !activeMotion && !dragState?.dragged && now >= actionUntil) {
      playEmotion('01', 2250, 'welcome');
    } else {
      restoreState();
    }
    if (currentState.mode === 'sleep' && previousMode !== 'sleep' && !companion.manualSleep) {
      desktop.say('sleep');
    }
    if (!dragState?.dragged && !companion.manualSleep && currentState.gaze) {
      ball.setGaze(currentState.gaze.x, currentState.gaze.y);
      petElement.dataset.gaze = `${currentState.gaze.x.toFixed(2)},${currentState.gaze.y.toFixed(2)}`;
    } else {
      ball.clearGaze();
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
    playEmotion('01', 2250, 'welcome');
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
    if (lastSample?.locked) return;
    if (shouldWake) {
      wake();
      return;
    }
    const motion = InteractionMotion.chooseMotion(Math.random(), lastDoubleMotion);
    lastDoubleMotion = motion.id;
    playReaction(motion.id);
  }

  function playReaction(action, speak = true) {
    const motion = InteractionMotion.getMotion(action);
    if (!motion || lastSample?.locked || companion.manualSleep) return;
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    noteInteraction();
    activeMotion = { token: ++nextMotionToken, action, owner: 'user' };
    petElement.dataset.motionOwner = 'user';
    ball.setEmotion(motion.emotion);
    ball.setMotionFrame(InteractionMotion.sampleMotion(action, 0));
    petElement.dataset.lastAction = action;
    desktop.playMotion({ ...activeMotion });
    if (speak) desktop.say({ event: 'play', motion: action });
  }

  function onMotion(packet) {
    if (!activeMotion || !packet || packet.token !== activeMotion.token ||
        packet.action !== activeMotion.action || !packet.frame) return;
    if (packet.frame.done === true) {
      activeMotion = null;
      petElement.dataset.motionOwner = 'none';
      ball.stopMotion();
      restoreState();
    } else ball.setMotionFrame(packet.frame);
  }

  function runSingleClickAction(speak = true) {
    if (companion.manualSleep || lastSample?.locked) return;
    if (activeMotion) stopMotion();
    noteInteraction();
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
    const definitions = EmotionBall.config.list();
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
    if (lastSample?.locked) return;
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
    if (event.button !== 0 || lastSample?.locked) return;
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
    if (lastSample?.locked) return;
    const rect = petElement.getBoundingClientRect();
    if (!companion.manualSleep && !activeMotion) {
      if (!dragState && petting.update({
        x: event.clientX, y: event.clientY,
        width: rect.width, height: rect.height, buttons: event.buttons
      }, performance.now())) {
        clearTimeout(helloTimer);
        helloTimer = null;
        noteInteraction();
        playEmotion('19', 2400, 'pet');
        petElement.dataset.lastAction = 'pet';
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
      playEmotion('19', 1000, cancelled ? null : 'drop');
      petElement.dataset.lastAction = 'drop';
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
    if (companion.manualSleep || lastSample?.locked || activeMotion) return;
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
  });

  onWindow('beforeunload', () => {
    codexEnabled = false;
    cancelPendingInteraction();
    clearAction();
    stopMotion();
    listeners.forEach(remove => remove());
    if (ball) ball.destroy();
  });

  createBall('50');
  petElement.dataset.mode = 'awake';
  petElement.dataset.motionOwner = 'none';
  petElement.dataset.codexWorking = 'false';
  petElement.dataset.codexActiveTasks = '0';
  listeners.push(desktop.onCommand(observe(runCommand)));
  listeners.push(desktop.onMotion(observe(onMotion)));
  listeners.push(desktop.onActivity(observe(updateActivity)));
  listeners.push(desktop.onSettings(observe(settings => {
    companion.setKeepAwake(settings.keepAwake);
    if (lastSample) updateActivity(lastSample);
  })));
  listeners.push(desktop.onCodexSettings(observe(settings => {
    if (!Number.isSafeInteger(settings?.generation) || settings.generation < codexGeneration ||
      !Number.isSafeInteger(settings.pageEpoch) || settings.pageEpoch <= 0 || settings.pageEpoch < codexPageEpoch ||
      typeof settings.enabled !== 'boolean') return;
    const changed = settings.generation !== codexGeneration || settings.pageEpoch !== codexPageEpoch;
    if (changed || !settings.enabled) cancelCodex();
    if (changed) lastCodexAlertId = 0;
    lastAvailability = null;
    codexGeneration = settings.generation;
    codexPageEpoch = settings.pageEpoch;
    codexEnabled = settings.enabled;
    codexActiveTaskCount = Number.isSafeInteger(settings.activeTaskCount) && settings.activeTaskCount >= 0 &&
      settings.activeTaskCount <= 64 ? settings.activeTaskCount : 0;
  })));
  window.__petReady = true;
})();
