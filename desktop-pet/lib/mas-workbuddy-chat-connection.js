'use strict';

// Reading local quota credentials is not consent to send chat content. This
// record grants only the explicitly approved account, with no path or token.
const PURPOSE = 'workbuddy-chat-v1';
const validAccount = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function createMasWorkBuddyChatConnection({ storage, getAccountKey, onChange = () => {}, onDisable = () => {} }) {
  let enabled = false, authorized = false, accountKey = null, epoch = 0, closed = false;
  let status = 'disabled', error = null, pending = Promise.resolve();
  const currentAccount = () => { try { const value = getAccountKey(); return validAccount(value) ? value : null; } catch { return null; } };
  const snapshot = () => ({ enabled, authorized, status,
    message: error || ({ disabled: 'WorkBuddy 聊天尚未启用。', enabling: '正在启用 WorkBuddy 聊天…',
      'waiting-account': '等待确认已连接的 WorkBuddy 账号。', 'needs-connection': '请先连接并确认 WorkBuddy 账号。',
      'account-changed': 'WorkBuddy 账号已变化，请重新同意启用聊天。', ready: '已同意使用当前 WorkBuddy 账号聊天。' }[status] || 'WorkBuddy 聊天暂时不可用。') });
  const notify = () => { try { onChange(snapshot()); } catch {} };
  const cancel = () => { try { onDisable(); } catch {} };
  function serialized(run) { const result = pending.catch(() => {}).then(run); pending = result.then(() => {}, () => {}); return result; }
  function invalidate(nextStatus, forceCancel = false) {
    const cancelling = forceCancel || enabled || authorized;
    ++epoch; enabled = authorized = false; accountKey = null; status = nextStatus; error = null;
    if (cancelling) cancel(); notify();
    return epoch;
  }
  async function removeConsent(current) {
    try { await storage.remove('workbuddy'); }
    catch {
      // A failed removal must never restore in-memory authority. Report only a
      // safe error so the user can retry persistent cleanup.
      if (!closed && current === epoch) { error = '聊天已停止，同意记录未能清除，请再次停用重试。'; notify(); }
    }
  }
  function checkAccount() {
    if (closed || !enabled || !accountKey) return;
    const current = currentAccount();
    if (current && current !== accountKey) {
      const generation = invalidate('account-changed');
      void serialized(() => removeConsent(generation));
    } else if (!current && authorized) {
      ++epoch; authorized = false; status = 'waiting-account'; cancel(); notify();
    }
  }
  function getState() { checkAccount(); return snapshot(); }
  return {
    getState,
    getGeneration() { checkAccount(); return epoch; },
    getAuthorizedAccountKey() { checkAccount(); return !closed && enabled && authorized ? accountKey : null; },
    restore() {
      if (closed) return Promise.resolve(snapshot());
      const current = invalidate('disabled');
      return serialized(async () => {
        let saved;
        try { saved = await storage.load('workbuddy'); }
        catch { if (!closed && current === epoch) { status = 'error'; error = '聊天同意记录暂时无法读取，请重新启用。'; notify(); } return snapshot(); }
        if (closed || current !== epoch) return snapshot();
        if (saved?.version !== 1 || saved.purpose !== PURPOSE || saved.enabled !== true || !validAccount(saved.accountKey)) return snapshot();
        enabled = true; accountKey = saved.accountKey;
        const latest = currentAccount();
        if (latest && latest !== accountKey) {
          const generation = invalidate('account-changed'); await removeConsent(generation); return snapshot();
        }
        authorized = latest === accountKey; status = authorized ? 'ready' : 'waiting-account'; notify(); return snapshot();
      });
    },
    enable() {
      checkAccount();
      if (closed) return Promise.resolve({ status: 'cancelled' });
      const owner = currentAccount();
      if (!owner) return Promise.resolve({ ...snapshot(), status: 'needs-connection', message: '请先连接并确认 WorkBuddy 账号。' });
      const current = invalidate('enabling');
      return serialized(async () => {
        if (closed || current !== epoch) return { status: 'cancelled' };
        if (currentAccount() !== owner) {
          const generation = invalidate('account-changed'); await removeConsent(generation); return snapshot();
        }
        try { await storage.save('workbuddy', { version: 1, purpose: PURPOSE, enabled: true, accountKey: owner }); }
        catch {
          if (closed || current !== epoch) { await removeConsent(current); return { status: 'cancelled' }; }
          const generation = invalidate('error'); error = '聊天同意未能保存，请重新启用。'; await removeConsent(generation); notify(); return snapshot();
        }
        if (closed || current !== epoch) { await removeConsent(current); return { status: 'cancelled' }; }
        const latest = currentAccount();
        if (latest !== owner) {
          const generation = invalidate(latest ? 'account-changed' : 'needs-connection'); await removeConsent(generation); return snapshot();
        }
        enabled = authorized = true; accountKey = owner; status = 'ready'; error = null; notify(); return snapshot();
      });
    },
    disable() {
      const current = invalidate('disabled', true);
      return serialized(async () => { await removeConsent(current); return snapshot(); });
    },
    refreshAccount() {
      checkAccount();
      if (!closed && enabled && !authorized && accountKey === currentAccount()) {
        ++epoch; authorized = true; status = 'ready'; error = null; notify();
      }
      return pending.then(() => snapshot());
    },
    close() { if (closed) return; closed = true; invalidate('disabled', true); }
  };
}
module.exports = { createMasWorkBuddyChatConnection };
