const MESSAGES = Object.freeze({
  LOGIN_REQUIRED: '请在 WorkBuddy 中重新登录',
  ACCOUNT_CHANGED: 'WorkBuddy 账号已变化，正在重新连接',
  UNSUPPORTED_PLATFORM: '当前仅支持 macOS WorkBuddy',
  UNSUPPORTED_AUTH: '当前 WorkBuddy 登录格式暂不支持，请更新球球',
  UNSUPPORTED_ACCOUNT: '当前 WorkBuddy 登录身份暂无法识别',
  UNSUPPORTED_QUOTA: '当前 WorkBuddy 积分格式暂无法识别，请更新球球',
  RATE_LIMITED: 'WorkBuddy 请求较多，稍后自动重试',
  TIMEOUT: '查询超时，稍后自动重试',
  CONNECTION_FAILED: '连接暂未恢复，稍后自动重试',
  SERVICE_UNAVAILABLE: 'WorkBuddy 服务暂不可用，稍后自动重试',
  INVALID_RESPONSE: '本次返回不完整，稍后自动重试',
  ACCOUNT_RESTRICTED: 'WorkBuddy 账号当前受限，请在客户端检查',
  UPDATE_FAILED: '更新失败，请稍后重试'
});
const errorCode = code => typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'UPDATE_FAILED';
const errorMessage = code => MESSAGES[errorCode(code)];
const clearsAccount = code => ['ACCOUNT_CHANGED', 'LOGIN_REQUIRED', 'UNSUPPORTED_ACCOUNT', 'UNSUPPORTED_AUTH'].includes(code);
const waitsForUser = code => ['LOGIN_REQUIRED', 'UNSUPPORTED_ACCOUNT', 'UNSUPPORTED_AUTH', 'UNSUPPORTED_PLATFORM', 'UNSUPPORTED_QUOTA', 'ACCOUNT_RESTRICTED'].includes(code);
const transient = code => ['TIMEOUT', 'CONNECTION_FAILED', 'SERVICE_UNAVAILABLE', 'ACCOUNT_CHANGED'].includes(code);
function retryDelay(code, failures) {
  if (waitsForUser(code)) return null;
  const fast = [15000, 45000, 120000];
  if (transient(code) && failures <= fast.length) return fast[failures - 1];
  const step = Math.max(0, failures - 1 - (transient(code) ? fast.length : 0));
  return Math.min(30 * 60000, 5 * 60000 * 2 ** Math.min(step, 3));
}
module.exports = { errorCode, errorMessage, clearsAccount, retryDelay };
