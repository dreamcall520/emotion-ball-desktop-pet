# 球球桌宠公开官网

这是球球桌宠的独立静态官网源码，部署目标为 GitHub Pages。

## 首页、功能介绍、更新日志与隐私说明

首页外观切换等待目标背景解码后，同步更新页面配色、图片与 WebGL 纹理；快速切换仅应用最后一次选择，跟随系统使用相同流程。下载按钮仅保留位移过渡，底色直接跟随外观。四页浏览器标签及 manifest 复用导航的透明圆球 `assets/brand-72.webp`，不改 App 安装图标。

首页采用确认后的整屏银白/夜景玻璃主视觉，品牌语「球球-陪你自在一点」。`home.js` 复用原生 WebGL 实现自动柔光、曲面折射与鼠标水波；眼睛以2～4秒随机间隔自然眨动，约四分之一概率快速连眨两次，闭眼以像素宽度的抗锯齿圆弧收合并沿用原眼睛颜色；暂停、减少动态、页面隐藏及静态回退保持可用。主下载按钮为「国内下载 · 微云」并使用内联 Apple 标识，下方注明版本与 Apple 芯片，并提供 GitHub 备用入口；Intel 保留顶部独立说明入口。首页顶部导航叠加半透明渐变、柔和高光与背景模糊；浅深色分别处理，并支持减少透明度与无模糊能力的静态回退。

原官网功能和演示保留在 `product/index.html`，地址为 `https://qiuqiu.pet/product/`。导航的功能介绍、安装指南与更新日志在新页签打开；旧首页功能锚点通过 `location.replace` 跳转到对应功能分区。旧 `product.html` 仅保留兼容跳转，并携带原查询参数和锚点。产品正文和演示、许可及署名保持。更新日志沿用编号小标题＋一句简短说明，直接写新增功能；不得因减轻视觉而改成无标题普通列表。标题字重、字号及间距可轻量调整，历史条目保持。0.4.10列官方皮肤小白与小宇、暮光紫配色、意见反馈、官方定制活动上线；定制活动标题下配一句“让喜欢的它，住进你的桌面。”，最新日志不附其它平台旧版本的说明段落，不写沟通过程、排序和技术返修细节。日志位于 `updates/index.html`（`https://qiuqiu.pet/updates/`），按用户要求移除 0.4.03 条目，本次以 0.4.08 替换 0.4.06 日志，保留其余 17 条记录；0.4.08 与 0.4.00 在侧栏、正文及手机选择器标为「大版本更新」。0.4.09 新增天气与额度卡交互更新日志，保留 0.4.08 及更早历史。macOS 各版本下载每种架构只保留 DMG，Windows 提供 EXE，共 22 个入口（20 个 DMG、1 个 Windows EXE 与唯一无 DMG 的 0.3.10 热修复 ZIP）；重复的 Apple／Intel 版本提示已删。桌面侧栏、手机选择器、hash 直链与历史返回保持，无 JavaScript 时显示全部记录。旧 `/product/#updates` 及 `product.html#updates` 转到独立日志页。首页、功能介绍、更新日志保留独立 canonical 和分享封面；隐私说明独立位于 `https://qiuqiu.pet/privacy/`，四页均已加入 sitemap。

首页「免费、非商业 · 署名与许可」使用原生小弹窗，分行展示使用范围、原作者 GitHub 项目与再次分发说明，可通过关闭按钮、Esc 或点击背景关闭；不再跳转功能介绍。原作者旧项目地址已重定向为 `sam70361/aora-bot`，弹窗链接使用 GitHub API 回读的现地址。首页新页签入口统一为细线圆角新窗口图标。更新日志只展示对应版本下载，不附加 GitHub Release 页面入口。

功能介绍采用统一宽度模块、左文案/右演示与圆角玻璃胶囊导航，彩色细边流光尊重减少动态设置；浅深色主下载统一为蓝色并加 Apple 标识。主下载按下时轻微放大，松开回弹，减少动态时不启用缩放过渡。页尾提供「陪你工作，也帮你记事。」和下载入口，许可复用首页原生弹窗。应用联动导航沿用 `#codex` 兼容锚点，说明覆盖 Codex、ZCode 与 WorkBuddy 的额度、积分和聊天；保留原两列布局与折叠说明，不增加独立卡片区域。普通演示固定浅色标准配色，外观模块继续独立演示浅/深/系统和高对比；便签两窗口单次带 scope 初始化。隐私说明改为独立文档，联系邮箱为用户确认的 `920022027@qq.com`；旧首页和产品页隐私锚点保留查询参数跳转。

主视觉为本项目生成的静态资产；自动柔光在玻璃区域内渲染；鼠标移动和点击水波覆盖空白背景并保护角色，文字始终固定。以30fps、130万像素和最多3组鼠标波为上限，没有新增项目依赖。

## 维护原则

- 球球桌宠保持免费下载，不售卖 App 或上游球形角色的授权。新增春野原创作品与周边展示、微信联系及自愿支持入口，不提供站内订单、结算或支付状态；周边仅使用春野形象，原 App 的许可与署名保持。
- Apple 芯片与 Intel x64 下载信息分开维护，不用另一架构冒充。
- GitHub 备用下载使用公开 Release DMG 直链，同步版本和发布日期；文件大小、SHA-256 保留在本维护文档。国内主入口指向 Apple 0.4.10 微云分享 https://share.weiyun.com/fdzg4UOY ，文件大小及 SHA-256 与正式 DMG 一致；Intel 和历史版本不复用该入口。
- Intel 与 Apple 芯片版本按各自验收结论维护；本次用户已确认 Intel 0.4.09 验收可用，当前页面按正常 Intel 芯片版展示。
- `LICENSE`、`NOTICE.md` 和原作者 `sam70361/emotion-ball` 署名不得删除。
- 官网不使用远程字体；意见反馈仅在用户主动提交时上传填写内容和所选截图。Umami 不使用 Cookie，GA4 使用第一方 Cookie，访问统计范围见下文。

## 搜索与站点地图

12 个公开页面分别维护标题、描述、canonical 与 OG/Twitter 分享信息，首页和功能页提供基本结构化数据。`sitemap.xml` 仅列正式页面；页面正文或搜索元信息有实际更新时，同步该页的 `lastmod`，不要按每日构建机械刷新。完整演示页使用 `noindex, follow, indexifembedded`，不独立出现在搜索结果中，同时允许 Google 理解产品页嵌入的演示；不要在 `robots.txt` 中禁止抓取演示资源。检查：`node --test tests/seo.test.cjs`。Google Search Console 的所有权验证、sitemap 提交及收录状态须在后台单独回读。

根目录 `google8197da8dce207df0.html` 是 `https://qiuqiu.pet/` 的 Search Console 所有权验证文件，必须保留原文件名与内容，成功验证后也不要移除；不加入 sitemap。

## 基础防护

- `robots.txt` 保留普通搜索抓取及 sitemap，拒绝 GPTBot、ClaudeBot、Google-Extended、CCBot，并请求所有爬虫跳过测试目录。这是对遵守协议的爬虫的声明，不能限制请求频率或拦截伪装爬虫；Google-Extended 同时控制部分 Gemini 内容使用。
- 所有完整页面及演示在正文前加载 `site-protection.js`，逐层检查 iframe 祖先。外站嵌入跳到不含统计的官网来源提示；直接访问、同源嵌套和本地 HTTP 预览正常使用。这是可被禁用 JavaScript 绕过的浏览器回退，无法阻止源码镜像、截图或直接下载素材。
- 首页与功能页许可弹窗提供官网地址、免费下载说明及 LICENSE / NOTICE 链接，沿用现有署名与非商业分发条款。按用户选择加强限制：首页、功能页和日志页的宣传图片阻止右键菜单和原生拖拽，正文拦截复制事件。文字仍可选择；链接、按钮、输入框、可编辑区、代码、隐私/许可及站内演示不受该限制，既有便签复制和下载保持可用。限制依赖 JavaScript，不能阻止截图、开发者工具、直接资源下载或整站复制。
- 域名当前使用 DNSPod / GitHub Pages，尚未配置 CDN 防爬限速、资源防盗链或 `Content-Security-Policy: frame-ancestors 'self'` 响应头。该指令不能通过 HTML meta 生效，若接入 CDN，必须允许官网现有同源多层演示；图片防盗链需覆盖 WebP 并放行分享封面及必要的公开资源。

检查：`node --test tests/protection.test.cjs`；实际浏览器：`NODE_PATH=<bundled node_modules> node tests/protection.browser.cjs`，不发送访问统计。后者覆盖三种屏宽、浅深色、许可链接、输入、站内双层演示、无 Referrer 外站嵌入、混合祖先及 sandbox iframe。

参考：[robots.txt 的能力边界](https://developers.google.com/search/docs/crawling-indexing/robots/intro)、[OpenAI crawler](https://developers.openai.com/api/docs/bots)、[Claude crawler](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)、[Google-Extended](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)、[Common Crawl](https://commoncrawl.org/ccbot)、[frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)、[Cloudflare 图片防盗链范围](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/)。

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

### GA4 访问来源与下载点击

GA4 媒体资源“球球官网”，网站数据流“球球官网 Web”，衡量 ID `G-4SKBHMHFLJ`、数据流 ID `16143253967`，报告时区为中国时间、币种 CNY。与既有 Umami 并行，覆盖 sitemap 中的 12 个正式页面；演示、测试和 Google 验证文件不加载统计。各页 `analytics.js` 的 `data-ga4-id` 配置同一个真实衡量 ID，空值时不加载 Google 脚本。GA4 使用第一方 Cookie 区分浏览器与会话，不代表真实人数或登录身份；不启用 Google Signals、广告个性化和增强型衡量。

- 手动发送每页一次 `page_view`，只包含正式页面路径、固定官网标题和外部来源 origin。已知 `utm_source`/`utm_medium` 组合可以归因微信、小红书等渠道，其它查询参数、hash、来源路径及任意营销字段不上传。来源缺失时可能记为直接访问。
- `download_click` 统计带现有标记的 GitHub 当前下载入口及官网现有微云入口，参数为 `architecture`、`position`、`download_source`、`version`；历史日志下载不计。微云入口对应 Apple 0.4.09，版本参数与实际分享文件一致。点击不等于下载完成或安装成功。
- 原 Umami 四页 PV 汇总与 GitHub 下载事件保持，不扩大旧口径；两平台覆盖页数、来源和下载范围不同，不直接相加或强求一致。
- 仅在正式 HTTPS 域名加载，尊重 DNT、旧 `umami.disabled` 及统一 `localStorage['qiuqiu.analytics.disabled']='1'`；退出后重新加载页面生效。统计不发送聊天、便签、反馈文本、截图、邮箱或桌宠本机资料，失败不阻断下载或页面使用。
- GA4 从接入后开始累计，历史访问不能补回；来源看“流量获取”，点击看 `download_click` 事件。必须以真实事件送达和后台实时回读验收，安装提示或前端请求成功不能单独证明后台已收数。

## 致谢、周边与春野作品

> 2026-10-26 双十一活动：商城全场 8 折，提手杯 ¥96、随行杯 ¥52.8、背心 ¥70.4、鼠标垫两尺寸 ¥40 / ¥48。列表、详情、切换规格及微信咨询同步活动价。v2改为整页红金背景图、紧凑活动条、8折徽标/立省金额与不划线日常价。活动于北京时间2026-11-12 00:00结束，shop-sale.js自动恢复日常页面、背景、原价和已打开咨询；静态HTML以日常原价为基线，关闭脚本时不展示活动。

`/thanks/` 展示用户提供的建议与支持记录，建议按条展示，名单自动循环并支持暂停、键盘浏览与减少动态。`/shop/` 展示提手杯 ¥120、随行杯 ¥66、黑标健身背心 ¥88 与春野定制鼠标垫 ¥50 起；详情通过微信号 `ooOJBKoo` 联系春野，商品细节与发货安排在微信确认。鼠标垫详情 `/shop/mousepad/` 提供共 21 款图案：既有用户选款去重15款，另按2026-10-13明确授权追加复古参考延展v9六款；春野拼布为封面主图，原六款优先、新六款随后展示，统一厚度 3mm，800×300mm ¥50、800×400mm ¥60；选尺寸同步价格，咨询文本包含图案、尺寸、厚度与售价。展示图保留原比例，原始选款与来源见项目 `验收记录/官网-鼠标垫上架-20261013/`。微信联系码、微信赞赏码、支付宝码各自保留原图。

`/works/` 展示春野第八、七、六、五、四弹的 20 张原动图与对应微信添加二维码，支持复制表情链接、保存二维码、暂停、离屏暂停和减少动态静态回退。首页支持菜单、手机菜单与功能介绍、页脚提供相关入口；首页主视觉与下载、产品正文、反馈 API、现有四页访问统计保持。

微信分享短链在普通浏览器可能返回 404；作品按钮统一打开本站原生二维码弹窗，二维码直接编码官方短链返回的完整 `qremoticonstore` 地址，保留 `productid` 中的字面 `+`，不重构参数。二维码及复制可离线校验；微信内实际添加需微信端核验。

社区页面使用 `community.css/js` 与各页样式，`community-entry.css` 只负责原首页/功能页新增入口。新社区页不扩展访问统计；原二维码、头像和动图均为发布的公开素材，不包含后台凭证。维护时只加入已经确认可公开的记录，不用生成的姓名或金额填充支持名单。

## 国内下载入口

首页版本行、桌面下载菜单和手机菜单均提供国内入口；产品页顶部采用 C 分体展开菜单，下载卡片按内容宽度主次并排，空间不足时上下排列，页尾为文字入口。主按钮打开已核验的最新微云分享页，GitHub 保留备用直链下载；菜单使用原生 details，可用 Escape 或外部点击关闭。界面不展示 GitHub 默认或登录说明，不承诺免登录、速度或所有国内网络可用。微云点击不扩展原有 GitHub 下载统计口径。

## 当前下载记录

### 0.4.10 Apple 芯片版（2026-11-01）

隔离发布分支 `release/website-0.4.10` 基于最新 `gh-pages@6a59c8b`。仅更新 Apple Silicon 0.4.10；Intel 0.4.09 国内入口和 Windows 0.4.09 试用 EXE 保留，历史记录不覆盖。包含官方小白与梦境、反馈与本机提交记录、默认晴空蓝及首帧主题、跨屏落位、天气/额度交互、装扮宣传与右栏滚动。不将商店候选 AI 或 Windows 后续候选能力写入本版。

正式标签 `v0.4.10`，DMG `Qiuqiu-0.4.10-macOS-arm64.dmg`，最终正式构建源码 `86dfc7af3cfb38f4c1c7a5db9a9f506ee6a7d211`。本轮正式包回归另修复小白冷素材加载时动作被提前截断，以及退出时迟到天气回调访问已关闭窗口。正式发布源码 `main@f3e74ccc84a85971269f7bd4c40afd32aa5bb7ed`，树与该构建源码严格一致。GitHub Release 于 2026-11-01T02:54:31Z 公开并设为 Latest；公开 API 回读两附件 uploaded 的大小与 digest 均一致，主发布流程已匿名完整下载 DMG/ZIP 并核验 SHA。国内分享已通过当前 Chrome 普通下载完整核验：263949909 bytes，SHA-256 `dc42939f09753d004f2c27d870200dcc8422ccbc440eee17002c4aac8868f264`，与正式 DMG 完全一致。该验证不是匿名浏览器测试，不承诺所有国内网络均可用。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| Qiuqiu-0.4.10-macOS-arm64.dmg | 263949909 | `dc42939f09753d004f2c27d870200dcc8422ccbc440eee17002c4aac8868f264` |
| Qiuqiu-0.4.10-macOS-arm64.zip | 248673055 | `0a2264c5bca2049b1ed5c35572b0da51fe69d487041b685d7de970b376d24a51` |

包内 ASAR SHA-256：`79c849fb8b4427e1fae4ff2a4b0b57968478f3244775de46e2223c2735ce58cd`。

国内入口：[Qiuqiu-0.4.10-macOS-arm64.dmg](https://share.weiyun.com/fdzg4UOY)，单文件分享，无提取码。已通过当前 Chrome 普通下载完整大小与 SHA 核验，无需提取码；不得以旧版分享代替。证据见项目 `验收记录/v0.4.10-release-20261101/final-after-exit-fix/weiyun-public-download.json`。六处国内按钮已同步新入口；Apple 国内 GA4 下载统计精确对应 0.4.10，Intel 0.4.09 分支不变。现有网页演示按各自来源清单保留，不冒称全部升级到0.4.10。

### 0.4.09 正式发布（2026-10-29）

Apple 芯片版 **0.4.09**，发布日期 **2026-10-29**，GitHub 兼容标签 `v0.4.9`。包含天气卡、云朵天气互动、额度卡平滑交互与稳定性修复。Intel 0.4.09 独立维护，用户在本次发布回看中确认已验收可用，页面按正常 Intel 芯片版展示，未以 Apple 包替代。GitHub Release 已公开并设为 Latest，附件大小与 digest 经公开 API 回读一致；国内微云普通下载已完整核验。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.09-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.9/Qiuqiu-0.4.09-macOS-arm64.dmg) | 184736236 | `947e5a438914e6421959f66563e8c25105080c3db21e6a3e88ceb314e1316189` |
| [Qiuqiu-0.4.09-macOS-arm64.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.9/Qiuqiu-0.4.09-macOS-arm64.zip) | 170027184 | `c28e83bd577e3f612eb3f42c76cf4310d31efce48b19ca7eff192ba1268042f8` |

正式源码为 `main@d0871ea4e2fbfe4799f7263f0576b06bd98747c3`。页面主下载及日志提供 DMG，ZIP 作为发布附件保留。 0.4.09 日志的同一下载区域提供 Apple 芯片 DMG、Intel 芯片 DMG 和 Windows x64 试用 EXE。Intel 指向已核验的国内分享 https://share.weiyun.com/6WH6LkRl ，Windows 使用独立 GitHub 试用 Release 的 EXE 直链 https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.9-windows/Qiuqiu-0.4.09-Windows-x64-Setup.exe ，不改变 Apple 稳定版 Latest。Windows 按试用版展示，保留 Windows 10/11 x64 系统要求及天气手动选城、WorkBuddy 联动与部分聊天能力边界，不冒称与 macOS 全部功能相同。 安装包为 `Qiuqiu-0.4.09-Windows-x64-Setup.exe`，199492598 bytes，SHA-256 `63ad5827055918e5b50f46805793483da1ea443a6de5aec731d79fb27ac17971`；附件 API 的大小与 digest 已核对，匿名完整 GET 的大小与 SHA-256 也与原始 EXE 一致，证据位于项目 `验收记录/官网-多平台下载入口-20261030/windows-github-download.json`。原微云 `2ib9DR95` 两次普通下载未触发实际文件，因此未作为上线入口。

国内微云：[Qiuqiu-0.4.09-macOS-arm64.dmg](https://share.weiyun.com/EYLnV2WY)，无提取码。普通下载实测 **184736236 bytes**、SHA-256 `947e5a438914e6421959f66563e8c25105080c3db21e6a3e88ceb314e1316189`，与正式 DMG 一致。旧分享保留，不再作为当前下载入口；未承诺匿名、关闭 VPN 或所有国内网络均可用。天气隐私说明同步区分系统定位及地名解析、Open-Meteo 查询与本机缓存。

### 0.4.08 下载记录（保留）

Apple 芯片版 **0.4.08**，发布日期 **2026-10-26**，GitHub 兼容标签 `v0.4.8`。正式 Release 已公开；DMG/ZIP 已通过无登录完整 GET，大小与 SHA-256 和本地正式附件一致。

本次为大版本更新，包含咩咩四季主题、ZCode 与 WorkBuddy 联动、联动样式管理、导入桌面伙伴，以及统一设置中心、应用图标和聊天界面升级。更新日志保留用户确认的七项文案与序号。Intel 仍为 0.3.13 候选；应用联动演示新增来源切换及 0.4.08 的 ZCode、WorkBuddy 界面，其余演示与商城图片保持原版本。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.08-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.8/Qiuqiu-0.4.08-macOS-arm64.dmg) | 184580031 | `2b67990b115470bd874136eb1062186d4d3e43639103744b6e545555b3a90ed2` |
| [Qiuqiu-0.4.08-macOS-arm64.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.8/Qiuqiu-0.4.08-macOS-arm64.zip) | 169890613 | `e76c0bc064dd9bc03329b8768010b1277c73ae7ee00a84cbe449516b0bc6a461` |

公开 Release 为 `v0.4.8`，源码提交与标签均为 `6528e5a`；回读证据位于项目 `验收记录/v0.4.08-release-20261026/github-public-readback.json`。页面主下载及日志只提供 DMG，ZIP 作为维护记录保留。

### 国内微云 0.4.08 同步（2026-10-26，完整下载已核验）

分享：[Qiuqiu-0.4.08-macOS-arm64.dmg](https://share.weiyun.com/ZdAiD7rR)。分享页唯一文件同名，显示 176.03 MB，无提取码。2026-10-26 01:35（北京时间）在当前 Chrome 登录态通过一次普通下载完成核验：**184580031 bytes**、SHA-256 `2b67990b115470bd874136eb1062186d4d3e43639103744b6e545555b3a90ed2`，与 GitHub 正式 DMG 和本地正式附件完全一致，无重试。未测试匿名或关闭 VPN，不据此承诺免登录、速度或所有国内网络可用。证据位于项目 `验收记录/v0.4.08-release-20261026/domestic-download-verified.json`。

### 0.4.06 下载记录（保留）

Apple 芯片版 **0.4.06**，发布日期 **2026-10-24**，GitHub 兼容标签 `v0.4.6`。正式 Release 已公开；DMG/ZIP 已通过无登录完整 GET，大小与 SHA-256 和冻结正式附件一致。

本次升级设置中心，新增四主题咩咩、主题互动与春节烟花，焕新应用图标，并优化已知问题。Intel 仍为 0.3.13 候选；国内微云已同步 0.4.06 DMG，并于 2026-10-25 完整下载核验大小及 SHA-256 与正式公包一致。既有网页演示与商城图片保持原版本，不冒充新版运行界面。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.06-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.6/Qiuqiu-0.4.06-macOS-arm64.dmg) | 184112825 | `d260895779d076f40f002a9b590229a0ea02e0b74207f46cae626a6775fe55fc` |
| [Qiuqiu-0.4.06-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.6/Qiuqiu-0.4.06-macOS-arm64-share.zip) | 169428505 | `6942a47a7bee1495c4549f3f10114d41a7b65040048dc577ad2efb399056f1a9` |

大小与 SHA-256 来自主线冻结的正式附件元数据，并经公开完整下载核验一致。公开 Release 为 `v0.4.6`，源码提交 `03b7aac`；回读证据位于项目 `验收记录/v0.4.06-release-20261024/github-public-readback.json`。页面主下载及日志只提供 DMG，ZIP 作为维护记录保留。

### 国内微云 0.4.06 同步（2026-10-25，完整下载已核验）

分享：[Qiuqiu-0.4.06-macOS-arm64.dmg](https://share.weiyun.com/rXnnLRhI)。分享页唯一文件同名，显示 175.58 MB。2026-10-25 09:03（北京时间）在当前 Chrome 登录态通过一次普通下载完成核验：**184112825 bytes**、SHA-256 `d260895779d076f40f002a9b590229a0ea02e0b74207f46cae626a6775fe55fc`，与公开正式 DMG 完全一致，无重试。未测试匿名或关闭 VPN，不据此承诺免登录、速度或所有国内网络可用。证据位于项目 `验收记录/官网国内下载更新-20261025/domestic-download-verified.json`。旧 0.4.05 分享记录作为历史保留，Intel 候选及 GitHub 主下载不变。

### 0.4.05 下载记录（保留）

Apple 芯片版 **0.4.05**，发布日期 **2026-10-15**，GitHub 兼容标签 `v0.4.5`。GitHub Release 已公开，DMG/ZIP 均经匿名 HTTP 200 完整下载，大小与 SHA-256 和本地正式归档一致。

本次整合额度预估、番茄钟、额度守护战、悬浮快捷面板与六种额度展示样式，并修复贴边布局、对白层级、关于窗口检查更新位置、Codex 联动确认、定制预览与保存反馈。Intel 仍为实际 0.3.13 候选；国内备用已同步为 0.4.05 微云分享，文件与同版正式 DMG 一致。网页演示仍按各自 manifest 标注 0.4.04/0.4.00 来源，未升级或冒充新版运行界面。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.05-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.5/Qiuqiu-0.4.05-macOS-arm64-share.zip) | 123889683 | `b0051dc2a7573cd86bf6d18d55cfa74e6ad0ef368a487dd3353c13abb0b402cb` |
| [Qiuqiu-0.4.05-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.5/Qiuqiu-0.4.05-macOS-arm64.dmg) | 136895385 | `902a67ac443f75c348870dba9781f21072b250f47af53a4cb653b9e252283437` |

大小与 SHA-256 来自已验收的 r25 正式归档；公开源码 `main@341a89f0d54e3f7a313ecc3099f8621b83065b6f`，本地归档已真挂载/解包。公开 tag 指向同一源码提交。Release 完整下载及官网部署/线上字节回读证据位于项目 `验收记录/v0.4.05-release-20261015/`。

### 0.4.04 下载记录（保留）

Apple 芯片版 **0.4.04**，发布日期 **2026-10-07**，GitHub 兼容标签 `v0.4.4`。

本次升级 Codex 额度趋势的「趋势／每日消耗」视图与重置机会到期提醒，新增「清除未看」，并优化功能窗口跟随、便签、定制及色弱模式显示，修复 Codex 宠物待机动画节奏。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.4.04-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.4/Qiuqiu-0.4.04-macOS-arm64-share.zip) | 123612298 | `22e80247088db2fdd5a5cc81b12703138a3bf7421427895ed77a16fdcdc81be9` |
| [Qiuqiu-0.4.04-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.4/Qiuqiu-0.4.04-macOS-arm64.dmg) | 137872466 | `b232c896c74224e0800a75ea03b82c50d770c87efb71c54ca88045cdfebbc281` |

大小与 SHA-256 来自本地正式附件元数据 `v0.4.04-release/public-installer.json`，公开源码 `main@16809908dd3cd4d9cb29fb5cb84cfea5a16bd2c7`；与实际构建提交的文件树一致。公开 Release `v0.4.4` 已发布；公开安装包与官网回读证据见项目 0.4.04 正式发布记录。

### 0.4.03 下载记录（保留）

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

2026-10-29 发布后回看：用户明确确认「intel验收过了可以用」，当前入口、安装介绍与搜索摘要改为正常 Intel 芯片版，保留 macOS 12+ 要求。以下打包与检查记录作为当时事实保留，不改写为本轮重跑或全部通过。

2026-10-29：官网 Intel 当前入口更新为 **0.4.09 构建候选**（`v0.4.9-intel`），基于正式源码 `d0871ea`，要求 macOS 12.0+。国内入口为 https://share.weiyun.com/6WH6LkRl ，只包含本版 Intel DMG，无提取码。上传完成及分享页文件名/180.8 MB 回读已确认；当前 Chrome 登录态普通下载完整完成，189580803 bytes 与 SHA-256 均和本地正式包一致。未测试匿名下载。GitHub 上传多次失败，最终单次 30 分钟超时，独立预发布仍为草稿且未展示备用入口；不改变 Apple 稳定版或其草稿。401 个业务文件、54 项天气测试、x86_64 架构/签名、DMG/ZIP 完整性检查通过；Rosetta 定位组件加载通过。真实 Intel Mac 未验收，Codex 额度标签检查超时、定制四种形态就绪检查未通过；页面保留明显说明。临时签名，未公证。

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| [Intel 0.4.09 DMG](https://share.weiyun.com/6WH6LkRl) | 189580803 | `399d1d12c816e1f67cdac294d1f87ee127a43eb2e9884d96cd42e1af40ea8dbf` |

以下为旧版历史记录：

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

官网默认提供 DMG：打开磁盘镜像，将“球球桌宠.app”拖入 Applications，完成后可推出镜像。GitHub Release 保留 ZIP 归档；历史记录仅在没有对应 DMG 时显示 ZIP。Intel x64 当前下载为 0.4.09（macOS 12+），用户已确认验收可用。应用采用本机临时签名，未进行 Apple Developer ID 签名或公证。

额外点数不限定 Pro；符合条件的 Plus/Pro 账号可购买点数，支持灵活计费的团队可使用工作区点数。球球仅在账号支持点数且 Codex 返回点数状态时展示，不并入套餐比例或重置机会，也不与 API 费用合并。依据：[官方点数说明](https://learn.chatgpt.com/docs/pricing)。

API 报告需要组织所有者提供具有费用与用量读取权限的 Admin API Key；普通调用 Key 无法查询费用。默认范围是整个组织，费用保留官方币种，缓存属于输入 tokens 的一部分；数据可能延迟，不表示余额、当前聊天实时费用或最终账单。报告与常驻卡由用户主动连接、开启，密钥在本机安全存储中加密保存。官网仅说明功能，没有连接真实 API 账户或验证真实账单。

新版检查只提供版本结果和下载页面入口。本目录内容更新及本地检查不代表 Release 已上传或官网已发布，发布后须回读公开安装附件与线上页面。

官网模型菜单是预设演示，不读取账号模型列表、不发送真实消息、不保存桌宠设置。实际应用支持选择本机 Codex、ZCode 或 WorkBuddy，模型目录以对应账号为准，聊天记录按来源保存；网页聊天仍明确标为 Codex 交互示例，不承诺固定响应时间。

## 意见反馈

`feedback/` 提供官网内的意见反馈表单：首页、功能介绍、更新日志与隐私页均有入口。支持问题反馈、使用建议和功能需求，可附最多3张截图，每张最多1MiB。失败保留输入，同一内容重试沿用提交编号，后端确认保存后才显示回执。

`feedback/config.js` 中的 `endpoint` 为提交地址，当前为自有 Cloudflare 账号下的 `https://qiuqiu-feedback-entry.pages.dev/api/feedback`。Pages 通过 Service binding 调用已部署的 Worker 和 D1，官网现有 DNSPod 解析无需迁移；若地址留空，表单会显示通道尚未开放并禁用提交。后端源码及部署说明在 App 的 `feature/feedback-entry` 工作树 `feedback-server/`，App 共用相同表单并通过主进程提交。

本地浏览器检查为 `node tests/feedback.browser.cjs`，需要可用的 Playwright 与 Chrome；它覆盖布局及模拟接口交互，不能替代线上保存和国内无 VPN 验证。

## 本地预览

在本目录启动任意静态文件服务器，然后访问首页。例如：

```bash
python3 -m http.server 4179 --bind 127.0.0.1
```

## 官网验证与发布

0.4.05 本轮通过 20 项 Node 检查、118 个本地引用和全部 16 条历史日志逐字节核验；没有启动浏览器或 App，本轮不声称新增浏览器视觉检查。当前国内入口已单独更新为 0.4.05，Intel 0.3.13 与历史版本入口保持。

```bash
node --test tests/*.test.cjs
```

当前检查涵盖旧地址跳转、演示主题、便签窗口 scope、原生许可弹窗控制、历史日志及下载契约。`tests/showcases.browser.cjs` 保留的是改版前完整页面的浏览器脚本，其旧版布局断言不适用于当前结构；独立日志的浏览器脚本为 `tests/updates.browser.cjs`。0.4.04 发布准备的 17 项 Node 检查、定制器独立检查、首页/功能页/日志页四宽度浅深色共 24 组浏览器布局通过，无脚本或请求错误；34 次本地 HTTP 回读与源码逐字节一致。证据位于项目 `v0.4.04-release/website/`，线上部署与安装包发布仍须按下述流程单独核验。

2026-10-08 两处演示同步另通过 19 项 Node 检查、36 个安装包／标签来源文件、10 个网页适配文件哈希与 77 个 HTML 依赖核验。展示曲线使用连续示例，已采样占周期 60%／约 71%，每日标签最多一位小数。本轮未运行浏览器，不能替代实际布局及观感确认；独立证据见项目 `官网-0.4.04演示同步-20261007/`。

部署沿用 `gh-pages` 根目录与 `qiuqiu.pet`。本地检查通过后提交、推送；必须回读 Pages 的实际构建提交及线上 HTML/变更资源，不能把推送成功当作部署完成。

## 当前功能演示

应用联动在同一区域切换 Codex、ZCode、WorkBuddy，保留双列结构、示例提示与 `#codex` 入口。ZCode、WorkBuddy 的 DOM、CSS、renderer 来自正式 0.4.08 `6528e5a`，按各自额度单位与积分记录提供内存示例；详见 `demos/quota/README.md` 与 `source-manifest.json`。Codex/API 额度与趋势、聊天配色及高对比交互保留公开 0.4.04 安装包（`v0.4.4@16809908dd3cd4d9cb29fb5cb84cfea5a16bd2c7`），包内文件与公开标签逐字节核对。趋势含走势／每日消耗、圆润连线、图表说明与重置机会到期时钟；色弱聊天去掉外描边和输入流光，键盘焦点提示保留。便签/待办继续保留公开 App 0.4.00 `main@7f5c291d34512f629c17275c93bed472f421e8b9` 基线。定制器及聊天头像引擎升级为公开 0.4.03 `main@eac7a8d12bd425fb98f005828ab80afabe18ca0b`；定制器保留原生界面；共享 Codex 宠物播放器单独同步 0.4.04 的 6.6 秒待机节奏，其他动作与网页同源素材适配保留，逐文件来源见定制器清单。其余蓝色覆盖样式保留公开 0.4.03 `main@eac7a8d12bd425fb98f005828ab80afabe18ca0b`，聊天蓝色文件与 0.4.04 一致，来源与哈希见 `demos/theme-source-manifest.json`；原界面来源与必要适配见各演示目录 `source-manifest.json`。定制区并列介绍球球形态/配色定制与本机 Codex 自定义宠物。网页演示使用作者提供的既有 ikun、春野原始精灵图，可选择宠物、预览 9 类动作、收藏/载入及保存后同步本页聊天头像；不读取访客的本机宠物目录。两份素材原字节与来源记录见 `demos/customize/assets/demo-pets.json`。主介绍不再叠放截图或折叠简化示例；历史截图文件仅作归档。

额度示例采样和机会日期均在网页内存中合成，不读取真实用量记录；清除未看只处理本页示例。Electron IPC 替换为本页内存桥接，不连接账户、模型或账单，不修改 App 或用户资料；刷新页面恢复示例。定制保存后同步本页聊天头像，收藏载入仅影响预览。公开六瓣幻彩采用原 Rive 引擎。外层官网沿用浅灰蓝/深灰，普通演示默认晴空蓝和浅色；外观控件按「主题色」「明暗模式」「可读性」分组：桌面使用细竖线分隔，手机分行并用细横线区分；色点、选中下划线与原生高对比开关保留，三类设置独立生效。官网的蓝色默认值不改变 App 新装默认薄荷绿。手机仅适配原控件，不用截图缩放。离屏、页面隐藏、暂停与减少动态均可停止演示动效。嵌入窗口在用户进入前不自动抢焦点，脚本聚焦不滚动官网。功能页使用 `overflow-x:clip`，避免 body 形成额外滚动容器而干扰导航吸顶。

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

## 官网咩咩定制演示（2026-10-24）

产品页定制演示新增第五形态“咩咩”，选中后才显示主题下拉框：自动换装（默认）、日常、万圣、圣诞、春节。使用公开0.4.06的SheepSkin、日历规则、normalizer与头像支持；共享文件和60运行资源保存在demos/sheep，保留源字节并由source-manifest逐文件记录。浏览器只按当前预览需求加载图像，不增加动画教学或桌面设置入口。羊形态隐藏颜色和轮廓五官控件，透明度仍可调整，切回原四形态恢复原控件。Codex公共示例与9动作保持。

保存沿用网页内存语义：保存后同步当前产品页聊天示例头像，同一页重载聊天iframe保留已保存形象，刷新整页或定制演示后恢复示例。不会写本机App、读取访客目录或保留到浏览器存储。页面说明继续明确“仅为网页演示，刷新后恢复”。
