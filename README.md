# 球球桌宠公开官网

这是球球桌宠的独立静态官网源码，部署目标为 GitHub Pages。

## 维护原则

- 官网保持免费、非商业，不放广告、付费、赞助或商业推广。
- Apple 芯片与 Intel x64 下载信息分开维护，不用另一架构冒充。
- 下载链接必须来自公开 GitHub Release 直链，并同步版本、文件大小、发布日期和 SHA-256。
- Intel 构建候选在真实 Intel Mac 验收前，必须保留明显说明。
- `LICENSE`、`NOTICE.md` 和原作者 `sam70361/emotion-ball` 署名不得删除。
- 官网不使用 Cookie、表单或远程字体；访问统计仅限下方说明的匿名汇总范围。

## 官网访问统计

Umami Cloud 网站“球球官网”，website ID 为 `fe855bb0-9000-49aa-820b-baa55887bd11`。从 2026-09-24 发布接入后开始累计，不包含此前访问。私有[统计看板](https://cloud.umami.is/analytics/us/websites/fe855bb0-9000-49aa-820b-baa55887bd11)需使用本次已登录的 Umami 账号。后台时区已核对为 Asia/Shanghai，当前套餐为 Hobby（$0/月）。

配置在 `index.html` 中 `analytics.js` 的 `data-website-id`。清空该值即可停用，停用时也不加载第三方脚本；停用或更换平台时同步修改首页隐私说明。此 ID 为公开网站配置，不是 API 密钥。

- 仅在 `https://qiuqiu.pet` 加载；本地预览、其他域名、DNT 开启或 `localStorage['umami.disabled'] = '1'` 时不加载。
- 一次页面加载上报一次 PV；站内锚点切换不重复计数。UV 是 Umami 的匿名访客估算，不能当作真实人数，跨设备或浏览器可能重复。
- `download` 事件只包含 `architecture`（`arm64` / `x64`）与 `position`（`hero` / `download`）。下载点击不代表下载完成或安装成功；脚本拦截、网络失败与过早离开可能造成漏计。
- 页面 URL 固定为 `/`，来源仅保留外部网站 origin；不传 URL 查询参数、hash、来源路径、聊天演示内容、邮箱或账号信息。不启用身份识别、回放或热图。
- 保留浏览器语言、屏幕尺寸等基础访问维度；Umami 根据网络请求识别粗略地区及设备。统计不使用 Cookie，尊重 DNT；不影响桌宠本地运行的隐私边界。
- Umami Hobby 当前免费额度为每月 100,000 个事件、1 个网站、保留 6 个月；PV 与下载点击均消耗事件额度。免费版不含 API/MCP，日报需从已登录的后台读取。不升级、不添加付款方式。
- 历史访问无法补回。首日按接入时间注明不完整；日报按 Asia/Shanghai 的前一自然日统计，读取失败不能记为 0。

参考：[Umami 价格](https://umami.is/pricing)、[追踪配置](https://docs.umami.is/docs/tracker-configuration)、[指标口径](https://docs.umami.is/docs/metric-definitions)。

本地检查：`node --test tests/analytics.test.cjs`。这些测试不会连接统计后台。

## 当前下载记录

Apple 芯片版 **0.4.00**，发布日期 **2026-10-05**，GitHub 兼容标签 `v0.4.0`。本轮包含便签与待办、来定制球球、自动更新提醒、额度卡片 2.0 与全局 UI 升级。用户确认的六项日志完整保留在首页，第六项仅标题；官网可见的 0.3.27–0.3.32 日志合并为本次里程碑，范围外 12 条历史保留。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.00-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.0/Qiuqiu-0.4.00-macOS-arm64-share.zip) | 123560022 | `5374bcbc07fde4eb36814066774dad03d516ee42052a728e851c018acf3539af` |
| [Qiuqiu-0.4.00-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.0/Qiuqiu-0.4.00-macOS-arm64.dmg) | 137814227 | `184677114814b3f261675134b59f0ea5dfd5b8cf0b2acfb24aff7ffff5e6fd07` |

### 0.3.32 下载记录（保留在维护文档，不在首页展示）

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.3.32-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.32/Qiuqiu-0.3.32-macOS-arm64-share.zip) | 123482291 | `daab41fffda21f1f269bc31cc8474eaba09c658d907bb1b844b8f546794162b6` |
| [Qiuqiu-0.3.32-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.32/Qiuqiu-0.3.32-macOS-arm64.dmg) | 137811080 | `aa3f79586a1ee618e399f53a9f7cf9446e6bd742578ae0553e22db8aae611c64` |

### 0.3.31 下载记录（保留）

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.3.31-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.31/Qiuqiu-0.3.31-macOS-arm64-share.zip) | 123480779 | `f889ab8d214477846bec9df5b9bac42eb115a5c20bb6d32e08233265417f2600` |
| [Qiuqiu-0.3.31-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.31/Qiuqiu-0.3.31-macOS-arm64.dmg) | 137807268 | `4f6d13dc5dfd4b3dd7c1d9aa19aa80f565b51c2852217845fbce62902444a122` |

### 0.3.30 下载记录（保留）

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.3.30-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.30/Qiuqiu-0.3.30-macOS-arm64-share.zip) | 123480684 | `78c474ec18e9b22990385bcad526b987a35ccffe8581edcdd3dc89829c264c85` |
| [Qiuqiu-0.3.30-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.30/Qiuqiu-0.3.30-macOS-arm64.dmg) | 137808229 | `2b38f31bf64698fc839c62965127fcbdca87f8135534fb57fe1acb2be7c78552` |

ZIP 解压得到“球球桌宠.app”，可拖入 Applications；DMG 是另一个独立安装附件。Intel x64 下载仍为已公开的 0.3.13 构建候选，尚未在真实 Intel Mac 上验收；本次更新仅适用于 Apple 芯片版。应用采用本机临时签名，未进行 Apple Developer ID 签名或公证。

额外点数不限定 Pro；符合条件的 Plus/Pro 账号可购买点数，支持灵活计费的团队可使用工作区点数。球球仅在账号支持点数且 Codex 返回点数状态时展示，不并入套餐比例或重置机会，也不与 API 费用合并。依据：[官方点数说明](https://learn.chatgpt.com/docs/pricing)。

API 报告需要组织所有者提供具有费用与用量读取权限的 Admin API Key；普通调用 Key 无法查询费用。默认范围是整个组织，费用保留官方币种，缓存属于输入 tokens 的一部分；数据可能延迟，不表示余额、当前聊天实时费用或最终账单。报告与常驻卡由用户主动连接、开启，密钥在本机安全存储中加密保存。官网仅说明功能，没有连接真实 API 账户或验证真实账单。

新版检查只提供版本结果和下载页面入口。本目录内容更新及本地检查不代表 Release 已上传或官网已发布，发布后须回读公开安装附件与线上页面。

官网模型菜单是预设演示，不读取账号模型列表、不发送真实消息、不保存桌宠设置。实际应用的模型目录以本机 Codex 当前账号为准，切换保持同一聊天；不承诺固定响应时间。

## 本地预览

在本目录启动任意静态文件服务器，然后访问首页。例如：

```bash
python3 -m http.server 4179 --bind 127.0.0.1
```

## 官网验证与发布

```bash
node --test tests/*.test.cjs
# 另开本地静态服务器，使用已经安装的 Playwright 与 Chrome；无需新增依赖。
NODE_PATH=/path/to/existing/node_modules QIUQIU_SITE_URL=http://127.0.0.1:4185/ QIUQIU_QA_OUTPUT=/tmp/qiuqiu-website-0400 node tests/showcases.browser.cjs
```

浏览器检查包括 1440/390/320px 浅深色、系统深色、减少动态及四类展示的实际操作。检查使用浏览器临时设置退出匿名统计；分区截图暂隐藏固定导航与回顶按钮，检查仍在完整页面运行。

部署沿用 `gh-pages` 根目录与 `qiuqiu.pet`。本地检查通过后提交、推送；必须回读 Pages 的实际构建提交及线上 HTML/变更资源，不能把推送成功当作部署完成。

## 目录

- `index.html`：页面内容和可访问结构。
- `styles.css`：浅色、深色、移动端与网页玻璃材质近似。
- `app.js`：外观切换、移动导航和校验值复制。
- `motion-showcase.js`、`motion-showcase.css`：首屏、互动、Codex 与桌面场景的实时 V5 动效编排；自动播放支持离屏暂停、手动点选及减少动态效果。
- `quota-demo.js`、`quota-demo.css`：可操作的额度演示卡片，只使用示例数据，不连接 Codex。
- `assets/motion/`：复用已确认的 V5 互动、思绪游光和文案模块，以及原有身体动作采样；原设计稿和桌面应用未修改。
- `assets/vendor/emotion-ball/`：复用公开 0.4.00 的球形角色矢量引擎与形态数据。
- `notes-showcase.js`、`notes-showcase.css`：便签、待办、桌面卡与整理确认的内存示例，无真实模型或通知。
- `customize-showcase.js`、`customize-showcase.css`：四形态与实时配色、命名收藏、保存后头像同步的网页示例；幻彩使用公开六瓣静态图，不模拟真实 Rive 动效。
- `chat-showcase.js`、`chat-showcase.css`：0.4.00 浅薄荷/冷石墨聊天样式与历史续聊示例。
- `assets/screenshots/`：保留历史图；`v0400-*` 用于当前主介绍图。定制与额度来自最终公开包原生截图，便签直接渲染公开版 DOM/CSS 及合成内容；简化交互示例收进折叠区域。
- `LICENSE`、`NOTICE.md`：许可与原作者声明。
