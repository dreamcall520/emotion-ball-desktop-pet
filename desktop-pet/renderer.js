(function startDesktopPet() {
  'use strict';

  const petElement = document.getElementById('pet');
  const desktop = window.petDesktop || {
    beginDrag() {},
    dragTo() {},
    endDrag() {},
    bounce() {},
    stopMotion() {},
    say() {},
    showContextMenu() {},
    onCommand() { return () => {}; },
    onActivity() { return () => {}; },
    onSettings() { return () => {}; }
  };

  const companion = new CompanionBehavior.CompanionState();
  const petting = new CompanionBehavior.PettingTracker();

  let ball = null;
  let compactMode = null;
  let dragState = null;
  let singleClickTimer = null;
  let helloTimer = null;
  let actionTimer = null;
  let actionUntil = 0;
  let lastWorkAttempt = 0;
  let lastSample = null;
  let currentState = { mode: 'awake', emotionId: '50', gaze: null };
  const listeners = [];

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

  function stopMotion() {
    ball.stopMotion();
    desktop.stopMotion();
  }

  function cancelPendingInteraction() {
    clearTimeout(singleClickTimer);
    singleClickTimer = null;
    clearTimeout(helloTimer);
    helloTimer = null;
  }

  function restoreState() {
    if (dragState?.dragged || performance.now() < actionUntil) return;
    showEmotion(companion.manualSleep ? '00' : currentState.emotionId);
  }

  function playEmotion(id, duration, scene) {
    clearAction();
    actionUntil = performance.now() + duration;
    ball.setEmotion(id);
    if (scene) desktop.say(scene);
    actionTimer = setTimeout(() => {
      actionUntil = 0;
      restoreState();
    }, duration);
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
      return;
    }
    ball.setActive(true);
    if (currentState.welcome && !dragState?.dragged && now >= actionUntil) {
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
        now - lastWorkAttempt >= 60000 && !dragState && now >= actionUntil) {
      lastWorkAttempt = now;
      desktop.say('work');
    }
  }

  function noteInteraction() {
    companion.noteInteraction(performance.now());
    if (lastSample) updateActivity(lastSample);
  }

  function wake() {
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
    cancelPendingInteraction();
    if (lastSample?.locked) return;
    if (companion.manualSleep || ball.emotionId === '00') {
      wake();
      return;
    }
    const reactions = [
      { emotion: '03', action: 'greet' },
      { emotion: '10', action: 'bounce' },
      { emotion: '14', action: 'shy' },
      { emotion: '19', action: 'happy' },
      { emotion: '10', action: 'spin' }
    ];
    let index = Math.floor(Math.random() * reactions.length);
    if (reactions[index].action === petElement.dataset.lastAction) index = (index + 1) % reactions.length;
    const reaction = reactions[index];
    stopMotion();
    noteInteraction();
    playEmotion(reaction.emotion, 3200, 'play');
    petElement.dataset.lastAction = reaction.action;
    if (reaction.action === 'bounce') ball.bounce();
    else if (reaction.action === 'spin') ball.spin(1);
  }

  function runSingleClickAction(speak = true) {
    if (companion.manualSleep || lastSample?.locked) return;
    noteInteraction();
    playEmotion('10', 3200, speak ? 'play' : null);
    const action = PetBehavior.chooseClickAction(Math.random());
    petElement.dataset.lastAction = action;
    if (action === 'bounce') ball.bounce();
    else if (action === 'spin') ball.spin(1);
  }

  function scheduleSingleClick() {
    clearTimeout(singleClickTimer);
    singleClickTimer = setTimeout(() => {
      singleClickTimer = null;
      runSingleClickAction();
    }, 260);
  }

  function runRandomEmotion() {
    companion.setManualSleep(false, performance.now());
    const definitions = EmotionBall.config.list();
    const selected = definitions[Math.floor(Math.random() * definitions.length)];
    if (selected) playEmotion(selected.id, 5000);
  }

  function runCommand(command) {
    if (lastSample?.locked) return;
    if (command === 'random') runRandomEmotion();
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

  petElement.addEventListener('pointerdown', event => {
    if (event.button !== 0 || lastSample?.locked) return;
    clearTimeout(helloTimer);
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

  petElement.addEventListener('pointermove', event => {
    if (lastSample?.locked) return;
    const rect = petElement.getBoundingClientRect();
    if (!companion.manualSleep) {
      if (!dragState && petting.update({
        x: event.clientX, y: event.clientY,
        width: rect.width, height: rect.height, buttons: event.buttons
      }, performance.now())) {
        clearTimeout(helloTimer);
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

  petElement.addEventListener('pointerup', event => finishPointer(event, false));
  petElement.addEventListener('pointercancel', event => finishPointer(event, true));

  petElement.addEventListener('dblclick', event => {
    if (event.button !== 0) return;
    runDoubleClickAction();
  });

  petElement.addEventListener('pointerenter', () => {
    if (companion.manualSleep || lastSample?.locked) return;
    noteInteraction();
    clearTimeout(helloTimer);
    helloTimer = setTimeout(() => {
      if (companion.manualSleep || dragState || performance.now() < actionUntil) return;
      playEmotion('03', 2200, 'hello');
    }, 900);
  });

  petElement.addEventListener('pointerleave', () => {
    clearTimeout(helloTimer);
    petting.reset();
  });

  petElement.addEventListener('contextmenu', event => {
    event.preventDefault();
    desktop.showContextMenu();
  });

  window.addEventListener('resize', () => {
    const shouldBeCompact = window.innerWidth <= 120;
    if (shouldBeCompact !== compactMode) createBall(ball.emotionId);
  });

  window.addEventListener('beforeunload', () => {
    clearTimeout(singleClickTimer);
    clearTimeout(helloTimer);
    clearAction();
    listeners.forEach(remove => remove());
    if (ball) ball.destroy();
  });

  createBall('50');
  petElement.dataset.mode = 'awake';
  listeners.push(desktop.onCommand(runCommand));
  listeners.push(desktop.onActivity(updateActivity));
  listeners.push(desktop.onSettings(settings => {
    companion.setKeepAwake(settings.keepAwake);
    if (lastSample) updateActivity(lastSample);
  }));
  window.__petReady = true;
})();
