# 商店 WorkBuddy 隐私说明增量依据

核对日期：2026-11-21（Asia/Shanghai）。功能基线 `b90401f`，本轮只补政策和首连说明，不新增访问、发送或授权行为。线上商店专用隐私页当时为 2026-11-01 版，完全没有 WorkBuddy；App 关于页已指向 `https://qiuqiu.pet/privacy/mac-app-store/`，无需改 URL 或 Codex 授权。

## 数据流证据

| 用途 | 源码依据 | 可公开说明的边界 |
|---|---|---|
| 身份与积分 | `desktop-pet/lib/workbuddy-helper.cjs:74,318`、`mas-installed-workbuddy-access.js:82`、`workbuddy-quota.js:44` | 登录材料只用于对应官方请求；球球保存目录书签和账号识别哈希，未见复制账号 access/refresh token 到球球文件。余额趋势本地保存，断连不删除历史文件。哈希不等于彻底匿名 |
| 消耗 | `desktop-pet/lib/workbuddy-usage-reader.js:10,43,95` | 接收完整官方 JSON 后投影时间、credit、requestId；不读取其中 input/inputTrunc 用于统计。不能声称接口响应从不含正文。当前统计与临时官网 Cookie 在内存中，不作为消耗文件持久化 |
| 聊天 | `desktop-pet/lib/workbuddy-chat.js:116,162`、`chat-store.js:73`、`workbuddy-helper.cjs` | 消息与已完成的会话上下文、系统提示发往 `https://copilot.tencent.com/v2/chat/completions`；问天气可附城市和摘要。聊天正文与回复在本机 JSON 保存，权限0600不等于应用层加密。newChat 归档，不是删除；断连不清聊天 |
| 任务 | `desktop-pet/lib/workbuddy-tasks-reader.js:26`、`workbuddy-tasks.js:24` | 只查询任务元数据列，不查询消息正文，不修改源任务或官方未读；球球“已查看”状态可本地保存。打开任务交给系统处理 WorkBuddy 深链 |
| 提醒输入 | `desktop-pet/assets/workbuddy-desktop-hook/plugins/qiuqiu-task-events/scripts/emit-metadata.sh:7,79`、`workbuddy-desktop-event-bridge.js:77` | Hook stdin 可能含正文，脚本在本机内存过滤，原始输入不落临时文件；只通过认证的127.0.0.1回环连接传必要任务元数据，不走代理、不传正文／路径／账号登录凭据。接收地址和配对令牌本地保存 |
| 安装／停用 | `desktop-pet/lib/mas-workbuddy-event-installation.js:60,82,130`、`mas-workbuddy-task-notifications.js` | 用户许可原配置目录后注册自有Hook，先备份修改前完整settings.json；其他配置保留。卸载保留备份及用户已改动文件，不能承诺全部自动删除 |
| 诊断与撤销 | `desktop-pet/main.js:277,4242`、`desktop-pet/lib/feedback-reporting.js:55,169,257` | 本地错误日志可含路径堆栈；自动诊断另行明确同意且仅发送白名单字段，不能把本地日志与自动上传混为一谈。关闭清队列，不删除服务器既有记录；整体断连停止联动和撤销许可，不删除聊天、趋势、已查看状态及原工具资料 |

## 对外说明与链接

- 商店专用页新增 WorkBuddy 专节：登录复用与官方请求、积分和消耗、聊天、独立任务同步、默认提醒的目录许可与本机过滤、原设置备份、停用与删除边界；明确各功能以安装版本为准，避免把候选能力写成旧商店版已有功能。
- 首连 terms 补当前对话上下文、天气摘要、提醒原始输入与过滤，以及原设置备份；保留同一连接确认和现有开关，不增加弹窗、不撤销既有同意。
- [WorkBuddy 隐私保护指引（PC端）](https://privacy.qq.com/document/preview/771d9a58551449e9a7e7445ebfe04966)：从官方PC公开安装资源三处入口独立定位。匿名页面和官方公开正文接口均HTTP200，正文接口code=0，名称为“WorkBuddy隐私保护指引（PC端）”，更新日期2026-11-13，适用Windows/Mac；不是企业专属协议。
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/) 要求按实际数据和第三方处理填写；不因“本机保存”或“可选功能”自动推断无需披露。本轮没有操作 App Store Connect，不把本说明写成后台申报已完成或法律认证。

不更改普通官网 `/privacy/`、已有天气／反馈／诊断功能、Apple隐私清单或Codex授权流程。网页发布、候选打包与当前运行版本以本轮交付回执为准。
