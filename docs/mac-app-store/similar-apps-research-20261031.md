# 同类上架 App 与 GitHub 实现核验

核验日期：2026-10-31。目的：保留球球 Codex／ZCode／WorkBuddy 联动，寻找可复用实现方式。

结论：有已上架的AI额度/状态类Mac App，不能把沙盒默认拒绝读文件推导为永久不可行。但没有找到完整覆盖球球三家额度、任务和聊天的现成方案；当前公开源码不等于商店已审核二进制逐字一致。

## 最有价值的案例

| 案例 | 已核证据 | 具体做法 | 球球适用边界 |
| --- | --- | --- | --- |
| AgentDeck Dashboard | Apple商店页面含Mac；官方仓库有MAS/CLI能力矩阵，声明macOS已上线 | `.codex`目录书签；原生HTTPS账户额度；用户同意的Hooks→本地HTTP；外部CLI能力由可选daemon承担 | 可以参考额度与状态分层。启动外部CLI/终端输入等不属于其独立MAS能力，不能说完整聊天已由此证明 |
| Belay | Mac专属商店页面；开源MAS entitlement与CodexProvider | 系统选目录、持久书签、增量读取Codex任务日志；文件观察存活期间保持根目录访问scope | 可参考任务状态及长时观察。其MAS版与官网版Hooks能力不同，不是所有本地网络都被Apple禁止 |
| Tempo for Claude | Mac商店页面；开源macOS entitlement与本地数据库读取器 | 沙盒下选`.claude`目录和书签；账户用量通过HTTPS；Keychain保存自有登录态 | 证明本地统计与沙盒可兼容。其OAuth实现/临时文件例外不能直接搬到球球，商店通过不代表厂商已授权所有第三方凭据用途 |
| CodexBar WorkBuddy实现 | 官方项目的WorkBuddy文档与插件路径 | 网站登录会话查询积分，不读取/解密WorkBuddy桌面token；会话与User-Agent配对 | 给WorkBuddy额度提供替代候选。不是Mac商店通过证明；网站API未公开且可能变化，不覆盖桌面任务/聊天 |
| Cavemode | 官网清楚列出商店/官网版差异 | 商店版移除Codex，官网版保留 | 作为对照，不作为球球的目标方案：用户明确不接受移除联动 |

## 可回读来源

### AgentDeck

- 商店：https://apps.apple.com/us/app/agentdeck-dashboard/id6784822497
- 能力矩阵：https://github.com/puritysb/AgentDeck/blob/master/docs/appstore-feature-matrix.md
- 权限：https://github.com/puritysb/AgentDeck/blob/master/apple/AgentDeck/Resources/AgentDeck.entitlements
- 额度：https://github.com/puritysb/AgentDeck/blob/master/apple/AgentDeck/Daemon/Core/UsageAPIClient.swift
- Hook配置：https://github.com/puritysb/AgentDeck/blob/master/apple/AgentDeck/Daemon/Core/CodexConfigInstaller.swift
- 本轮只读源码快照：`4ec362e83a023d637d1e99103f99e474c1141cc8`。
- 注意：其“MAS无Process/解释器/helper”的描述是自身架构约束，不能泛化为Apple禁止所有子进程或要求球球放弃Electron。

### Belay

- 商店：https://apps.apple.com/us/app/belay-awake-for-ai-agents/id6801207644?mt=12
- 权限：https://github.com/PerfectoWeb/Belay/blob/main/Resources/Entitlements/Belay-MAS.entitlements
- 文件授权：https://github.com/PerfectoWeb/Belay/blob/main/Packages/BelayKit/Sources/BelaySupport/BookmarkFileAccess.swift
- Home映射：https://github.com/PerfectoWeb/Belay/blob/main/Packages/BelayKit/Sources/BelaySupport/BookmarkFileAccessHomes.swift
- Codex任务日志：https://github.com/PerfectoWeb/Belay/blob/main/Packages/BelayKit/Sources/BelayProviders/CodexProvider.swift

### Tempo

- 商店：https://apps.apple.com/us/app/tempo-for-claude/id6762001047?platform=mac
- 仓库：https://github.com/tenondecrpc/tempo-for-claude
- 本轮只读快照：`0076fc5d42fa539b0b53310452e29fa0a76f2854`。
- `Tempo macOS/Tempo macOS.entitlements`：sandbox、用户选择只读、app-scope bookmark；另有单文件临时例外。
- `Tempo macOS/ClaudeLocalDBReader.swift:273–350`：目录选择、书签保存/解析/过期更新与scope。

### WorkBuddy替代认证来源

- https://github.com/steipete/CodexBar/blob/main/docs/workbuddy.md
- 插件：https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/workbuddy.ts
- 关键区别：网站会话与桌面加密登录态是两条路线，不能混称“官方OAuth额度API”。球球候选应使用自身隔离网站会话，不能默认导入浏览器凭据。

### 其他参考

- Cavemode官网与差异：https://cavemode.app/
- Electron书签实现参考：https://github.com/jfigge/jumphippo/blob/main/CLAUDE.md 。只读快照`26188e8cace3d10b87c13afa895be989bca97a15`；其提交清单尚有未完成项，不列为已上架成功案例。

## 已按研究结果推进的本地实现

1. 修正原生诊断App生命周期：调用finishLaunching后可读取授权窗口。先前timeout不能视作平台能力不支持。
2. 真实系统选择器对合成目录授权后：JSON、SQLite、包内helper均可读取；新进程恢复书签后仍可读；删除本地书签后新进程恢复拒绝。报告 `authorization-interactive-result-20261031.json`，`authorizationLifecycleObserved=true`。
3. 同一授权并未赋予外部Unix socket连接或外部可执行文件运行能力；本地TCP仍成功。不能用文件读取成功推断CLI链路已打通。
4. 目录模块新增观察生命周期租约，避免短次withAccess结束后文件监听失去scope。
5. Codex鉴权WebSocket模块已完成本机测试服务握手及JSON-RPC测试，未接真实账号/模型。
6. WorkBuddy独立网站会话额度适配按此路线准备；还需本人登录及真实回读。

原生诊断采用ad-hoc签名，只证明本机技术边界；Electron MAS、真实三家账号和最终Apple审核继续独立核验。
