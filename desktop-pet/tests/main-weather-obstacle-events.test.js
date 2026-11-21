const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = main.includes('const weatherObstacleWatcher =') ? main.indexOf('const weatherObstacleWatcher =') : main.indexOf('const trackWeatherObstacle =');
const code = main.slice(start, main.indexOf('  weatherWindow.start();', start));
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const unrelated = new EventEmitter(), card = new EventEmitter(), bubbleWindow = new EventEmitter(), pet = new EventEmitter();
  const app = new EventEmitter(); let calls = 0, current = true, cardWindow = card;
  const weatherWindow = { getWindow: () => null, reposition: () => calls++ };
  const sandbox = { app, weatherWindow, weatherPetWindow: pet, isQuitting: false,
    isCurrentWeatherOwner: () => current, BrowserWindow: { getAllWindows: () => [unrelated, card, bubbleWindow, pet] },
    quotaLabel: null, apiUsageLabel: null, zcodeLink: null, workbuddyLabel: { getWindow: () => cardWindow },
    apiBalanceLabel: null, quotaCardGroupWindow: null, bubble: { getWindow: () => bubbleWindow },
    safelyInvokeWindow: (_name, action) => action(), require: name => require(path.join(__dirname, '..', name)) };
  vm.runInNewContext(code, sandbox);
  return { unrelated, card, bubbleWindow, pet, get calls() { return calls; }, stale: () => { current = false; },
    closeCard: () => { cardWindow = null; card.emit('closed'); } };
}
test('unrelated game and settings window events do not synchronously reflow weather', async () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) for (const event of ['resize', 'show', 'hide']) f.unrelated.emit(event);
  await flush(); assert.equal(f.calls, 0);
});
test('one burst of real card and bubble layout events is batched into one weather update', async () => {
  const f = fixture();
  for (const event of ['move', 'resize', 'show', 'hide']) { f.card.emit(event); f.bubbleWindow.emit(event); }
  await flush(); assert.equal(f.calls, 1);
  f.closeCard(); await flush(); assert.equal(f.calls, 2, 'removing an obstacle still updates placement');
});
test('pet has its own direct observer and stale weather owners do not schedule old layouts', async () => {
  const f = fixture(); f.pet.emit('move'); await flush(); assert.equal(f.calls, 0);
  f.card.emit('hide'); f.stale(); await flush(); assert.equal(f.calls, 0);
});
