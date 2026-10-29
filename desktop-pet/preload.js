const { contextBridge, ipcRenderer } = require('electron');
// Chromium's online event is only a recovery hint; the quota request verifies actual service access.
if (typeof window !== 'undefined') window.addEventListener('online', () => ipcRenderer.send('pet:network-online'));
// sandbox 预加载不加载本地模块，只暴露固定的动作名称与数据字段。
const motionIds = new Set(['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']);
const auroraClickIds = new Set(['dizzy', 'turn']);
const companionIds = new Set(['nuzzle', 'land', 'stretch']);
const sheepActionIds = new Set(['walk','greet','joy','sleep','ear','bell','stretch','working','complete',
  'candy','magic','pumpkin','gift','receive-gift','scarf','snow','fortune','firecrackers','dumplings']);

function pointPayload(point) {
  return { x: point && point.x, y: point && point.y };
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('petDesktop', {
  onColorMode: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value, appearance, theme) => callback(value === 'accessible' ? 'accessible' : 'standard',
      ['light', 'dark'].includes(appearance) ? appearance : 'system', theme === 'blue' ? 'blue' : 'green');
    ipcRenderer.on('pet:color-mode', listener);
    return () => ipcRenderer.removeListener('pet:color-mode', listener);
  },
  reportSleepState: state => { if (state === 'awake' || state === 'sleep') ipcRenderer.send('pet:sleep-state', state); },
  beginDrag: point => ipcRenderer.send('pet:drag-start', pointPayload(point)),
  dragTo: point => ipcRenderer.send('pet:drag-move', pointPayload(point)),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  bounce: () => ipcRenderer.send('pet:bounce'),
  stopMotion: () => ipcRenderer.send('pet:stop-motion'),
  playMotion: request => {
    if (request && Number.isSafeInteger(request.token) && request.token > 0 &&
      (motionIds.has(request.action) || auroraClickIds.has(request.action) || companionIds.has(request.action))) {
      ipcRenderer.send('pet:motion-start', { token: request.token, action: request.action,
        side: request.side === 'left' ? 'left' : 'right', reducedMotion: request.reducedMotion === true });
    }
  },
  thought: request => {
    if (typeof request?.visible !== 'boolean') return;
    ipcRenderer.send('pet:thought', { visible: request.visible,
      side: request.side === 'left' ? 'left' : 'right', reducedMotion: request.reducedMotion === true });
  },
  codexMotionReady: request => {
    if (request && Number.isSafeInteger(request.token) && request.token > 0 && motionIds.has(request.action) &&
      Number.isSafeInteger(request.alertId) && request.alertId > 0 && Number.isSafeInteger(request.generation) && request.generation > 0 &&
      Number.isSafeInteger(request.pageEpoch) && request.pageEpoch > 0) {
      ipcRenderer.send('pet:codex-motion-ready', {
        token: request.token, action: request.action, alertId: request.alertId, generation: request.generation, pageEpoch: request.pageEpoch,
        ...(Number.isInteger(request.durationMs) && request.durationMs >= 10 && request.durationMs <= 60000 ? { durationMs: request.durationMs } : {})
      });
    }
  },
  codexAvailability: request => {
    if (request && Number.isSafeInteger(request.generation) && request.generation > 0 &&
      Number.isSafeInteger(request.pageEpoch) && request.pageEpoch > 0 && typeof request.available === 'boolean') {
      ipcRenderer.send('pet:codex-availability', { generation: request.generation, pageEpoch: request.pageEpoch, available: request.available });
    }
  },
  say: event => {
    if (typeof event === 'string') ipcRenderer.send('pet:say', event);
    else if (event?.event === 'play' && typeof event.sheepAction === 'string' && sheepActionIds.has(event.sheepAction)) {
      ipcRenderer.send('pet:say', { event: 'play', sheepAction: event.sheepAction });
    } else if (event?.event === 'play' && motionIds.has(event.motion)) {
      ipcRenderer.send('pet:say', { event: 'play', motion: event.motion });
    }
  },
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  updateOffering: value => {
    if(value?.eligible===false&&value.transient===true&&value.playing!==true&&!value.ink&&['halloween','christmas'].includes(value.theme)&&['left','right'].includes(value.facing)){
      ipcRenderer.send('pet:offering-state',{eligible:false,transient:true,theme:value.theme,facing:value.facing});return;
    }
    if(value?.eligible===false&&!value.ink){ipcRenderer.send('pet:offering-state',{eligible:false});return;}
    const b=value?.ink;
    if(value&&typeof value.eligible==='boolean'&&['halloween','christmas'].includes(value.theme)&&['left','right'].includes(value.facing)&&b&&
      [b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.x>=0&&b.y>=0&&b.width>0&&b.height>0&&b.x+b.width<=1.001&&b.y+b.height<=1.001){
      ipcRenderer.send('pet:offering-state',{eligible:value.eligible,transient:value.transient===true&&value.eligible===false&&value.playing!==true,theme:value.theme,facing:value.facing,playing:value.playing===true,dragging:value.dragging===true,hideSource:value.hideSource===true,settled:value.settled===true,ink:{x:b.x,y:b.y,width:b.width,height:b.height}});
    }else ipcRenderer.send('pet:offering-state',{eligible:false});
  },
  onOfferingPointer: callback => subscribe('pet:offering-pointer',callback),
  onPresentation: callback => subscribe('pet:presentation', callback),
  onCommand: callback => subscribe('pet:command', callback),
  onMotion: callback => subscribe('pet:motion-frame', callback),
  onActivity: callback => subscribe('pet:activity', callback),
  onSettings: callback => subscribe('pet:settings', callback),
  onQuota: callback => subscribe('pet:quota-display', callback),
  onCodexSettings: callback => subscribe('pet:codex-settings', callback)
});
