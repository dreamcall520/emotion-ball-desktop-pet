const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BODY_MOTION_SIZES } = require('./verify-body-motion');
const QUOTA_LABEL_MARKERS = Object.freeze([
  'CODEX_QUOTA_SIZE_60', 'CODEX_QUOTA_SIZE_80', 'CODEX_QUOTA_SIZE_120',
  'CODEX_QUOTA_SIZE_180', 'CODEX_QUOTA_SIZE_260'
]);

const packagedApp = process.env.PET_SMOKE_APP_PATH;
const electronBinary = packagedApp ? path.join(packagedApp, 'Contents/MacOS/球球桌宠') : require('electron');
const root = path.resolve(__dirname, '../..');

function runSmokeTest() {
  return new Promise((resolve, reject) => {
    const smokeUserData = fs.mkdtempSync(
      path.join(os.tmpdir(), 'emotion-ball-smoke-')
    );
    const cleanup = () => {
      fs.rmSync(smokeUserData, { recursive: true, force: true });
    };
    const child = spawn(
      electronBinary,
      [`--user-data-dir=${smokeUserData}`, ...(packagedApp ? [] : [root])],
      {
        cwd: root,
        env: {
          ...process.env,
          PET_SMOKE_TEST: '1',
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', chunk => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`桌宠真实启动与互动检查超过 240 秒\n${output}`));
    }, 240000);

    child.once('error', error => {
      clearTimeout(timer);
      cleanup();
      reject(error);
    });

    child.once('close', code => {
      clearTimeout(timer);
      cleanup();
      try {
        assert.equal(code, 0, output);
        assert.match(output, /PET_SMOKE_OK/);
        assert.match(output, /PET_BOUNCE_OK/);
        assert.match(output, /PET_SLEEP_VISUAL_OK/);
        assert.match(output, /PET_SLEEP_VISUAL_MICRO_OK/);
        for (const marker of ['COMPANION_STRETCH', 'COMPANION_NUZZLE', 'COMPANION_LAND', 'INWARD_FACING']) {
          assert.ok(output.includes(`PET_${marker}_OK`), `${marker}新版互动未完成实机检查`);
        }
        for (const marker of ['CODEX_SIMULATED', 'CODEX_TASK_MENU', 'CODEX_TASK_TITLE', 'CODEX_THINKING',
          ...BODY_MOTION_SIZES.map(size => `CODEX_SIZE_${size}`),
          ...QUOTA_LABEL_MARKERS,
          'CODEX_QUOTA_POLICY', 'CODEX_QUOTA_LABEL', 'CODEX_QUOTA_COMPACT', 'CODEX_QUOTA_BEAM',
          'CODEX_QUOTA_STANDARD_EXPAND', 'CODEX_QUOTA_WALLPAPER_CONTRAST',
          'CODEX_QUOTA_APPEARANCE']) {
          assert.ok(output.includes(`PET_${marker}_OK`), `${marker}模拟 Codex 原生检查未完成`);
        }
        for (const marker of ['USER_DATA', 'ACTIVITY_STATES', 'GAZE', 'TOUCH_DRAG', 'BUBBLE_REPLY', 'BUBBLE_EDGES_SETTINGS', 'NATIVE_ACTIVITY', 'FIXED_COLOR', 'DOUBLE_CLICK', 'BODY_MOTION', 'BODY_MOTION_INTERRUPTS', 'BODY_MOTION_EDGES', ...BODY_MOTION_SIZES.map(size => `BODY_MOTION_SIZE_${size}`), ...['HOP', 'JELLY', 'SWAY', 'PEEK', 'BOW', 'SPIN'].map(id => `BODY_MOTION_${id}`)]) {
          assert.ok(output.includes(`PET_${marker}_OK`), `${marker}检查未完成`);
        }
        assert.doesNotMatch(output, /Uncaught|ERR_FILE_NOT_FOUND|did-fail-load/i);
        resolve(output);
      } catch (error) {
        reject(error);
      }
    });
  });
}

runSmokeTest().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
