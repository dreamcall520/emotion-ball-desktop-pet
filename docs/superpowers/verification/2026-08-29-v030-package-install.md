# 球球桌宠 0.3.0 → 0.3.1 打包与安装记录

状态：0.3.1 最终安装包、分享 ZIP 和本机安装均已完成新鲜验收；正式安装版已重新启动，用户设置保留，Codex 联动仍默认关闭。以下保留 0.3.0、候选版及失败轮次的历史证据；当前结果以末尾「0.3.1 最终打包、安装与分享」为准。

## 授权与变更

- 用户明确要求「打包新的安装包，并完成安装」。本次只生成本地 Apple 芯片 DMG 并完成本机应用更新，不自动发布 GitHub Release、合并主分支或覆盖旧分享 ZIP。
- 基于已推送的 `a3b29df`，版本升至 0.3.0；仅调整版本和安装/使用说明，不更改球球颜色、尺寸、动作、位置规则或 Codex 读取逻辑。
- Codex 联动默认关闭，安装说明注明内测及当前限制：已打开任务的真实完成/合并提醒已验证；未打开后台任务、等待确认/失败/中断及实际跳转仍待验。本次安装要求不代表同意自动开启联动。

## 已验证的安装包

- 文件：`/Users/allan/Documents/个人创作/球球桌宠-0.3.0-Apple芯片.dmg`。
- 大小：123,927,599 字节（约 124 MB）。仅一个 Apple Silicon 应用，没有同时打包 Intel 版或旧版。
- DMG SHA-256：`2a39f2d988327723a11a6cd9e3250df3a9ad0fa48b8e7351022352c0eb277b5e`。
- 应用 `app.asar` SHA-256：`ef7c473c0f9898146bf487866ae8ab430f4d0e087bc5ba5fb2a042fe6855ea62`。
- 应用版本 0.3.0、arm64、最低 macOS 12.0；本机临时签名通过 `codesign --verify --deep --strict`，未使用 Developer ID 或苹果公证。
- 全量 491 项测试通过，0 失败/跳过；构建成功。逐个核对包内 39 个源文件一致，七个 Codex 模块齐全，没有用户设置、账号或会话文件。
- `hdiutil verify` 通过；只读挂载后，DMG 内应用与已构建应用的 600 项目录/文件/链接完全一致（267 文件、14 符号链接），检查字节、权限及链接目标，挂载内应用严格签名也通过。
- DMG 包含应用、Applications 快捷入口、安装说明、原项目 LICENSE/NOTICE 和 Electron/Chromium 许可文件。旧 ZIP 保持不变。

## 首次打包版运行与锁屏证据（历史）

- 通过现有 `PET_SMOKE_APP_PATH` 入口直接运行 0.3.0 打包应用，使用独立临时设置；没有改写安装版设置或真实 Codex 状态。
- 已通过活动状态、眼神跟随、摸头/拖动、气泡回应、80×80 六种动作及重播、中断检查；尚未完成其余尺寸和后续 Codex 模拟窗口检查。
- 运行约 81 秒时记录到真实 `locked: true` 活动包，随后球球状态变为 `sleep`、睡眠表情 `00`；检查仍等待 `sway-120` 结束后清醒的中性姿态，因此报告归位超时。睡眠姿态的 -2° 旋转来自睡眠定义，不据此更改动作或放宽断言。
- 桌面操作工具同时明确返回「The Mac is locked…Ask the user to unlock the Mac manually before continuing」。未通过其他工具绕过锁屏，也未在锁屏状态退出或替换正常应用。
- 临时证据目录：`/tmp/emotion-ball-030-package.n0WxTa`，包括 `companion-failure.json`、已完成动作记录、截图及只读包一致性检查助手。测试进程已退出；DMG 只读挂载已卸载，临时打包副本的应用注册已清理。

## 首次中断时的安装状态与计划（历史，已续验）

- 安装前实际读取：`/Applications/球球桌宠.app` 为 0.2.2；设置为极小 80×80、置顶、保持清醒和气泡开启。具体位置以正式退出前最新设置为准，不从本记录恢复旧坐标。
- 本轮未替换应用，安装版 `app.asar` 仍为 `d47f8f168df9f918605a6ffd498ee7b80f3e04cef76dc5d1ab8dbcb5f4238f06`。
- 旧 0.2.2 原始打包副本移至 `/Users/allan/.Trash/球球桌宠-旧打包副本-20260829.bc6Pem/build`，可恢复；未移动正常安装应用。
- 解锁后：先对同一打包应用重新完成全套检查，再正常退出旧版、备份最新设置和旧应用、从已验证 DMG 安装，回读版本/文件/设置并实际启动、操作菜单；确认搜索仅正式安装入口。
- 尚未执行安装替换，不预先宣称保留设置成功或完成新版本启动。旧的其他互动偶发问题和 Codex 未验场景不会因生成 DMG 自动关闭。

## 解锁后安装完成

- 2026-08-29 用户明确表示已解锁，桌面工具实际读取到正常球球窗口后继续。复用上述哈希未变的 DMG 与打包应用，没有重新构建或修改动画。
- 本次重新运行全部 491 项测试，0 失败/跳过。通过 `PET_SMOKE_APP_PATH` 运行实际打包应用，完整检查退出码 0，包含 `PET_SMOKE_OK`、`PET_BOUNCE_OK` 及所有原有互动/颜色/睡眠检查标记；四档 80/120/180/260、双屏和边缘检查全部完成，38 个全身动作案例共 7,700 渲染帧。
- 四档 Codex 原生窗口模拟检查全部通过，记录来源为 `simulated-connection-real-ui`。这是提醒窗口与动作检查，不是新增真实 Codex 任务验证；未创建测试任务或开启安装版联动，此前真实场景的未验边界保持不变。
- 正常退出旧版后确认进程结束，再读取并备份最新设置。旧 0.2.2 应用和该次设置保存在 `/Users/allan/.Trash/球球桌宠-0.2.2-更新前-20260829.Kf2UHy/`，可恢复；没有永久删除旧应用。
- 从只读挂载的 DMG 复制至 `/Applications/球球桌宠.app`。安装版与镜像内应用全部 600 项字节/权限/链接一致，39 个源文件与源码一致，七个 Codex 模块齐全；严格签名验证通过、版本为 0.3.0，`app.asar` SHA-256 与上文一致。
- 首次启动前，设置文件与新鲜备份逐字节一致，SHA-256 为 `d4e12de810c8a2f815f0502f19bfe9546bb95abc63bf01464d17526a5ca69e58`。启动与互动后逐项回读确认 `tiny`（80×80）、`x=1895`、`y=-1572`、置顶、保持清醒及气泡全部保留；仅正常补入默认值 `codexEnabled: false`，当前文件 SHA-256 为 `43fc4e47d9e6266e90efd509980a10f9cc1e291a932c6cf27521f64738ff75ee`。未恢复旧记录中的坐标或直接改写用户设置。
- 实际启动的窗口来自 `/Applications/球球桌宠.app/Contents/Resources/app.asar/desktop-pet/index.html`，原生右键菜单已出现「Codex 联动」及四档尺寸；默认关闭，不显示联动状态子菜单。菜单截图接口返回空，因此菜单存在以实际可访问性文本确认，关闭状态另以设置和包内默认值回读确认，未声称拍到勾选状态。
- 已查看安装版灰白球球外观并实际双击，前后截图可见眼睛/姿态响应；没有拖动位置。本次实际安装 UI 检查不外推为所有真实 Codex 场景通过。
- 镜像已卸载，临时打包入口取消注册。安装后两次系统索引查询均只返回 `/Applications/球球桌宠.app`；最后进程回读为 PID 85148，来自正式安装路径。
- 安装、启动、菜单和双击检查完成后，收尾的桌面应用列表检查再次明确报告 Mac 锁屏；已停止进一步桌面操作，没有绕过锁屏。此前完成的安装与 UI 证据保留，随后仅做文件/进程只读回查和文档同步。
- 完整证据目录：`/tmp/emotion-ball-030-unlocked.30Qem3`，包括 `motion-verification.json`、`motion-frames.json`、`codex-native-results.json`、`sleep.png`、`installed-before-doubleclick.jpg` 和 `installed-after-doubleclick.jpg`。
- 新 DMG SHA-256 保持不变。旧分享 ZIP 的 SHA-256 仍为 `61bf6fc96c780cb00ea6c0b01b93fcd836382b57a58b6165b5070e86d4c60e58`；没有生成新 ZIP、上传安装包、合并 main 或发布 Release。

## 任务交互源码候选验证

- 本次只验证 `codex/light-companion` 源码候选；提交前基线为 `5220ebd`，候选内容为「补齐 Codex 任务交互打包验收」，不在提交正文中写入无法自指的最终 SHA。
- 定向命令 `node --test desktop-pet/tests/package-script.test.js desktop-pet/tests/codex-native-helper.test.js desktop-pet/tests/smoke-verification.test.js` 最终为 24 项通过、0 失败；`npm test` 最终为 536 项通过、0 失败、0 跳过。
- `npm run smoke` 使用独立临时设置目录和本地合成回调，最终退出码为 0。除既有互动、六种动作、四档 80/120/180/260、双屏边缘、Codex 四档窗口、睡眠视觉、弹跳及总完成标记外，新增输出 `PET_CODEX_TASK_MENU_OK`、`PET_CODEX_TASK_TITLE_OK`，并保留 `PET_CODEX_SIMULATED_OK`。
- 原生菜单实际只列出「处理中、等你确认」，不列出完成、失败或「最近提醒」；任务名称开关默认关闭且在 Codex 总开关关闭时禁用。通过真实 `MenuItem` 复选项 click 开启后，同一个可见气泡原位切换为清理后的任务名称，再关闭回到通用文案；提醒编号、到期时间和身体动作令牌均未改变。
- 前两次 smoke 没有锁屏，均因误用 Electron 原生复选项的自动反转语义而在名称切换处失败；修正为真实 `MenuItem.click` 调用方式后重新完整执行通过，没有放宽断言或把失败记录成成功。
- 原生 helper 仍只允许 `PET_SMOKE_TEST=1`，仅接收本地合成任务状态；本次没有读取真实 Codex、创建真实任务、发送模型请求或消耗任务额度。
- 本节没有运行 `package:mac`、没有生成 DMG，也没有改动或重新验证本机安装、分享 ZIP、`main` 合并和 GitHub Release；上文历史安装事实保持不变。

## Codex 额度功能候选自动化证据

- 本节记录 `codex/light-companion` 候选源码、自动测试与主代理执行的真实窗口 smoke；没有连接真实 Codex、没有创建测试任务，也没有消耗真实额度。
- 定向命令 `node --test desktop-pet/tests/package-script.test.js desktop-pet/tests/codex-native-helper.test.js desktop-pet/tests/smoke-verification.test.js` 为 35 项通过、0 失败；`npm test` 为 707 项通过、0 失败、0 跳过。
- 打包暂存清单已逐文件加入额度选择、提醒策略、标签定位、标签窗口以及 HTML/CSS/预加载/渲染共 8 个资源；测试逐文件比对内容，并确认暂存区不夹带用户设置、日志或验收结果。
- 原生模拟验收助手已接入当前额度标签控制器，并使用本地合成快照覆盖 80/120/180/260 四档尺寸、常驻开关、自动/5 小时/周额度、气泡避让、浅深外观截图以及已用 10%/80%/90%/100% 的 normal/strong/urgent 表现。主代理先发现并保留了旧截图帧失败证据，随后在 `43096a7` 上重新完整运行并通过；两轮均未连接真实 Codex 或创建任务。
- 常驻标签候选布局已把固定可见的「剩余 N%」放在可省略详情之前；过期数据的核心区固定显示「已过期 · 剩余 N%」，标签和周期才可省略。模拟验收会以 64%、78% 和超长恶意标签读取真实 DOM 宽度，并设置独立的 `quota-label-stale-long` 待验截图，在截图前后核对仍是当前 176×54 标签窗口。四档尺寸只调用应用真实尺寸入口并回读窗口与设置，不能直接改宽高伪造通过标记。
- 第一次真实窗口 smoke 证据目录为 `/tmp/emotion-ball-quota-final.OTL9MS`，进程退出码与功能 marker 均为 0，但人工回读暴露出截图缺口：`quota-label-stale-long.png` 与新鲜浅色截图的 SHA-256 均为 `ad6e471ebfab8397e064f03aafc4047d6ac910c64db9e945f1967a1b6d78e220`，虽然页面 DOM 已进入过期状态，实际捕获仍是旧合成帧，因此该轮截图证据判定失败。`b995feb` 后的门禁会等待连续两帧与绘制稳定，并拒绝内容相同的过期截图；`43096a7` 又为页面绘制和截图分别增加 3 秒局部超时，避免卡到整套烟测超时。
- 修复后的新鲜真实窗口 smoke 证据目录为 `/tmp/emotion-ball-quota-pass.5sXcg1`，退出码 0，输出四档 `PET_CODEX_QUOTA_SIZE_*_OK`、`PET_CODEX_QUOTA_NEGATIVE_DISPLAY_OK`、`PET_CODEX_QUOTA_LABEL_OK`、`PET_CODEX_QUOTA_POLICY_OK`、`PET_CODEX_TASK_MENU_OK`、`PET_CODEX_TASK_TITLE_OK`、`PET_CODEX_SIMULATED_OK` 及总标记 `PET_SMOKE_OK`。实际负坐标工作区为 `{x:-524,y:-1692,width:3008,height:1635}`；球球和标签窗口真实移动验收后，窗口 bounds 与保存的 `size/x/y` 均恢复原值。
- 新鲜截图 SHA-256 分别为：浅色 `ad6e471ebfab8397e064f03aafc4047d6ac910c64db9e945f1967a1b6d78e220`、深色 `42e2f86ce678df1db2de1ad7d5f30117285fd30e0836e2668bb342f8b1cfe7af`、过期长名称 `40f40808cf7c407f321beeb3598954d370575a338ca9da0068dc3245e078440f`，三者互不相同。人工逐张回读确认浅深模式均完整显示「剩余 64% / 78%」，过期图完整显示「已过期 · 剩余 64% / 78%」，仅名称详情省略；80×80 的标签、气泡和球球截图无窗口裁切，球体颜色未改变。
- 双屏候选验收读取真实显示器列表：只有检测到负坐标显示器并真实移动球球、完成标签屏内/避让断言后才输出 `PET_CODEX_QUOTA_NEGATIVE_DISPLAY_OK`；没有该环境只输出 `PET_CODEX_QUOTA_NEGATIVE_DISPLAY_SKIPPED`。通用 `PET_CODEX_QUOTA_LABEL_OK` 不代表已做实机双屏验收。
- 异常收尾会先重建本地合成连接，再临时开启以恢复额度周期、常驻与任务名称开关；随后先恢复球球真实 bounds，再调用真实尺寸入口按该 bounds 持久化尺寸与位置，最后通过仅在 smoke 闭包内可达的受控入口精确还原初始 `size/x/y`。静默位置、尺寸或落盘失效都会形成清理错误；各清理步骤仍独立执行，原始失败与清理失败会一并保留，不会因此连接真实 Codex。
- 冒烟门禁已强制新增 `PET_CODEX_QUOTA_SIZE_80_OK`、`120`、`180`、`260`、`PET_CODEX_QUOTA_POLICY_OK` 和 `PET_CODEX_QUOTA_LABEL_OK`；自动测试逐一删除标记，均确认会失败。
- 当前源码与真实窗口合成验收已完成；打包应用、DMG/分享 ZIP、对应新哈希、本机安装替换、搜索入口及 GitHub Release 尚未在本轮额度候选上执行。后续打包与安装必须继续产生新鲜证据，不复用上文历史包或旧安装结果代替。

## 0.3.1 最终打包、安装与分享

- 版本升至 0.3.1。最终全量自动测试为 710 项通过、0 失败、0 跳过；动作相关定向测试为 96 项通过，锁屏/拖动专项为 12 项通过，`git diff --check` 通过。
- 第一次安装版 smoke 在屏幕边缘重播 `peek` 时发现动作约 1,115 ms 被提前截断，未把该轮记为通过。原因是 macOS 的迟到 `drag-end` 在新双击动作开始后仍触发归位。最终实现为：动作开始时冻结真实锚点，迟到抬手只保存安全锚点、不保存动画中间帧；真实锚点越界则终止动作并安全归位。
- 第二次安装版 smoke 的功能标记全部通过，但清理阶段发现 `rest` 后的迟到 `drag-end` 会覆盖已恢复的空坐标，也未把该轮记为通过。最终在休息/睡眠时作废拖动会话，并忽略没有活动拖动会话的抬手消息；新增三项回归测试覆盖迟到抬手、越界锚点及清理竞态。
- 最终真实安装版 smoke 使用 `/Applications/球球桌宠.app`，证据目录为 `/tmp/emotion-ball-031-final-pass.dsq5DC`，退出码 0。四档 80/120/180/260、双屏边缘、任务菜单/任务名称、额度四档标签、负坐标显示器、额度策略、睡眠视觉、弹跳和总标记 `PET_SMOKE_OK` 均通过；没有连接真实 Codex、创建测试任务或消耗额度。
- 最终浅色、深色、过期额度标签截图 SHA-256 分别为 `ad6e471ebfab8397e064f03aafc4047d6ac910c64db9e945f1967a1b6d78e220`、`42e2f86ce678df1db2de1ad7d5f30117285fd30e0836e2668bb342f8b1cfe7af`、`40f40808cf7c407f321beeb3598954d370575a338ca9da0068dc3245e078440f`；与已人工回读的最终截图一致，80×80 无裁切，球体颜色未改变。
- 安装应用版本为 0.3.1、arm64，严格签名验证通过；`app.asar` SHA-256 为 `39c0c2e9fa8800e1b4b178c371a61c695f0d9cbd77e4e5eb0e407186f29cd56a`。本机安装前后设置 SHA-256 均为 `70e82fc9a66d61651ef36fe6d52956b700a00542146110a0ca72c857fddd4177`，没有产生错误日志。
- 正式安装版先退出上一进程，再从 `/Applications/球球桌宠.app` 重新启动为 PID 14294；版本、程序哈希和设置再次回读一致。`/Applications` 精确扫描和 Spotlight 的应用标识查询均只返回这一份正式安装入口。
- 最终 DMG 为 `/Users/allan/Documents/个人创作/球球桌宠-0.3.1-Apple芯片.dmg`，大小 138,063,803 字节，SHA-256 为 `b0e172f3bfb6112e359609dcab56b21205c1be1387a4f0d2dfad2084c502eda2`，`hdiutil verify` 通过；镜像内应用版本、签名及目录/文件/链接比对均通过。
- 最终分享 ZIP 为 `/Users/allan/Documents/个人创作/球球桌宠-0.3.1-Apple芯片-分享用.zip`，大小 135,985,970 字节，SHA-256 为 `8f62892db809c843db924fcb0b58c9542432bd6bdc7a8ccec4812a9fbabdcbdf`；解压测试通过，根目录只包含上述 DMG。旧候选包和打包暂存目录已移入废纸篓，可恢复，没有永久删除。
- 本包为免费、非商用分享包，采用本机临时签名，未使用 Apple Developer ID，也未做苹果公证；接收者首次启动可能需要右键「打开」或在「隐私与安全性」中允许。没有发布 GitHub Release，也没有合并 `main`。
