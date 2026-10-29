const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const productDir = path.join(__dirname, '../product');
const html = fs.readFileSync(path.join(productDir, 'index.html'), 'utf8');
assert.doesNotMatch(html, /download-checks|app-capture|data-showcase-try/);
assert.doesNotMatch(html, /<section[^>]+id="updates"|class="updates-history"|class="milestone-update"/);
assert.ok(html.includes('href="../updates/" target="_blank" rel="noopener">更新日志'));
const arm64 = [...html.matchAll(/data-download-arch="arm64"[^>]*href="([^"]+)"/g)];
assert.equal(arm64.length, 6);
const githubArm64 = arm64.filter(m => m[1].startsWith('https://github.com/'));
assert.equal(githubArm64.length, 3);
assert.ok(githubArm64.every(m => /\/v0\.4\.8\/Qiuqiu-0\.4\.08-macOS-arm64\.dmg$/.test(m[1])));
assert.match(html, /<dt>版本<\/dt><dd>0\.4\.08<\/dd>/);
assert.ok(html.includes('<dt>发布日期</dt><dd>2026-10-26</dd>'));
assert.match(html, /直接选择本机 Codex 自定义宠物/);
assert.match(html, /9 类动作/);
assert.match(html, /保存后应用到桌面，并同步聊天头像/);
const demoTitles = [...html.matchAll(/<iframe[^>]+title="([^"]+)"/g)].map(m => m[1]);
assert.equal(demoTitles.filter(title => title.startsWith('0.4.00 ')).length, 2);
assert.equal(demoTitles.filter(title => title.startsWith('0.4.04 ')).length, 1);
assert.equal(demoTitles.filter(title => title.startsWith('0.4.08 多应用额度')).length, 2);
assert.ok(demoTitles.every(title => !title.includes('0.4.01')));
const home = fs.readFileSync(path.join(productDir, '../index.html'), 'utf8');
const homeDownloads = [...home.matchAll(/href="(https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/[^\"]+)"/g)];
assert.equal(homeDownloads.length, 2);
assert.ok(homeDownloads.every(m => /\/v0\.4\.8\/Qiuqiu-0\.4\.08-macOS-arm64\.dmg$/.test(m[1])));
assert.match(home, /0\.4\.08 · Apple 芯片/);
assert.match(html, /v0\.3\.13\/Qiuqiu-0\.3\.13-macOS-x64\.dmg/);
assert.match(html, /下载并打开 DMG/);
assert.match(html, /双击挂载磁盘镜像/);
assert.doesNotMatch(html + home, /-share\.zip|下载 ZIP/);
assert.doesNotMatch(html, /class="install-list"|codex-pet-row|可操作演示 ·/);
assert.match(html, /assets\/macos-privacy-security-open-anyway\.png/);
assert.doesNotMatch(html, /幻彩云|圆角方|尚不包含此功能/);
for (const ref of html.matchAll(/(?:src|href)="([^"#][^"]+)"/g)) {
  const file = ref[1].split('?')[0];
  if (!/^https?:/.test(file)) assert.ok(fs.existsSync(path.join(productDir, file)), `missing ${file}`);
}
console.log('Functionality page: retained demos, moved history, release downloads and local resources passed');

for (const page of [html,home]) {
  const domestic=[...page.matchAll(/<a[^>]*href="https:\/\/share\.weiyun\.com\/ZdAiD7rR"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(domestic.length,3);
  assert.ok(domestic.every(m=>m[0].includes('0.4.08')&&m[0].includes('微云分享页')&&!m[1].includes('旧版')));
  assert.ok(domestic.every(m=>m[0].includes('target="_blank"')&&m[0].includes('rel="noopener"')));
  assert.doesNotMatch(page,/share\.weiyun\.com\/(?:OJvZzed5|rXnnLRhI)/);
  assert.match(page,/analytics\.js\?v=20261026-release/);
}
assert.match(html,/Intel 构建候选/);
assert.match(html,/尚未在真实 Intel Mac 上验收/);

// Primary Apple downloads use the explicit domestic share page; GitHub remains an opt-in fallback.
for (const page of [html, home]) {
  const primary = [...page.matchAll(/<a[^>]*class="[^"]*(?:button-primary|download-button)[^"]*"[^>]*data-download-arch="arm64"[^>]*>/g)];
  assert.equal(primary.length, page === html ? 3 : 1);
  assert.ok(primary.every(m => m[0].includes('href="https://share.weiyun.com/ZdAiD7rR"')));
  assert.match(page, /GitHub 备用/);
  assert.doesNotMatch(page, /自动加速|免登录下载|不限速/);
}

// GitHub fallback is a native DMG download, not a new-page link.
for (const page of [home, html]) {
  const fallback = [...page.matchAll(/<a[^>]*href="https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/[^" ]+arm64\.dmg"[^>]*>[\s\S]*?<\/a>/g)];
  assert.equal(fallback.length, page === home ? 2 : 3);
  assert.ok(fallback.every(m => !m[0].includes('target="_blank"') && !m[0].includes('↗')));
  assert.doesNotMatch(page, /<span>[^<]*微云分享页/);
}
