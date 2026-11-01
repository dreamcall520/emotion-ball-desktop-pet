# 正式 0.4.10 与 MAS 首发范围对齐

2026-11-01。只读源码及本地签包回执核对；未再次运行全量、未改业务源码、未操作真实账号／日志／浏览器。用户口述“4.0.10”对应实际版本 `0.4.10`。

## 基线结论

主 Agent 已核 GitHub 最新正式发布为 `v0.4.10`，发布目标 `f3e74ccc84a85971269f7bd4c40afd32aa5bb7ed`，发布时间 `2026-11-01 02:54:31Z`（北京时间10:54:31）。本次本地核对 `git merge-base --is-ancestor` 成功；MAS 分支经 `7f9b72e` 合并包含该正式发布祖先。检查时 HEAD 为 `3e13b19`。

结论是“以正式0.4.10为已合入基线，再叠加商店沙盒与首发范围改造”，不是旧版功能重新拼凑，也不意味着 MAS 所有文件与官网发行包完全相同。

## 五项发布内容核对

| 正式版内容 | 主文件与源码核对 | 首发门控是否覆盖／移除 | 已有运行证据与边界 |
|---|---|---|---|
| 小白官方形象、排在小宇前；专属动作与睡眠气泡 | `lib/builtin-pets.js`、`assets/pets/xiaobai/pet.json`、`lib/codex-pet-player.js`、`renderer.js`、`lib/bubble-window.js` 均与发布目标同 Git 内容；`customize-renderer.js` 仍优先选择 builtin 小白，插在咩咩后、小宇前；`main.js` 的 dogDream、睡姿／动作及退出清理逻辑保留 | `mas-first-release.js` 只限制提供商／费用功能和卡片来源，没有过滤内置小白、定制或动作。定制 renderer 的增量主要是素材目录接入，并未重写小白排序段 | 开发包已实际小白预览、保存、重启恢复；未将全部专属动作、睡眠气泡跨状态的实机验收写成全过 |
| 天气／额度切换，弹窗随屏与互斥恢复 | `lib/popup-quota-visibility.js`、`lib/quota-label-window.js`、`lib/bubble-placement.js` 与发布目标同内容；`main.js` 原 `quotaPopups`、窗口跟随与额度抑制链保留。`lib/weather-window.js` 相对发布目标仅增加显式城市选择窗口的独立抑制回调，避免被普通卡片隐藏条件立即藏掉，未撤销原展开／收起逻辑 | 卡片来源缩为 Codex／天气，二者仍走原卡片布局及弹窗互斥；被首发裁剪的 WB/ZCode/API 不再加入实际卡组，属于已确认范围差异，不是误删天气或 Codex 卡 | 开发包手动城市、天气展开／收起与重启保持、真实 Codex 大小卡／展开后收回已验；全屏、多屏、全部弹窗组合仍以最终矩阵为待验 |
| 晴空蓝默认、快捷面板默认及配色闪烁修复 | `lib/settings.js`、`lib/shortcuts.js`、`lib/shortcut-window.js`、`global-settings.html`、`global-settings.css`、`customize.css` 与发布目标同内容。默认 `uiTheme:'blue'`，快捷设置 `shape:'floating', enabled:true`；现有页面主题首帧链继续沿用 | 首发设置归一化只关 WB/ZCode/API，未覆盖蓝色默认、主题偏好或快捷设置；设置页只去掉费用页签，不删除快捷面板设置 | 源码继承明确；开发包设置分类已可达，但不能据此声明所有冷启动配色帧、快捷键注册和跨屏组合均实机通过 |
| 反馈提交／记录及定制案例滚动 | `lib/feedback-reporting.js`、`global-settings-feedback.js`、`promotion.css`、`promotion-renderer.js`、`customize.css` 与发布目标同内容；`main.js` feedback 初始化、设置入口、定制菜单及宣传入口保留。宣传弹窗仍 `max-height`＋滚动，案例动作／微信咨询未被替换 | 首发未裁掉反馈或完整定制；`filterMenu()` 不匹配 feedback／customize／promotion；包清单仍包含反馈、案例资源及相关页面 | 开发包四标签、案例动作选择及咨询入口、收藏／导入已有定向证据；本轮未为验证而实际提交反馈或自动上报，不能把“页面存在”算发送成功 |
| 退出时天气回调清理 | 发布目标 `main.js` 已有 `weatherPetWindow`／`initialWeatherWindow`／`isCurrentWeatherOwner()`、退出前 `isQuitting` 和 `weatherWindow.destroy()`；当前代码保留相同保护。商店增量只补 runtime/连接窗清理，没有删天气 owner 检查 | 没有首发条件绕过退出保护；天气仍启用，退出清理不依赖被裁掉的提供商 | 多轮开发候选实际退出／重启已取得证据；不单凭源码等同所有退出竞态和最终分发实机已通过 |

上述“同内容”是对发布目标 Git blob 与当前工作树内容作比较；`main.js` 和定制／聊天相关文件因 MAS 适配有差异，已经按对应逻辑段检查，不能把不同内容的文件宣传为整份字节相同。

## 签名包证据与其限度

- `release-0410-package-alignment.json`：分发构建 `1793528828` 的签名 ASAR 中，实际存在的471个发布版跟踪文件里446个与正式0.4.10完全相同，25个有差异；统计仅涵盖包内存在的发布跟踪文件，不能据此推断缺失／新增文件或全部行为无差异。
- `../first-release-distribution-check-20261101.json`：该正式签名分发包的15个关键业务文件与当前受核源码字节匹配，包含 main、weather、定制、单Codex连接、同意与目录模块；记录 `uploaded:false`。此为包内容／签包层证据，不是商店审核或最终分发41项运行验收通过。
- `development-acceptance-20261101.md`：记录真正 MAS **开发**包已测范围；既有真实 Codex 登录／首条聊天、额度大小卡、天气、素材导入／恢复等不跨层当作正式分发包全部已测。

仍需按 `acceptance-matrix.md` 在最终分发／上传构建核对完整定制、窗口组合、权限与恢复。当前报告不改矩阵状态，不宣布上线或用户验收完成。

## 商店描述完整性

当前 `store-metadata-zh-CN.md` 已覆盖：内置伙伴与完整定制、本地素材与 Codex 素材目录、便签待办、番茄钟、天气展开／收起、Codex同账号大小额度卡与模型聊天、可选部分任务及现有微信咨询。与本次首发范围没有发现功能范围冲突。

可在定稿时补两处用户可感知信息：①内置小白及专属互动；②快捷入口和意见反馈。它们当前描述没有明确点名，属于文案展示不足，未见因此被代码删除。默认晴空蓝、配色闪烁、滚动与退出回调是默认体验或缺陷修复，不必把所有修复项逐条用于商店宣传。反馈文案仍应与自动异常报告实际默认状态及隐私页保持一致。

本报告只提出文案建议，未修改商店描述，也未将来源／权属、咨询销售路径或未验项目视为已经解决。

## 本次对齐后实际保存

主Agent已在Chrome本人登录的App Store Connect中回读现有应用6829348954，版本0.4.10、正式Bundle ID匹配。已保存单Codex首发描述与关键词，随后补明确的小白/小宇动作互动、快捷面板和反馈说明；保存按钮禁用确认，截屏在项目验收记录/商店首发完整保留-20261101/AppStoreConnect-对齐0410已保存.png，最终文字见store-description-saved-zh-CN.txt。该操作仅更新准备提交草稿，未上传二进制或提交审核。
