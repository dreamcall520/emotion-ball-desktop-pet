# 真正 Electron MAS 开发沙盒构建入口

2026-10-31，新增 `desktop-pet/scripts/package-mas-development.js`。这是本机开发验证入口，与现有商店分发/PKG入口分开；没有创建证书、profile或提交应用。当前会员审核待处理、有效签名身份为0是主会话已核外部阻塞，本入口不把Personal Team、ad-hoc签名或Darwin候选当成MAS沙盒通过。

## 预检和构建

默认和 `--plan` 只读取源码package版本、配置是否提供，返回缺项与 `runtimeSandboxValidated:false`。不会读取profile、钥匙串、设备ID或缓存，不下载、不签名、不创建身份。

构建操作由开发/CI执行，不是用户连接AI工具所需步骤：

```sh
node desktop-pet/scripts/package-mas-development.js --plan
node desktop-pet/scripts/package-mas-development.js --build
```

开发配置：`MAS_DEV_BUNDLE_ID`（强制以`.masdevelopment`结尾）、`MAS_DEV_TEAM_ID`、`MAS_DEV_PROFILE`（绝对路径）、`MAS_DEV_SIGN_IDENTITY`（Apple Development）、`MAS_DEV_BUILD_VERSION`、`MAS_DEV_ELECTRON_ZIP_DIR`（已有本机MAS ZIP目录），可选`MAS_DEV_ARCH`。入口缺项立即退出2，不导入会下载runtime的打包流程。

`--build`才读取签名元数据与profile，验证Mac平台、有效期、精确Team/AppID、开发属性、profile包含的签名证书及本机已注册Provisioning UDID和App Group。设备只使用System Information的Provisioning UDID，不用Hardware UUID替代，不在输出里打印设备资料或profile内容。拒绝分发、Developer ID、ad-hoc、未注册设备和不匹配profile。

## 打包及签名顺序

1. 只使用显式缓存目录中 `electron-v<version>-mas-<arch>.zip`，没有缓存不下载、不回退Darwin。
2. 独立名字/Bundle ID/staging/output，设置`qiuqiuAcceptance:mas`；主进程入口强制`process.mas===true`。新Bundle使用自己的系统沙盒容器，不复制现有候选账号。
3. 随包加入`qiuqiu-codex`、`qiuqiu-workbuddy`，先验证源组件清单；嵌入开发profile。
4. 主权限为App Sandbox、独立App Group、开发调试、用户选择文件/持久书签、网络client/server（官方登录回调与仅回环受管理连接）、天气定位；子程序仅sandbox+inherit。没有增加用户目录全盘权限或临时例外。
5. `@electron/osx-sign`先签嵌套组件和App；刷新签名可能改变的Codex二进制摘要及WorkBuddy清单；最后**只重签最外App**，不能再`--deep`修改子程序导致摘要失效。严格签名检查，并回读主App、Codex helper及Electron helper的沙盒权限。
6. 运行内置开发probe，必须同时确认真正MAS runtime与本Bundle专属容器路径。任何Darwin替换或外部数据目录均失败；生成的普通运行入口同样拒绝非MAS runtime。

开发probe只证明MAS/容器初始化。目录授权恢复/撤销、OAuth回调、随包helper、三家实际聊天和任务事件仍需在该包逐项原生验收；不能据签名或probe成功宣称已完成这些功能，也不能把开发App送商店。

## 已验证与未验证

9项合成检查通过，覆盖配置拒绝、profile和设备绑定、签名顺序/清单刷新、权限、缺缓存拒绝及Darwin probe拒绝。真实`--plan`成功；空配置`--build`退出2，未调用签名/下载。脱敏回执见`mas-development-entry-preflight-20261031.json`。

**本机真实MAS开发包尚未产生。** 有效Apple Development身份、该独立App ID的开发profile和本机设备注册齐备后，主Agent可直接使用本入口继续，不需要终端用户配置AI服务。

参考：[Electron官方MAS开发签名说明](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)、[Apple注册开发设备](https://developer.apple.com/help/account/devices/register-a-single-device/)、[Apple创建开发profile](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile)。
