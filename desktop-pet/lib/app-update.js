const https = require('node:https');

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
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? { parts, version: match.slice(1).join('.') } : null;
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

async function checkLatestRelease(currentVersion, { get = getJson } = {}) {
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
  return { currentVersion: current.version, latestVersion: latest.version, hasUpdate,
    url: `${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}` };
}

module.exports = { checkLatestRelease };
