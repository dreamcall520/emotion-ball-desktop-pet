'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const VERSION = '2026-11-01-chat-data-v1';
const PROVIDERS = new Set(['codex', 'zcode', 'workbuddy']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
const denied = error => ({ accepted: false, error });
function createChatDataConsentStore(file) {
  if (!path.isAbsolute(file || '')) throw new TypeError('absolute consent file required');
  return {
    read() {
      let fd;
      try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > 32768) throw failure('CONSENT_STORAGE');
        const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
        if (!Array.isArray(value) || value.length > 64) return [];
        return value.filter(row => row && Object.keys(row).sort().join(',') === 'provider,scope,version' &&
          PROVIDERS.has(row.provider) && row.version === VERSION && /^[a-f0-9]{64}$/.test(row.scope));
      } catch (error) { if (error.code === 'ENOENT') return []; throw failure('CONSENT_STORAGE'); }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    },
    write(rows) {
      const directory = path.dirname(file), temporary = file + '.' + randomUUID() + '.tmp';
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (fs.lstatSync(directory).isSymbolicLink()) throw failure('CONSENT_STORAGE');
        fs.writeFileSync(temporary, JSON.stringify(rows), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch (_) { throw failure('CONSENT_STORAGE'); }
      finally { try { fs.unlinkSync(temporary); } catch (_) {} }
    }
  };
}
function context(raw) {
  if (!raw || !PROVIDERS.has(raw.provider) || typeof raw.channel !== 'string' || !/^[a-z0-9-]{1,80}$/.test(raw.channel)) throw failure('CONSENT_CONTEXT');
  const origin = new URL(raw.recipientOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.href !== origin.origin + '/') throw failure('CONSENT_CONTEXT');
  if (typeof raw.billing !== 'string' || !raw.billing || raw.billing.length > 300 || /[\x00-\x1f]/.test(raw.billing)) throw failure('CONSENT_CONTEXT');
  const accountKey = typeof raw.accountKey === 'string' && /^[a-f0-9]{64}$/.test(raw.accountKey) ? raw.accountKey : null;
  const identity = [VERSION, raw.provider, raw.channel, origin.origin, accountKey, raw.billing];
  return { provider: raw.provider, scope: hash(identity), persistable: accountKey !== null,
    fingerprint: hash([...identity, raw.conversationKey ?? null, raw.revision ?? null]),
    origin: origin.origin, billing: raw.billing, channel: raw.channel };
}
function disclosure(value) {
  const name = { codex: 'Codex', zcode: 'ZCode', workbuddy: 'WorkBuddy' }[value.provider];
  if(value.channel==='notes-organize')return{
    title:'允许将当前便签发送给 Codex 整理？',
    message:'仅在你点击智能整理时，将当前这条便签的标题和正文发送给 Codex 官方服务。',
    detail:'接收服务：'+value.origin+'\n'+value.billing+'\n不会发送其他便签、待办或原工具聊天记录。这项便签整理同意与聊天同意独立；切换账号或接收服务后重新确认。'+
      (value.persistable?'':'\n当前账号身份尚未核实，本次同意不会保存。')+
      '\n拒绝不会发送便签，原文保持不变。可随时在工具连接页的 Codex 中撤销 AI 数据同意，或解除该工具授权。',
    buttons:['暂不整理','同意并整理'],defaultId:0,cancelId:0,noLink:true,type:'question'
  };
  return {
    title: '允许将聊天内容发送给 ' + name + '？',
    message: '仅在你点击发送时，将这条消息和当前会话上下文发给所选 AI 服务。',
    detail: '接收服务：' + value.origin + '\n' + value.billing +
      '\n这项同意只用于当前工具、账号与服务来源；切换账号或接收服务后需要重新确认。' +
      (value.persistable ? '' : '\n当前账号身份尚未核实，本次同意不会保存，下次发送需重新确认。') +
      '\n拒绝不会发送消息。可随时在工具连接页撤销 AI 数据同意（含聊天与便签整理），或解除该工具授权。',
    buttons: ['暂不发送', '同意并发送'], defaultId: 0, cancelId: 0, noLink: true, type: 'question'
  };
}
function createChatDataConsent({ store, request } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function' || typeof request !== 'function') throw new TypeError('consent store and request required');
  let pending = false, closed = false;
  const revisions = new Map();
  function revoke(provider) {
    if (!PROVIDERS.has(provider)) throw failure('CONSENT_CONTEXT');
    revisions.set(provider, (revisions.get(provider) || 0) + 1);
    store.write(store.read().filter(row => row.provider !== provider));
  }
  async function run({ getContext, isCurrent = () => true, send, requestConsent = request } = {}) {
    if (closed || pending) return denied('正在确认聊天发送，请稍候。');
    if (typeof getContext !== 'function' || typeof send !== 'function') return denied('聊天来源暂时无法核对，消息未发送。');
    pending = true;
    try {
      if (!isCurrent()) return denied('聊天窗口或来源已变化，消息未发送。');
      const before = context(await getContext()), revision = revisions.get(before.provider) || 0;
      const rows = store.read();
      const known = before.persistable && rows.some(row => row.version === VERSION && row.provider === before.provider && row.scope === before.scope);
      if (!known && await requestConsent(disclosure(before)) !== true) return { ...denied('你已取消，消息未发送。'), cancelled: true };
      const after = context(await getContext());
      if (closed || !isCurrent() || before.fingerprint !== after.fingerprint || revision !== (revisions.get(before.provider) || 0)) return denied('账号、来源或会话已变化，请重新确认后发送。');
      if (!known && after.persistable) {
        const latest = store.read().filter(row => row.provider !== after.provider || row.scope !== after.scope);
        store.write([...latest.slice(-63), { version: VERSION, provider: after.provider, scope: after.scope }]);
      }
      // No await between the final owner/context check and the actual send call.
      if (closed || !isCurrent() || revision !== (revisions.get(before.provider) || 0)) return denied('聊天授权已变化，消息未发送。');
      return send();
    } catch (_) { return denied('无法安全核对聊天数据同意，消息未发送。请重新连接后再试。'); }
    finally { pending = false; }
  }
  return { run, revoke, close() { closed = true; } };
}
module.exports = { createChatDataConsent, createChatDataConsentStore, VERSION };
