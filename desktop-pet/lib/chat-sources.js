function createChatSources({ codex, createZcode, isZcodeEnabled = () => false,
  createWorkbuddy, isWorkbuddyEnabled = () => false, initialSource = 'codex', onSelect = () => {}, onChange = () => {} }) {
  const enabled = id => id === 'codex' || (id === 'zcode' ? isZcodeEnabled() : id === 'workbuddy' && isWorkbuddyEnabled());
  let source = ['zcode', 'workbuddy'].includes(initialSource) && enabled(initialSource) ? initialSource : 'codex';
  let zcode = null, workbuddy = null, closed = false, switching = false, transition = 0;
  const current = () => source === 'zcode' ? (zcode ||= createZcode()) : source === 'workbuddy' ? (workbuddy ||= createWorkbuddy()) : codex;
  const sources = () => [{ id: 'codex', label: 'Codex', enabled: true },
    { id: 'zcode', label: 'ZCode', enabled: isZcodeEnabled() },
    { id: 'workbuddy', label: 'WorkBuddy', enabled: isWorkbuddyEnabled() }];
  function getState() {
    return { ...current().getState(), source, sources: sources(), sourceChanging: switching };
  }
  function sourceChanged(id) { if (!closed && id === source) onChange(getState()); }
  async function selectSource(id) {
    if (closed || switching || !['codex', 'zcode', 'workbuddy'].includes(id)) return { accepted: false, error: '请选择可用的聊天来源。' };
    if (!enabled(id)) return { accepted: false, error: `请先在设置中开启 ${id === 'zcode' ? 'ZCode' : 'WorkBuddy'} 联动。` };
    if (id === source) return { accepted: true };
    const state = current().getState();
    if (state.busy || state.connection === 'connecting') return { accepted: false, error: '请先等待当前回复完成，或停止后再切换。' };
    try { onSelect(id); } catch (_) { return { accepted: false, error: '聊天来源未能保存，请稍后重试。' }; }
    source = id;
    const token = ++transition;
    switching = true;
    sourceChanged(source);
    try { await current().connect(); } catch (_) { /* The companion publishes its connection error. */ }
    finally { if (transition === token) { switching = false; sourceChanged(source); } }
    return { accepted: true };
  }
  async function sourceDisabled(id) {
    const token = ++transition;
    const previous = id === 'zcode' ? zcode : workbuddy;
    if (id === 'zcode') zcode = null; else workbuddy = null;
    if (source === id) {
      source = 'codex';
      try { onSelect(source); } catch (_) { /* Disable must release the connection even if saving failed. */ }
    }
    switching = true;
    sourceChanged(source);
    try { await previous?.close(); }
    finally { if (transition === token) { switching = false; sourceChanged(source); } }
  }
  const result = { getState, sourceChanged, selectSource, zcodeDisabled: () => sourceDisabled('zcode'), workbuddyDisabled: () => sourceDisabled('workbuddy'),
    ownsThread: id => codex.ownsThread(id),
    close() {
      closed = true; transition++;
      const pending = [codex.close(), zcode?.close(), workbuddy?.close()];
      return pending.some(value => value?.then) ? Promise.allSettled(pending) : undefined;
    } };
  for (const name of ['connect', 'send', 'stop', 'newChat', 'selectChat', 'setModel', 'refreshModels']) {
    result[name] = (...args) => {
      if (closed) return Promise.resolve({ accepted: false, error: '聊天已关闭。' });
      if (switching && !['connect', 'stop'].includes(name)) return Promise.resolve({ accepted: false, error: '正在连接聊天来源，请稍后再试。' });
      if (!enabled(source)) return Promise.resolve({ accepted: false, error: `${source === 'zcode' ? 'ZCode' : 'WorkBuddy'} 联动已关闭。` });
      return current()[name](...args);
    };
  }
  return result;
}

module.exports = { createChatSources };
