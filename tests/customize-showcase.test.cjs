const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const productDir = path.join(__dirname, '../product');
const html = fs.readFileSync(path.join(productDir, 'index.html'), 'utf8');
assert.doesNotMatch(html, /download-checks|app-capture|data-showcase-try/);
assert.doesNotMatch(html, /<section[^>]+id="updates"|class="updates-history"|class="milestone-update"/);
assert.ok(html.includes('href="../updates/" target="_blank" rel="noopener">更新日志'));
const arm64 = [...html.matchAll(/data-download-arch="arm64"[^>]*href="([^"]+)"/g)];
assert.equal(arm64.length, 3);
assert.ok(arm64.every(m => /\/v0\.4\.0\/Qiuqiu-0\.4\.00-macOS-arm64(?:-share\.zip|\.dmg)$/.test(m[1])));
assert.match(html, /<dt>发布日期<\/dt><dd>2026-10-05<\/dd>/);
assert.match(html, /v0\.3\.13\/Qiuqiu-0\.3\.13-macOS-x64-share\.zip/);
assert.match(html, /下载并解压 ZIP/);
assert.match(html, /得到「球球桌宠\.app」/);
assert.doesNotMatch(html, /class="install-list"|codex-pet-row|可操作演示 ·/);
assert.match(html, /assets\/macos-privacy-security-open-anyway\.png/);
assert.doesNotMatch(html, /幻彩云|圆角方|尚不包含此功能|0\.4\.1/);
for (const ref of html.matchAll(/(?:src|href)="([^"#][^"]+)"/g)) {
  const file = ref[1].split('?')[0];
  if (!/^https?:/.test(file)) assert.ok(fs.existsSync(path.join(productDir, file)), `missing ${file}`);
}
console.log('Functionality page: retained demos, moved history, release downloads and local resources passed');
