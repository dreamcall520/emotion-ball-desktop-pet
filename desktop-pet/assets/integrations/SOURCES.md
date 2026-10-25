# 联动应用图标来源

2026-10-25 从本机已安装应用提取官方原资源，仅缩小至 256×256 PNG，不从旧 64px 文件放大，不重绘、不锐化或改色。用于设置导航和额度卡来源识别；图标及商标属于各自权利方，不属于球球原创素材或其代码许可证授权范围。

| 输出 | 原资源 | 原始像素 |
| --- | --- | --- |
| `codex.png` | `/Applications/ChatGPT.app/Contents/Resources/icon-codex-light.png` | 1024×1024 |
| `codex-dark.png` | 同目录 `icon-codex-dark-color.png` | 1024×1024 |
| `openai.png`、`codex-default.png` | 同目录 `icon-chatgpt.png` | 2048×2048 |
| `codex-space.png` | 同目录 `icon-space-light.png` | 1024×1024 |
| `codex-space-dark.png` | 同目录 `icon-space-dark.png` | 1024×1024 |
| `zcode.png` | `/Applications/ZCode.app/Contents/Resources/icon.icns`，经 `iconutil -c iconset` 取原生 `icon_512x512.png` | 512×512 |
| `workbuddy.png` | `/Applications/WorkBuddy.app/Contents/Resources/icon.icns`，经 `iconutil -c iconset` 取原生 `icon_512x512.png` | 512×512 |

转换使用 macOS `sips -z 256 256`。`codex-default.png` 是 Codex 应用默认样式，`openai.png` 是 API 来源标识，两者按当前官方原资源导出，不代表共享账号、数据或额度。
