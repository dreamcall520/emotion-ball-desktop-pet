# 球球商店候选 AI 接入 Implementation Plan

> **For agentic workers:** use subagent-driven-development for the independent provider modules; the main agent owns main.js, packaging and final validation. 用户已明确要求继续实施。

**Goal:** 把已验证的Codex额度接入球球候选UI，完成可验证的本机日志任务观察及受限聊天WS接入，并推进ZCode、WorkBuddy的商店适配。

**Architecture:** 商店模式只使用用户选择目录、包内JavaScript/SQLite和HTTPS/loopback连接，不自动启动外部工具。Codex聊天沿用既有只聊天协议检查，连接用户独立运行的专用服务。官网模式继续原路径；独立诊断候选明确不是MAS运行验收。

**Tech Stack:** Electron 43、Node、ws、App Sandbox bookmarks、native HTTPS、node:sqlite。

## 1. Codex聊天传输

- [ ] 修改lib/codex-chat-rpc.js，增加`webSocket:{endpoint,bearerToken},hostHome`，不discover/spawn。
- [ ] 新增lib/codex-chat-ws-connection.js，原始JSON消息交旧RPC处理；只初始化一次。
- [ ] 保留config/read、只读/无工具、workspace、instructionSources与输出Schema校验；关闭只断socket。
- [ ] 跑`node --test desktop-pet/tests/codex-chat-rpc.test.js desktop-pet/tests/codex-chat-ws.test.js`。

## 2. 用户目录与Codex任务

- [ ] lib/mas-codex-tasks.js有界读取授权sessions日志，只按明确轮次事件推导；不使用mtime猜运行。
- [ ] 明确过期、缺元数据和残缺日志为unknown/partial，不混入子agent及球球聊天workspace。
- [ ] lib/mas-codex-connection.js对接createCodexCompanion的start/refresh/retry/close与onQuota/onTask/onStatus/onAccount。
- [ ] 原有lib/codex-account-usage.js的真实来源与缺窗口语义保持；没有数据不补0。

## 3. 三家连接界面与主App接入

- [ ] lib/mas-provider-runtime.js集中拥有目录书签存储、瞬时Codex配对令牌、provider生命周期。
- [ ] 新增store-connections.html/preload/renderer，提供授权Codex/ZCode目录、导入现有本机服务连接文件、WorkBuddy自有会话登录；不在renderer展示令牌。
- [ ] main.js在process.mas或显式mas-candidate中注入上述服务、使用独立候选profile；正常官网路径保持。
- [ ] 商店模式的安装包更新、外部扫描、启动项及外部CLI路径不得被调用；不因接入失败退回不受支持路径。

## 4. ZCode与WorkBuddy

- [ ] mas-zcode-provider.js只读授权配置、HTTPS额度与node:sqlite缓存；缓存非终态保持unknown，不能当作已验证的当前账号实时任务。
- [ ] mas-workbuddy-provider.js封装隔离网站Session登录和积分汇总；不导入Chrome/桌面密钥；覆盖范围明确。
- [ ] 尚无正式聊天/任务授权能力的分支必须返回明确不可用原因，不能换成独立付费API或显示成功。

## 5. 独立本机Codex服务与真实验证

- [ ] scripts/start-codex-local-chat-service.js仅供用户独立启动测试服务，不被App调用；使用全部禁工具覆盖项。
- [ ] capability随机令牌只在权限600的临时配对文件里，CLI只见hash；退出只停止本次拥有的child并清理自己的文件。
- [ ] 主Agent启动服务，候选App导入配对，真实验证模型列表、专用会话、一次无工具短回复、连续对话/取消；不修改用户已有会话。
- [ ] 在同一最终候选App核验真实额度与任务数据，并回读主进程snapshot/聊天结果；不以模块测试代替App链路。

## 6. 验证与交付

- [ ] provider定向测试、原有聊天回归、main语法与打包文件清单检查；需要时跑全量回归。
- [ ] 生成独立诊断候选，签名/源码/配置隔离回读；不替换正式App。
- [ ] 本机有效开发/分发证书仍缺失时，明确没有完成Electron MAS签名实机或上架；不以darwin候选冒充。
- [ ] 已完成、实测、未支持和外部账号/证书阻塞分别记录到docs/mac-app-store和项目交接。
