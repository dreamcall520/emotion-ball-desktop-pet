# WorkBuddy 商店候选连接服务

当前仅为可注入主进程的独立模块，没有接入 `main.js`，未访问真实账号、登录凭据、官网会话或模型。

## 接口

```js
const { createMasWorkBuddyProvider } = require('./lib/mas-workbuddy-provider');
const workbuddy = createMasWorkBuddyProvider({
  BrowserWindow, session, shell,
  onChange: state => { /* 主进程将安全状态桥接到额度卡 */ }
});
workbuddy.getState();
await workbuddy.openLogin();
const summary = await workbuddy.readSummary({ signal });
workbuddy.close();
```

- `getState()`：返回独立状态副本，包括 status/busy/loginVisible/summary/stale/errorCode/errorMessage/loadErrorCode/capabilities。登录页面加载失败时，loadErrorCode 仅保留 `ERR_*` 纯码或整数 errno，其他异常内容丢弃；不返回原始 message、URL 或账号信息。重新尝试登录会清空旧诊断。
- `openLogin()`：创建或显示自有 WorkBuddy 官网窗口。每次明确重新登录、官网顶层导航都会作废旧卡片和旧请求，避免账号切换后保留前一账号数据。页面加载完成仍是未确认登录，只有额度请求成功才标 connected。
- `readSummary({signal})`：调用已有 `workbuddy-web-quota`，返回白名单汇总；新请求取代旧请求，迟到结果不能覆盖新结果。登录失效清空旧卡；限流等错误仅保留明确 stale 的旧读数。
- `close()`：仅中止自有查询、关闭自有登录及授权窗，不清空持久Cookie，不操作另一个App，不自动退出网站账号。

内部使用 `persist:qiuqiu-mas-workbuddy-web` 分区，只属于当前球球 userData。官网 BrowserWindow 与 session.fetch 使用同一 Session 和 User-Agent。不导入 Chrome cookies、不读取桌面WorkBuddy密钥/Keychain、不复制真实账号标识到UI；远程网页无 preload，nodeIntegration=false，contextIsolation/sandbox/webSecurity=true，禁用webview和DevTools。

专用 Session 初始化时移除默认 UA 中包含非 ASCII 字符的产品项，保留原 Chromium/Electron 版本；窗口和额度请求都使用该 Session 的同一个 UA。2026-10-31 独立匿名 Electron 复现：中文 App 名进入 UA 后，显式 User-Agent 请求在发网前产生 TypeError；移除该产品项后，相同固定端点和 `redirect:'manual'` 返回预期匿名 HTTP 401。未读取已登录候选的 Cookie/Token，也不代表真实登录积分验收通过。官方 Session.fetch 使用 Chromium 网络栈：[Session API](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init)；[net.fetch 限制](https://www.electronjs.org/docs/latest/api/net#netfetchinput-init)注明 Response.url/type 不可靠，本模块不依赖它们的空值判定成功。

## 登录导航依据

2026-10-31 只读核验官网公开脚本和匿名 `/login` HTML：

- `https://www.workbuddy.cn/` 的公开 `LoginIframeDialog` 经同源 `/login?platform=website&redirect_uri=...&product=workbuddy` 展示登录。
- 该匿名登录页面包含 `https://open.weixin.qq.com/connect/oauth2/authorize` 微信授权入口。
- 当前入口直接打开 `/login/`，携带官网使用的 platform/state/product 参数，登录后回到 Plans & usage。匿名 GET 核验该完整登录入口返回 200 HTML；`/profile/plans-usage` 的匿名 GET 同样返回 200，不能根据 HEAD 的 404 推断它是原候选失败的根因。真实 Electron 登录失败原因仍需下一次候选的安全错误码和实机结果确认。
- 因此顶层及授权弹窗允许 HTTPS 的 `www.workbuddy.cn`、`workbuddy.cn`、`open.weixin.qq.com`；不泛化到所有 Tencent/QQ域名。合法iframe验证码/授权资源仍按普通隔离网页处理，不误拦截其子框架redirect。
- 其他不含授权码/token等敏感参数的HTTPS外链交由系统浏览器；自定义协议、file/javascript、嵌入用户名密码、非标准端口和携带授权码的外链被拒绝，并给明确状态。未来官网若改用其他OAuth域名，需要按实际官方流程核验后补充，不能宣称所有登录方式已验。

公开来源：
- https://www.workbuddy.cn/
- https://www.workbuddy.cn/login/?platform=website&state=2&redirect_uri=https%3A%2F%2Fwww.workbuddy.cn%2Fprofile%2Fplans-usage&product=workbuddy
- https://open.workbuddy.cn/docs/openapi

## 给额度卡的结果范围

`summary.scope` 固定为 `website-summary`；`credits` 为 total/remaining/used/reserved，附 planNames、updatedAt、coverage。只包含网站summary里的credits包。coverage明确不拆 basic/reward/purchased、不查询重置时间、不确认企业完整限额。不能把该结果直接冒充旧desktop report的personal/enterprise分支。

`capabilities.chat` 和 `capabilities.tasks` 当前为 `available:false, reason:'openapi-application-not-configured'`。官网账号登录与第三方Open API授权不是一回事；后者需要应用和权限以及服务端换票，不在客户端打入client_secret，不自动建应用或发起模型请求。

## 本人登录与实机验收动作

主进程桥接候选入口后，用户点击“登录WorkBuddy官网”，在球球自己的窗口按官网完成手机/微信登录，再点击“刷新额度”。对照官网Plans & usage页面确认数值与账号；关闭重开候选App验证持久会话；退出官网后刷新应要求重新登录；换账号不能保留前一账号卡片。

本模块的合成测试只覆盖连接服务状态、窗口/导航策略、同Session请求、取消与迟到结果隔离；不证明官网接受Electron UA或真实MAS沙盒、权限、额度、微信登录已通过。

### 2026-10-31 R4 Darwin 候选实机结果

主 Agent 经本人登录后的窗口实测回报：UA 修复后保留原候选 profile，官网显示已记住的账号选择；选择原账号恢复网站会话后，官网积分为 8050，球球点击刷新后的“网站积分汇总”同为 8050。此次恢复没有重新扫码。此前的 `CONNECTION_FAILED` 已由独立匿名实验定位到中文 UA 触发的 Header TypeError；修复后曾出现的 `LOGIN_REQUIRED` 在本人恢复网站会话后解除，无需添加额外 CSRF 或 Authorization 请求头。

此结果只确认该 Darwin 候选、当前本人账号的网站积分汇总链路。真实 MAS 沙盒、首次扫码完整流程、重启持久性、退出/换账号、企业分类额度与聊天/任务仍按各自验收范围处理，不从 8050 一次数值一致推断全部通过。已停止额外账号及端点请求。
