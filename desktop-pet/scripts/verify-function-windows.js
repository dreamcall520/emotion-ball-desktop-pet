const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

// PET_SMOKE_FUNCTION_WINDOWS_ONLY=1 npm run smoke; runner supplies an isolated profile.
async function verifyFunctionWindows({ pet, screen, openers, notes, getObstacles = () => [], showCards = () => {} }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  const displays = screen.getAllDisplays(), checks = [], noteChecks = [], original = pet.getBounds();
  const output = process.env.PET_SMOKE_FUNCTION_WINDOWS_OUTPUT;
  const inside = (bounds, area) => bounds.x >= area.x && bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  const hasRoomBeside = (bounds, area, occupied) => bounds.width <= Math.max(
    Math.min(...occupied.map(b => b.x)) - area.x,
    area.x + area.width - Math.max(...occupied.map(b => b.x + b.width))) || bounds.height <= Math.max(
    Math.min(...occupied.map(b => b.y)) - area.y,
    area.y + area.height - Math.max(...occupied.map(b => b.y + b.height)));
  const cardsReady = async () => {
    showCards();
    for (let i = 0; i < 100 && getObstacles().length < 2; i++) await wait(40);
    assert.equal(getObstacles().length, 2, 'native quota and API cards are visible');
    await wait(80);
  };
  try {
    for (const display of displays) for (const corner of [0, 0.5, 1]) {
      const area = display.workArea;
      pet.setBounds({ ...original, x: Math.round(area.x + (area.width - original.width) * corner),
        y: Math.round(area.y + (area.height - original.height) * corner) }, false);
      for (const [name, open] of openers) {
        await cardsReady();
        const win = open();
        if (checks.every(check => check.name !== name)) win.once('closed', () => process.stdout.write(`PET_FUNCTION_WINDOW_CLOSED ${name}\n`));
        for (let i = 0; i < 100 && (!win.isVisible() || win.webContents.isLoading()); i++) await wait(40);
        assert.ok(win.isVisible(), `${name} did not open`);
        await wait(80);
        const petBounds = pet.getBounds(), target = screen.getDisplayMatching(petBounds), bounds = win.getBounds();
        assert.equal(target.id, display.id, 'native pet reached the requested display');
        assert.ok(inside(bounds, target.workArea), `${name}: ${JSON.stringify({ bounds, area: target.workArea })}`);
        const obstacles = getObstacles();
        assert.equal(obstacles.length, 2, `${name}: cards remain visible`);
        if (hasRoomBeside(bounds, target.workArea, [petBounds, ...obstacles])) {
          assert.ok(obstacles.every(card => !overlaps(bounds, card)), `${name} overlaps a visible card: ${JSON.stringify({ bounds, obstacles })}`);
        }
        checks.push({ name, displayId: target.id, corner, petBounds, bounds, obstacles });
        // Simulate a user moving/resizing the same window, then reopening it.
        const moved = { ...bounds, x: target.workArea.x, y: target.workArea.y };
        if (win.isResizable()) {
          moved.width = Math.min(bounds.width + 20, target.workArea.width);
          moved.height = Math.min(bounds.height + 20, target.workArea.height);
        }
        win.setBounds(moved, false); win.hide();
        const size = win.getSize();
        await cardsReady();
        assert.equal(open(), win);
        await wait(80);
        assert.ok(!win.isDestroyed(), `${name} was closed during the reopen check`);
        assert.ok(inside(win.getBounds(), target.workArea), `${name} reopened outside pet work area`);
        assert.deepEqual(win.getSize(), size, `${name} lost the user's resized dimensions`);
        if (hasRoomBeside(win.getBounds(), target.workArea, [pet.getBounds(), ...getObstacles()])) {
          assert.ok(getObstacles().every(card => !overlaps(win.getBounds(), card)), `${name} reopened over a visible card`);
        }
        if (moved.width < target.workArea.width && moved.height < target.workArea.height) {
          assert.notDeepEqual(win.getPosition(), [moved.x, moved.y], `${name} reused its dragged position`);
        }
        checks.at(-1).reopenedBounds = win.getBounds();
        win.hide();
      }
    }
    if (notes) {
      const { newNote } = require('../lib/notes-model');
      for (const display of displays) {
        const area = display.workArea, primary = screen.getPrimaryDisplay().workArea;
        const panel = notes.openPanel({ tab: 'note' });
        for (let i = 0; i < 100 && (!panel.isVisible() || panel.webContents.isLoading()); i++) await wait(40);
        panel.setBounds({ x: area.x + 24, y: area.y + 24, width: Math.min(380, area.width), height: Math.min(520, area.height) }, false);
        // Keep pet elsewhere: desktop display must use the initiating panel, including saved locations on another display.
        if (displays.length > 1) {
          const other = displays.find(candidate => candidate.id !== display.id).workArea;
          pet.setBounds({ ...original, x: other.x + 24, y: other.y + 24 }, false);
        }
        const item = newNote('Native display placement check', '', Date.now());
        item.windowBounds = { x: primary.x + 24, y: primary.y + 24, width: 320, height: 220 };
        notes.getStore().update(state => { state.notes.push(item); return state; });
        const result = await panel.webContents.executeJavaScript(`window.qiuNotes.openNote(${JSON.stringify(item.id)})`);
        assert.equal(result.ok, true);
        const win = notes.getWindows().notes.at(-1);
        for (let i = 0; i < 100 && (!win.isVisible() || win.webContents.isLoading()); i++) await wait(40);
        assert.ok(win.isVisible());
        const bounds = win.getBounds();
        assert.equal(screen.getDisplayMatching(bounds).id, display.id, 'desktop note follows panel display');
        assert.ok(inside(bounds, area));
        noteChecks.push({ displayId: display.id, panel: panel.getBounds(), pet: pet.getBounds(), bounds });
        notes.getStore().update(state => { state.notes.find(note => note.id === item.id).desktopOpen = false; return state; });
        panel.hide();
      }
    }
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'native-window-bounds.json'), JSON.stringify({
        displays: displays.map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor })), checks, noteChecks
      }, null, 2));
    }
    process.stdout.write(`PET_FUNCTION_WINDOWS_OK displays=${displays.length} opens=${checks.length * 2} desktopNotes=${noteChecks.length}\n`);
  } finally { if (!pet.isDestroyed()) pet.setBounds(original, false); }
}

module.exports = { verifyFunctionWindows };
