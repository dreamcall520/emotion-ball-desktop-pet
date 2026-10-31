'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMasDirectoryAccess } = require('./mas-directory-access');
const { createMasCodexConnection } = require('./mas-codex-connection');
const { createCodexChatRpc } = require('./codex-chat-rpc');
const { createZcodeChatWsRpc } = require('./zcode-chat-ws-rpc');
const { loopbackEndpoint } = require('./codex-ws-transport');
const { createMasZcodeProvider } = require('./mas-zcode-provider');
const { createMasWorkBuddyProvider } = require('./mas-workbuddy-provider');
const PROVIDERS = new Set(['codex', 'zcode']);
const failure = code => Object.assign(new Error(code), { code });
function createDirectoryStorage(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const filename = provider => { if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER'); return path.join(root, provider + '.json'); };
  return {
    async load(provider) {
      let handle;
      try {
        handle = fs.openSync(filename(provider), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(handle);
        if (!stat.isFile() || stat.size > 256 * 1024) throw failure('INVALID_GRANT');
        return JSON.parse(fs.readFileSync(handle, 'utf8'));
      } catch (error) { if (error.code === 'ENOENT') return null; throw failure('GRANT_STORAGE_FAILED'); }
      finally { if (handle !== undefined) fs.closeSync(handle); }
    },
    async save(provider, grant) {
      const destination = filename(provider), temporary = destination + '.' + randomUUID() + '.tmp';
      try { fs.writeFileSync(temporary, JSON.stringify(grant), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, destination); }
      finally { try { fs.unlinkSync(temporary); } catch (_) {} }
    },
    async remove(provider) { try { fs.unlinkSync(filename(provider)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  };
}
function createDiagnosticDirectoryAccess({ dialog, storage }) {
  const grant = async provider => {
    const stored = await storage.load(provider);
    if (!stored?.directory || stored.kind !== 'diagnostic-user-selected') throw failure('DIRECTORY_ACCESS_REQUIRED');
    if (!(await fs.promises.stat(stored.directory)).isDirectory()) throw failure('DIRECTORY_ACCESS_REQUIRED');
    return stored;
  };
  return {
    async authorize(provider) {
      if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER');
      const selected = await dialog.showOpenDialog({ title: `选择 ${provider === 'codex' ? 'Codex 的 .codex' : 'ZCode 的 .zcode'} 数据目录`,
        message: '此为隔离联调候选；本次目录选择不等同系统沙盒验收。', properties: ['openDirectory', 'showHiddenFiles'] });
      if (selected.canceled) return { status: 'cancelled' };
      const directory = selected.filePaths?.[0];
      if (!directory || !path.isAbsolute(directory) || path.basename(directory) !== '.' + provider) throw failure('DIRECTORY_ACCESS_REQUIRED');
      const stat = await fs.promises.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('DIRECTORY_ACCESS_REQUIRED');
      await storage.save(provider, { kind: 'diagnostic-user-selected', directory });
      return { status: 'stored', directory };
    },
    async acquire(provider) { const value = await grant(provider); return { directory: value.directory, release() {} }; },
    async withAccess(provider, operation) { return operation((await grant(provider)).directory); },
    async getStatus(provider) { const value = await storage.load(provider); return value?.kind === 'diagnostic-user-selected' && typeof value.directory === 'string' && path.isAbsolute(value.directory) ? { status: 'stored', directory: value.directory } : { status: 'needs-authorization' }; },
    async revoke(provider) { await storage.remove(provider); return { status: 'needs-authorization' }; }
  };
}
function createMasProviderRuntime({ app, dialog, BrowserWindow, session, shell, fetch,
  diagnostic = false, onChange = () => {} } = {}) {
  let closed = false, runtimeClosing = null;
  const quotaPorts = new Set();
  const chatServices = Object.fromEntries([...PROVIDERS].map(provider => [provider, { service: null, generation: 0, clients: new Set() }]));
  const storage = createDirectoryStorage(path.join(app.getPath('userData'), 'store-directory-grants'));
  const access = diagnostic ? createDiagnosticDirectoryAccess({ dialog, storage }) : createMasDirectoryAccess({ app, dialog, storage });
  const workbuddy = createMasWorkBuddyProvider({ BrowserWindow, session, shell, onChange: () => { if (!closed) { for (const notify of quotaPorts) notify(); onChange(); } } });
  const zcode = createMasZcodeProvider({ directoryAccess: access, fetch });
  async function authorize(provider) {
    if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER');
    const result = await access.authorize(provider);
    if (result.status === 'stored' && path.basename(result.directory) !== '.' + provider) {
      await access.revoke(provider); throw failure('DIRECTORY_ACCESS_REQUIRED');
    }
    onChange(); return { status: result.status };
  }
  async function getState() {
    const [codex, zcodeDirectory] = await Promise.all(['codex', 'zcode'].map(p => access.getStatus(p)));
    const service = chatServices.codex.service, zcodeService = chatServices.zcode.service;
    return { mode: diagnostic ? 'diagnostic-unsandboxed' : 'mas-sandbox',
      codex: { directory: codex.status, serviceConfigured: Boolean(service), endpoint: service?.endpoint || null,
        tasks: 'authorized-session-logs', chat: service ? 'configured-unverified' : 'needs-local-service' },
      zcode: { directory: zcodeDirectory.status, capabilities: zcode.getCapabilities(),
        serviceConfigured: Boolean(zcodeService), endpoint: zcodeService?.endpoint || null,
        chat: zcodeService ? 'experimental-configured-unverified' : 'needs-experimental-local-service',
        publicApiContractVerified: false }, workbuddy: workbuddy.getState() };
  }
  async function importLocalService(provider) {
    if (!PROVIDERS.has(provider)) throw failure('INVALID_PROVIDER');
    if (closed) throw failure('CLOSED');
    const slot = chatServices[provider];
    const directory = await access.getStatus(provider);
    if (directory.status !== 'stored') throw failure('DIRECTORY_ACCESS_REQUIRED');
    const selected = await dialog.showOpenDialog({ title: `选择已运行 ${provider === 'codex' ? 'Codex' : 'ZCode 实验'}本机服务的连接目录`,
      message: provider === 'codex' ? '选择启动器输出的目录；无需打开或预览其中的配对文件。' :
        '仅供实验候选联调；不代表厂商授权或真实聊天已通过。选择 ZCode 启动器输出的目录，不预览配对文件。',
      properties: ['openDirectory'], securityScopedBookmarks: true });
    if (closed) throw failure('CLOSED');
    if (selected.canceled) return { status: 'cancelled' };
    const selectedDirectory = selected.filePaths?.[0];
    if (selected.filePaths?.length !== 1 || typeof selectedDirectory !== 'string' || !path.isAbsolute(selectedDirectory) || selectedDirectory.includes('\0')) throw failure('INVALID_PAIRING_FILE');
    const file = path.join(selectedDirectory, 'pairing.json'); let stop, handle;
    try {
      if (!diagnostic) {
        if (!selected.bookmarks?.[0]) throw failure('DIRECTORY_ACCESS_REQUIRED');
        stop = app.startAccessingSecurityScopedResource(selected.bookmarks[0]);
        if (typeof stop !== 'function') throw failure('DIRECTORY_ACCESS_REQUIRED');
      }
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw failure('INVALID_PAIRING_FILE');
      handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(handle);
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > 16384) throw failure('INVALID_PAIRING_FILE');
      const raw = JSON.parse(fs.readFileSync(handle, 'utf8'));
      const providerMatches = provider === 'zcode' ? raw.provider === 'zcode' : raw.provider === undefined || raw.provider === 'codex';
      if (!providerMatches || raw.version !== 1 || typeof raw.bearerToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{16,8192}={0,2}$/.test(raw.bearerToken) ||
        raw.hostHome !== path.dirname(directory.directory)) throw failure('INVALID_PAIRING_FILE');
      const selectedService = { endpoint: loopbackEndpoint(raw.endpoint), bearerToken: raw.bearerToken, hostHome: raw.hostHome };
      if (provider === 'zcode' && new URL(selectedService.endpoint).pathname !== '/zcode') throw failure('INVALID_PAIRING_FILE');
      if (closed) throw failure('CLOSED');
      slot.service = selectedService; slot.generation++;
      // A different underlying RPC is a different client to chat-companion: retire
      // the facade so its loaded thread/model identity cannot silently survive.
      await Promise.all([...slot.clients].map(client => client.invalidate()));
      if (closed) throw failure('CLOSED');
      onChange(); return { status: 'configured', endpoint: selectedService.endpoint };
    } catch (error) { throw failure(['DIRECTORY_ACCESS_REQUIRED', 'INVALID_ENDPOINT', 'CLOSED'].includes(error.code) ? error.code : 'INVALID_PAIRING_FILE'); }
    finally { if (handle !== undefined) fs.closeSync(handle); if (typeof stop === 'function') stop(); }
  }
  function localChat(provider, options = {}) {
    if (closed) throw failure('CLOSED');
    const slot = chatServices[provider];
    let target = null, epoch = -1, ended = false, closing = null;
    function retire(code) {
      if (closing) return closing;
      ended = true; slot.clients.delete(facade);
      const previous = target; target = null;
      closing = Promise.resolve().then(() => previous?.close()).catch(() => {});
      if (code) { try { options.onDisconnect?.(code); } catch (_) {} }
      return closing;
    }
    const facade = {
      async start() {
        if (ended || closed) throw failure('CLOSED');
        if (!slot.service) throw failure('MISSING');
        if (target && epoch !== slot.generation) {
          await retire('DISCONNECTED'); throw failure('DISCONNECTED');
        }
        if (!target) {
          const service = slot.service;
          const callbacks = { onNotification: packet => { if (!ended && !closed) options.onNotification?.(packet); },
            onDisconnect: code => { void retire(code); } };
          target = provider === 'codex'
            ? createCodexChatRpc({ ...options, hostHome: service.hostHome,
              webSocket: { endpoint: service.endpoint, bearerToken: service.bearerToken }, ...callbacks })
            : createZcodeChatWsRpc({ ...options, endpoint: service.endpoint, bearerToken: service.bearerToken, ...callbacks });
          epoch = slot.generation;
        }
        return target.start();
      },
      close() { return retire(); },
      invalidate() { return retire('DISCONNECTED'); }
    };
    for (const method of ['readAccount','startThread','resumeThread','startTurn','listModels','nameThread','readThreadEnvironment','verifyThreadEnvironment','interruptTurn']) {
      facade[method] = (...args) => {
        if (ended || closed) return Promise.reject(failure('CLOSED'));
        if (!slot.service) return Promise.reject(failure('MISSING'));
        if (epoch !== slot.generation) return Promise.reject(failure('DISCONNECTED'));
        if (!target) return Promise.reject(failure('MISSING'));
        return typeof target[method] === 'function' ? target[method](...args) : Promise.reject(failure('UNSUPPORTED'));
      };
    }
    slot.clients.add(facade);
    return facade;
  }
  function createWorkBuddyQuotaPort({ onChange: changed = () => {} } = {}) {
    let enabled = false, timer = null, controller = null, ended = false;
    const emit = () => changed(port.getState());
    const port = {
      getState() {
        const raw = workbuddy.getState(), summary = enabled ? raw.summary : null;
        return { enabled, busy: enabled && raw.busy, stale: enabled && raw.stale,
          error: enabled && raw.errorCode ? raw.errorMessage : null,
          errorCode: enabled && raw.errorCode ? raw.status === 'needs-login' ? 'LOGIN_REQUIRED' : 'UPDATE_FAILED' : null,
          report: summary ? { scope: 'website-summary', total: summary.credits.remaining,
            basic: null, reward: null, purchased: null, plan: summary.planNames.join(' / ') || '网站汇总',
            nextRefreshAt: null, expires: [], updatedAt: summary.updatedAt, coverage: summary.coverage } : null,
          accountKey: null, history: [], historyError: null, nextRetryAt: null };
      },
      async refresh() {
        if (!enabled || ended) return port.getState();
        clearTimeout(timer); controller?.abort(); controller = new AbortController();
        try { await workbuddy.readSummary({ signal: controller.signal }); } catch (_) {}
        if (enabled && !ended && workbuddy.getState().status === 'connected') { timer = setTimeout(() => { void port.refresh(); }, 300000); timer.unref?.(); }
        emit(); return port.getState();
      },
      setEnabled(value) { enabled = value === true; clearTimeout(timer); controller?.abort(); emit(); if (enabled) void port.refresh(); },
      recover() { if (enabled) void port.refresh(); },
      close() { ended = true; enabled = false; clearTimeout(timer); controller?.abort(); quotaPorts.delete(emit); }
    };
    quotaPorts.add(emit); return port;
  }
  function unavailableObservation(message) {
    return { getState: () => ({ busy: false, report: null, error: message }), setEnabled() {},
      refresh: async () => ({ busy: false, report: null, error: message }), dismissAll() {}, dismiss() { return false; }, close() {} };
  }
  function close() {
    if (closed) return runtimeClosing;
    closed = true; workbuddy.close(); quotaPorts.clear();
    const closing = [];
    for (const slot of Object.values(chatServices)) {
      slot.service = null; slot.generation++;
      closing.push(...[...slot.clients].map(client => client.close()));
    }
    runtimeClosing = Promise.all(closing).then(() => undefined);
    return runtimeClosing;
  }
  return { access, authorize, getState,
    importCodexService: () => importLocalService('codex'), importZcodeService: () => importLocalService('zcode'),
    createCodexChatRpc: options => localChat('codex', options), createZcodeChatRpc: options => localChat('zcode', options),
    async ensureAuthorized(provider) { if ((await access.getStatus(provider)).status === 'stored') return true; return (await authorize(provider)).status === 'stored'; },
    createCodexConnection: options => createMasCodexConnection({ ...options, directoryAccess: access, fetch }), zcode, workbuddy, createWorkBuddyQuotaPort, unavailableObservation,
    async revoke(provider) {
      await access.revoke(provider);
      const slot = chatServices[provider];
      if (slot) { slot.service = null; slot.generation++; await Promise.all([...slot.clients].map(client => client.invalidate())); }
      onChange();
    }, close };

}
module.exports = { createMasProviderRuntime, createDirectoryStorage, createDiagnosticDirectoryAccess };
