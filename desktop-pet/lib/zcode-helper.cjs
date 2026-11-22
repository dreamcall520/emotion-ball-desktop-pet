'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, createDecipheriv } = require('node:crypto');
const { readZcodeAccount, decryptCredential } = require('./zcode-account');
const { fetchZcodeUsage } = require('./zcode-usage');
const { isTeam } = require('./zcode-team-auth');
const fail = code => Object.assign(new Error(code), { code });
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function scopedIo(directory, io = fs) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.basename(directory) !== '.zcode' || directory.includes('\0')) throw fail('DIRECTORY_ACCESS_REQUIRED');
  const root = path.resolve(directory), stat = io.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || io.realpathSync(root) !== root) throw fail('DIRECTORY_ACCESS_REQUIRED');
  function check(file) {
    const candidate = path.resolve(file);
    if (!inside(root, candidate) || !inside(root, io.realpathSync(candidate))) throw fail('ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY');
    const entry = io.lstatSync(candidate);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 1024 * 1024) throw fail('ZCODE_INVALID_ACCOUNT_FILE');
    return candidate;
  }
  return { root, statSync: file => io.statSync(check(file)), readFileSync: (file, ...args) => io.readFileSync(check(file), ...args) };
}
async function createAccountReader({ directory, appDirectory, io = fs, getExistingKey } = {}) {
  const files = scopedIo(directory, io), credentialFile = path.join(files.root, 'v2/credentials.json');
  let encodedKey, key;
  async function systemKey() {
    if (key) return key;
    if (!getExistingKey) {
      if (typeof appDirectory !== 'string' || !path.isAbsolute(appDirectory) || path.basename(appDirectory) !== 'ZCode.app' || appDirectory.includes('\0')) throw fail('DIRECTORY_ACCESS_REQUIRED');
      const module = path.join(appDirectory, 'Contents/Resources/app.asar/node_modules/@napi-rs/keyring');
      getExistingKey = async () => {
        const { AsyncEntry } = require(module);
        const entry = new AsyncEntry('ZCode Credential Encryption', createHash('sha256').update(path.resolve(credentialFile)).digest('hex'));
        // Read the existing OS entry only. Never initialize, migrate or set a key.
        return entry.getPassword();
      };
    }
    try { encodedKey = await getExistingKey(); } catch { throw fail('ZCODE_CREDENTIAL_SECURE_STORAGE_REQUIRED'); }
    if (typeof encodedKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw fail('ZCODE_CREDENTIAL_SECURE_STORAGE_REQUIRED');
    key = Buffer.from(encodedKey, 'base64url'); encodedKey = undefined;
    if (key.length !== 32) throw fail('ZCODE_CREDENTIAL_DECRYPT_FAILED');
    return key;
  }
  async function read() {
    const raw = JSON.parse(files.readFileSync(credentialFile, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('ZCODE_INVALID_ACCOUNT_FILE');
    if (Object.values(raw).some(value => typeof value === 'string' && value.startsWith('enc:v2:'))) await systemKey();
    const decoded = {};
    const credentialHome = path.dirname(files.root), user = os.userInfo();
    const secret = `zcode-credential-fallback:${os.platform()}:${user.homedir}:${user.username}`;
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value !== 'string') continue;
      if (!value.startsWith('enc:v2:')) { decoded[name] = decryptCredential(value, secret); continue; }
      const pieces = /^enc:v2:os:([a-f0-9]{24}):([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value);
      if (!pieces || pieces[1] !== createHash('sha256').update(key).digest('hex').slice(0, 24)) throw fail('ZCODE_CREDENTIAL_DECRYPT_FAILED');
      const iv = Buffer.from(pieces[2], 'base64url'), tag = Buffer.from(pieces[3], 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw fail('ZCODE_CREDENTIAL_DECRYPT_FAILED');
      try { const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
        decoded[name] = Buffer.concat([decipher.update(Buffer.from(pieces[4], 'base64url')), decipher.final()]).toString('utf8');
      } catch { throw fail('ZCODE_CREDENTIAL_DECRYPT_FAILED'); }
    }
    const source = { statSync: files.statSync, readFileSync: (file, ...args) => path.resolve(file) === credentialFile
      ? JSON.stringify(decoded) : files.readFileSync(file, ...args) };
    return readZcodeAccount({ home: credentialHome, env: { ZCODE_DATA_BASE_DIR: credentialHome }, fs: source, requireScopedApiKey: true });
  }
  return { read, close() { key?.fill(0); key = encodedKey = undefined; } };
}
function projectAccount(account) {
  if (!validHash(account?.accountKey) || !['zai', 'bigmodel'].includes(account.family)) throw fail('ZCODE_LOGIN_REQUIRED');
  return { accountKey: account.accountKey, family: account.family,
    selection: { kind: account.selection?.kind || null, scope: account.selection?.scope === 'team' ? 'team' : 'personal' },
    hasJwtToken: typeof account.jwtToken === 'string' && !!account.jwtToken && !account.jwtToken.startsWith('enc:'),
    hasAccessToken: typeof account.accessToken === 'string' && !!account.accessToken && !account.accessToken.startsWith('enc:'),
    hasCodingPlanKey: typeof account.codingPlanApiKey === 'string' && !!account.codingPlanApiKey && !account.codingPlanApiKey.startsWith('enc:'),
    hasDeviceMid: !!account.deviceMid };
}
async function runOperation(operation, payload, { reader, appVersion, fetch: fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!['account-check', 'usage'].includes(operation) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
    Object.keys(payload).some(key => key !== 'expectedAccountKey') || payload.expectedAccountKey !== undefined && !validHash(payload.expectedAccountKey) ||
    operation === 'usage' && !validHash(payload.expectedAccountKey)) throw fail('INVALID_REQUEST');
  const account = await reader.read(), projected = projectAccount(account);
  if (payload.expectedAccountKey !== undefined && projected.accountKey !== payload.expectedAccountKey) throw fail('ZCODE_ACCOUNT_CHANGED');
  if (operation === 'account-check') return projected;
  const quota = await fetchZcodeUsage(account, { appVersion, now,
    fetch: (url, init = {}) => { if ((init.method || 'GET') !== 'GET') throw fail('ZCODE_MAS_READ_ONLY'); return fetchImpl(url, init); },
    resolveTeamAccount: async selected => { if (isTeam(selected) && !selected.codingPlanApiKey) throw fail('ZCODE_TEAM_KEY_MISSING'); return selected; } });
  const latest = await reader.read();
  if (latest.accountKey !== account.accountKey || latest.jwtToken !== account.jwtToken || latest.accessToken !== account.accessToken || latest.codingPlanApiKey !== account.codingPlanApiKey) throw fail('ZCODE_ACCOUNT_CHANGED');
  return { accountKey: account.accountKey, ...quota };
}
const SAFE_ERRORS = new Set(['INVALID_REQUEST', 'DIRECTORY_ACCESS_REQUIRED', 'ZCODE_ACCOUNT_CHANGED', 'ZCODE_OUTSIDE_AUTHORIZED_DIRECTORY',
  'ZCODE_ACCOUNT_MISSING', 'ZCODE_INVALID_ACCOUNT_FILE', 'ZCODE_CREDENTIAL_SECURE_STORAGE_REQUIRED', 'ZCODE_CREDENTIAL_DECRYPT_FAILED',
  'ZCODE_PROVIDER_UNSUPPORTED', 'ZCODE_LOGIN_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR', 'ZCODE_INVALID_RESPONSE',
  'ZCODE_USAGE_UNAVAILABLE', 'ZCODE_BILLING_ERROR', 'ZCODE_MAS_READ_ONLY']);
async function main() {
  let reader;
  try {
    let input = ''; for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 4096) throw fail('INVALID_REQUEST'); }
    const request = JSON.parse(input), appDirectory = process.env.QIUQIU_ZCODE_APP_DIRECTORY, directory = process.env.QIUQIU_ZCODE_ACCOUNT_DIRECTORY;
    if (typeof appDirectory !== 'string') throw fail('DIRECTORY_ACCESS_REQUIRED');
    const plist = fs.readFileSync(path.join(appDirectory, 'Contents/Info.plist'), 'utf8');
    const appVersion = /<key>CFBundleShortVersionString<\/key>\s*<string>(\d{1,4}(?:\.\d{1,4}){1,3})<\/string>/.exec(plist)?.[1];
    if (!appVersion) throw fail('INVALID_REQUEST');
    reader = await createAccountReader({ directory, appDirectory });
    const result = await runOperation(request.operation, request.payload || {}, { reader, appVersion,
      ...(Number.isSafeInteger(request.now) && request.now >= 0 ? { now: request.now } : {}) });
    process.stdout.write(JSON.stringify({ type: 'result', result }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ type: 'error', code: SAFE_ERRORS.has(error.code) ? error.code : 'ZCODE_INVALID_RESPONSE' }) + '\n'); process.exitCode = 1; }
  finally { reader?.close(); }
}
if (require.main === module) void main();
module.exports = { createAccountReader, projectAccount, runOperation };
