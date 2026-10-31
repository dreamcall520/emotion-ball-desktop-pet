# 统一连接引导：剩余官方接入路线核验

2026-10-31，仅只读公开官方源码/已安装程序资源；没有读取用户聊天、凭据、原配置，没有登录、模型请求或安装操作。以下是代码契约核验，不是原生联通验收。

## ZCode：官方登录与空套餐

固定公开来源：[zai-org/ZCode a60ba6a7e5a06742270ca605f5d2cc2766afa7e1](https://github.com/zai-org/ZCode/tree/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1)，公开源码版本3.17.1。

- `apps/zcode-cli/packages/bootstrap/src/auth-login.ts:53` 的 `loginZCodeCli` 是官方浏览器授权+服务端轮询路线（Z.ai与BigModel）；成功后不是直接拿JWT调用模型，而是 `resolveCodingPlanMaterial`。OAuth派生API key不落盘，运行时按OAuth换取请求材料。
- `apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts:119` 的 `resolveMaterial` 对Z.ai先换业务登录，再交给ProjectAccessTokenClient。
- `packages/shared/src/project-access-token-client.ts:270` 从客户信息获取组织/项目，选择默认项目；若没有可用项目，抛 `project_token_project_unavailable`，不会制造替代套餐。
- 因此“额度套餐为空”不能直接证明有官方模型访问权，也不能仅凭空套餐断言永远不能登录。最小下一步是球球自有隔离配置内接官方登录/材料解析和模型目录预检；材料缺失应提示当前官方账号没有可用访问材料，绝不自动改走自定义API计费。真正聊天仍需该账号真实调用验证。
- 本机官方CLI已可从公开源码构建，但尚不能据此声称已接入球球或通过商店沙盒。

固定源码：[官方登录](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/apps/zcode-cli/packages/bootstrap/src/auth-login.ts)、[换取材料](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts)、[项目解析](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/project-access-token-client.ts)。

## ZCode：原工具实时事件可继续做插件

已安装产品公开 `app.asar/package.json` 实际是 **3.16.3**，不是上面的3.17.1。其 `Contents/Resources/glm/zcode.cjs` SHA256为 `97490d0f06a7a225d54d47817acf4b4859cdb268b59f2490caaeda982bef063a`。只读核对以下契约与公开3.17.1相同：

- 插件主manifest `.zcode-plugin/plugin.json`，标准 `hooks/hooks.json` 自动加载；不要在manifest再次指定同文件造成重复。
- 子进程有 `ZCODE_PLUGIN_ROOT`，兼容 `CLAUDE_PLUGIN_ROOT`。支持shell command、秒timeout/timeoutMs以及async；官方插件管理CLI可add本地marketplace/install/enable，但本轮不运行。
- 7个事件：SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、PostToolUse、PostToolUseFailure、Stop；**没有FinalStop或SessionEnd**。
- stdin有snake_case `session_id`/`hook_event_name`；轮次是camelCase **turnId**，没有generation_id。可只导出sessionId、turnId、事件与阶段。
- Stop携带 `stop_hook_active`，但 `runStopHooks` 后还有 `shouldContinueAfterStopHooks`，可能继续同一轮；必须显示“停止候选/最终状态待确认”，不能复用WorkBuddy FinalStop完成语义。
- 官方runtime自己会生成临时transcript文件、把路径放在stdin，然后清理。我们的过滤脚本不读取该文件，也不保存/传输正文；不能声称原工具从不临时落正文。
- 已安装3.16.3 renderer `out/renderer/assets/styles-CQuzX8si.js` 存在 `plugin-store-add-source-input`、目录选择/拖入能力、addMarketplace(source)路径。公开3.17.1的 `packages/ui/src/settings/AddMarketplaceSourceDialog.tsx` 明确支持本地目录。实际原生UI入口与安装成功仍需当次用户授权后验证。

固定源码：[Hooks规范](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/docs/plugin-hooks-compat.md)、[事件与字段](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/apps/zcode-cli/packages/contracts/src/hooks/index.ts)、[输入兼容处理](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/apps/zcode-cli/packages/core/src/hooks/configured-runner-input.ts)、[Stop后续跑](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/apps/zcode-cli/packages/core/src/runtime/methods/turn-stop.ts)。

## WorkBuddy：插件安装深链尚无可用证据

只读5.9.3官方已安装资源。`renderer/assets/main-Dq5eynTm.js` 的 `handleDesktopOpenUrl` 完整分发链处理任务、skill/install、expert/install、模型切换、会话、Buddy、连接器回调；没有plugin/marketplace安装处理。

其中 `codebuddy-ide /skill/install` 只发 `skill-install-intent`（参数skillname/downloadurl），不能据此冒充可安装含Hooks的插件套件。`plugins-DRJALwSU.js` 真实安装是内部adapter `addPluginMarketplace(source)` 后 `installPlugins([name],marketplace,scope)`；没有发现可供第三方App直接调用的已证实公开深链。

最小可交付：球球统一引导生成本机市场、直接显示安装文件和准确的原工具步骤；用户安装一次后复用。不能猜测 `workbuddy://plugin/install`，不能静默写原工具配置代替官方确认。后续可向厂商申请支持插件安装意图URI，或将审查后的插件纳入官方市场再核官方安装入口。

## WorkBuddy：官网积分额外登录存在官方SSO，但未开放给球球

5.9.3确有第一方客户端→网站免重复登录：

1. `renderer/assets/open-web-with-login-C1qOI1NW.js` 的 `requestDeviceAuthCode` 发 `request-device-auth-code`。
2. `renderer/assets/workbuddy-provider-DJLA1WVE.js` 经内部adapter调用 `clawWechatmpDeviceAuthCode`。
3. `main/server.js` / source cache `server.js` 的 `ClawService.wechatMpCreateDeviceAuthCode` 以当前原工具 `buildAuthHeaders`，POST 产品endpoint的 `/v2/plugin/device/auth/code`，取得短期deviceCode。
4. 前端用 `/console/client-login?code=<short-lived-code>&target=<path>` 打开官网。

以上是第一方内部契约，不证明球球独立登录的CodeBuddy CLI2.179.0有该权限。对随包CLI公共产物的对应route/方法检查没有发现同名公开导出；本轮没有调用接口、读取令牌或复制cookie。

因此本轮仍将官网积分登录作为同一引导内的独立可跳过步骤，不能承诺已做到一次官方聊天登录自动读官网积分。下一步优先寻求第一方支持的只读积分API或短期换票授权；如果只能使用原工具内部SSO，也需官方允许的用户触发入口，不能读取原工具私有token代办。
