# 球球双击全身动作增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 双击获得五种可辨认的身体动作，保留低频旋转，80×80不裁切、可中断、文字匹配，并交付本机体验版。

**Architecture:** 桌宠侧纯数据模块提供六种动作的统一时间曲线。主进程以一个计时器同时生成窗口位置和身体帧，渲染层仅应用当前有效动作帧，避免两套时钟造成落地错位。原有单击、颜色、空闲状态和气泡节流保留。

**Tech Stack:** 现有 Electron 43、原生 JavaScript/SVG、Node test；不新增依赖。

---

工作树：`/Users/allan/Documents/个人创作/emotion-ball-desktop-pet/.worktrees/light-companion`，分支 `codex/light-companion`。设计见同级 specs 中 `2026-08-27-double-click-body-motion-design.md`。125项测试基线已运行通过。只提交对应文件；不发布、不合并 main、不删除工作树。

## 文件职责

- 新增 `desktop-pet/lib/interaction-motion.js`：可在 Node 和渲染层共用的动作目录、选择器、帧采样和位置约束。
- 新增 `desktop-pet/lib/window-motion.js`：宿主计时、取消、原位恢复；依赖注入窗口与时钟，便于真实逻辑测试。
- 修改 `emotion-ball/js/engine.js`、`ball.js`：仅增加受控身体帧和横纵缩放，不更改原始表情数据。
- 修改 `desktop-pet/renderer.js`、`preload.js`、`main.js`、`index.html`：双击、有效帧、打断、主进程通信。
- 修改 `desktop-pet/lib/dialogue.js`：动作专属文本、当前动作回复对应关系及旧气泡失效。
- 修改打包脚本、既有真实窗口检查脚本、相关测试和使用说明；版本更新到0.2.2。

## 任务1：动作目录、采样和安全范围

文件：新增 `desktop-pet/lib/interaction-motion.js`、`desktop-pet/tests/interaction-motion.test.js`。

- [x] 写失败测试，先用文件存在断言验证缺少功能，再覆盖全部导出：`MOTIONS`、`getMotion(id)`、`chooseMotion(random, previousId)`、`sampleMotion(id, elapsedMs)`、`positionForMotion(bounds, workArea, offset)`。

```js
assert.ok(fs.existsSync(modulePath), '缺少全身动作模块');
const motion = require(modulePath);
assert.deepEqual(motion.MOTIONS.map(item => item.id), ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin']);
for (const item of motion.MOTIONS) {
  assert.equal(motion.chooseMotion(0, item.id).id === item.id, false);
  const first = motion.sampleMotion(item.id, 0);
  const last = motion.sampleMotion(item.id, item.durationMs);
  assert.deepEqual(first.body, last.body);
  assert.deepEqual(last.window, { x: 0, y: 0 });
  assert.equal(last.done, true);
}
```

- [x] 运行 `node --test desktop-pet/tests/interaction-motion.test.js`，确认先因缺少动作模块断言失败，而非语法错误。
- [x] 实现 UMD 导出 `window.InteractionMotion` / `module.exports`。目录每项包含 `{id, durationMs, weight, emotion}`。五项weight=2，spin=1；选择前排除previousId；异常随机值按0，数值限制到[0,1)。未知id采样返回null，异常时间返回安全起始帧。
- [x] 使用下列完整关键帧数据和采样规则；每一帧合并中性值，未列字段不继承上一帧。body坐标采用259 viewBox单位，window偏移也采用同一单位。

```js
const neutral = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, yaw: 0 };
// [毫秒, 身体覆盖值, 窗口x, 窗口y, 眼神x, 眼神y]
const frames = {
  hop: [[0,{}],[180,{scaleX:1.06,scaleY:.78,y:14}],
    [350,{scaleX:.90,scaleY:1.04},0,-32], [540,{scaleX:.95,scaleY:1.02},0,-64],
    [760,{scaleX:1.05,scaleY:.80,y:14}], [940,{scaleX:.91,scaleY:1.03},0,-38],
    [1120,{scaleX:.97,scaleY:1.01},0,-42], [1330,{scaleX:1.04,scaleY:.86,y:9}],
    [1550,{scaleX:.98,scaleY:1.02}], [1800,{}]],
  jelly: [[0,{}],[220,{scaleX:1.06,scaleY:.76,y:16}],
    [440,{scaleX:.83,scaleY:1.06}],[660,{scaleX:1.04,scaleY:.84,y:10}],
    [870,{scaleX:.91,scaleY:1.04}],[1100,{scaleX:1.02,scaleY:.94,y:4}],
    [1340,{scaleX:.98,scaleY:1.02}],[1600,{}]],
  sway: [[0,{}],[250,{rotate:-14,scaleX:.96,scaleY:.98},-16,0,-5],
    [520,{rotate:14,scaleX:.96,scaleY:.98},16,0,5],
    [790,{rotate:-12,scaleX:.97},-14,0,-5],[1100,{rotate:12,scaleX:.97},14,0,5],
    [1450,{rotate:-6},-6,0,-2],[1800,{}]],
  peek: [[0,{}],[260,{rotate:-12,scaleX:.95,scaleY:.96},-18,0,-10],
    [600,{rotate:-12,scaleX:.95,scaleY:.96},-18,0,-10],[880,{}],
    [1180,{rotate:12,scaleX:.95,scaleY:.96},18,0,10],
    [1540,{rotate:12,scaleX:.95,scaleY:.96},18,0,10],[1900,{}]],
  bow: [[0,{}],[260,{scaleX:.97,scaleY:.76,y:18},0,0,0,8],
    [440,{scaleX:.97,scaleY:.76,y:18},0,0,0,8],[650,{}],
    [900,{scaleX:.99,scaleY:.82,y:14},0,0,0,6],
    [1100,{scaleX:.99,scaleY:.82,y:14},0,0,0,6],
    [1360,{scaleX:.99,scaleY:1.02}],[1600,{}]],
  spin: [[0,{}],[200,{scaleX:1.03,scaleY:.92,y:5}],
    [1320,{yaw:Math.PI*2}],[1600,{yaw:Math.PI*2}]]
};
function smooth(t) { return t*t*(3-2*t); }
function interpolate(a,b,t) { return a+(b-a)*smooth(t); }
// sampleMotion 返回 {body, window:{x,y}, gaze:{x,y}, done}。
// 完成时精确返回neutral（spin的2π与0视觉等价），不得留下微小残余。
```

- [x] 对每个采样body计算旋转椭圆的外包络，约束在viewBox `[-7,236]` 以内（圆心114.2705，实际blob点最大半径114.299603，保守半径114.3）；不改变中性尺寸。`positionForMotion` 用窗口宽/259缩放offset，结果四舍五入，夹在workArea内；允许负坐标，非法bounds/area/offset返回null。
- [x] 每16ms采样六个动作，验证有限值、起止中性、身体外包络安全；跳跃有两次离地且有落地形变，其余五种身体轨迹各不相同。检查80/120/180/240尺寸、四角、负坐标；连续选择不重复、spin权重较低、非法输入安全。
- [x] 运行上述测试和 `node --test --test-reporter=dot desktop-pet/tests/*.test.js`；提交动作模块和测试。专项17项、全套142项通过，方案与质量独立检查均通过（75efccb、62b495b）。

## 任务2：接入完整互动生命周期

文件：新增 `desktop-pet/lib/window-motion.js`、对应测试；修改 renderer、preload、main、index、engine、ball、dialogue、打包清单及其既有测试。

- [x] 在现有真实引擎/renderer测试夹具中先写失败测试：六种双击分别对应完整身体动作，rest/睡眠/锁屏/隐藏/缩放/拖动取消；再次双击旧帧失效；再来一次重播气泡关联动作；睡眠双击只唤醒。扩展宿主替身以运行真实window-motion控制器，不用预设动作成功的空mock替代。
- [x] 为窗口控制器先测试：一次start/stop恢复原位；接续动作取消旧计时；取消后捕获的旧回调不再发送帧或移动；靠边收敛；不持久化临时坐标；窗口销毁安全。运行目标测试确认新增断言失败。
- [x] 控制器使用如下接口，执行单一时间轴；停止和完成都发当前token的结束帧，销毁时不发。

```js
createWindowMotion({ getWindow, getWorkArea, now, schedule, cancel, sendFrame });
// 返回 { start({token, action}), stop({restore=true, notify=true}={}) }。
// start仅接受正安全整数token和getMotion(action)存在的动作。
// start先stop，再保存原始bounds、startedAt、token、action；每16ms执行：
const elapsed = now() - state.startedAt;
const frame = sampleMotion(state.action, elapsed);
const point = positionForMotion(state.bounds, state.workArea, frame.window);
window.setPosition(point.x, point.y, false);
sendFrame({ token: state.token, action: state.action, frame });
// 每次回调首先检查current===state和窗口存活；frame.done时释放计时及恢复位置。
```

- [x] preload新增严格受限的 `playMotion({token,action})` 与 `onMotion(callback)`；`pet:motion-start`主进程检查发送者、锁屏、窗口可见性、token和动作白名单。已有stopMotion同时停止新旧动作。
- [x] engine新增 `setMotionFrame(frame)`，只接收有限数值的body和gaze；在现有表情/颜色合成之后应用身体字段，受控动作期间body.scale固定1，避免旧呼吸和预设body位移叠加。`stopMotion()`、setEmotion和销毁清理覆盖层，结束后原管线不变。ball身体transform增加 `scale(b.scale * (b.scaleX || 1), b.scale * (b.scaleY || 1))`；眼神附加偏移不覆盖原同屏逻辑，动作中可以以动作眼神为主，结束还原。
- [x] renderer内的双击选择和启动遵循下面的接线；先取消再建立token，禁止旧动作回调修改新状态。不要增加测试专用生产入口。

```js
function playReaction(action, speak = true) {
  const motion = InteractionMotion.getMotion(action);
  if (!motion || lastSample?.locked || companion.manualSleep) return;
  cancelPendingInteraction(); clearAction(); stopMotion(); noteInteraction();
  const token = ++nextMotionToken;
  activeMotion = {token, action};
  ball.setEmotion(motion.emotion);
  ball.setMotionFrame(InteractionMotion.sampleMotion(action, 0));
  petElement.dataset.lastAction = action;
  desktop.playMotion({token, action});
  if (speak) desktop.say({event:'play', motion:action});
}
// onMotion只接受activeMotion.token匹配的帧。
// done先清activeMotion并stopMotion（引擎层），然后restoreState。
// restoreState在activeMotion存在时不切回闲置表情。
// 接收窗口生命周期stop命令时统一清理动作、排队单击、表情定时。
```

- [x] main主导生命周期：新动作前停旧bounce；单击bounce前停新动作；拖起、sleep/rest、隐藏、调整尺寸、显示器变化、锁屏/挂起、退出统一取消。拖动以停止动画后的实际位置建立锚点，旧回调不得拉回拖动结果。renderer缩放重建球球前清理旧token。
- [x] dialogue.offer扩展为兼容字符串事件或 `{event:'play', motion:<白名单>}`。五类专属短句每类至少2句、旋转至少2句，长度保持现有小气泡可容纳；同类不连续重复。响应保留气泡所绑定动作，`respond`对新动作返回 `{command:'again',motion}`，旧通用play继续返回原字符串。renderer据此重播完整动作；rest不改变睡眠规则。节流阻止新文字时，旧专属play失效并隐藏；重复/过期按钮不能重播。
- [x] index加载纯动作模块；package-mac显式包含新增运行文件。保留contextIsolation、sandbox、非激活窗口；不改其他权限。
- [x] 跑全部测试，核对旧125项回归；源代码真实窗口检查由下一任务执行。通过方案与质量检查后提交。f8a64c3、3515e96实现与修复，全套196项通过，独立符合性及质量检查均通过。

## 任务3：实机验证与本机交付

文件：修改 `desktop-pet/scripts/verify-companion.js`、`smoke-electron.js`、相关检查测试、package.json/package-lock.json、README与desktop-pet/README.md/分享安装说明.txt。截图和临时文件放新建的 `/tmp` 目录，不提交报告或截图。

- [x] 扩展原有真实窗口检查，先确认旧的五项眼神动作断言不再满足新六动作；六类动作通过受控随机值加真实双击事件触发，不引入生产测试入口。检查每项中间帧的SVG transform确实变化、结束归位、颜色固定、气泡文案正确；检查再来一次、rest和中途拖动。
- [x] 在同一真实窗口按动作逐个播放并采集多帧，80×80为主，检查其他尺寸和贴边状态。读取实际SVG/窗口边界证明不裁切，并查看完整播放记录和白底/深底关键帧。检查sleep/Zzz和同屏注视仍然有效。
- [x] 将版本从0.2.1增到0.2.2，使用说明只更新双击及重播行为；不声称分享包已发布。
- [x] 运行 `git diff --check`、`npm test`、`npm run smoke`、`npm run package:mac`。再针对打包 app.asar 运行相同 smoke，检查所有模块和版本一致。
- [x] 独立检查整个变更并修复必要问题；主代理实际查看截图，不把脚本成功等同视觉验收。
- [ ] 主代理更新 `/Applications/球球桌宠.app`：先回读版本和最新设置，正常退出，旧app移至唯一的废纸篓备份路径，再复制已验收的新app；核对签名、app.asar一致、实际启动、搜索入口唯一。若用户在操作，不抢鼠标。
- [ ] 最小同步已确认项目结果到Obsidian当前上下文；只报告实际完成项，保留特性分支，不推送或重做分享ZIP。

### 当次进度（2026-08-27）

代码提交 `0f1e933`，201项测试及独立符合性、最终质量检查均通过。源码和打包版各通过38个完整动作案例，分别采集7826、7828个真实渲染帧；覆盖四档尺寸和两屏四角（含负坐标）。球体最小边缘余量约2.515 CSS像素，主代理已查看六类浅深底关键帧及打包版80睡眼/Zzz截图。

打包版本0.2.2，31个运行文件与源码逐字节一致，严格签名通过。包内app.asar SHA-256为 `a199c9a93999965ad659be344ac76dcb2a6926b52be0ffadec5821cc44b1727d`。临时验收素材位于 `/tmp/emotion-ball-body-motion.NFe3dH/`，最终源码报告在 `source-recheck/`，打包版报告在 `packaged/`；不提交这些图片或报告。

正式安装仍待完成：桌面操作工具在安装前回报Mac锁屏，必须由用户手动解锁。当前 `/Applications/球球桌宠.app` 仍为0.2.1，未移动或覆盖；未创建本轮旧版备份。解锁后先回读当时最新设置，再正常退出、备份、替换、启动和核对搜索入口，不能恢复较早坐标。未推送GitHub、未更新公开Release或分享ZIP。

## 自检

五种身体动作、低频旋转、固定灰白、80×80、动作去重、完整重播、冷却、睡眠/拖动/锁屏中断、边界、单击保留、模块打包、本地安装分别由上述任务覆盖。实现中如需改接口，只在同一任务内同步调用方和测试，不扩大产品范围。
