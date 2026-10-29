const https = require('node:https');
const path = require('node:path');

const REPOSITORY = 'https://github.com/dreamcall520/emotion-ball-desktop-pet';
const ENDPOINT = 'https://api.github.com/repos/dreamcall520/emotion-ball-desktop-pet/releases/latest';
const FORMAT_ERROR = '官方版本信息暂不可用，请稍后重试。';
const NETWORK_ERROR = '无法检查更新，请检查网络后重试。';
const TIMEOUT_ERROR = '检查更新超时，请稍后重试。';
const NOT_FOUND_ERROR = '暂未找到球球的正式发布版本，请稍后重试。';
const SAFE_ERRORS = new Set([FORMAT_ERROR, NETWORK_ERROR, TIMEOUT_ERROR, NOT_FOUND_ERROR]);
const updateError = message => Object.assign(new Error(message), { publicMessage: message });
const pendingDownloads = new WeakMap();
const DOWNLOAD_MESSAGES = {
  INVALID_INSTALLER: ['prepare', '新版安装包暂不可用，请重新检查更新。'],
  DOWNLOAD_BUSY: ['prepare', '安装包正在下载，请等待当前下载完成。'],
  START_PENDING: ['start', '上次下载尚未开始，请重新打开关于球球，或选择浏览器下载。'],
  WINDOW_CLOSED: ['start', '下载尚未开始，请重新打开关于球球后重试。'],
  START_TIMEOUT: ['start', '下载启动超时，可选择浏览器下载。'],
  START_FAILED: ['start', '暂时无法开始下载，可选择浏览器下载。'],
  SAVE_DIALOG_FAILED: ['save', '无法打开保存窗口，请重新打开关于球球后重试。'],
  TRANSFER_INTERRUPTED: ['transfer', '下载中断，自动恢复未成功，可重新下载或选择其他入口。'],
  RESUME_FAILED: ['transfer', '下载恢复失败，可重新下载或选择其他入口。'],
  DOWNLOAD_FAILED: ['transfer', '下载失败，请检查网络和保存位置后重试。'],
  CANCELLED: ['cancel', '已取消下载，可以重新下载。']
};
const downloadError = code => ({ state: code === 'CANCELLED' ? 'cancelled' : 'error', code,
  stage: DOWNLOAD_MESSAGES[code][0], message: DOWNLOAD_MESSAGES[code][1] });

function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|\d{2}|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? { parts, version: match.slice(1).join('.') } : null;
}

function installerName(value) {
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = /^Qiuqiu-(\d+\.\d+\.\d+)-macOS-(arm64|x64)\.dmg$/.exec(value);
  const version = match && parseVersion(match[1]);
  return version ? { ...version, arch: match[2] } : null;
}

function selectInstaller(release, platform, arch) {
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch) || !Array.isArray(release.assets)) return null;
  const latest = parseVersion(release.tag_name);
  for (const asset of release.assets) {
    const name = installerName(asset?.name);
    if (!name || name.arch !== arch || name.parts.some((part, index) => part !== latest.parts[index]) ||
        asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
    const url = `${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`;
    if (asset.browser_download_url === url) return { name: asset.name, url };
  }
  return null;
}

function validatedInstaller(installer) {
  try {
    const url = new URL(installer?.url), segments = url.pathname.split('/');
    const tag = parseVersion(decodeURIComponent(segments[5] || '')), name = installerName(installer.name);
    if (tag && name && name.parts.every((part, index) => part === tag.parts[index]) &&
      installer.url === `${REPOSITORY}/releases/download/${encodeURIComponent(segments[5])}/${encodeURIComponent(installer.name)}`) return name;
  } catch (_) {}
  return null;
}

function getDownloadFallbacks(release, { platform = process.platform, arch = process.arch } = {}) {
  const name = validatedInstaller(release?.installer), version = parseVersion(release?.latestVersion);
  if (platform !== 'darwin' || !name || name.arch !== arch || !version ||
    name.parts.some((part, index) => part !== version.parts[index])) return { browser: null, domestic: null };
  return { browser: release.installer.url,
    // Verified 0.4.08 Apple Silicon sharing page. Never use it for another version/architecture.
    domestic: name.arch === 'arm64' && name.parts.join('.') === '0.4.8' ? 'https://share.weiyun.com/ZdAiD7rR' : null };
}

function downloadInstaller(webContents, installer, { onProgress = () => {}, onDiagnostic = () => {}, downloadsPath } = {}) {
  if (!validatedInstaller(installer) || !webContents || webContents.isDestroyed()) return Promise.resolve(downloadError('INVALID_INSTALLER'));
  const pending = pendingDownloads.get(webContents);
  if (pending) return Promise.resolve(downloadError(pending.expired ? 'START_PENDING' : 'DOWNLOAD_BUSY'));
  return new Promise(resolve => {
    const session = webContents.session;
    const entry = { expired: false };
    pendingDownloads.set(webContents, entry);
    let item = null, finished = false, retries = 0, retryTimer = null, recoveryTimer = null;
    const notify = value => { try { onProgress(value); } catch (_) {} };
    // Only fixed stage/code and a bounded counter are logged; never URL chains or save paths.
    const diagnostic = (code, stage, attempt) => {
      try { onDiagnostic({ code, stage, ...(attempt ? { attempt } : {}) }); } catch (_) {}
    };
    const removeStartListeners = () => {
      session.removeListener('will-download', receive);
      webContents.removeListener('destroyed', closed);
    };
    const clearEntry = () => {
      removeStartListeners();
      if (pendingDownloads.get(webContents) === entry) pendingDownloads.delete(webContents);
    };
    const stopItem = () => { try { item?.cancel(); } catch (_) {} };
    const finish = (result, waitForLate = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(retryTimer); clearTimeout(recoveryTimer);
      if (waitForLate) entry.expired = true;
      else clearEntry();
      item?.removeListener('updated', progress);
      item?.removeListener('done', done);
      diagnostic(result.code, result.stage);
      notify(result);
      resolve(result);
    };
    const closed = () => { if (finished) clearEntry(); else finish(downloadError('WINDOW_CLOSED')); };
    const failTransfer = code => { finish(downloadError(code)); stopItem(); };
    const progress = (_event, state) => {
      if (finished) return;
      if (state === 'interrupted') {
        if (retryTimer) return;
        clearTimeout(recoveryTimer); recoveryTimer = null;
        let resumable = false;
        try { resumable = item.canResume(); } catch (_) {}
        if (!resumable || retries >= 2) { failTransfer('TRANSFER_INTERRUPTED'); return; }
        notify({ state: 'retrying', stage: 'transfer', attempt: retries + 1, maxAttempts: 2 });
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (finished) return;
          try {
            if (!item.canResume()) { failTransfer('TRANSFER_INTERRUPTED'); return; }
            retries++;
            diagnostic('RESUME_ATTEMPT', 'transfer', retries);
            // DownloadItem.updated/interrupted is resumable; done/interrupted is terminal.
            // A server without range support may restart this same item; never spawn another download.
            recoveryTimer = setTimeout(() => { recoveryTimer = null; progress(null, 'interrupted'); }, 15000);
            item.resume();
          } catch (_) { failTransfer('RESUME_FAILED'); }
        }, retries === 0 ? 1000 : 3000);
        return;
      }
      clearTimeout(retryTimer); retryTimer = null;
      clearTimeout(recoveryTimer); recoveryTimer = null;
      try {
        const total = item.getTotalBytes(), received = item.getReceivedBytes();
        notify({ state: 'downloading', stage: 'transfer', percent: total > 0 ? Math.min(100, Math.floor(received / total * 100)) : null });
      } catch (_) { failTransfer('DOWNLOAD_FAILED'); }
    };
    const done = (_event, state) => {
      if (finished) return;
      try { finish(state === 'completed'
        ? { state: 'completed', code: 'DOWNLOAD_COMPLETED', stage: 'complete', path: item.getSavePath() }
        : downloadError(state === 'cancelled' ? 'CANCELLED' : 'DOWNLOAD_FAILED')); }
      catch (_) { failTransfer('DOWNLOAD_FAILED'); }
    };
    const receive = (event, download, sender) => {
      if (sender !== webContents) return;
      try { if (!download.getURLChain().includes(installer.url)) return; } catch (_) { return; }
      if (finished) {
        // A timed-out request must not become an untracked download or attach to a later retry.
        try { if (typeof event.preventDefault === 'function') event.preventDefault(); else download.cancel(); } catch (_) {}
        clearEntry();
        return;
      }
      item = download;
      clearTimeout(timer);
      removeStartListeners();
      try {
        item.setSaveDialogOptions({ title: '下载球球安装包', buttonLabel: '下载',
          defaultPath: downloadsPath ? path.join(downloadsPath, installer.name) : installer.name,
          filters: [{ name: 'macOS 安装包', extensions: ['dmg'] }] });
        item.on('updated', progress);
        item.once('done', done);
        notify({ state: 'downloading', stage: 'save', percent: null });
      } catch (_) { failTransfer('SAVE_DIALOG_FAILED'); }
    };
    // Keep one late-event guard until the request arrives or its window is destroyed.
    // While it exists, native retry is blocked; browser alternatives remain available.
    const timer = setTimeout(() => finish(downloadError('START_TIMEOUT'), true), 30000);
    session.on('will-download', receive);
    webContents.once('destroyed', closed);
    notify({ state: 'starting', stage: 'start' });
    try { webContents.downloadURL(installer.url); }
    catch (_) { finish(downloadError('START_FAILED')); }
  });
}

function getJson(url, options) {
  return new Promise((resolve, reject) => {
    let request = null, done = false;
    const timer = setTimeout(() => {
      finish(updateError(TIMEOUT_ERROR));
      request?.destroy();
    }, 10000);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    try {
      request = https.get(url, options, response => {
        response.on('error', () => finish(updateError(NETWORK_ERROR)));
        response.on('aborted', () => finish(updateError(NETWORK_ERROR)));
        if (response.statusCode !== 200) {
          finish(updateError(response.statusCode === 404 ? NOT_FOUND_ERROR : FORMAT_ERROR));
          response.destroy();
          return;
        }
        const chunks = [];
        let length = 0;
        response.on('data', chunk => {
          if (done) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          length += buffer.length;
          if (length > 256 * 1024) {
            finish(updateError(FORMAT_ERROR));
            response.destroy();
          } else chunks.push(buffer);
        });
        response.on('end', () => {
          if (done) return;
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (_) { finish(updateError(FORMAT_ERROR)); }
        });
      });
      request.on('error', () => finish(updateError(NETWORK_ERROR)));
    } catch (_) { finish(updateError(NETWORK_ERROR)); }
  });
}

async function checkLatestRelease(currentVersion, { get = getJson, platform = process.platform, arch = process.arch } = {}) {
  const current = parseVersion(currentVersion);
  if (!current) throw updateError('当前版本号无效，无法检查更新。');
  let release;
  try {
    release = await get(ENDPOINT, { headers: {
      'User-Agent': `Qiuqiu/${current.version}`, Accept: 'application/vnd.github+json'
    } });
  } catch (error) {
    const message = SAFE_ERRORS.has(error?.publicMessage) ? error.publicMessage : NETWORK_ERROR;
    throw updateError(message);
  }
  let tag, latest;
  try {
    if (!release || typeof release !== 'object' || Array.isArray(release) ||
        release.draft !== false || release.prerelease !== false) throw new Error();
    tag = release.tag_name;
    latest = parseVersion(tag);
    if (!latest) throw new Error();
  } catch (_) { throw updateError(FORMAT_ERROR); }
  let hasUpdate = false;
  for (let index = 0; index < 3; index += 1) {
    if (latest.parts[index] === current.parts[index]) continue;
    hasUpdate = latest.parts[index] > current.parts[index];
    break;
  }
  const installer = selectInstaller(release, platform, arch);
  const device = arch === 'arm64' ? 'Apple 芯片 Mac' : arch === 'x64' ? 'Intel Mac' : '当前设备';
  return { currentVersion: current.version, latestVersion: latest.version, hasUpdate,
    url: `${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`, installer,
    downloadMessage: installer ? '' : `暂无适合 ${device} 的新版安装包，请稍后重试。` };
}

module.exports = { checkLatestRelease, downloadInstaller, getDownloadFallbacks };
