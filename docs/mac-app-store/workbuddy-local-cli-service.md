# 个人CLI本地服务启动器

脚本 `scripts/start-workbuddy-local-cli-service.js` 是本人从终端独立运行的官方CLI宿主，不由球球App自动启动、不打进MAS包。它不读取或复制WorkBuddy Desktop密钥，也不访问别的CLI profile。

已安装官方npm `@tencent-ai/codebuddy-code@2.179.0` 于 `~/Library/Application Support/球球桌宠-商店联调工具/codebuddy-cli`，其profile/workspace已独立。2026-10-31 主Agent确认本人已完成该profile的Chinese Site登录，未发送模型。运行本启动器前应先由主Agent退出其交互CLI，脚本不会擅自结束该进程。

本人运行（不是由App拉起）：

```sh
node scripts/start-workbuddy-local-cli-service.js
```

服务仅loopback，随机网关密码进子进程环境，不在argv或URL；stdout/stderr可能含官方启动密码，因此父进程只消费不回显、不落日志。只轮询 `/api/v1/auth/status`，验证authEnabled/authenticated都为true后，stdout输出safe JSON（ready/provider/pairingPath/cliVersion），不含密码。配对文件格式：version=1、provider=workbuddy-cli、endpoint、password、workspaceDir、cliVersion。临时目录700、文件600。该文件是敏感本地配对，不应复制到聊天或日志；关闭自有宿主后自动删除。SIGINT/SIGTERM仅停止自有子进程，不操作WorkBuddy或别的终端。

## 工具与配置边界

固定使用 `--tools ''`、`--permission-mode dontAsk`、显式deny `*` 和 `mcp__*`、strict空MCP、disableAllHooks；只加载独立profile的user配置，不读项目/local配置；子进程清除 CODEBUDDY_/SERVER__/ELECTRON_ 以及 ANTHROPIC_/OPENAI_/BIGMODEL_/ZAI_/GEMINI_ 前缀的继承环境，避免机器已有模型凭据或路由覆盖本人登录来源；保留 HOME、网络代理及普通环境，不修改父进程环境。禁后台任务、cron、Agent自主组队。官方help已验证这些参数存在，公开权限文档说明dontAsk不是禁用全部工具，读类工具可能默认允许，因此不能只用dontAsk替代tools空与deny规则。

证据范围：2.179.0的version/help及无账号probe启动已验证；本脚本mock测试验证启动参数、密码去向、权限文件、readiness、停止清理。尚未发模型或执行工具，不能宣称serve模式的实际Agent工具集已端到端验证。下一步主Agent应只创建全新ACP会话、核对模式与工具声明，再由本人明确发消息；未知工具审批保持拒绝。CLI网关还暴露其他高权限API，配对密码只交球球主进程，不能给不可信网页；本脚本不是OS级沙盒。

该路线使用个人CLI/CodeBuddy新会话，不表示能读取或继续已有WorkBuddy Desktop任务。官网当前体验版8050积分不自动证明CLI执行资格，登录成功也不等于模型请求已获准。未购买套餐、创建APIkey或自动部署。

参考：[官方安装与隔离目录](https://www.workbuddy.cn/docs/cli/installation)、[CLI权限规则](https://www.workbuddy.cn/docs/cli/permissions)、[Gateway环境变量](https://www.workbuddy.cn/docs/cli/env-vars)、[HTTP API](https://www.workbuddy.cn/docs/cli/http-api)。

2026-10-31 主Agent已回报：此独立宿主实际启动，真实最小聊天收到end_turn。该结果确认当前CLI账号的一次文本聊天；不代表全部工具、原WorkBuddy任务、MAS沙盒已验收。此次新增厂商环境清理mock回归已验证；主Agent已只读确认现有运行宿主的父环境没有这些厂商前缀，因此无需为此改动重启正在运行的宿主。
