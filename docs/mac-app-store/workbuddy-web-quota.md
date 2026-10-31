# WorkBuddy 自有网站会话额度候选

当前仅实现独立模块 `desktop-pet/lib/workbuddy-web-quota.js`，没有接入正式 App、没有发起真实请求，也没有访问现有浏览器或桌面登录凭据。

参考的是 CodexBar 公开文档描述的接口行为，没有复制其实现代码：
https://github.com/steipete/CodexBar/blob/main/docs/workbuddy.md

## 接入与范围

创建 `createWorkBuddyWebQuota({ session })`，注入 Electron 的自有网站 Session；调用 `readSummary({ signal })` 查询。本人需要先在**同一个 Session** 的 WorkBuddy 官网窗口登录，之后才可用其网站会话。请求使用该 Session 的 `getUserAgent()`，不猜 Chrome 版本，不导入外部浏览器 cookie，不读取 WorkBuddy 桌面密钥。

只 POST 固定 `https://www.workbuddy.cn/billing/meter/get-user-resource-summary`，凭据由 Session 自身携带；不跟随跳转，不添加或返回 Cookie/Authorization/账号标识，不输出原始响应。该网站端点没有公开稳定第三方契约，仍需本人网站登录与实际 Electron/MAS 实机验收。

输出只代表网站资源汇总中的 `credits` 包：total/remaining/used/reserved 与服务返回的套餐名称。没有可识别积分包时明确报错，不伪造零。没有查询套餐列表，因此不提供重置时间，不拆 basic/reward/purchased，也不宣称企业总限额已验证。此结果不能直接冒充既有桌面额度报告。

未登录、限流、异常跳转、业务错误、超时、取消、超大/坏响应均明确失败；不自动改用其他账号或 cookie 源。取消和超时覆盖响应体读取阶段，流清理自身卡住也不阻止调用返回。

## 已验证与未验证

`node --test desktop-pet/tests/workbuddy-web-quota.test.js` 使用合成响应测试请求约束、字段/数值校验、过滤、身份信息不外泄、错误分支、流式上限和全程取消/超时。模拟测试不证明官网接受 Electron 自有 Session，不证明真实额度准确性，也不代表可上架。

未验证：本人在隔离 Session 中实际登录；真实查询与网站展示对照；登录失效后的重登；MAS沙盒与最终包；企业套餐及冻结/结转积分的业务口径。
