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

  function refreshControls() {
    const checking = update.state === 'checking';
    $('about-website').disabled = busy || typeof bridge?.openWebsite !== 'function';
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

  try {
    window.PetChatAvatar.render($('about-avatar'), {
      shape: 'blob', bodyColor: '#F2F0EB', eyeColor: '#252629', idleEyes: 'original', auroraTransparency: 0
    });
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
  window.addEventListener('beforeunload', () => { if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
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
