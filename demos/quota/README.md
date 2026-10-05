# 0.4.00 真实额度界面网页演示

入口：`demos/quota/index.html`。直接复用公开 App `main@7f5c291d34512f629c17275c93bed472f421e8b9` 的 DOM、CSS 和 renderer，以内存 bridge 替代 Electron；不是截图或另一套仿制卡片。

- 套餐卡：原生 196×144，紧凑 128×32；API 卡：196×92，紧凑 128×32。
- 桌面左侧原尺寸卡、右侧默认趋势；宽度 ≤600px 纵排。父 iframe 推荐 `width:100%`，高度按 resize 消息更新，初始可用 860px。
- 卡片、两个周期趋势、点数、重置机会/过去30天历史、任务/待查看清零、独立 API 报告都可操作。API 连接设置在网页隐藏，所有输入/报告均无真实账户请求。
- `source-manifest.json` 记录正式来源、原文件与嵌入文件 SHA-256 和少量适配。

父页只能同源嵌入。所有消息都检查 `event.source === parent` 和 `event.origin === location.origin`；内部小 iframe 消息也逐一核对来源 window 和 kind。

父 → 演示：

```js
frame.contentWindow.postMessage({type:'qiuqiu-demo-theme',appearance:'light',colorMode:'standard'},location.origin);
frame.contentWindow.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin);
```

`appearance` 仅 `light|dark`；`colorMode` 仅 `standard|accessible`。暂停消息暂停原额度/API 卡两层流光及嵌入尺寸过渡；详情原 CSS 无自动动画。减少动态仍复用原 CSS。

演示 → 父：`{type:'qiuqiu-demo-ready'}`、`{type:'qiuqiu-demo-resize',height}`。父页同样核对 origin 与对应 iframe 的 contentWindow 再设置高度。

运行检查（使用既有 Playwright，无安装步骤）：

```bash
NODE_PATH=/Users/allan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules QIUQIU_SITE_URL=http://127.0.0.1:4185/ node demos/quota/check.browser.cjs
```

同一检查覆盖额度和聊天。结果与16张外观/尺寸截图写入 `/tmp/qiuqiu-live-app-demos/`，不写入用户资料或账户。
