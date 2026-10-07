const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

// PET_SMOKE_FUNCTION_WINDOWS_ONLY=1 npm run smoke; runner supplies an isolated profile.
async function verifyFunctionWindows({ pet, screen, openers }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  const displays = screen.getAllDisplays(), checks = [], original = pet.getBounds();
  const output = process.env.PET_SMOKE_FUNCTION_WINDOWS_OUTPUT;
  const inside = (bounds, area) => bounds.x >= area.x && bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
  try {
    for (const display of displays) for (const corner of [0, 0.5, 1]) {
      const area = display.workArea;
      pet.setBounds({ ...original, x: Math.round(area.x + (area.width - original.width) * corner),
        y: Math.round(area.y + (area.height - original.height) * corner) }, false);
      for (const [name, open] of openers) {
        const win = open();
        if (checks.every(check => check.name !== name)) win.once('closed', () => process.stdout.write(`PET_FUNCTION_WINDOW_CLOSED ${name}\n`));
        for (let i = 0; i < 100 && (!win.isVisible() || win.webContents.isLoading()); i++) await wait(40);
        assert.ok(win.isVisible(), `${name} did not open`);
        await wait(80);
        const petBounds = pet.getBounds(), target = screen.getDisplayMatching(petBounds), bounds = win.getBounds();
        assert.equal(target.id, display.id, 'native pet reached the requested display');
        assert.ok(inside(bounds, target.workArea), `${name}: ${JSON.stringify({ bounds, area: target.workArea })}`);
        checks.push({ name, displayId: target.id, corner, petBounds, bounds });
        // Simulate a user moving/resizing the same window, then reopening it.
        const moved = { ...bounds, x: target.workArea.x, y: target.workArea.y };
        if (win.isResizable()) {
          moved.width = Math.min(bounds.width + 20, target.workArea.width);
          moved.height = Math.min(bounds.height + 20, target.workArea.height);
        }
        win.setBounds(moved, false); win.hide();
        const size = win.getSize();
        assert.equal(open(), win);
        await wait(80);
        assert.ok(!win.isDestroyed(), `${name} was closed during the reopen check`);
        assert.ok(inside(win.getBounds(), target.workArea), `${name} reopened outside pet work area`);
        assert.deepEqual(win.getSize(), size, `${name} lost the user's resized dimensions`);
        if (moved.width < target.workArea.width && moved.height < target.workArea.height) {
          assert.notDeepEqual(win.getPosition(), [moved.x, moved.y], `${name} reused its dragged position`);
        }
        checks.at(-1).reopenedBounds = win.getBounds();
        win.hide();
      }
    }
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'native-window-bounds.json'), JSON.stringify({
        displays: displays.map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor })), checks
      }, null, 2));
    }
    process.stdout.write(`PET_FUNCTION_WINDOWS_OK displays=${displays.length} opens=${checks.length * 2}\n`);
  } finally { if (!pet.isDestroyed()) pet.setBounds(original, false); }
}

module.exports = { verifyFunctionWindows };
