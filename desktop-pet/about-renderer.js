(() => {
  'use strict';
  const bridge = window.qiuqiuAbout;
  const $ = id => document.getElementById(id);
  const status = $('about-status');
  let busy = false;
  let update = { state: 'idle' };
  let updateReceived = false;
  let currentVersion = '';
  let releaseAvailable = false;
  const avatar = $('about-avatar');
  const avatarStatus = $('about-avatar-status');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const portraits = [
    { shape: 'blob', name: '经典' }, { shape: 'cloud', name: '云朵' },
    { shape: 'aurora-cloud', name: '幻彩', contour: 'six-lobe' }, { shape: 'square', name: '方糖' }
  ];
  const portraitTarget = $('about-portrait');
  let portraitIndex = 0, avatarClickTimer = null, avatarEffectTimer = null;
  let ball = null, aurora = null;

  function cancelAvatarClick() { clearTimeout(avatarClickTimer); avatarClickTimer = null; }
  function stopAvatarEffect() {
    clearTimeout(avatarEffectTimer); avatarEffectTimer = null;
    ball?.stopMotion();
  }
  function destroyPortrait() {
    stopAvatarEffect();
    aurora?.destroy(); aurora = null;
    ball?.destroy(); ball = null;
    portraitTarget.replaceChildren();
  }
  function renderPortrait(index) {
    const portrait = portraits[index];
    const appearance = window.PetCustomization.normalizeAppearance(window.PetCustomization.applyShapeRecommendation({}, portrait.shape, portrait.contour));
    cancelAvatarClick();
    destroyPortrait();
    const source = window.EmotionBall.config.get('02').raw;
    window.EmotionBall.config.register({ ...source, id: '50', name: '关于页待机', group: 'custom', antics: false, anims: [], pool: [0, 8] });
    const customShape = window.EB_CUSTOM_SHAPES.createShape(appearance);
    const referenceTexture = window.PetCustomization.auroraReferenceTexture(appearance, customShape);
    ball = window.EmotionBall.create(portraitTarget, {
      emotion: '50', fallbackId: '50', shape: appearance.shape, customShape,
      auroraBodyTexture: referenceTexture, auroraStyle: appearance.auroraStyle,
      auroraTransparency: appearance.auroraTransparency,
      color: appearance.bodyColor, eyeColor: appearance.eyeColor,
      glowPinkColor: appearance.glowPinkColor, glowGoldColor: appearance.glowGoldColor,
      eyeScale: appearance.eyeScale, eyeSpacing: appearance.eyeSpacing, eyeHeight: appearance.eyeHeight,
      idle: false, autostart: !motion?.matches, lite: false, liteRibbons: true,
      label: `${portrait.name}球球`
    });
    portraitIndex = index;
    avatar.dataset.shape = portrait.shape;
    avatar.setAttribute('aria-label', `${portrait.name}球球。单击互动，双击随机换形态`);
    avatar.title = `当前：${portrait.name} · 单击${portrait.shape === 'aurora-cloud' ? '互动' : '转圈'} · 双击换形态\n键盘 Enter / 空格互动，→ 换形态`;
    if (portrait.shape !== 'aurora-cloud') return;
    // Only the existing Rive artwork is shown for 幻彩; its preparatory SVG is never a preview fallback.
    const svg = portraitTarget.querySelector(':scope > svg');
    svg.style.visibility = 'hidden';
    ball.setActive(false);
    try {
      aurora = window.AuroraRive.create(portraitTarget, appearance, referenceTexture, false);
      if (!aurora) throw new Error('幻彩暂时无法加载');
    } catch (error) { renderPortrait(0); throw error; }
    const next = aurora;
    const finish = ready => {
      if (aurora !== next) return;
      if (!ready) {
        renderPortrait(0);
        avatarStatus.textContent = '幻彩暂时无法加载，已回到经典球球。';
      }
    };
    next.whenReady().then(finish, () => finish(false));
  }
  function spinPortrait() {
    if (document.hidden || !ball) return;
    if (motion?.matches) { avatarStatus.textContent = '已开启减少动态，球球保持静态。'; return; }
    if (portraits[portraitIndex].shape === 'aurora-cloud') {
      avatarStatus.textContent = aurora?.click() ? '幻彩球球与你互动。' : '幻彩正在加载，请稍后再试。';
      return;
    }
    clearTimeout(avatarEffectTimer);
    ball.setEmotion('10');
    ball.spin(1);
    avatarEffectTimer = setTimeout(() => { avatarEffectTimer = null; ball?.setEmotion('50'); }, 3200);
    avatarStatus.textContent = `${portraits[portraitIndex].name}球球转了一圈。`;
  }
  function changePortrait() {
    if (document.hidden) return;
    cancelAvatarClick(); stopAvatarEffect();
    const choices = portraits.map((_, index) => index).filter(index => index !== portraitIndex);
    try {
      renderPortrait(choices[Math.floor(Math.random() * choices.length)]);
      avatarStatus.textContent = `换成${portraits[portraitIndex].name}球球了。`;
    } catch (_) { avatarStatus.textContent = '暂时无法切换球球形态，请再试一次。'; }
  }
  avatar.addEventListener('click', event => {
    cancelAvatarClick();
    if (event.detail > 1) return;
    if (event.detail === 0) spinPortrait();
    else avatarClickTimer = setTimeout(() => { avatarClickTimer = null; spinPortrait(); }, 520);
  });
  avatar.addEventListener('dblclick', event => { event.preventDefault(); changePortrait(); });
  avatar.addEventListener('keydown', event => {
    if (!['Enter', ' ', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.key === 'ArrowRight' || event.key === 'Enter' && event.shiftKey) changePortrait();
    else { cancelAvatarClick(); spinPortrait(); }
  });
  const stopAvatar = () => { cancelAvatarClick(); destroyPortrait(); };
  const refreshAvatar = () => { stopAvatar(); if (!document.hidden) renderPortrait(portraitIndex); };
  motion?.addEventListener('change', refreshAvatar);
  document.addEventListener('visibilitychange', () => {
    document.documentElement.dataset.aboutVisible = String(!document.hidden);
    if (document.hidden) stopAvatar();
    else renderPortrait(portraitIndex);
  });

  function refreshControls() {
    const checking = update.state === 'checking';
    $('about-website').disabled = busy || typeof bridge?.openWebsite !== 'function';
    $('about-check-updates').hidden = releaseAvailable;
    $('about-check-updates').disabled = busy || checking || typeof bridge?.checkUpdates !== 'function';
    $('about-open-release').disabled = busy || checking || typeof bridge?.openRelease !== 'function';
    $('about-open-release').hidden = !releaseAvailable;
  }

  function renderUpdate(value) {
    if (!value || !['idle', 'checking', 'ready', 'error'].includes(value.state)) return false;
    update = value;
    if (value.state !== 'checking') releaseAvailable = value.state === 'ready' && value.hasUpdate === true;
    const version = typeof value.currentVersion === 'string' ? value.currentVersion : currentVersion;
    status.textContent = value.state === 'checking' ? '正在检查更新…'
      : value.state === 'ready' ? value.hasUpdate
        ? `发现新版本${typeof value.latestVersion === 'string' ? ' ' + value.latestVersion : ''}`
        : `已是最新版本${version ? '（' + version + '）' : ''}`
        : value.state === 'error' ? typeof value.message === 'string' && value.message ? value.message : '暂时无法检查更新，请稍后重试。'
          : '';
    status.title = status.textContent;
    refreshControls();
    return true;
  }

  document.documentElement.dataset.aboutVisible = String(!document.hidden);
  try {
    if (!document.hidden) renderPortrait(0);
  } catch (_) { status.textContent = '暂时无法显示球球形象。'; }

  async function perform(method, pending, failure) {
    if (busy || typeof bridge?.[method] !== 'function') return;
    busy = true;
    refreshControls();
    if (pending) { status.textContent = pending; status.title = pending; }
    try {
      const result = await bridge[method]();
      if (method !== 'checkUpdates') {
        if (result === false) { status.textContent = failure; status.title = failure; }
        else renderUpdate(update);
      }
    }
    catch (_) {
      if (method === 'checkUpdates') renderUpdate({ state: 'error', message: failure });
      else { status.textContent = failure; status.title = failure; }
    }
    finally {
      busy = false;
      refreshControls();
    }
  }

  $('about-website').addEventListener('click', () => perform('openWebsite', '', '暂时无法打开官网，请稍后重试。'));
  $('about-check-updates').addEventListener('click', () => perform('checkUpdates', '正在检查更新…', '暂时无法检查更新，请稍后重试。'));
  $('about-open-release').addEventListener('click', () => perform('openRelease', '', '暂时无法打开新版页面，请稍后重试。'));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    try { bridge?.close(); } catch (_) {}
  });

  let unsubscribe;
  try {
    if (typeof bridge?.onUpdate === 'function') unsubscribe = bridge.onUpdate(value => {
      if (renderUpdate(value)) updateReceived = true;
    });
  } catch (_) {}
  window.addEventListener('beforeunload', () => {
    stopAvatar(); motion?.removeEventListener('change', refreshAvatar);
    if (typeof unsubscribe === 'function') unsubscribe();
  }, { once: true });
  refreshControls();
  if (typeof bridge?.getInfo !== 'function') {
    $('about-version').textContent = '版本暂不可用';
    $('about-website').disabled = true;
    $('about-check-updates').disabled = true;
    $('about-open-release').disabled = true;
    status.textContent = '请重新打开关于球球。';
    return;
  }
  Promise.resolve().then(() => bridge.getInfo()).then(info => {
    if (typeof info?.version === 'string' && info.version.length > 0 && info.version.length <= 80) {
      currentVersion = info.version;
      $('about-version').textContent = `版本 ${info.version}`;
    }
    else $('about-version').textContent = '版本暂不可用';
    if (typeof info?.developer === 'string' && info.developer.length > 0 && info.developer.length <= 80) $('about-developer').textContent = `开发者 ${info.developer}`;
    if (!updateReceived && info?.update) renderUpdate(info.update);
  }).catch(() => { $('about-version').textContent = '版本暂不可用'; if (update.state === 'idle') status.textContent = '未能读取版本信息，请重新打开。'; });
})();
