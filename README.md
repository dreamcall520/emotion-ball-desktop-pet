# 球球桌宠公开官网

这是球球桌宠的独立静态官网源码，部署目标为 GitHub Pages。

## 维护原则

- 官网保持免费、非商业，不放广告、付费、赞助或商业推广。
- Apple 芯片与 Intel x64 下载信息分开维护，不用另一架构冒充。
- 下载链接必须来自公开 GitHub Release 直链，并同步版本、文件大小、发布日期和 SHA-256。
- Intel 构建候选在真实 Intel Mac 验收前，必须保留明显说明。
- `LICENSE`、`NOTICE.md` 和原作者 `sam70361/emotion-ball` 署名不得删除。
- 官网没有统计脚本、Cookie、表单或远程字体。

## 本地预览

在本目录启动任意静态文件服务器，然后访问首页。例如：

```bash
python3 -m http.server 4179 --bind 127.0.0.1
```

## 目录

- `index.html`：页面内容和可访问结构。
- `styles.css`：浅色、深色、移动端与网页玻璃材质近似。
- `app.js`：外观切换、移动导航、校验值复制和球球互动演示。
- `assets/vendor/emotion-ball/`：原项目球形角色矢量引擎。
- `assets/screenshots/`：来自隔离烟测的真实产品截图。
- `LICENSE`、`NOTICE.md`：许可与原作者声明。
