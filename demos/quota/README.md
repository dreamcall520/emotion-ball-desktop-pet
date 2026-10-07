# 0.4.04 真实额度界面网页演示

入口：`demos/quota/index.html`。直接复用公开 0.4.04 安装包（源码 `v0.4.4@16809908dd3cd4d9cb29fb5cb84cfea5a16bd2c7`） 的 DOM、CSS 和 renderer，以内存 bridge 替代 Electron；不是截图或另一套仿制卡片。

- 原 App 视口与 CSS 不变：套餐卡 196×144、API 卡 196×92，折叠均为 128×32。网页统一等比放大：展开卡 280px 宽，套餐卡约206px高、API卡约131px高；折叠约183×46px。小于280px的容器按可用宽度缩小。
- 主版左侧280px卡、右侧默认趋势填满余下宽度，中间20px；组合最大1100px。演示视口宽度 ≤700px 改为纵排，卡片居中、详情宽度自适应。
- 图7外观模式用 `demos/quota/index.html?appearanceDemo=1`：卡片224px宽（套餐约165px高、API约105px高；折叠约146×37px），≥560px保持卡与趋势并排、中间16px，<560px纵排。360/320px手机也适用。
- 父 iframe 推荐 `width:100%`，高度按 resize 消息更新，初始可用860px。iframe 内原坐标保持不变，放大仅由网页 `sizeCards()` 与外层窗口处理。详情列宽度变化会触发原 renderer 重新测高，无需切换主题。
- 卡片、两个周期趋势、点数、重置机会/过去30天历史、任务/待查看清零、独立 API 报告都可操作。API 连接设置在网页隐藏，所有输入/报告均无真实账户请求。
- 趋势直接复用 0.4.04 的圆润连线、走势／每日消耗切换、图表说明及重置机会到期时钟；示例为内存合成的连续采样，未接入真实账号或本机记录。到期时预计余量没有输入时保持「暂无法预估」。
- 展示样例采用连续四分钟采样，5 小时／周窗口的已采样部分分别覆盖 60%／约 71%；余量保留一位小数，使每日消耗标签简洁，避免短碎线段。曲线仍截止到示例当前时刻，未来部分留给到期提醒。
- 「清除未看」仅处理当前网页示例，按模型代次核对并等待父级回执；不修改真实会话。
- `source-manifest.json` 记录正式来源、原文件与嵌入文件 SHA-256 和少量适配。

父页只能同源嵌入。所有消息都检查 `event.source === parent` 和 `event.origin === location.origin`；内部小 iframe 消息也逐一核对来源 window 和 kind。

父 → 演示：

```js
frame.contentWindow.postMessage({type:'qiuqiu-demo-theme',appearance:'light',colorMode:'standard'},location.origin);
frame.contentWindow.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin);
```

`appearance` 仅 `light|dark`；`colorMode` 仅 `standard|accessible`。暂停消息暂停原额度/API 卡两层流光及外层尺寸过渡；详情原 CSS 无自动动画。减少动态仍复用原 CSS。页面不显示常驻演示免责声明；内存数据与无账户请求边界保持不变，仅实际点击刷新/指南后显示短状态反馈。

演示 → 父：`{type:'qiuqiu-demo-ready'}`、`{type:'qiuqiu-demo-resize',height}`。父页同样核对 origin 与对应 iframe 的 contentWindow 再设置高度。

运行检查（使用既有 Playwright，无安装步骤）：

```bash
NODE_PATH=/path/to/existing/node_modules QIUQIU_SITE_URL=http://127.0.0.1:4185/ node demos/quota/check.browser.cjs
```

同一检查覆盖额度和聊天。额度主版核验1100/720/700/360/320px的浅/深、标准/色弱组合；外观模式核验620/560/559/360/320px，额外核验窄屏实际折叠、历史入口和260px缩放；保留聊天回归。结果与48张截图写入 `/tmp/qiuqiu-live-app-demos/`（可用 `QIUQIU_QA_OUTPUT` 更换目录）。检查原始视口、放大尺寸、横向溢出、控制台、动效暂停及无外部请求，不写入用户资料或账户。

本轮回归使用 `node --test tests/quota-demo.test.cjs`，覆盖真实网页模型驱动原生趋势／每日消耗、到期标记、未知状态和清除未看回执。受浏览器地址策略限制，本轮未运行浏览器检查；实际观感待手动刷新确认。
