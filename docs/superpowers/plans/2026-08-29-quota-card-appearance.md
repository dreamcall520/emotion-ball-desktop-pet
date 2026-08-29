# 额度卡片外观设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为额度卡片增加「跟随系统 / 浅色 / 深色」外观设置，默认跟随系统，并只影响桌面额度卡片。

**Architecture:** 沿用现有设置与 Codex 联动菜单，在额度窗口模型中增加一个白名单外观枚举。渲染层把该值写入页面根节点，CSS 继续使用同一套布局，通过外观状态和系统媒体查询选择浅色或深色液态玻璃变量，不修改 Electron 全局主题。

**Tech Stack:** Electron、CommonJS、原生 HTML/CSS、Node.js `node:test`、现有真实窗口 smoke 验收。

---

## 文件职责

- `desktop-pet/lib/settings.js`：新增并校验持久化设置 `codexQuotaAppearance`。
- `desktop-pet/main.js`：增加菜单、保存入口，并把设置提供给额度窗口。
- `desktop-pet/lib/quota-label-window.js`：把受控外观值并入现有卡片模型，切换时复用窗口和展开状态。
- `desktop-pet/quota-label-preload.js`：在 IPC 边界再次白名单化外观值。
- `desktop-pet/quota-label-renderer.js`：把外观写入文档与卡片节点，不改变额度内容。
- `desktop-pet/quota-label.css`：实现跟随系统与固定浅色/深色的视觉选择。
- `desktop-pet/tests/settings.test.js`、`desktop-pet/tests/main-motion.test.js`、`desktop-pet/tests/quota-label-window.test.js`：覆盖设置、菜单、模型、渲染和样式边界。
- `desktop-pet/scripts/verify-codex-companion.js`、`desktop-pet/scripts/smoke-electron.js`、`desktop-pet/tests/smoke-verification.test.js`：真实窗口切换、截图和 smoke 门禁。
- `README.md`、`desktop-pet/README.md`、`desktop-pet/分享安装说明.txt`、`package.json`、`package-lock.json`：0.3.8 使用说明与版本。

### Task 1: 设置与菜单

**Files:**
- Modify: `desktop-pet/tests/settings.test.js`
- Modify: `desktop-pet/tests/main-motion.test.js`
- Modify: `desktop-pet/lib/settings.js`
- Modify: `desktop-pet/main.js`

- [ ] **Step 1: 写设置失败测试**

在 `settings.test.js` 的默认设置断言中加入：

```js
assert.equal(DEFAULTS.codexQuotaAppearance, 'system');
for (const appearance of ['system', 'light', 'dark']) {
  assert.equal(normalizeSettings({ codexQuotaAppearance: appearance }).codexQuotaAppearance, appearance);
}
for (const invalid of ['', 'auto', 'night', 1, null, {}]) {
  assert.equal(normalizeSettings({ codexQuotaAppearance: invalid }).codexQuotaAppearance, 'system');
}
```

同时把所有完整设置对象的期望值补上 `codexQuotaAppearance: 'system'`，并验证保存 `dark` 后可回读且不会持久化账号或额度数据。

- [ ] **Step 2: 写菜单失败测试**

在 `main-motion.test.js` 的 fixture 增加 `codexQuotaAppearance = 'system'`，并让设置 stub 返回该值。新增测试：

```js
test('额度卡片外观提供跟随系统浅色深色三档并即时刷新', async () => {
  const off = await fixture();
  assert.equal(menuItem(off, 'codex-quota-appearance').enabled, false);

  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  const menu = menuItem(f, 'codex-quota-appearance');
  assert.equal(menu.submenu.find(item => item.checked).id, 'codex-quota-appearance-system');
  const before = f.quotaLabel.shows.length;
  assert.equal(f.call("setCodexPreference('codexQuotaAppearance', 'dark')"), true);
  assert.equal(f.saved.at(-1).codexQuotaAppearance, 'dark');
  assert.equal(menuItem(f, 'codex-quota-appearance').submenu.find(item => item.checked).id,
    'codex-quota-appearance-dark');
  assert.ok(f.quotaLabel.shows.length > before);
});
```

再扩展保存失败用例，确认外观仍为旧值、菜单勾选不假成功。

- [ ] **Step 3: 运行测试确认因缺少功能而失败**

Run:

```bash
node --test desktop-pet/tests/settings.test.js desktop-pet/tests/main-motion.test.js
```

Expected: FAIL，明确指出 `codexQuotaAppearance` 缺失或 `codex-quota-appearance` 菜单不存在。

- [ ] **Step 4: 最小实现设置与菜单**

在 `settings.js` 增加：

```js
codexQuotaAppearance: 'system'
```

并在 `normalizeSettings()` 中使用：

```js
codexQuotaAppearance: ['system', 'light', 'dark'].includes(raw.codexQuotaAppearance)
  ? raw.codexQuotaAppearance
  : DEFAULTS.codexQuotaAppearance
```

在 `setCodexPreference()` 白名单加入 `codexQuotaAppearance`，使用三个枚举校验；在 `codexMenu()` 的额度卡片大小之后增加：

```js
{
  id: 'codex-quota-appearance', label: '额度卡片外观', enabled: settings.codexEnabled === true,
  submenu: [
    ['system', 'codex-quota-appearance-system', '跟随系统'],
    ['light', 'codex-quota-appearance-light', '浅色'],
    ['dark', 'codex-quota-appearance-dark', '深色']
  ].map(([value, id, label]) => ({
    id, label, type: 'radio', enabled: settings.codexEnabled === true,
    checked: settings.codexQuotaAppearance === value,
    click: item => {
      item.checked = settings.codexQuotaAppearance === value;
      setCodexPreference('codexQuotaAppearance', value);
    }
  }))
}
```

- [ ] **Step 5: 运行设置与菜单测试**

Run:

```bash
node --test desktop-pet/tests/settings.test.js desktop-pet/tests/main-motion.test.js
```

Expected: PASS，且原有 Codex 设置、任务动作和拖动测试无回归。

- [ ] **Step 6: 提交设置与菜单**

```bash
git add desktop-pet/lib/settings.js desktop-pet/main.js desktop-pet/tests/settings.test.js desktop-pet/tests/main-motion.test.js
git commit -m "feat: 增加额度卡片外观设置"
```

### Task 2: 外观值安全传递到卡片页面

**Files:**
- Modify: `desktop-pet/tests/quota-label-window.test.js`
- Modify: `desktop-pet/lib/quota-label-window.js`
- Modify: `desktop-pet/quota-label-preload.js`
- Modify: `desktop-pet/quota-label-renderer.js`
- Modify: `desktop-pet/main.js`

- [ ] **Step 1: 写窗口模型、预加载和渲染失败测试**

在 `quota-label-window.test.js` 增加三类断言：

```js
test('外观值只接受 system light dark，切换时复用窗口与展开状态', async () => {
  let appearance = 'system';
  const f = fixture({ getAppearance: () => appearance });
  f.controller.show(readyModel());
  await f.ready();
  assert.equal(f.sent.at(-1).appearance, 'system');
  const sameWindow = f.controller.getWindow();
  appearance = 'dark';
  f.controller.show(readyModel());
  assert.equal(f.controller.getWindow(), sameWindow);
  assert.equal(f.sent.at(-1).appearance, 'dark');
});
```

- `getAppearance()` 返回非法值或抛错时发送 `system`。
- 预加载层把 `appearance` 白名单化，恶意 getter 只读取一次。
- 渲染模型把 `appearance` 写到 `document.documentElement.dataset.appearance` 和卡片根节点，非法值回退 `system`。

- [ ] **Step 2: 运行测试确认失败原因正确**

Run:

```bash
node --test desktop-pet/tests/quota-label-window.test.js
```

Expected: FAIL，发送模型缺少 `appearance`，页面没有 `data-appearance`。

- [ ] **Step 3: 最小实现模型传递**

在额度窗口构造参数增加：

```js
getAppearance = () => 'system'
```

用固定白名单解析，并在每次 `show()` 生成 `currentModel` 时加入：

```js
appearance: ['system', 'light', 'dark'].includes(value) ? value : 'system'
```

主进程创建窗口时传入：

```js
getAppearance: () => settings?.codexQuotaAppearance
```

预加载与渲染层的 `safeModel()` 都返回白名单 `appearance`；渲染时设置：

```js
document.documentElement.dataset.appearance = model.appearance;
label.dataset.appearance = model.appearance;
```

不把外观写进额度快照，不修改额度项、重置机会或展开逻辑。

- [ ] **Step 4: 运行窗口与 IPC 测试**

Run:

```bash
node --test desktop-pet/tests/quota-label-window.test.js desktop-pet/tests/main-motion.test.js
```

Expected: PASS，窗口引用、位置和展开状态保持不变。

- [ ] **Step 5: 提交数据传递**

```bash
git add desktop-pet/main.js desktop-pet/lib/quota-label-window.js desktop-pet/quota-label-preload.js desktop-pet/quota-label-renderer.js desktop-pet/tests/quota-label-window.test.js
git commit -m "feat: 将额度外观传递到卡片页面"
```

### Task 3: 浅色、深色与跟随系统视觉

**Files:**
- Modify: `desktop-pet/tests/quota-label-window.test.js`
- Modify: `desktop-pet/quota-label.css`

- [ ] **Step 1: 写样式失败测试**

在现有静态样式测试旁增加：

```js
test('额度卡片外观支持跟随系统和固定浅深色且不改变其他窗口', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /data-appearance=["']dark["']/);
  assert.match(css, /data-appearance=["']light["']/);
  assert.match(css, /data-appearance=["']system["']/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../pet.css'), 'utf8'),
    /data-appearance/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.doesNotMatch(main, /nativeTheme\.themeSource|desktopCapturer|screenCapture/);
});
```

同时检查固定深色使用浅色文字、固定浅色使用深色文字和高覆盖玻璃底。这样明确证明实现没有修改全局主题，也没有新增壁纸读取或屏幕录制路径。

- [ ] **Step 2: 运行测试确认 CSS 尚不支持覆盖模式**

Run:

```bash
node --test desktop-pet/tests/quota-label-window.test.js
```

Expected: FAIL，缺少 `data-appearance` 外观选择器。

- [ ] **Step 3: 最小实现 CSS 外观状态**

- 保留当前浅色变量为基础值。
- 将当前深色媒体查询限制为 `data-appearance="system"`。
- 为 `data-appearance="dark"` 提供同一组深色变量与文字/边框规则，使系统浅色时仍固定深色。
- 为 `data-appearance="light"` 明确浅色变量与文字/边框规则，使系统深色时仍固定浅色。
- 不修改卡片尺寸、网格、字体、流光关键帧或 `prefers-reduced-motion` 规则。

外观选择器使用以下结构；浅色和深色关键变量保持现有值，现有深色子元素规则分别挂到固定深色和系统深色选择器下：

```css
:root[data-appearance="light"] {
  color-scheme: light;
  --quota-surface: rgba(244, 249, 255, .86);
  --quota-muted: #555e6a;
  --quota-subtle: #505965;
}

:root[data-appearance="dark"] {
  color-scheme: dark;
  --quota-surface: rgba(26, 34, 45, .82);
  --quota-muted: #d2d8e0;
  --quota-subtle: #bdc6d1;
}

@media (prefers-color-scheme: dark) {
  :root[data-appearance="system"] {
    color-scheme: dark;
    --quota-surface: rgba(26, 34, 45, .82);
    --quota-muted: #d2d8e0;
    --quota-subtle: #bdc6d1;
  }
}
```

- [ ] **Step 4: 运行卡片静态与布局测试**

Run:

```bash
node --test desktop-pet/tests/quota-label-window.test.js desktop-pet/tests/quota-label-placement.test.js
```

Expected: PASS，标准/小巧/展开尺寸与对比度测试全部保留。

- [ ] **Step 5: 提交外观样式**

```bash
git add desktop-pet/quota-label.css desktop-pet/tests/quota-label-window.test.js
git commit -m "feat: 支持额度卡片固定浅深色"
```

### Task 4: 真实窗口切换与截图门禁

**Files:**
- Modify: `desktop-pet/scripts/verify-codex-companion.js`
- Modify: `desktop-pet/scripts/smoke-electron.js`
- Modify: `desktop-pet/tests/smoke-verification.test.js`

- [ ] **Step 1: 写 smoke 标记失败测试**

在 `smoke-verification.test.js` 的完整标记中加入 `PET_CODEX_QUOTA_APPEARANCE_OK`，并新增删除该标记后必须失败的断言。

- [ ] **Step 2: 运行 smoke 门禁测试确认失败**

Run:

```bash
node --test desktop-pet/tests/smoke-verification.test.js
```

Expected: FAIL，`smoke-electron.js` 尚未要求外观验收标记。

- [ ] **Step 3: 扩展真实窗口验收**

在 `labelView()` 返回 `appearance`、实际背景色和主要/次要文字色。通过正式 `setQuotaPreference()` 依次验证：

1. `system` + 模拟浅色；
2. `system` + 模拟深色；
3. `light` + 模拟深色，仍回读浅色；
4. `dark` + 模拟浅色，仍回读深色；
5. 同一窗口、同一尺寸、同一展开状态和相同额度行保持不变。

保存截图：

```text
quota-label-appearance-system-light.png
quota-label-appearance-system-dark.png
quota-label-appearance-forced-light.png
quota-label-appearance-forced-dark.png
```

完成后输出：

```js
process.stdout.write('PET_CODEX_QUOTA_APPEARANCE_OK\n');
```

并在 `smoke-electron.js` 强制要求 `CODEX_QUOTA_APPEARANCE`。

- [ ] **Step 4: 运行定向测试与源码真实窗口验收**

Run:

```bash
node --test desktop-pet/tests/smoke-verification.test.js desktop-pet/tests/quota-label-window.test.js
PET_SMOKE_ARTIFACT_DIR="$(mktemp -d /tmp/emotion-ball-appearance-source.XXXXXX)" npm run smoke
```

Expected: 测试 PASS；smoke 退出码 0，包含 `PET_CODEX_QUOTA_APPEARANCE_OK` 和 `PET_SMOKE_OK`，四张截图存在且内容哈希不全相同。

- [ ] **Step 5: 实际查看四张截图**

使用本地图片查看工具检查：

- 浅色与深色模式文字、边框、进度条清晰；
- 固定模式不受模拟系统主题反转；
- 小巧、标准和展开内容无裁切；
- 球球和气泡外观没有变化。

- [ ] **Step 6: 提交真实窗口门禁**

```bash
git add desktop-pet/scripts/verify-codex-companion.js desktop-pet/scripts/smoke-electron.js desktop-pet/tests/smoke-verification.test.js
git commit -m "test: 验收额度卡片外观切换"
```

### Task 5: 版本、文档、全量验收、安装与分享包

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `desktop-pet/README.md`
- Modify: `desktop-pet/分享安装说明.txt`

- [ ] **Step 1: 更新版本和使用说明**

将版本升至 `0.3.8`。说明「Codex 联动 → 额度卡片外观」三档、默认跟随系统和只影响额度卡片；保留免费非商业、Apple 芯片、未公证说明。

- [ ] **Step 2: 跑全量测试与源码 smoke**

Run:

```bash
git diff --check
npm test
PET_SMOKE_ARTIFACT_DIR="$(mktemp -d /tmp/emotion-ball-038-source.XXXXXX)" npm run smoke
```

Expected: 全量测试 0 失败；smoke 包含所有额度外观、动作、尺寸、睡眠和 Codex 标记。

- [ ] **Step 3: 构建并验证打包应用**

Run:

```bash
npm run package:mac
PET_SMOKE_APP_PATH="$PWD/dist/球球桌宠-darwin-arm64/球球桌宠.app" \
PET_SMOKE_ARTIFACT_DIR="$(mktemp -d /tmp/emotion-ball-038-packaged.XXXXXX)" npm run smoke
codesign --verify --deep --strict "dist/球球桌宠-darwin-arm64/球球桌宠.app"
```

Expected: 打包应用版本 0.3.8、严格签名有效，打包 smoke 退出码 0。

- [ ] **Step 4: 安装并保留用户设置**

- 正常退出 `/Applications/球球桌宠.app`。
- 安装前读取设置 SHA-256，把旧 0.3.7 应用移入废纸篓可恢复备份。
- 复制已验证 0.3.8 应用到 `/Applications`，确认安装前后设置 SHA-256 一致。
- 启动后回读版本、进程路径、`app.asar` 与打包应用一致；Spotlight 只保留正式安装入口。

- [ ] **Step 5: 生成并校验分享文件**

生成：

```text
/Users/allan/Documents/个人创作/球球桌宠-0.3.8-Apple芯片.dmg
/Users/allan/Documents/个人创作/球球桌宠-0.3.8-Apple芯片-分享用.zip
```

DMG 包含应用、Applications 链接和安装说明；运行 `hdiutil verify`、只读挂载版本/签名/`app.asar` 比对、`unzip -t`，记录大小和 SHA-256。不得覆盖旧分享文件。

- [ ] **Step 6: 提交文档版本并同步 GitHub**

```bash
git add package.json package-lock.json README.md desktop-pet/README.md desktop-pet/分享安装说明.txt
git commit -m "release: 准备球球桌宠 0.3.8"
git push origin codex/light-companion
```

回读本地与远端提交一致；不自动合并 `main`，不自动创建 GitHub Release。
