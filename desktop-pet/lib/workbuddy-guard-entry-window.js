const path = require('node:path');
const { pathToFileURL } = require('node:url');
const CHANNEL = 'pet:workbuddy-guard-entry';
const validBounds = value => value && ['x','y','width','height'].every(key => Number.isFinite(value[key])) && value.width > 0 && value.height > 0;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function entryBounds(card, area, obstacles = [], side = null) {
  if (!validBounds(card) || !validBounds(area) || area.width < 48 || area.height < 44) return null;
  const width = 48, height = 44, y = Math.max(area.y, Math.min(card.y + (card.height - height) / 2, area.y + area.height - height));
  const candidates = [{ x: card.x + card.width + 8, side: 'right' }, { x: card.x - width - 8, side: 'left' }];
  if (side === 'right') candidates.reverse();
  for (const candidate of candidates) {
    const bounds = { x: Math.round(candidate.x), y: Math.round(y), width, height };
    if (bounds.x >= area.x && bounds.y >= area.y && bounds.x + width <= area.x + area.width && bounds.y + height <= area.y + area.height &&
      ![card, ...obstacles].some(b => b && overlaps(bounds, b))) return { bounds, side: candidate.side };
  }
  return null;
}
function safeGuardEntryModel(value) {
  if (value === undefined) return { state:'ready', practice:true, items:[] };
  if (!value || value.state !== 'ready') return null;
  const sourceId = value.sourceId === undefined ? 'codex' : value.sourceId;
  if (!['codex','workbuddy','api','balance','zcode'].includes(sourceId)) return null;
  if (value.practice === true) return { sourceId, state:'ready', practice:true, items:[] };
  if (!['codex','zcode'].includes(sourceId)) return null;
  const first = Array.isArray(value.items) ? value.items[0] : null;
  if (!first || !Number.isFinite(first.remaining) || first.remaining < 0 || first.remaining > 100) return null;
  let item;
  if (sourceId === 'zcode') {
    if (typeof first.bucketId !== 'string' || !/^zcode:[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,394}$/u.test(first.bucketId) ||
      !(first.windowMinutes === null || Number.isFinite(first.windowMinutes) && first.windowMinutes > 0) ||
      !Number.isSafeInteger(first.resetsAt) || first.resetsAt <= 0) return null;
    item = { remaining:first.remaining, windowMinutes:first.windowMinutes, bucketId:first.bucketId,
      periodStart:Number.isSafeInteger(first.periodStart)&&first.periodStart>=0?first.periodStart:null, resetsAt:first.resetsAt };
  } else {
    if (!Number.isSafeInteger(first.windowMinutes) || first.windowMinutes <= 0) return null;
    item = { remaining:first.remaining, windowMinutes:first.windowMinutes };
  }
  return { sourceId, state:'ready', practice:false, items:[item] };
}
function createWorkBuddyGuardEntryWindow({ BrowserWindow, onGuard = () => {}, onError = () => {}, alwaysOnTop = true }) {
  let groupTransitionMode=null;
  let win = null, ready = false, visible = false, layout = null, model = null, top = Boolean(alwaysOnTop), presenting = false;
  const file = path.join(__dirname, '../workbuddy-guard-entry.html'), url = pathToFileURL(file).href;
  const live = target => target && !target.isDestroyed() && !target.webContents.isDestroyed?.();
  const report = error => { try { onError(error); } catch (_) {} };
  function hide({safety=false}={}) { if(safety)groupTransitionMode=null; visible = false; if (live(win) && win.isVisible()) win.hide(); }
  function destroy() { groupTransitionMode=null; const old = win; win = null; ready = visible = false; if (live(old)) old.destroy(); }
  function present() {
    if (groupTransitionMode==='hold'||groupTransitionMode==='masked')return;
    if (presenting || !ready || !visible || !layout || !model || !live(win)) return;
    presenting = true;
    try {
      const previous = win.getBounds();
      if (Object.keys(layout.bounds).some(k => previous[k] !== layout.bounds[k])) win.setBounds(layout.bounds, false);
      win.webContents.send(CHANNEL, { ...model, guardEntry: true, expanded: false, visible: true, size: 'compact', guardSide: layout.side, guardTargetWidth: 48 });
      win.setIgnoreMouseEvents?.(groupTransitionMode!==null,{forward:true});
      if(groupTransitionMode==='stage')win.hide();else if (!win.isVisible()) win.showInactive();
    } catch (error) { hide(); report(error); }
    finally { presenting = false; }
  }
  function ensure() {
    if (live(win)) return;
    const target = new BrowserWindow({ width: 48, height: 44, title: '球球守护战', show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
      fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, '../workbuddy-guard-entry-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    win = target; ready = false;
    target.setAlwaysOnTop(top, 'floating'); target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); target.setHiddenInMissionControl(true);
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-attach-webview']) target.webContents.on(event, e => e.preventDefault());
    target.webContents.on('did-start-loading',()=>{if(win===target)ready=false;});
    target.webContents.on('ipc-message', (event, channel) => {
      if (groupTransitionMode || channel !== `${CHANNEL}-open` || win !== target || !ready || !visible || !target.isVisible() || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame || event.sender.getURL() !== url) return;
      try { onGuard(); } catch (error) { report(error); }
    });
    const loaded = () => { if (win === target && !ready) { ready = true; present(); } };
    target.webContents.on('did-finish-load', loaded);
    target.on('closed', () => { if (win === target) { win = null; ready = visible = false; } });
    target.webContents.on('render-process-gone', () => { if (win === target) destroy(); });
    Promise.resolve(target.loadFile(file)).then(loaded).catch(error => { if (win === target) destroy(); report(error); });
  }
  return { show(card, area, obstacles, side, value) {
      if (side && typeof side === 'object' && value === undefined) { value=side;side=null; }
      model=safeGuardEntryModel(value);layout = entryBounds(card, area, obstacles, side); if (!layout || !model) { hide(); return; } visible = true; try { ensure(); present(); } catch (error) { destroy(); report(error); }
    }, hide, destroy,
    getWindow: () => live(win) ? win : null,
    getCaptureWindow: () => visible&&ready&&live(win)?win:null,
    isCaptureReady: () => !visible || ready&&live(win),
    setGroupTransitionMode(mode) {if(![null,'hold','stage','masked'].includes(mode))return;groupTransitionMode=mode;if(live(win)){win.setIgnoreMouseEvents?.(true,{forward:true});if(mode==='stage'||mode==='masked')win.hide();}if(mode===null||mode==='stage')present();},
    setAlwaysOnTop(value) { top = Boolean(value); try { if (live(win)) win.setAlwaysOnTop(top, 'floating'); } catch (error) { report(error); } } };
}
module.exports = { createWorkBuddyGuardEntryWindow, entryBounds, safeGuardEntryModel };
