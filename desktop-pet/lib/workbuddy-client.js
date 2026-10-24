const { spawn } = require('node:child_process');
const path = require('node:path');

const MESSAGES = {
  LOGIN_REQUIRED: '请在 WorkBuddy 中重新登录。', UNSUPPORTED_PLATFORM: '当前仅支持 macOS WorkBuddy。',
  UNSUPPORTED_AUTH: '当前 WorkBuddy 登录格式暂不支持，请更新球球。', UNSUPPORTED_ACCOUNT: '当前仅支持已验证的国内个人体验版套餐。',
  ACCOUNT_CHANGED: 'WorkBuddy 账号已变化，请新建聊天。', RATE_LIMITED: 'WorkBuddy 请求过于频繁，请稍后重试。',
  INSUFFICIENT_CREDITS: 'WorkBuddy 积分不足。', ACCOUNT_RESTRICTED: 'WorkBuddy 账号当前受限。',
  MODEL_UNAVAILABLE: '当前 WorkBuddy 模型不可用，请重新选择。', SERVICE_UNAVAILABLE: 'WorkBuddy 服务暂不可用。',
  INVALID_RESPONSE: 'WorkBuddy 返回格式异常，本次结果未更新。', TOOLS_UNSUPPORTED: '球球暂不支持 WorkBuddy 工具调用。',
  TRUNCATED_RESPONSE: 'WorkBuddy 回复未完整结束，请重新发送。', RESPONSE_TOO_LONG: 'WorkBuddy 回复超出长度限制。',
  CONTEXT_TOO_LONG: '聊天内容过长，请新建聊天。', TIMEOUT: 'WorkBuddy 请求超时。',
  CONNECTION_FAILED: '无法连接 WorkBuddy，请确认客户端已安装并登录。', INVALID_REQUEST: 'WorkBuddy 请求格式无效。',
  CANCELLED: '已停止 WorkBuddy 请求。'
};
function workBuddyError(code) {
  if (!Object.hasOwn(MESSAGES, code)) code = 'CONNECTION_FAILED';
  return Object.assign(new Error(MESSAGES[code]), { code, publicMessage: MESSAGES[code] });
}
function createWorkBuddyRunner({ spawnProcess = spawn, binary = '/Applications/WorkBuddy.app/Contents/MacOS/Electron',
  helper = path.join(__dirname, 'workbuddy-helper.cjs'), schedule = setTimeout, cancel = clearTimeout } = {}) {
  return function runWorkBuddy(operation, payload = {}, { signal, onDelta } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(workBuddyError('CANCELLED')); return; }
      if (!['quota', 'models', 'chat'].includes(operation)) { reject(workBuddyError('INVALID_REQUEST')); return; }
      let input;
      try { input = JSON.stringify({ operation, payload }); } catch (_) { reject(workBuddyError('INVALID_REQUEST')); return; }
      if (input.length > 256000) { reject(workBuddyError('CONTEXT_TOO_LONG')); return; }
      let child, timer, settled = false, buffer = '', bytes = 0, result, remoteError;
      const abort = () => finish(workBuddyError('CANCELLED'));
      function finish(error, value) {
        if (settled) return;
        settled = true;
        if (timer) cancel(timer);
        signal?.removeEventListener('abort', abort);
        if (child && child.exitCode === null) child.kill();
        error ? reject(error) : resolve(value);
      }
      function line(value) {
        if (!value.trim()) return;
        try {
          const packet = JSON.parse(value);
          if (packet.type === 'delta' && operation === 'chat' && typeof packet.text === 'string' && !result && !remoteError) {
            onDelta?.(packet.text);
          } else if (packet.type === 'result' && !result && !remoteError && packet.result &&
              /^[0-9a-f]{64}$/.test(packet.result.accountKey || '')) {
            result = packet.result;
          } else if (packet.type === 'error' && !result && !remoteError) {
            remoteError = workBuddyError(packet.code);
            if (/^[0-9a-f]{64}$/.test(packet.accountKey || '')) remoteError.accountKey = packet.accountKey;
          }
          else finish(workBuddyError('INVALID_RESPONSE'));
        } catch (_) { finish(workBuddyError('INVALID_RESPONSE')); }
      }
      try {
        child = spawnProcess(binary, [helper], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        timer = schedule(() => finish(workBuddyError('TIMEOUT')), operation === 'chat' ? 185000 : 60000);
        timer?.unref?.();
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          if (settled) return;
          bytes += Buffer.byteLength(chunk); buffer += chunk;
          if (bytes > 2 * 1024 * 1024 || buffer.length > 1024 * 1024) { finish(workBuddyError('INVALID_RESPONSE')); return; }
          let end;
          while (!settled && (end = buffer.indexOf('\n')) >= 0) { const value = buffer.slice(0, end); buffer = buffer.slice(end + 1); line(value); }
        });
        // Discard native diagnostics: never forward untrusted process stderr to UI or logs.
        child.stderr.on('data', () => {});
        child.on('error', () => finish(workBuddyError('CONNECTION_FAILED')));
        child.stdin.on('error', () => finish(workBuddyError('CONNECTION_FAILED')));
        child.on('close', code => {
          if (settled) return;
          if (buffer.trim()) line(buffer);
          if (remoteError) finish(remoteError);
          else if (code === 0 && result) finish(null, result);
          else finish(workBuddyError('CONNECTION_FAILED'));
        });
        child.stdin.end(input);
      } catch (_) { finish(workBuddyError('CONNECTION_FAILED')); }
    });
  };
}
const runWorkBuddy = createWorkBuddyRunner();
module.exports = { runWorkBuddy, createWorkBuddyRunner, workBuddyError };
