# R26 送审资料与隐私差异审计（草案）

核验日期：2026-11-01。审计基线：96d934d；只读源码、构建资产及公开页面，不修改原工具、账号、网站或发布状态。本文不是法律意见、审核通过声明或完整依赖许可审计。

## 结论与优先级

R24已证明真实MAS内实际Node安装器的合成目录安装、0700且无quarantine；R25已证明两家原工具事件与重启配对。因此不再把这些列为技术未通。但仍缺下面送审资料和用户披露，当前不能称“送审准备完成”。

| 优先级 | 当前事实与缺口 | 最小完成条件 |
| --- | --- | --- |
| P0（来源权利） | 根LICENSE仅允许个人学习、研究和非商业分享，明确禁止商业用途且不提供商业授权；NOTICE另指球形视觉受限、boo-binary动画来自Combos，不属仓库许可授权范围。MAS打包仍包含相关代码及动画。 | 在公开商店分发前取得覆盖具体代码、视觉与动画的独立有效权利证明，或替换/移除未获授权内容并复验最终包；保留声明本身不是分发授权。 |
| P0 | 线上隐私页HTTP200，但内容只描述Codex，没有完整覆盖WorkBuddy、ZCode、用户自定义模型服务、独立登录数据、原工具目录写入、Hook元数据及撤销/保留规则。 | 按最终MAS功能形成真实数据流清单，最小更新隐私页并核对线上内容；App内可访问同一政策。 |
| P0 | 聊天UI目前只找到额度提示及“不会自动发送”，没有找到明确第三方AI接收者、发送内容及发送前同意的完整闭环。工具登录/文件授权不能自动替代数据共享许可。 | 首次发送前按所选服务披露聊天正文/必要上下文发送对象、用途、政策链接并取得明确许可；自定义端点不能固定写成由OpenAI处理。撤销及换服务重确认有验证。 |
| P0 | Codex Apache-2.0及Tencent CLI MIT存在许可证据，但代码再分发许可不等于第三方账号服务接入、商标或全部依赖许可均已核清。 | 保留精确版本LICENSE/NOTICE；形成最终包第三方清单与依赖许可证/必要声明；核实对应账号服务条款允许的集成方式。不要将MIT声明扩展成服务授权。 |
| P0 | 没有找到完整可提交商店元数据/审核说明成套资料；既有README、mas-build仍夹有已过时的“未开通会员/无签名/没MAS包”早期状态。 | 建立唯一当前入口，补商店名称/副标题/描述/关键词/版权/地区/定价/年龄问卷、截图与审核操作说明；旧文档明确历史日期。 |
| P0 | 外部固定插件路线有实际技术证据，但2.4.5(ii)/(iv)审核适用性尚未获得Apple裁定。 | 审核说明正面披露随包固定脚本、准确外部路径、系统授权、配置修改、等待退出与重开、无运行时下载、停用/清理及用途。不因“未审核”永久禁用，也不隐瞒安装行为或保证通过。 |
| P1 | 公开支持目前确认官网首页及隐私页联系邮箱；未找到专用问题支持页和完整MAS授权/退出等待/额度为空/断开指引。 | 提供可公开访问的支持网址，含联系渠道、适用系统、连接与排障及隐私入口；在App Store Connect回读具体URL，不能只把mailto当支持网页。 |
| P1 | 未找到仓库自有PrivacyInfo.xcprivacy及最终包隐私报告，尚未完成SDK/数据申报清点。 | 按实际平台适用性核对最终包第三方manifest和数据收集；验证格式及Contents/Resources位置；根据实际数据流填写App Privacy，不能默认“未收集任何数据”。 |
| P1 | 发版签名pkg、App Store Connect记录、加密出口问卷、最终上传处理及审核演示资料未在本次审计确认。 | 由最终构建/后台当前回执确认；提供可用测试账号或完整演示方式，并标明第三方套餐与外部工具依赖。 |

## PrivacyInfo平台边界（避免误判）

Apple当前《Privacy manifest files》把数据收集信息说明列为所有平台，把required-reason API理由申报列为iOS/iPadOS/tvOS/visionOS/watchOS；《Describing use of required reason API》也这样列平台。因此不能仅凭Node使用文件时间戳/磁盘接口、仓库没有自有PrivacyInfo，就断言macOS MAS必拒。应清点最终包、适用SDK要求和真实收集行为；如提交manifest，其格式错误会造成拒收。

官方来源：
- https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk
- https://developer.apple.com/app-store/app-privacy-details/

## 许可现有证据及其边界

- `prepare-mas-codex-helper.js`锁定0.166.0、npm归档摘要、Apache-2.0及LICENSE/NOTICE摘要；本机build产物可见两份许可。需核最终分发包也保留它们，而非只看开发目录。
- `prepare-mas-workbuddy-helper.js`锁定2.179.0与package-lock，读取厂商LICENSE.txt并校验Tencent版权及MIT授权首句；复制依赖，构建期不执行安装脚本，产物manifest保存文件摘要。它不是完整法律/服务条款审计，也没有自动检查所有传递依赖授权条件。其裁剪内容应在第三方清单中如实说明。
- 构建目录有嵌套模板package.json，简单递归统计的license缺失数不能当作“有19个无授权依赖”。必须以真正安装依赖与最终文件清单核验。
- ZCode聊天当前不是再分发原ZCode私有zcode.cjs；需在最终包清单中确认无误带入，并把官方套餐与自定义服务路径分开说明。
- Apple 5.2.2要求第三方服务使用符合其条款，可能要求提供授权；开源许可不替代这个要求。

## 建议审核披露文本要点（待最终行为核对）

球球是独立桌宠与AI工具连接客户端，并非OpenAI、ZCode或Tencent官方产品。连接和聊天由用户主动启用，基础桌宠不依赖登录。用户分别使用其本人第三方账号；聊天消耗其所选服务额度，球球不保证套餐可用或余额一定可读。部分任务状态依赖用户已安装的原工具。

任务插件源码随App完整提交，运行时不下载额外插件。球球仅在系统选择器授予的`~/.zcode`或`~/.workbuddy`目录，安装固定插件及必要注册/设置；主进程具备公开的user-selected.executable权限。原工具运行时提示用户保存并退出，球球不自动强退；安装后可请求重新打开。插件仅把已披露的最小任务元数据发往本机球球，不把提示词/回复正文作为任务状态发送。ZCode停止不等于最终完成，WorkBuddy主回复完成不等于全部后台任务完成。退出球球后不保留其自有后台接收进程。

这些要点必须与最终包逐项一致。尤其应解释“断开连接”实际是否仅停止接收/撤销本地书签，是否保留原插件文件及原设置；目前不能编造已实现卸载或清除第三方服务器数据。

官方依据：Apple审核规则2.4.5、5.1.2(i)、5.2.2，以及完整审核说明要求：
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review
- https://developer.apple.com/forums/thread/811450?answerId=871171022

## 本轮核验方式

源码检索：PrivacyInfo、license/NOTICE、隐私/同意/第三方文案、打包白名单；读取两份helper准备脚本、UI发送提示与R24/R25报告。线上`https://qiuqiu.pet/privacy/`经curl返回200 text/html，网页内容仍为Codex为主；web工具访问失败不作为网站故障。未打开用户聊天/凭据，不启动模型，不修改网站，不提交外部记录。未执行全量打包或许可证扫描工具；未声称App Store Connect现状已核实。


## 本地隐私候选增量（尚未发布）

2026-11-01仅更新官网本地`website/privacy/index.html`，保留八节布局、现有邮箱及其他功能说明。补充三家/自定义模型发送对象、当前上下文、计费边界、独立官方登录配置、目录只读与插件写入用途区分、Hook本机过滤及厂商临时对话文件、断开/撤销不等于清除所有本机或厂商记录。更新日期与三个description同步。

静态HTML解析及八节结构、关键披露字符串检查通过。尚未执行浏览器渲染或发布，因此上表线上隐私缺口仍未关闭；此文案也不能替代App内发送前的明确许可。

必要浏览器核验：通过本地HTTP预览检查桌面/窄屏、浅深主题长段换行及无横向溢出；检查页内锚点、返回/反馈链接、OpenAI政策链接与现有联系邮箱；发布后再回读公网准确内容及App内隐私入口。未新增未经核实的厂商政策URL或支持联系方式。

## 官网统计披露补查

核对`website/analytics.js`：仅正式HTTPS主机及12条页面白名单、有效统计ID时加载；DNT三来源值1/yes、本地umami.disabled或qiuqiu.analytics.disabled标记可阻止。Umami payload重建仅固定站点/首页URL/标题、站外origin、合法语言/屏幕与限定download字段；GA4发送净化pagePath/referrer、白名单source/medium及download参数，关闭Google Signals与广告个性化信号。代码没有对传输IP做本地匿名化，因此不能承诺服务方收不到IP。未核后台保留期、地区配置、Cookie实际落盘或服务端日志。

本地隐私第七节补官网两家统计、字段边界、第一方Cookie、基础网络信息与DNT说明，不编造Umami无Cookie或IP永不保存承诺。Google当前官方说明确认GA4默认第一方Cookie；Umami指标说明确认基于IP/User-Agent生成匿名会话统计。仅链接说明，不代服务方承诺。

来源：https://support.google.com/analytics/answer/6004245 、https://support.google.com/analytics/answer/11397207 、https://docs.umami.is/docs/metric-definitions 。

反馈配置指向作者自有Cloudflare Pages入口，经Worker/D1接收；当前“发送给球球作者”描述未冒充不经托管服务，未额外虚构保存期或删除承诺。后台数据处理/保留仍需独立核对。以上仍仅本地候选，未发布。


## 根许可及角色/动画来源：新增最高优先级缺口

实际读取根`LICENSE`与`NOTICE.md`。LICENSE标题为“Learning & Research Only License / 仅供学习研究许可（禁止一切商业用途）”；文字仅允许个人学习、研究、技术交流与注明出处的非商业分享，明示禁止售卖、商业产品/服务集成及商业推广，并称不提供商业授权。其版权声明仅针对独立编写代码；适用范围声明与NOTICE的具体目录范围有差异，不能直接推定所有新代码或所有角色都属于同一权利人或同一许可。需要逐项来源清单。

NOTICE明确球形角色blob/wedge/gem及视觉特效仅供个人学习研究；`boo-binary.js`动画来自Combos，第三方素材不属于仓库原创或仓库许可授权范围。`mood-mates/`虽声明独立双许可，但不能据此给当前包内所有角色或旧球形视觉授权。

真实打包路径：`package-mas.js:165`调用`package-mac.prepareStaging`；其白名单`package-mac.js:265`包含boo-binary，362–367包含emotion-ball角色/引擎代码与图标，368–369保留根LICENSE/NOTICE。`chat.html`、`about.html`、`codex-consent.html`等仍加载球形代码及boo-binary。这并非仅仓库中存在而未进入包。当前MAS开发staging也实际存在ball.js、boo-binary.js、LICENSE、NOTICE。正式分发最终ASAR仍需再核，但当前源码没有MAS专用排除此类资源。

所需证据：从有权许可者取得明确覆盖Mac App Store公开分发、复制/改编、目标地区及相应素材用途的许可或权属证明；第三方动画单独核权；若无法取得则替换/移除并核验所有引用、截图、图标与最终包。作者自有新增代码应独立确认权属，不能单靠更改仓库声明覆盖第三方作品。声明保留义务与分发权是两件事。

本报告不判断“免费就必然允许”或“免费必然属于商业”；当前文本没有明确授予App Store公开分发所需的完整权利，独立授权证据尚未找到。Apple 5.2/5.2.1要求提交者拥有或获许使用包内内容；这项来源缺口优先于优化商店文案。未联系任何权利人、未改根许可/素材/代码。
