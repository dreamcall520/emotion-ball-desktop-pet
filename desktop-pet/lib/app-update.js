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

function downloadInstaller(webContents, installer, { onProgress = () => {}, downloadsPath } = {}) {
  let valid = false;
  try {
    const url = new URL(installer?.url), segments = url.pathname.split('/');
    const tag = parseVersion(decodeURIComponent(segments[5] || '')), name = installerName(installer.name);
    valid = Boolean(tag && name && name.parts.every((part, index) => part === tag.parts[index]) &&
      installer.url === `${REPOSITORY}/releases/download/${encodeURIComponent(segments[5])}/${encodeURIComponent(installer.name)}`);
  } catch (_) {}
  if (!valid || !webContents || webContents.isDestroyed()) return Promise.resolve({ state: 'error', message: '新版安装包暂不可用，请重新检查更新。' });
  return new Promise(resolve => {
    const session = webContents.session;
    let item = null, finished = false;
    const notify = value => { try { onProgress(value); } catch (_) {} };
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      session.removeListener('will-download', receive);
      webContents.removeListener('destroyed', closed);
      item?.removeListener('updated', progress);
      item?.removeListener('done', done);
      notify(result);
      resolve(result);
    };
    const closed = () => finish({ state: 'error', message: '下载尚未开始，请重新打开关于球球后重试。' });
    const progress = (_event, state) => {
      if (state === 'interrupted') {
        finish({ state: 'error', message: '下载中断，请检查网络后重试。' });
        item.cancel();
        return;
      }
      const total = item.getTotalBytes(), received = item.getReceivedBytes();
      notify({ state: 'downloading', percent: total > 0 ? Math.min(100, Math.floor(received / total * 100)) : null });
    };
    const done = (_event, state) => finish(state === 'completed'
      ? { state: 'completed', path: item.getSavePath() }
      : state === 'cancelled' ? { state: 'cancelled', message: '已取消下载，可以重新下载。' }
        : { state: 'error', message: '下载失败，请检查网络和保存位置后重试。' });
    const receive = (_event, download, sender) => {
      if (sender !== webContents || !download.getURLChain().includes(installer.url)) return;
      item = download;
      clearTimeout(timer);
      session.removeListener('will-download', receive);
      webContents.removeListener('destroyed', closed);
      item.setSaveDialogOptions({ title: '下载球球安装包', buttonLabel: '下载',
        defaultPath: downloadsPath ? path.join(downloadsPath, installer.name) : installer.name,
        filters: [{ name: 'macOS 安装包', extensions: ['dmg'] }] });
      item.on('updated', progress);
      item.once('done', done);
      notify({ state: 'downloading', percent: null });
    };
    const timer = setTimeout(() => finish({ state: 'error', message: '下载启动超时，请检查网络后重试。' }), 30000);
    session.on('will-download', receive);
    webContents.once('destroyed', closed);
    notify({ state: 'starting' });
    try { webContents.downloadURL(installer.url); }
    catch (_) { finish({ state: 'error', message: '暂时无法开始下载，请稍后重试。' }); }
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

module.exports = { checkLatestRelease, downloadInstaller };
