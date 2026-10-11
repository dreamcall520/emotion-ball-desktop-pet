/* Run: node desktop-pet/scripts/check-pomodoro-ui.js (uses existing Playwright and Chrome). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const runtime = process.env.POMODORO_PLAYWRIGHT || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(runtime);
const output = process.env.POMODORO_UI_OUTPUT || path.join(os.tmpdir(), 'qiuqiu-pomodoro-ui-check');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const errors = [], results = [];
  try {
    async function pageFor(view, width, height, reducedMotion = 'reduce') {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion });
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let state = { mode: 'focus', status: 'idle', total: 1500, remaining: 1500, deadline: 0, completed: 0,
          cycleCompleted: 0, minutes: 0, face: 'analog', intention: '', pinned: false, encouragementEnabled: true,
          durations: { focus: 25, short: 5, long: 15 }, reminder: false, encouragement: '', panelOpen: true };
        let receive = () => {}, theme = () => {};
        window.testState = value => { state = { ...state, ...value }; receive(state); };
        window.testTheme = (mode, appearance, color) => theme(mode, appearance, color);
        window.testActions = [];
        window.qiuPomodoro = {
          load: async () => ({ ok: true, state }),
          onState: callback => { receive = callback; return () => {}; },
          onColorMode: callback => { theme = callback; callback('standard', 'light', 'green'); return () => {}; },
          action: async (type, value) => {
            window.testActions.push({ type, value });
            if (window.testHold === type) await new Promise(resolve => { window.testRelease = resolve; });
            if (window.testFail && type === 'settings') return { ok: false, message: '保存失败，请重试。' };
            if (type === 'settings') {
              const changed = Object.keys(value.durations).some(key => value.durations[key] !== state.durations[key]);
              state = { ...state, ...value, ...(changed ? { status: 'idle', remaining: value.durations[state.mode] * 60, total: value.durations[state.mode] * 60 } : {}) };
            }
            if (type === 'pin') state.pinned = value;
            if (type === 'mode') state = { ...state, mode: value, total: state.durations[value] * 60, remaining: state.durations[value] * 60 };
            if (type === 'intention') state.intention = value;
            if (type === 'toggle') state.status = state.status === 'running' ? 'paused' : 'running';
            receive(state); return { ok: true, state };
          }
        };
      });
      const url = pathToFileURL(path.join(__dirname, '../pomodoro.html')); url.searchParams.set('view', view);
      await page.goto(url.href);
      await page.waitForFunction(() => document.documentElement.dataset.appearance === 'light');
      await page.waitForTimeout(30);
      return page;
    }
    const panel = await pageFor('panel', 320, 488);
    assert.equal(await panel.locator('.panel-header').evaluate(node => getComputedStyle(node).webkitAppRegion), 'drag');
    assert.equal(await panel.locator('#pin').evaluate(node => getComputedStyle(node).webkitAppRegion), 'no-drag');
    assert.equal(await panel.locator('#pin').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    const bounds = async (page, selector) => page.locator(selector).boundingBox();
    for (const theme of ['green', 'blue']) for (const appearance of ['light', 'dark']) for (const mode of ['standard', 'accessible']) {
      await panel.evaluate(([mode, appearance, theme]) => testTheme(mode, appearance, theme), [mode, appearance, theme]);
      await panel.waitForFunction(value => document.documentElement.dataset.notesAppearance === value, appearance);
      const styles = await panel.locator('#focus-panel').evaluate(node => ({ background: getComputedStyle(node).backgroundColor,
        image: getComputedStyle(node).backgroundImage, color: getComputedStyle(node).color, border: getComputedStyle(node).borderWidth,
        accent: getComputedStyle(node).getPropertyValue('--accent').trim() }));
      if (mode === 'accessible') { assert.equal(styles.image, 'none'); assert.ok(!styles.background.startsWith('rgba')); assert.equal(styles.border, '0px'); }
      else assert.ok(styles.image.includes(theme === 'green' ? appearance === 'dark' ? '38, 61, 66' : '221, 244, 234' : appearance === 'dark' ? '32, 51, 71' : '230, 245, 255'));
      for (const face of ['analog', 'timeline', 'modules', 'minutes']) {
        await panel.setViewportSize({ width: 320, height: face === 'analog' ? 488 : 384 });
        await panel.evaluate(face => testState({ face }), face);
        await panel.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        for (const selector of ['#time', '#start', '.panel-footer']) { const b = await bounds(panel, selector);
          assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 320.1 && b.y + b.height <= (face === 'analog' ? 488.1 : 384.1), `${selector} clipped in ${theme}/${appearance}/${mode}/${face}: ${JSON.stringify(b)}`); }
        if (mode === 'standard' || face === 'analog') await panel.screenshot({ path: path.join(output, `${theme}-${appearance}-${mode === 'accessible' ? 'accessible-' : ''}${face}.png`), omitBackground: true });
      }
      results.push({ theme, appearance, mode, ...styles });
    }
    await panel.evaluate(() => { testTheme('standard', 'light', 'green'); testState({ face: 'analog', status: 'running', remaining: 1200 }); });
    await panel.setViewportSize({ width: 320, height: 488 });
    await panel.locator('#intention').fill('先写这一版');
    await panel.evaluate(() => testState({ remaining: 1199, intention: '旧内容' }));
    assert.equal(await panel.locator('#intention').inputValue(), '先写这一版');
    await panel.locator('#settings-open').click(); await panel.setViewportSize({ width: 320, height: 384 });
    assert.equal(await panel.locator('#settings').isVisible(), true);
    await panel.locator('.style-option:has(input[value=minutes])').click(); await panel.locator('input[name=focus]').fill('45');
    await panel.evaluate(() => testState({ remaining: 1198 }));
    assert.equal(await panel.locator('input[name=focus]').inputValue(), '45');
    await panel.keyboard.press('Escape'); assert.equal(await panel.locator('#settings').isVisible(), false);
    await panel.locator('#settings-open').click(); assert.equal(await panel.locator('input[name=focus]').inputValue(), '25');
    await panel.locator('.style-option:has(input[value=minutes])').click();
    await panel.evaluate(() => { window.testFail = true; }); await panel.locator('#settings button[type=submit]').click();
    assert.equal(await panel.locator('#settings').isVisible(), true); assert.equal(await panel.locator('#feedback').isVisible(), true);
    await panel.evaluate(() => { window.testFail = false; }); await panel.locator('#settings button[type=submit]').click();
    assert.equal(await panel.locator('#settings').isVisible(), false);
    assert.equal(await panel.locator('#time').getAttribute('aria-label'), '剩余19分钟58秒');
    await panel.evaluate(() => { testTheme('accessible', 'light', 'blue'); window.testHold = 'pin'; window.testActions = []; });
    await panel.locator('#pin').click();
    assert.equal(await panel.locator('#pin').getAttribute('aria-busy'), 'true');
    assert.equal(await panel.locator('#start').isDisabled(), false, '置顶不能让下方按钮切到色盲模式的禁用边框');
    assert.equal(await panel.locator('#reset').isDisabled(), false);
    assert.equal(await panel.locator('#pin').evaluate(node => node.matches(':focus-visible')), false, '鼠标置顶不产生键盘焦点框');
    await panel.locator('#pin').click(); assert.equal(await panel.evaluate(() => testActions.filter(item => item.type === 'pin').length), 1);
    await panel.evaluate(() => { window.testHold = ''; window.testRelease(); });
    await panel.waitForFunction(() => document.getElementById('pin').getAttribute('aria-busy') === 'false');
    assert.equal(await panel.locator('#pin').getAttribute('aria-pressed'), 'true');
    await panel.keyboard.press('Tab'); await panel.keyboard.press('Shift+Tab');
    assert.equal(await panel.locator('#pin').evaluate(node => node.matches(':focus-visible')), true, '保留键盘置顶焦点提示');
    await panel.locator('#collapse').click();
    assert.equal(await panel.evaluate(() => testActions.at(-1).type), 'close-panel');

    const mini = await pageFor('mini', 112, 48), message = await pageFor('message', 256, 244);
    for (const theme of ['green', 'blue']) for (const appearance of ['light', 'dark']) for (const mode of ['standard', 'accessible']) {
      for (const page of [mini, message]) await page.evaluate(([mode, appearance, theme]) => testTheme(mode, appearance, theme), [mode, appearance, theme]);
      await mini.waitForFunction(value => document.documentElement.dataset.notesAppearance === value, appearance);
      const m = await bounds(mini, '#mini'); assert.deepEqual([m.x, m.y, m.width, m.height], [6, 6, 100, 36]);
      const beam = await mini.locator('#mini-beam').evaluate(node => ({ animation: getComputedStyle(node, '::before').animationName, display: getComputedStyle(node, '::before').display }));
      assert.equal(beam.animation, 'none'); if (mode === 'accessible') assert.equal(beam.display, 'none');
      await message.setViewportSize({ width: 196, height: 66 });
      await message.evaluate(() => testState({ status: 'running', reminder: false, encouragement: '不急，专心做好眼前这一件。' }));
      const e = await bounds(message, '#encouragement'); assert.equal(e.width, 184); assert.ok(e.height <= 54);
      const fill = await message.locator('#encouragement').evaluate(node => getComputedStyle(node).backgroundColor);
      assert.ok(!fill.startsWith('rgba'), '鼓励必须有不透明底色');
      await mini.screenshot({ path: path.join(output, `mini-${theme}-${appearance}-${mode}.png`), omitBackground: true });
      await message.screenshot({ path: path.join(output, `encouragement-${theme}-${appearance}-${mode}.png`), omitBackground: true });
    }
    await mini.locator('#mini').click(); assert.equal(await mini.evaluate(() => testActions.at(-1).type), 'open');
    for (const [text, height] of [['不急，专心做好眼前这一件。再向前一点点。', 54], ['先做一件事。', 36]]) {
      await message.setViewportSize({ width: 196, height: height + 12 });
      await message.evaluate(text => { window.testActions = []; testState({ reminder: false, encouragement: text }); }, text);
      await message.waitForFunction(height => testActions.some(item => item.type === 'layout' && item.value.cardHeight === height), height);
      const card = await message.locator('#encouragement').evaluate(node => ({ height: node.getBoundingClientRect().height,
        clipped: node.scrollHeight > node.clientHeight }));
      assert.equal(card.height, height); assert.equal(card.clipped, false, '单行和双行鼓励均完整显示');
      await message.screenshot({ path: path.join(output, `encouragement-${height}px.png`), omitBackground: true });
    }
    await message.setViewportSize({ width: 256, height: 244 });
    await message.evaluate(() => testState({ status: 'complete', reminder: true, cycleCompleted: 4 }));
    assert.equal(await message.locator('#rest-now').textContent(), '长休息 15 分钟');
    await message.locator('#rest-now').click(); assert.equal(await message.evaluate(() => testActions.at(-1).type), 'rest');
    await message.screenshot({ path: path.join(output, 'complete-reminder.png'), omitBackground: true });
    await message.setViewportSize({ width: 256, height: 204 });
    await message.evaluate(() => testState({ mode: 'short', total: 300, status: 'complete', reminder: true }));
    assert.equal(await message.locator('#five-more').isVisible(), false);
    const restCard = await bounds(message, '#reminder'), restButton = await bounds(message, '#rest-now');
    assert.equal(restCard.height, 192); assert.ok(restCard.y + restCard.height <= 204);
    assert.ok(restCard.y + restCard.height - restButton.y - restButton.height < 40, '休息完成卡不保留第二个按钮的空位');
    await message.screenshot({ path: path.join(output, 'rest-complete-reminder.png'), omitBackground: true });

    const animated = await pageFor('panel', 320, 488, 'no-preference');
    const angle = () => animated.locator('#clock-needle').getAttribute('transform').then(value => Number(value.match(/rotate\(([^ ]+)/)[1]));
    assert.equal(await angle(), 150);
    await animated.locator('[data-mode=short]').click();
    await animated.waitForFunction(() => { const value = document.getElementById('clock-needle').getAttribute('transform'); return value !== 'rotate(150 100 100)' && value !== 'rotate(30 100 100)'; });
    const { intermediate, sector } = await animated.evaluate(() => ({ intermediate: Number(document.getElementById('clock-needle').getAttribute('transform').match(/rotate\(([^ ]+)/)[1]),
      sector: document.getElementById('clock-sector').getAttribute('d') }));
    assert.ok(intermediate > 30 && intermediate < 150, 'tab 切换有中间帧');
    const endpoint = sector.match(/1 ([\d.-]+) ([\d.-]+) Z$/);
    assert.ok(Math.abs(Number(endpoint[1]) - (100 + 66 * Math.sin(intermediate * Math.PI / 180))) < .001, '扇形和指针用同一中间帧');
    await animated.waitForFunction(() => document.getElementById('clock-needle').getAttribute('transform') === 'rotate(30 100 100)');
    await animated.evaluate(() => testState({ total: 3600, remaining: 3540 }));
    await animated.waitForFunction(() => document.getElementById('clock-needle').getAttribute('transform') === 'rotate(354 100 100)');
    await animated.evaluate(() => testState({ remaining: 60 }));
    await animated.waitForTimeout(80);
    const wrapped = await angle(); assert.ok(wrapped < 12 || wrapped > 348, `跨零点应沿短路径: ${wrapped}`);
    await animated.waitForFunction(() => document.getElementById('clock-needle').getAttribute('transform') === 'rotate(6 100 100)');
    await animated.emulateMedia({ reducedMotion: 'reduce' });
    await animated.locator('[data-mode=long]').click(); assert.equal(await angle(), 90);
    assert.equal(await animated.locator('#clock-scale').evaluate(node => node.getBoundingClientRect().width), 1, '刻度说明仅保留给辅助阅读');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ ok: true, themes: results, messageCardHeights: [36, 54], reminderCardHeights: [232, 192], pinFocus: true, needleTransition: true, reducedMotion: true, errors }, null, 2));
    console.log(`Pomodoro UI: 32 face/theme combinations, draft/error/focus behavior, mini + opaque messages passed. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
