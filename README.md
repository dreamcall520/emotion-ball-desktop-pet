# 球球桌宠公开官网

这是球球桌宠的独立静态官网源码，部署目标为 GitHub Pages。

## 首页、功能介绍、更新日志与隐私说明

首页外观切换等待目标背景解码后，同步更新页面配色、图片与 WebGL 纹理；快速切换仅应用最后一次选择，跟随系统使用相同流程。下载按钮仅保留位移过渡，底色直接跟随外观。四页浏览器标签及 manifest 复用导航的透明圆球 `assets/brand-72.webp`，不改 App 安装图标。

首页采用确认后的整屏银白/夜景玻璃主视觉，品牌语「球球-陪你自在一点」。`home.js` 复用原生 WebGL 实现自动柔光、曲面折射与鼠标水波；眼睛以2～4秒随机间隔自然眨动，约四分之一概率快速连眨两次，闭眼以像素宽度的抗锯齿圆弧收合并沿用原眼睛颜色；暂停、减少动态、页面隐藏及静态回退保持可用。主下载按钮为「macOS 版下载」并使用内联 Apple 标识，下方注明版本与 Apple 芯片，Intel 保持独立说明入口。首页顶部导航叠加半透明渐变、柔和高光与背景模糊；浅深色分别处理，并支持减少透明度与无模糊能力的静态回退。

原官网功能和演示保留在 `product/index.html`，地址为 `https://qiuqiu.pet/product/`。导航的功能介绍、安装指南与更新日志在新页签打开；旧首页功能锚点通过 `location.replace` 跳转到对应功能分区。旧 `product.html` 仅保留兼容跳转，并携带原查询参数和锚点。产品正文和演示、许可及署名保持。日志位于 `updates/index.html`（`https://qiuqiu.pet/updates/`），按用户要求移除 0.4.03 条目，保留其余 15 条记录；0.4.00 在侧栏、正文及手机选择器标为「大版本更新」。官网下载仍为最新 0.4.03。历史下载每种架构只保留 DMG，共 16 个入口（15 个 DMG 与唯一无 DMG 的 0.3.10 热修复 ZIP）；重复的 Apple／Intel 版本提示已删。桌面侧栏、手机选择器、hash 直链与历史返回保持，无 JavaScript 时显示全部记录。旧 `/product/#updates` 及 `product.html#updates` 转到独立日志页。首页、功能介绍、更新日志保留独立 canonical 和分享封面；隐私说明独立位于 `https://qiuqiu.pet/privacy/`，四页均已加入 sitemap。

首页「免费、非商业 · 署名与许可」使用原生小弹窗，分行展示使用范围、原作者 GitHub 项目与再次分发说明，可通过关闭按钮、Esc 或点击背景关闭；不再跳转功能介绍。原作者旧项目地址已重定向为 `sam70361/aora-bot`，弹窗链接使用 GitHub API 回读的现地址。首页新页签入口统一为细线圆角新窗口图标。更新日志只展示对应版本下载，不附加 GitHub Release 页面入口。

功能介绍采用统一宽度模块、左文案/右真实演示与圆角玻璃胶囊导航，彩色细边流光尊重减少动态设置；浅深色主下载统一为蓝色并加 Apple 标识。主下载按下时轻微放大，松开回弹，减少动态时不启用缩放过渡。页尾提供「陪你工作，也帮你记事。」和下载入口，许可复用首页原生弹窗。普通演示固定浅色标准配色，外观模块继续独立演示浅/深/系统和高对比；便签两窗口单次带 scope 初始化。隐私说明改为独立文档，联系邮箱为用户确认的 `920022027@qq.com`；旧首页和产品页隐私锚点保留查询参数跳转。

主视觉为本项目生成的静态资产；自动柔光在玻璃区域内渲染；鼠标移动和点击水波覆盖空白背景并保护角色，文字始终固定。以30fps、130万像素和最多3组鼠标波为上限，没有新增项目依赖。

## 维护原则

- 官网保持免费、非商业，不放广告、付费、赞助或商业推广。
- Apple 芯片与 Intel x64 下载信息分开维护，不用另一架构冒充。
- 下载链接必须来自公开 GitHub Release 直链，同步版本和发布日期；文件大小、SHA-256 保留在本维护文档。
- Intel 构建候选在真实 Intel Mac 验收前，必须保留明显说明。
- `LICENSE`、`NOTICE.md` 和原作者 `sam70361/emotion-ball` 署名不得删除。
- 官网不使用 Cookie、表单或远程字体；访问统计仅限下方说明的匿名汇总范围。

## 官网访问统计

Umami Cloud 网站“球球官网”，website ID 为 `fe855bb0-9000-49aa-820b-baa55887bd11`。从 2026-09-24 发布接入后开始累计，不包含此前访问。私有[统计看板](https://cloud.umami.is/analytics/us/websites/fe855bb0-9000-49aa-820b-baa55887bd11)需使用本次已登录的 Umami 账号。后台时区已核对为 Asia/Shanghai，当前套餐为 Hobby（$0/月）。

配置在首页、`product/index.html`、`updates/index.html` 和 `privacy/index.html` 中 `analytics.js` 的 `data-website-id`。清空该值即可停用，停用时也不加载第三方脚本；维护时保持本记录与实际脚本配置一致。此 ID 为公开网站配置，不是 API 密钥。

- 仅在 `https://qiuqiu.pet` 加载；本地预览、其他域名、DNT 开启或 `localStorage['umami.disabled'] = '1'` 时不加载。
- 一次页面加载上报一次 PV；站内锚点切换不重复计数。UV 是 Umami 的匿名访客估算，不能当作真实人数，跨设备或浏览器可能重复。
- `download` 事件只包含 `architecture`（`arm64` / `x64`）与 `position`（`hero` / `download`）。下载点击不代表下载完成或安装成功；脚本拦截、网络失败与过早离开可能造成漏计。
- 页面 URL 固定为 `/`，来源仅保留外部网站 origin；不传 URL 查询参数、hash、来源路径、聊天演示内容、邮箱或账号信息。不启用身份识别、回放或热图。
- 首页、功能介绍、更新日志和隐私说明各加载一次PV，继续汇总为站点访问，不区分页面路径；下载事件统计带当前入口标记的 DMG 或 ZIP；官网主入口现为 DMG，切换前的历史统计不回算。日志页的历史下载不加入当前下载指标，切换版本不新增 PV。
- 保留浏览器语言、屏幕尺寸等基础访问维度；Umami 根据网络请求识别粗略地区及设备。统计不使用 Cookie，尊重 DNT；不影响桌宠本地运行的隐私边界。
- Umami Hobby 当前免费额度为每月 100,000 个事件、1 个网站、保留 6 个月；PV 与下载点击均消耗事件额度。免费版不含 API/MCP，日报需从已登录的后台读取。不升级、不添加付款方式。
- 历史访问无法补回。首日按接入时间注明不完整；日报按 Asia/Shanghai 的前一自然日统计，读取失败不能记为 0。

参考：[Umami 价格](https://umami.is/pricing)、[追踪配置](https://docs.umami.is/docs/tracker-configuration)、[指标口径](https://docs.umami.is/docs/metric-definitions)。

本地检查：`node --test tests/analytics.test.cjs`。这些测试不会连接统计后台。

## 当前下载记录

Apple 芯片版 **0.4.03**，发布日期 **2026-10-07**，GitHub 兼容标签 `v0.4.3`。

【修复】额度趋势连线和显示

- 优化额度趋势连线与采样点显示，减少碎段和参考线干扰。
- 连续记录使用实线；缺记录区间仅以淡蓝虚线连接已知两端，余额校正仍断开，不填充缺口、不改变连续用量预测。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.03-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.3/Qiuqiu-0.4.03-macOS-arm64-share.zip) | 123599537 | `b2af0ad53485b2b70806264252378be0499e76313cd04927eb9529746155ad96` |
| [Qiuqiu-0.4.03-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.3/Qiuqiu-0.4.03-macOS-arm64.dmg) | 137853172 | `610966a0757abbbca47c8fe276ef5d2a7d7c3cbeed016ecb5d3986214d5eccca` |

大小与 SHA-256 来自本地正式附件元数据 `v0.4.03-trend-lines/public-installer.json`，公开源码 `f6497e3b8b1290f35ad1b686de3c3bffde82cb8c`。公开 Release `v0.4.3` 已发布；本轮通过公开 API 核对 DMG 名称、大小及 digest，并完成直链 HEAD 回读。完整包体的下载、签名及内容验收见项目 0.4.03 正式发布记录，本轮未重新下载包体。

### 0.4.02 下载记录（保留）

Apple 芯片版 **0.4.02**，发布日期 **2026-10-07**，GitHub兼容标签 `v0.4.2`。新增薄荷绿／晴空蓝主题，优化便签、待办与色弱友好模式，并修复额度趋势历史保留。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.02-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.2/Qiuqiu-0.4.02-macOS-arm64-share.zip) | 123599166 | `dc893f5b631cc5e6f56b2334d5cb28f0b237aa0cf11d8881c0da11094944eec3` |
| [Qiuqiu-0.4.02-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.2/Qiuqiu-0.4.02-macOS-arm64.dmg) | 137850212 | `356acfc53a3d929dabab016639f13404d24b3e7eac798e6a889c4eae5c2943c3` |

公开地址完整下载、大小、SHA-256、App签名及源码回读通过，证据 `v0.4.02-theme-and-quota/public-release-download-verification.json`。

### 0.4.01 下载记录（保留）

Apple 芯片版 **0.4.01**，发布日期 **2026-10-07**，GitHub 兼容标签 `v0.4.1`。新增直接选择本机 Codex 自定义宠物、九类动作预览、六档尺寸同步、搜索与滚动列表，以及本机副本、临时换装和启动外观保存。发布日期按 Release API 的 publishedAt 转换为北京时间；公开 ZIP、DMG 已完整下载核验，版本、签名及包内内容一致。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.01-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.1/Qiuqiu-0.4.01-macOS-arm64-share.zip) | 123579755 | `1a3e31a11f301d7454e42f387dc88f34728b9bdc73f2d3ab7df1768bbdf84c54` |
| [Qiuqiu-0.4.01-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.1/Qiuqiu-0.4.01-macOS-arm64.dmg) | 137834518 | `605e838eb5ff9f88ec19cfa6f23162db2dc932c06af7292a9e7dbbdf14de08b9` |

本轮附件的精确大小与 SHA-256 已由公开下载回读核验，详见项目验收记录 `v0.4.01-codex-pets/public-release-download-verification.json`。

### Intel 下载记录

Intel 0.3.13 构建候选仍未在真实 Intel Mac 验收。下表为 2026-10-07 GitHub 资产 API 返回的大小与 SHA-256 digest，HEAD 大小匹配；本轮未重新完整下载安装包。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.3.13-macOS-x64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.13/Qiuqiu-0.3.13-macOS-x64-share.zip) | 137676767 | `f4b1ee54f99da7222780cbd0d98799a2db79128329c9e12d8b8b0e0a2f6bc12a` |
| [Qiuqiu-0.3.13-macOS-x64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.13/Qiuqiu-0.3.13-macOS-x64.dmg) | 139670369 | `989ac4adfb2ad2e0501a82e5d8898e00494680cde89562fe39e5599da93f42d1` |

### 0.4.00 下载记录（保留）

Apple 芯片版 **0.4.00**，发布日期 **2026-10-05**，GitHub 兼容标签 `v0.4.0`。本轮包含便签与待办、来定制球球、自动更新提醒、额度卡片 2.0 与全局 UI 升级。更新日志日期按用户要求为 **2026-10-06**；下载发布日期仍采用 Release 的 2026-10-05。用户确认的六项日志完整保留在独立更新日志页，第六项仅标题；官网可见的 0.3.27–0.3.32 日志合并为本次里程碑，范围外 12 条历史保留。

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

官网默认提供 DMG：打开磁盘镜像，将“球球桌宠.app”拖入 Applications，完成后可推出镜像。GitHub Release 保留 ZIP 归档；历史记录仅在没有对应 DMG 时显示 ZIP。Intel x64 下载仍为已公开的 0.3.13 构建候选，尚未在真实 Intel Mac 上验收；本次更新仅适用于 Apple 芯片版。应用采用本机临时签名，未进行 Apple Developer ID 签名或公证。

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
```

当前检查涵盖旧地址跳转、演示主题、便签窗口 scope、原生许可弹窗控制、历史日志及下载契约。`tests/showcases.browser.cjs` 保留的是改版前完整页面的浏览器脚本，其旧版布局断言不适用于当前结构；独立日志的浏览器脚本为 `tests/updates.browser.cjs`。本轮自动浏览器访问受地址策略限制，最新玻璃、按压反馈及四宽度浅深色渲染尚未复验，源码/HTTP 检查不替代实际视觉验收。

部署沿用 `gh-pages` 根目录与 `qiuqiu.pet`。本地检查通过后提交、推送；必须回读 Pages 的实际构建提交及线上 HTML/变更资源，不能把推送成功当作部署完成。

## 当前功能演示

额度、趋势、聊天与便签/待办保留公开 App 0.4.00 `main@7f5c291d34512f629c17275c93bed472f421e8b9` 基线。定制器及聊天头像引擎升级为公开 0.4.03 `main@eac7a8d12bd425fb98f005828ab80afabe18ca0b`；定制器保留原生界面与动作播放器。蓝色覆盖样式逐字节取自公开 0.4.03 `main@eac7a8d12bd425fb98f005828ab80afabe18ca0b`，来源与哈希见 `demos/theme-source-manifest.json`；原界面来源与必要适配见各演示目录 `source-manifest.json`。定制区并列介绍球球形态/配色定制与本机 Codex 自定义宠物。网页演示使用作者提供的既有 ikun、春野原始精灵图，可选择宠物、预览 9 类动作、收藏/载入及保存后同步本页聊天头像；不读取访客的本机宠物目录。两份素材原字节与来源记录见 `demos/customize/assets/demo-pets.json`。主介绍不再叠放截图或折叠简化示例；历史截图文件仅作归档。

Electron IPC 替换为本页内存桥接，不连接账户、模型或账单，不修改 App 或用户资料；刷新页面恢复示例。定制保存后同步本页聊天头像，收藏载入仅影响预览。公开六瓣幻彩采用原 Rive 引擎。外层官网沿用浅灰蓝/深灰，普通演示默认晴空蓝和浅色；外观控件按「主题色」「明暗模式」「可读性」分组：桌面使用细竖线分隔，手机分行并用细横线区分；色点、选中下划线与原生高对比开关保留，三类设置独立生效。官网的蓝色默认值不改变 App 新装默认薄荷绿。手机仅适配原控件，不用截图缩放。离屏、页面隐藏、暂停与减少动态均可停止演示动效。嵌入窗口在用户进入前不自动抢焦点，脚本聚焦不滚动官网。功能页使用 `overflow-x:clip`，避免 body 形成额外滚动容器而干扰导航吸顶。

安装区保留三步图示，右侧为 [Apple 官方说明](https://support.apple.com/zh-cn/102445)中的真实 macOS「隐私与安全性」截图，标出「仍要打开」的实际位置；原图来自 [Apple CDN](https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/locale/zh-cn/macos-sequoia-system-settings-privacy-and-security-open-app-anyway.png)，未修改、未包含用户个人设置。

## 目录

- `index.html`、`home.js`、`home.css`：整屏品牌首页、玻璃柔光/鼠标水波和首页菜单。
- `flow-border.css`：首页主下载与功能页导航共用原有彩色边缘流光，保留减少动态适配；首页暂停按钮与页面隐藏共用现有暂停状态。
- `product/index.html`、`product-layout.css`、`styles.css`、`dark-theme.css`：功能介绍全文、外层配色与响应式布局；`product.html` 仅兼容旧地址跳转。
- `privacy/index.html`、`privacy.css`：独立隐私说明与用户确认的联系邮箱。
- `updates/index.html`、`updates.css`、`updates.js`：独立版本日志、响应式版本选择、真实版本下载与无脚本阅读。
- `app.js`：主题、移动导航等原有页面操作。
- `motion-showcase.js/css`、`assets/motion/`：复用 V5 互动、思绪游光与身体动作；支持离屏暂停、手动点选和减少动态。
- `demo-embed.js`、`demo-focus.js`、`native-demos.css`：同源嵌入、主题、保存头像、尺寸和暂停联动。
- `demos/{quota,chat,customize,notes}/`：当前公开 App 界面、内存桥接、来源清单及可运行检查。
- `appearance-showcase.js/css`：薄荷绿/晴空蓝、标准/色弱及浅色/深色/系统演示控制。
- `chat-showcase.css`、`notes-showcase.css`：官网介绍排版。
- `assets/vendor/emotion-ball/`：公开球形角色引擎。
- `assets/screenshots/`：历史图片归档，主介绍不再使用。
- `LICENSE`、`NOTICE.md`：许可与原作者声明。
