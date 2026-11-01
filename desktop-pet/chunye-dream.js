(function (global) {
  'use strict';

  const scriptURL = document.currentScript && document.currentScript.src;
  const defaultAvatarURL = scriptURL ? new URL('chunye-avatar.png', scriptURL).href : 'chunye-avatar.png';
  const partnerAvatarURL = scriptURL ? new URL('assets/partner-confirmed-reference.png', scriptURL).href : 'assets/partner-confirmed-reference.png';
  const avatars = Object.freeze({
    chunye: Object.freeze({ name: '春野', src: defaultAvatarURL }),
    partner: Object.freeze({ name: '伙伴', src: partnerAvatarURL })
  });
  const sleepPoses = new Set(['sleep', 'sleep-lying', 'manual-sleep']);
  const ENTER_MS = 800, EXIT_MS = 180;

  /**
   * Decorative content for a separate, transparent, non-focusable native window.
   * The owner controls window visibility, position, screen clamping and click-through.
   * side is the WINDOW's side relative to the dog; dots point back towards the dog.
   */
  function createChunyeDreamBubble(options) {
    options = options || {};
    const host = options.host || document.body;
    const root = document.createElement('div');
    root.className = 'chunye-dream';
    root.hidden = true;
    root.dataset.phase = 'hidden';
    root.dataset.entering = 'false';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', '小狗在睡梦里想着春野');

    const cloud = document.createElement('div');
    cloud.className = 'chunye-dream__cloud';
    const avatarFrame = document.createElement('div');
    avatarFrame.className = 'chunye-dream__avatar-frame';
    const avatar = document.createElement('img');
    avatar.className = 'chunye-dream__avatar';
    avatar.alt = '春野';
    avatar.draggable = false;
    avatar.setAttribute('aria-hidden', 'true');
    const heart = document.createElement('span');
    heart.className = 'chunye-dream__heart';
    heart.textContent = '♥';
    heart.setAttribute('aria-hidden', 'true');
    const near = document.createElement('span');
    near.className = 'chunye-dream__dot chunye-dream__dot--near';
    near.setAttribute('aria-hidden', 'true');
    const far = document.createElement('span');
    far.className = 'chunye-dream__dot chunye-dream__dot--far';
    far.setAttribute('aria-hidden', 'true');
    avatarFrame.append(avatar);
    cloud.append(avatarFrame, heart);
    root.append(cloud, near, far);
    host.append(root);

    const state = {
      visible: options.visible !== false,
      enabled: true,
      pose: 'sleep',
      side: 'left',
      tailSide: null,
      reducedMotion: false,
      showHeart: options.showHeart !== false,
      avatarId: 'chunye',
      avatarName: '春野',
      avatarReady: false
    };
    let destroyed = false;
    let layout = null;
    let phase = 'hidden', visibilityWanted = false;
    let transitionTimer = null, transitionEpoch = 0, transitionEndsAt = 0;
    const motionPreference = global.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reducesMotion = () => state.reducedMotion || motionPreference?.matches === true;

    function finishVisibility(nextPhase) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
      transitionEndsAt = 0;
      phase = nextPhase;
      root.dataset.phase = phase;
      root.dataset.entering = 'false';
      root.hidden = phase === 'hidden';
    }

    function applyVisibility(wanted) {
      const reduced = reducesMotion();
      root.dataset.reducedMotion = String(reduced);
      root.setAttribute('aria-hidden', String(!wanted));
      if (wanted === visibilityWanted) {
        if (reduced && (phase === 'entering' || phase === 'leaving')) finishVisibility(wanted ? 'visible' : 'hidden');
        return;
      }
      visibilityWanted = wanted;
      const epoch = ++transitionEpoch;
      clearTimeout(transitionTimer);
      transitionTimer = null;
      if (wanted) {
        const returning = phase === 'leaving';
        root.hidden = false;
        if (reduced || returning) { finishVisibility('visible'); return; }
        phase = 'entering';
        root.dataset.phase = phase;
        root.dataset.entering = 'true';
        transitionEndsAt = Date.now() + ENTER_MS;
        transitionTimer = setTimeout(() => {
          if (!destroyed && epoch === transitionEpoch && visibilityWanted) finishVisibility('visible');
        }, ENTER_MS);
      } else {
        if (reduced || phase === 'hidden') { finishVisibility('hidden'); return; }
        phase = 'leaving';
        root.dataset.phase = phase;
        transitionEndsAt = Date.now() + EXIT_MS;
        transitionTimer = setTimeout(() => {
          if (!destroyed && epoch === transitionEpoch && !visibilityWanted) finishVisibility('hidden');
        }, EXIT_MS);
      }
    }

    function setAvatar(avatarId) {
      if (destroyed || !Object.prototype.hasOwnProperty.call(avatars, avatarId)) return getState();
      const choice = avatars[avatarId];
      const src = avatarId === 'chunye' ? (options.avatarURL || options.avatarUrl || choice.src) : choice.src;
      state.avatarId = avatarId;
      state.avatarName = choice.name;
      root.dataset.avatar = avatarId;
      root.setAttribute('aria-label', '小狗在睡梦里想着' + choice.name);
      avatar.alt = choice.name;
      if (avatar.src !== src) {
        state.avatarReady = false;
        root.dataset.avatarReady = 'false';
        avatar.src = src;
      }
      return getState();
    }

    // The owner calls this once at the start of a sleeping episode.
    // Frequent pose/position packets keep the selected face stable.
    function selectRandomAvatar() {
      const ids = Object.keys(avatars);
      return setAvatar(ids[Math.floor(Math.random() * ids.length)]);
    }

    function renderLayout() {
      if (destroyed) return;
      const bounds = root.getBoundingClientRect();
      const width = Math.max(0, root.clientWidth || host.clientWidth || bounds.width || global.innerWidth || 0);
      const height = Math.max(0, root.clientHeight || host.clientHeight || bounds.height || global.innerHeight || 0);
      // 80x60 and 67x84 are actual thought-window sizes at the default pet scale.
      // Keep 3px for the shadow, and reserve 17px below the cloud for both dots.
      const cloudWidth = Math.min(54, Math.max(0, width - 12));
      const cloudHeight = Math.min(48, Math.max(0, height - 20));
      const x = Math.max(6, (width - cloudWidth) / 2);
      const y = Math.max(3, (height - cloudHeight - 17) / 2);
      const avatarSize = Math.min(36, cloudHeight - 8, cloudWidth - 14);
      const dotNearSize = cloudWidth < 44 ? 5 : 6;
      const dotFarSize = cloudWidth < 44 ? 3 : 4;
      const tailSide = state.tailSide || (state.side === 'center' ? 'center' : state.side === 'right' ? 'left' : 'right');
      const nearX = tailSide === 'center' ? x + (cloudWidth - dotNearSize) / 2 : tailSide === 'left' ? x + 8 : x + cloudWidth - 14;
      const farX = tailSide === 'center' ? x + (cloudWidth - dotFarSize) / 2 : tailSide === 'left' ? x + 1 : x + cloudWidth - 6;
      const nearY = y + cloudHeight + 3;
      const farY = y + cloudHeight + 10;
      const fits = width >= 48 && height >= 48 && avatarSize >= 20;
      layout = {
        viewport: { width, height }, fits,
        cloud: { x, y, width: cloudWidth, height: cloudHeight },
        avatarSize,
        dots: [
          { x: nearX, y: nearY, width: dotNearSize, height: dotNearSize },
          { x: farX, y: farY, width: dotFarSize, height: dotFarSize }
        ]
      };
      const properties = {
        '--dream-x': x, '--dream-y': y,
        '--dream-width': cloudWidth, '--dream-height': cloudHeight,
        '--dream-avatar-size': avatarSize,
        '--dream-dot-near-x': nearX, '--dream-dot-near-y': nearY,
        '--dream-dot-near-size': dotNearSize,
        '--dream-dot-far-x': farX, '--dream-dot-far-y': farY,
        '--dream-dot-far-size': dotFarSize
      };
      Object.entries(properties).forEach(([key, value]) => root.style.setProperty(key, value + 'px'));
      applyVisibility(state.visible && state.enabled && sleepPoses.has(state.pose) && fits);
    }

    function update(packet) {
      if (destroyed) return getState();
      packet = packet || {};
      if (typeof packet.visible === 'boolean') state.visible = packet.visible;
      if (typeof packet.enabled === 'boolean') state.enabled = packet.enabled;
      if (packet.isDog === false) state.enabled = false;
      if (packet.isDog === true && packet.enabled !== false) state.enabled = true;
      if (typeof packet.pose === 'string') state.pose = packet.pose;
      if (packet.side === 'left' || packet.side === 'right' || packet.side === 'center') state.side = packet.side;
      if (packet.tailSide === 'left' || packet.tailSide === 'right' || packet.tailSide === 'center' || packet.tailSide === null) state.tailSide = packet.tailSide;
      if (typeof packet.reducedMotion === 'boolean') state.reducedMotion = packet.reducedMotion;
      if (typeof packet.showHeart === 'boolean') state.showHeart = packet.showHeart;
      if (typeof packet.avatarId === 'string') setAvatar(packet.avatarId);
      root.dataset.pose = state.pose;
      root.dataset.side = state.side;
      heart.hidden = !state.showHeart;
      // Native owner keeps the transparent window for EXIT_MS before hiding it.
      renderLayout();
      return getState();
    }

    function getState() {
      return { ...state, rendered: !root.hidden && !destroyed, phase,
        transitionMs: Math.max(0, transitionEndsAt - Date.now()),
        effectiveReducedMotion: reducesMotion(), layout };
    }

    avatar.onload = function () { state.avatarReady = true; root.dataset.avatarReady = 'true'; };
    avatar.onerror = function () { state.avatarReady = false; root.dataset.avatarReady = 'false'; };
    setAvatar(Object.prototype.hasOwnProperty.call(avatars, options.avatarId) ? options.avatarId : 'chunye');

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(renderLayout) : null;
    if (observer) observer.observe(host);
    global.addEventListener('resize', renderLayout);
    motionPreference?.addEventListener?.('change', renderLayout);
    update(options);

    return Object.freeze({
      update,
      setAvatar,
      selectRandomAvatar,
      show: packet => update({ ...packet, visible: true }),
      hide: () => update({ visible: false }),
      getState,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        transitionEpoch++;
        clearTimeout(transitionTimer);
        observer && observer.disconnect();
        global.removeEventListener('resize', renderLayout);
        motionPreference?.removeEventListener?.('change', renderLayout);
        avatar.onload = avatar.onerror = null;
        root.remove();
      }
    });
  }

  global.createChunyeDreamBubble = createChunyeDreamBubble;
  const dedicatedHost = document.getElementById('dream-host');
  if (dedicatedHost) {
    const bubble = createChunyeDreamBubble({ host: dedicatedHost, visible: false });
    global.setDreamState = packet => bubble.update(packet);
    global.setDreamAvatar = avatarId => bubble.setAvatar(avatarId);
    global.selectRandomDreamAvatar = () => bubble.selectRandomAvatar();
    global.getDreamState = () => bubble.getState();
    global.addEventListener('beforeunload', () => bubble.destroy(), { once: true });
  }
})(window);
