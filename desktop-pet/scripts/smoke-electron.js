const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const electronBinary = require('electron');
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
      [`--user-data-dir=${smokeUserData}`, root],
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
    });
    child.stderr.on('data', chunk => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`桌宠真实启动超过 20 秒\n${output}`));
    }, 20000);

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
        assert.doesNotMatch(output, /Uncaught|ERR_FILE_NOT_FOUND|did-fail-load/i);
        resolve(output);
      } catch (error) {
        reject(error);
      }
    });
  });
}

runSmokeTest()
  .then(output => process.stdout.write(output))
  .catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
