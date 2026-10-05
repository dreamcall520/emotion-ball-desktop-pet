# 0.4.00 真实聊天界面网页演示

入口：`demos/chat/index.html`，推荐宽度360–560px，手机最小320px，高度520px。直接复用公开 `main@7f5c291d34512f629c17275c93bed472f421e8b9` 的 `chat.html/css/renderer`、公开形态与头像引擎；只用内存会话、示例模型和固定示例回复。未模拟或发布新版本提醒。

新聊天确认/取消、历史切回、模型示例、发送/停止、关闭/重开可操作。所有内容只在当前页面内存中，页面刷新即恢复示例，不连接 Codex 或存储输入。头像复用四种公开形态，包括当前六瓣 Rive。

所有父消息都检查 `event.source === parent` 且 `event.origin === location.origin`：

```js
frame.contentWindow.postMessage({type:'qiuqiu-demo-theme',appearance:'dark',colorMode:'accessible'},location.origin);
frame.contentWindow.postMessage({type:'qiuqiu-demo-avatar',appearance:NormalizedAppearance},location.origin);
frame.contentWindow.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin);
```

主题值仅 `light|dark`、`standard|accessible`；头像经公开 `PetCustomization.normalizeAppearance` 校验。请只在定制保存成功后发送头像，预览不发送。

向父页发 `qiuqiu-demo-ready`、`qiuqiu-demo-resize`（520）及 `qiuqiu-demo-chat-closed`。父页按 ready 回送当前主题/已保存头像；原头像引擎及输入流光随父暂停消息、页面不可见、减少动态响应。

`source-manifest.json` 保存来源与原/嵌入 SHA-256。唯一 renderer 适配是头像活动增加父页暂停条件；输入、历史、气泡、标题栏沿原实现。网页适配层给 iframe 内部留 2px 边距，避免原 15px 圆角边线贴着视口被裁切；父 iframe 不应额外设置圆角。`privacy-note` 保留空节点供 renderer 切换历史时引用，并由适配 CSS 始终隐藏。少量路径和关闭重开适配见清单。

检查：运行 `demos/quota/check.browser.cjs`，它同时覆盖本目录；结果位于 `/tmp/qiuqiu-live-app-demos/report.json`。
