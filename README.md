# 球球桌宠公开官网

这是球球桌宠的独立静态官网源码，部署目标为 GitHub Pages。

## 维护原则

- 官网保持免费、非商业，不放广告、付费、赞助或商业推广。
- Apple 芯片与 Intel x64 下载信息分开维护，不用另一架构冒充。
- 下载链接必须来自公开 GitHub Release 直链，并同步版本、文件大小、发布日期和 SHA-256。
- Intel 构建候选在真实 Intel Mac 验收前，必须保留明显说明。
- `LICENSE`、`NOTICE.md` 和原作者 `sam70361/emotion-ball` 署名不得删除。
- 官网没有统计脚本、Cookie、表单或远程字体。

## 当前下载记录

Apple 芯片版于 2026-09-23 更新为 0.3.24，对应代码标签 `v0.3.24`（bae9d4b88f258e03c14026c0d3d32f44d9007fb7）。官网保持简洁的下载卡，文件大小与校验值在此维护。

| 文件 | 精确大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Qiuqiu-0.3.24-macOS-arm64-share.zip](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.24/Qiuqiu-0.3.24-macOS-arm64-share.zip) | 116882520 | `9f5b09a9bad261ccda5c97a143ff5f859c274a82b86f10d49afd055d37ceafe0` |
| [Qiuqiu-0.3.24-macOS-arm64.dmg](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.3.24/Qiuqiu-0.3.24-macOS-arm64.dmg) | 118314322 | `b13fd698aae9c550b44b2ba3f09ab370a1be7c840c85199a7e807899465844bc` |

ZIP 内只包含上述 DMG。Intel x64 下载仍为已公开的 0.3.13 构建候选，尚未在真实 Intel Mac 上验收；本次模型选择更新仅适用于 Apple 芯片版。应用采用本机临时签名，未进行 Apple Developer ID 签名或公证。

官网模型菜单是预设演示，不读取账号模型列表、不发送真实消息、不保存桌宠设置。实际应用的模型目录以本机 Codex 当前账号为准，切换保持同一聊天；不承诺固定响应时间。

## 本地预览

在本目录启动任意静态文件服务器，然后访问首页。例如：

```bash
python3 -m http.server 4179 --bind 127.0.0.1
```

## 目录

- `index.html`：页面内容和可访问结构。
- `styles.css`：浅色、深色、移动端与网页玻璃材质近似。
- `app.js`：外观切换、移动导航和校验值复制。
- `motion-showcase.js`、`motion-showcase.css`：首屏、互动、Codex 与桌面场景的实时 V5 动效编排；自动播放支持离屏暂停、手动点选及减少动态效果。
- `quota-demo.js`、`quota-demo.css`：可操作的额度演示卡片，只使用示例数据，不连接 Codex。
- `assets/motion/`：复用已确认的 V5 互动、思绪游光和文案模块，以及原有身体动作采样；原设计稿和桌面应用未修改。
- `assets/vendor/emotion-ball/`：原项目球形角色矢量引擎。
- `assets/screenshots/`：保留的历史真实产品截图；当前展示区使用明确标注的网页动画演示。
- `LICENSE`、`NOTICE.md`：许可与原作者声明。
