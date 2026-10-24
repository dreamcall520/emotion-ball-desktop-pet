const nativeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, createDecipheriv } = require('node:crypto');

const MAX_BYTES = 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });
function readJson(fs, filePath, optional = false) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw fail('ZCODE_INVALID_ACCOUNT_FILE');
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('ZCODE_INVALID_ACCOUNT_FILE');
    return value;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return {};
    throw fail(error.code === 'ENOENT' ? 'ZCODE_ACCOUNT_MISSING' : 'ZCODE_INVALID_ACCOUNT_FILE');
  }
}
function decryptCredential(value, secret) {
  if (typeof value !== 'string' || !value.length || value.length > MAX_BYTES) return null;
  if (!value.startsWith('enc:v1:')) return value;
  try {
    const pieces = value.slice(7).split('.');
    if (pieces.length !== 3 || pieces.some(piece => !/^[A-Za-z0-9_-]+$/.test(piece))) throw new Error();
    const [iv, tag, ciphertext] = pieces.map(piece => Buffer.from(piece, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (_error) { throw fail('ZCODE_CREDENTIAL_DECRYPT_FAILED'); }
}
// Matches the installed ZCode credential cipher; never mutate or repair its credential store.
function readZcodeAccount({ home = os.homedir(), env = process.env, fs = nativeFs } = {}) {
  const base = env.ZCODE_DATA_BASE_DIR?.trim() || home;
  const dir = path.join(base === '~' ? home : base.startsWith('~/') ? path.join(home, base.slice(2)) : base, '.zcode', 'v2');
  const credentialsPath = path.join(dir, 'credentials.json');
  let username = 'unknown'; try { username = os.userInfo().username; } catch (_ignored) {}
  const secret = env.ZCODE_CREDENTIAL_SECRET?.trim() || `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
  const raw = readJson(fs, credentialsPath);
  const load = key => decryptCredential(raw[key], secret);
  const family = load('oauth:active_provider');
  if (!['zai', 'bigmodel'].includes(family)) throw fail('ZCODE_PROVIDER_UNSUPPORTED');
  const jwtToken = load('zcodejwttoken'); const accessToken = load(`oauth:${family}:access_token`);
  if (!jwtToken && !accessToken) throw fail('ZCODE_LOGIN_REQUIRED');
  let user = {}; try { user = JSON.parse(load(`oauth:${family}:user_info`) || '{}'); } catch (_ignored) {}
  const accountId = String(user.user_id || user.id || user.sub || '');
  const settings = readJson(fs, path.join(dir, 'setting.json'), true);
  const storedSelection = settings.providerFamilyConnectionSelections?.[family];
  const kind = ['start-plan', 'individual-coding-plan', 'team-coding-plan', 'api-key'].includes(storedSelection?.kind)
    ? storedSelection.kind : null;
  const providerId = kind ? `account:${family}-${kind}` : null;
  const selection = { family, providerId, scope: kind === 'team-coding-plan' ? 'team' : 'personal',
    ...(storedSelection && typeof storedSelection === 'object' ? storedSelection : {}), kind,
    mode: settings.modelProviderFamilyModes?.[family] || null,
    selectedKey: settings.modelProviderFamilySelectedKeys?.[family] || null,
    providerFamilyDomain: settings.providerFamilyDomain || null };
  const accountKey = createHash('sha256').update(JSON.stringify([family, accountId || jwtToken || accessToken,
    kind, storedSelection?.organizationId || null, storedSelection?.projectId || null])).digest('hex');
  const telemetry = readJson(fs, path.join(dir, 'telemetry-state.json'), true);
  const deviceMid = typeof telemetry.deviceMid === 'string' && /^[^\r\n]{1,256}$/.test(telemetry.deviceMid) ? telemetry.deviceMid : null;
  // Only use an actual configured Coding Plan key. OAuth/project key IDs are not API keys.
  const config = readJson(fs, path.join(dir, 'config.json'), true);
  const provider = config.provider?.[`builtin:${family}-coding-plan`];
  const expectedBase = family === 'zai' ? 'https://api.z.ai/api/anthropic' : 'https://open.bigmodel.cn/api/anthropic';
  const configuredKey = provider?.options?.apiKey;
  const configuredApiKey = kind !== 'team-coding-plan' && provider?.enabled === true && provider?.options?.baseURL?.replace(/\/$/, '') === expectedBase
    && typeof configuredKey === 'string' && /^[A-Za-z0-9._-]{10,4096}$/.test(configuredKey) ? configuredKey : null;
  let scopedKey = null;
  if (accountId && providerId && ['individual-coding-plan', 'team-coding-plan'].includes(kind)) {
    const parts = kind === 'team-coding-plan' && storedSelection.productId && storedSelection.organizationId && storedSelection.projectId
      ? ['team', providerId, storedSelection.productId, storedSelection.organizationId, storedSelection.projectId].map(encodeURIComponent).join(':')
      : kind === 'individual-coding-plan' ? `coding-plan:${providerId}` : null;
    if (parts) scopedKey = load(`account-provider:${parts}:account:${encodeURIComponent(accountId)}:api-key`);
  }
  const candidate = scopedKey || configuredApiKey;
  const codingPlanApiKey = typeof candidate === 'string' && /^[^\r\n]{10,4096}$/.test(candidate) && !/^(?:__|\$|<)/.test(candidate) ? candidate : null;
  return { accountKey, accountId, family, credentialsPath, jwtToken, accessToken, deviceMid,
    selection, codingPlanApiKey, baseDir: base };
}
module.exports = { readZcodeAccount, decryptCredential };
