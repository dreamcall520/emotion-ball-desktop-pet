(function startDesktopPet() {
  'use strict';

  const petElement = document.getElementById('pet');
  const desktop = window.petDesktop || {
    beginDrag() {},
    dragTo() {},
    endDrag() {},
    bounce() {},
    showContextMenu() {},
    onCommand() { return () => {}; }
  };

  let ball = null;
  let compactMode = null;
  let dragState = null;
  let singleClickTimer = null;
  let removeCommandListener = () => {};

  function createBall(emotionId) {
    const nextCompactMode = window.innerWidth <= 120;
    if (ball) ball.destroy();
    petElement.replaceChildren();
    compactMode = nextCompactMode;
    ball = EmotionBall.create(petElement, {
      emotion: emotionId || '02',
      shape: 'blob',
      idle: PetBehavior.IDLE_OPTIONS,
      eyeScale: compactMode ? 1.5 : 1,
      lite: compactMode,
      fallbackId: '02',
      label: '球球桌面宠物'
    });
    ball.bounce = () => {
      desktop.bounce();
      return ball;
    };
  }

  function wake() {
    ball.resetIdle();
    ball.setEmotion('01');
  }

  function sleep() {
    ball.resetIdle();
    ball.setEmotion('00');
  }

  function toggleSleep() {
    if (ball.emotionId === '00') wake();
    else sleep();
  }

  function runSingleClickAction() {
    ball.resetIdle();
    const action = PetBehavior.chooseClickAction(Math.random());
    if (action === 'bounce') ball.bounce();
    else if (action === 'spin') ball.spin(1);
    else ball.setEmotion('10');
  }

  function scheduleSingleClick() {
    clearTimeout(singleClickTimer);
    singleClickTimer = setTimeout(() => {
      singleClickTimer = null;
      runSingleClickAction();
    }, 260);
  }

  function runRandomEmotion() {
    const definitions = EmotionBall.config.list();
    const selected = definitions[Math.floor(Math.random() * definitions.length)];
    if (selected) ball.setEmotion(selected.id);
  }

  function runCommand(command) {
    if (command === 'random') runRandomEmotion();
    else if (command === 'sleep') sleep();
    else if (command === 'wake') wake();
  }

  function eventPoint(event) {
    return { x: event.screenX, y: event.screenY };
  }

  petElement.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const point = eventPoint(event);
    dragState = {
      pointerId: event.pointerId,
      start: point,
      dragged: false
    };
    petElement.setPointerCapture(event.pointerId);
    desktop.beginDrag(point);
  });

  petElement.addEventListener('pointermove', event => {
    const rect = petElement.getBoundingClientRect();
    ball.setGaze(
      Math.max(-1, Math.min(1, (event.clientX - rect.width / 2) / (rect.width / 2))),
      Math.max(-1, Math.min(1, (event.clientY - rect.height / 2) / (rect.height / 2)))
    );

    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const point = eventPoint(event);
    if (!dragState.dragged) {
      dragState.dragged = PetBehavior.isDrag(dragState.start, point);
      if (dragState.dragged) petElement.classList.add('dragging');
    }
    if (dragState.dragged) desktop.dragTo(point);
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
    ball.resetIdle();
    if (!cancelled && !wasDragged && event.button === 0) scheduleSingleClick();
  }

  petElement.addEventListener('pointerup', event => finishPointer(event, false));
  petElement.addEventListener('pointercancel', event => finishPointer(event, true));

  petElement.addEventListener('dblclick', event => {
    if (event.button !== 0) return;
    clearTimeout(singleClickTimer);
    singleClickTimer = null;
    toggleSleep();
  });

  petElement.addEventListener('pointerenter', () => {
    if (ball.emotionId === '00') wake();
    else ball.resetIdle();
  });

  petElement.addEventListener('pointerleave', () => {
    if (!dragState) ball.clearGaze();
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
    removeCommandListener();
    if (ball) ball.destroy();
  });

  createBall('02');
  removeCommandListener = desktop.onCommand(runCommand);
  window.__petReady = true;
})();
