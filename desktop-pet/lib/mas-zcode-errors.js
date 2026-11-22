'use strict';
const messages = Object.freeze({
  DIRECTORY_ACCESS_REQUIRED: '应用或账号目录授权已失效，请重新选择。',
  ZCODE_LOGIN_REQUIRED: '未读取到当前官方账号，请在 ZCode 中确认登录后重试。',
  ZCODE_ACCOUNT_MISSING: '所选目录中未找到 ZCode 账号，请重新选择账号目录。',
  ZCODE_ACCOUNT_CHANGED: 'ZCode 账号已切换，请重新连接当前账号。',
  ACCOUNT_CHANGED: 'ZCode 账号已切换，请重新连接当前账号。',
  ZCODE_CREDENTIAL_SECURE_STORAGE_REQUIRED: '暂未读取到 ZCode 的系统钥匙串授权，请重试。',
  ZCODE_CREDENTIAL_DECRYPT_FAILED: '暂未解开 ZCode 的本机凭据，请确认官方应用可正常使用后重试。',
  ZCODE_INVALID_RESPONSE: 'ZCode 本机组件未正常返回，请重试。',
  ZCODE_NETWORK_ERROR: '暂时无法连接 ZCode 服务，请检查网络后重试。',
  ZCODE_HTTP_ERROR: 'ZCode 服务暂未返回可用结果，请稍后重试。',
  ZCODE_TEAM_SELECTION_REQUIRED: '请先在 ZCode 中选定团队、项目和套餐。',
  ZCODE_TEAM_ACCESS_DENIED: '当前官方团队或项目暂不可用，请在 ZCode 中核对。',
  ZCODE_PLAN_ACCESS_DENIED: '当前官方套餐暂不可用，请在 ZCode 中核对。',
  ZCODE_REMINDER_CLEANUP_FAILED: '连接已解除，提醒设置尚未清理完成，请重试关闭提醒。',
  TIMEOUT: 'ZCode 响应超时，请稍后重试。',
  CANCELLED: '连接已取消。'
});
function zcodeConnectionError(error) {
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'ZCODE_CONNECTION_FAILED';
  return { code, message: messages[code] || 'ZCode 连接暂未完成，请重试。' };
}
module.exports = { zcodeConnectionError };
