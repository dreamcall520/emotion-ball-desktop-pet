# 动态额度周期与双周期展开卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 让球球按 Codex 账号实际返回的数据识别 5 小时与周额度，并在展开卡片中以已确认的液态玻璃层级同时展示两个周期。

**Architecture:** 额度视图层先按周期保留可靠窗口，再明确产出“主周期在前、补充周期在后”的最多两项模型；额度提醒只消费主周期选择结果。窗口层根据展开项数选择 196×96 或 196×128，渲染层以第一项作为主视觉、第二项作为次视觉，并通过同一胶囊组件表达两个周期。

**Tech Stack:** Electron、CommonJS、原生 HTML/CSS/JavaScript、Node.js `node:test`。

---

### Task 1: 修正实际额度窗口识别与主次周期模型

**Files:**
- Modify: `desktop-pet/lib/codex-quota-view.js`
- Modify: `desktop-pet/lib/codex-companion.js`
- Test: `desktop-pet/tests/codex-quota-view.test.js`
- Test: `desktop-pet/tests/codex-companion.test.js`

**Step 1: Write the failing test**

- 使用真实接口形状覆盖 `codex_bengalfox:primary` 的 300 分钟、`codex_bengalfox:secondary` 的 10080 分钟、`base_model_inference:primary` 的周额度和 `codex:primary` 的周额度。
- 断言自动模式以 5 小时为第一项、周额度为第二项；手动周额度调换主次；手动缺失周期不回退。
- 断言提醒只读取主周期，不能为卡片第二项额外生成阈值提醒。

**Step 2: Run test to verify it fails**

Run: `node --test desktop-pet/tests/codex-quota-view.test.js desktop-pet/tests/codex-companion.test.js`

Expected: FAIL，现有按额度池覆盖的逻辑丢失 5 小时窗口，且提醒会读取所有展示项。

**Step 3: Write minimal implementation**

- 先校验窗口，再按 300/10080 分钟和重置时刻保留独立周期。
- 每个周期选择一个可靠代表值；优先显示名或内部标识可确认的 `codex`，其次 `gpt-reserve`，最后使用该周期首个可靠值。
- 自动模式优先 5 小时，其次周额度，再次最短未知周期；手动模式严格选择用户周期。
- 模型第一项固定为主周期，第二项仅为实际存在的另一个标准周期；提醒新增只取主周期的入口。

**Step 4: Run test to verify it passes**

Run: `node --test desktop-pet/tests/codex-quota-view.test.js desktop-pet/tests/codex-companion.test.js`

Expected: PASS。

### Task 2: 为双周期展开态增加安全窗口高度

**Files:**
- Modify: `desktop-pet/lib/quota-label-placement.js`
- Modify: `desktop-pet/lib/quota-label-window.js`
- Test: `desktop-pet/tests/quota-label-placement.test.js`
- Test: `desktop-pet/tests/quota-label-window.test.js`

**Step 1: Write the failing test**

- 单周期展开保持 196×96。
- 双周期展开为 196×128，并验证屏幕四边、多屏负坐标、气泡避让和极小工作区不越界。
- 窗口首次创建、模型刷新和点击展开都依据当前项数切换正确高度。

**Step 2: Run test to verify it fails**

Run: `node --test desktop-pet/tests/quota-label-placement.test.js desktop-pet/tests/quota-label-window.test.js`

Expected: FAIL，现有展开态固定为 196×96。

**Step 3: Write minimal implementation**

- 新增双周期展开尺寸常量 196×128。
- 尺寸与定位函数接受安全的项数参数；窗口创建、重定位、点击展开均传入模型项数。

**Step 4: Run test to verify it passes**

Run: `node --test desktop-pet/tests/quota-label-placement.test.js desktop-pet/tests/quota-label-window.test.js`

Expected: PASS。

### Task 3: 按确认稿实现主次信息层级与统一周期胶囊

**Files:**
- Modify: `desktop-pet/quota-label.html`
- Modify: `desktop-pet/quota-label-renderer.js`
- Modify: `desktop-pet/quota-label.css`
- Test: `desktop-pet/tests/quota-label-window.test.js`

**Step 1: Write the failing test**

- 第一项必须驱动顶部 `CODEX + 周期胶囊 + 大百分比`，不再按最低剩余值重排。
- 第二项包含同款蓝色玻璃周期胶囊、中字号百分比、细进度条和独立重置时间。
- 两个胶囊共享同一视觉类；不得展示 Spark 等模型内部名称。
- 深色和浅色各自具备高覆盖玻璃底、明确主文字和次文字颜色；减少透明度时有实底。

**Step 2: Run test to verify it fails**

Run: `node --test desktop-pet/tests/quota-label-window.test.js`

Expected: FAIL，现有双项仍是两个等权普通行，重置时间也错误取两项中最早值。

**Step 3: Write minimal implementation**

- 渲染器给主项、次项增加明确角色；主项的重置时间只读取主项。
- 次项使用独立周期胶囊、百分比、进度条和一行重置时间。
- CSS 只调整展开双周期布局；收起卡片与单周期展开保持现有行为。
- 使用浅色近黑/深色近白主文字及足够对比的次文字令牌，保留现有流光、圆角和外观设置。

**Step 4: Run test to verify it passes**

Run: `node --test desktop-pet/tests/quota-label-window.test.js`

Expected: PASS。

### Task 4: 补充真实形状 smoke 与视觉回读

**Files:**
- Modify: `desktop-pet/scripts/verify-codex-companion.js`
- Modify: `desktop-pet/tests/codex-smoke.test.js`
- Create: `artifacts/quota-periods-expanded/` 下的验证截图

**Step 1: Write the failing test**

- smoke 注入真实 5 小时与周额度形状，要求窗口报告第一项为 5 小时、第二项为周额度，并能展开为双周期。
- 增加浅色系统、深色系统、固定浅色、固定深色的截图断言和尺寸断言。

**Step 2: Run test to verify it fails**

Run: `node --test desktop-pet/tests/codex-smoke.test.js`

Expected: FAIL，现有 smoke 未覆盖双周期真实形状和 196×128。

**Step 3: Write minimal implementation**

- 更新 smoke 测试数据与页面状态回读，不引入套餐判断。
- 生成四种外观截图并逐张检查文字、进度条、两枚周期胶囊和边界是否清楚。

**Step 4: Run test to verify it passes**

Run: `node --test desktop-pet/tests/codex-smoke.test.js`

Expected: PASS，并产出可回读截图。

### Task 5: 完整回归与提交

**Files:**
- Modify: 仅修复上述测试暴露的直接相关问题

**Step 1: Run focused tests**

Run: `node --test desktop-pet/tests/codex-quota-view.test.js desktop-pet/tests/codex-companion.test.js desktop-pet/tests/quota-label-placement.test.js desktop-pet/tests/quota-label-window.test.js desktop-pet/tests/main-motion.test.js`

Expected: PASS。

**Step 2: Run full test suite**

Run: `npm test`

Expected: PASS。

**Step 3: Inspect the diff and generated screenshots**

Run: `git diff --check && git status --short && git diff --stat`

Expected: 无空白错误，只包含额度周期、卡片与对应验证文件。

**Step 4: Commit**

Run: `git add desktop-pet docs/superpowers/plans/2026-08-30-quota-periods-expanded-card.md artifacts/quota-periods-expanded && git commit -m "feat: 支持动态双周期额度卡片"`

本步骤只提交源码与验证产物；不自动代表已打包、已安装或已同步远端。
