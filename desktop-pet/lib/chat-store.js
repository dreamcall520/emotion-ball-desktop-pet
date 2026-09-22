const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const MAX_MESSAGES = 80;
const MAX_TEXT = 16000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHATS = 100;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const emptyRecord = () => ({ version: 1, accountKey: null, threadId: null, creationPending: false, pendingTurn: false, messages: [] });
const storageError = () => Object.assign(new Error('聊天记录暂时无法保存，请检查本机存储后再试。'), { code: 'STORAGE' });

function normalizeRecord(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.messages) ||
      (raw.threadId !== null && !validId(raw.threadId)) ||
      (raw.accountKey !== null && (typeof raw.accountKey !== 'string' || !/^[a-f0-9]{64}$/.test(raw.accountKey)))) throw storageError();
  const record = {
    version: 1, accountKey: raw.accountKey, threadId: raw.threadId,
    creationPending: raw.creationPending === true, pendingTurn: raw.pendingTurn === true,
    messages: raw.messages.slice(-MAX_MESSAGES).map(message => {
      if (!message || !validId(message.id) || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string') throw storageError();
      return { id: message.id, role: message.role, text: message.text.slice(0, MAX_TEXT),
        status: ['streaming', 'complete', 'interrupted', 'error'].includes(message.status) ? message.status : 'complete' };
    })
  };
  // Keep the latest complete exchanges within the same budget used on read.
  while (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_BYTES && record.messages.length) {
    record.messages.shift();
    while (record.messages[0]?.role === 'assistant') record.messages.shift();
  }
  return record;
}

const chatTitle = record => record.messages.find(message => message.role === 'user')?.text.trim().replace(/\s+/g, ' ').slice(0, 48) || '还没开始的聊天';
const hasChat = record => Boolean(record.threadId || record.creationPending || record.messages.length);
function createChatRecord(record = emptyRecord(), now = Date.now()) {
  const clean = normalizeRecord(record);
  return { ...clean, chatId: record.chatId || (clean.threadId ? `chat-${createHash('sha256').update(clean.threadId).digest('hex').slice(0, 32)}` : randomUUID()),
    title: record.title || chatTitle(clean), updatedAt: record.updatedAt ?? now };
}
function normalizeArchive(raw) {
  if (raw?.version === 1) return { ...createChatRecord(raw), version: 2, history: [] };
  if (!raw || raw.version !== 2 || !Array.isArray(raw.history) || raw.history.length >= MAX_CHATS) throw storageError();
  const normalizeChat = value => {
    if (!validId(value?.chatId) || typeof value.title !== 'string' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) throw storageError();
    return { ...normalizeRecord({ ...value, version: 1 }), chatId: value.chatId, title: value.title.slice(0, 48), updatedAt: value.updatedAt };
  };
  const active = normalizeChat(raw), history = raw.history.map(normalizeChat);
  const ids = new Set(), threads = new Set();
  for (const chat of [active, ...history]) {
    if (ids.has(chat.chatId) || (chat.threadId && threads.has(chat.threadId))) throw storageError();
    ids.add(chat.chatId); if (chat.threadId) threads.add(chat.threadId);
  }
  const archive = { ...active, version: 2, history };
  if (Buffer.byteLength(JSON.stringify(archive), 'utf8') > MAX_ARCHIVE_BYTES) throw storageError();
  return archive;
}

function createChatStore(file) {
  return {
    read() {
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE_BYTES) throw storageError();
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        return raw?.version === 2 ? normalizeArchive(raw) : normalizeRecord(raw);
      } catch (error) {
        if (error.code === 'ENOENT') return emptyRecord();
        throw storageError();
      }
    },
    write(record) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const content = JSON.stringify(record?.version === 2 ? normalizeArchive(record) : normalizeRecord(record));
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, file);
      } catch (_) {
        try { fs.unlinkSync(temporary); } catch (_) {}
        throw storageError();
      }
    }
  };
}

module.exports = { createChatStore, normalizeRecord, normalizeArchive, createChatRecord, chatTitle, hasChat, emptyRecord, validId, MAX_MESSAGES, MAX_TEXT, MAX_BYTES, MAX_CHATS, MAX_ARCHIVE_BYTES };
