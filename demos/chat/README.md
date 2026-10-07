# 0.4.04 真实聊天界面网页演示

入口：`demos/chat/index.html`，推荐宽度360–560px，手机最小320px，高度520px。来源为已公开 `v0.4.4@16809908dd3cd4d9cb29fb5cb84cfea5a16bd2c7` 的 0.4.04 Apple 芯片安装包 `Qiuqiu-0.4.04-macOS-arm64-share.zip`：`app.asar` 内聊天相关19个源文件已与该 tag 逐字节核对一致。直接复用原生 `chat.html/css/renderer`、公开形态与头像引擎；只用内存会话、示例模型和固定示例回复。未模拟或发布新版本提醒。

默认蓝色。色弱模式沿用 0.4.04 的透明圆角、无外描边和无输入彩色流光；鼠标点击输入框不再加粗描边，Tab、方向键、Home/End 键盘导航时保留内侧蓝色焦点。蓝色配色文件与旧版相同，不新增配色方案。

新聊天确认/取消、历史切回、模型示例、发送/停止、关闭/重开可操作。所有内容只在当前页面内存中，页面刷新即恢复示例，不连接 Codex 或存储输入。头像复用四种公开形态，包括当前六瓣 Rive。

所有父消息都检查 `event.source === parent` 且 `event.origin === location.origin`：

```js
frame.contentWindow.postMessage({type:'qiuqiu-demo-theme',appearance:'dark',colorMode:'accessible',uiTheme:'blue'},location.origin);
frame.contentWindow.postMessage({type:'qiuqiu-demo-avatar',appearance:NormalizedAppearance},location.origin);
frame.contentWindow.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin);
```

主题值仅 `light|dark`、`standard|accessible`、`blue|green`；省略主题色时保留当前值，刷新恢复蓝色。原生 `onColorMode` 回调提供 `(colorMode, appearance, uiTheme)` 三参数。头像经公开 `PetCustomization.normalizeAppearance` 校验，Codex 宠物还校验两个固定示例的 ID、名称、版本、行数和精确同源资源 URL。请只在定制保存成功后发送头像，预览不发送。

向父页发 `qiuqiu-demo-ready`、`qiuqiu-demo-resize`（520）及 `qiuqiu-demo-chat-closed`。父页按 ready 回送当前主题/已保存头像；原头像引擎及输入流光随父暂停消息、页面不可见、减少动态响应。

`source-manifest.json` 保存公开包/tag 来源、原/嵌入 SHA-256。`chat.css`、`color-mode.css` 和 `chat-blue.css` 与公开包逐字节一致；唯一 renderer 适配是头像活动增加父页暂停条件，输入、历史、气泡、标题栏与键盘/鼠标焦点逻辑沿原实现。`color-mode.js` 仅在初始化时保留 HTML 已设的蓝色默认。网页适配层给 iframe 内部留 2px 边距，避免原 15px 圆角边线贴着视口被裁切；父 iframe 不应额外设置圆角。`privacy-note` 保留空节点供 renderer 切换历史时引用，并由适配 CSS 始终隐藏。少量路径和关闭重开适配见清单。

Node 回归：`node tests/ui-theme.test.cjs`、`node tests/avatar-sync.test.cjs`、`node tests/customize-demo.test.cjs`。现有 `demos/quota/check.browser.cjs` 还包含聊天布局/交互验收；本轮受浏览器地址策略限制未运行，实际观感待手动刷新确认。
