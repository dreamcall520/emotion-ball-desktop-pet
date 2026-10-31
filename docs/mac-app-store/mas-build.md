# 真正 Mac App Store 构建入口

入口：`desktop-pet/scripts/package-mas.js`。不调用原 `packageMac()`，不改变官网版打包，也不自动上传、创建应用、送审、发布或安装。

## 当前结果（2026-10-31）

- `node desktop-pet/scripts/package-mas.js --plan` 已实跑。当前六项必须配置均缺失，版本 `0.4.09` 规范化为 `0.4.9`，`submissionReady:false`。记录见 mas-build-plan-20261031.json。
- `node desktop-pet/scripts/package-mas.js --build` 已实跑。返回 `MAS_CONFIGURATION_REQUIRED`、退出码2，发生在读profile、钥匙串检查、runtime下载、native编译与签名之前。没有生成MAS App或pkg。
- 自动测试为合成profile/身份及注入工具的控制流验证，不能当成实际证书签名、真实pkg或MAS运行验收。

## 安全的只读计划

```bash
node desktop-pet/scripts/package-mas.js --plan
node desktop-pet/scripts/package-mas.js --plan --arch x64
```

不传参数也只生成plan。计划只读项目package.json和显式配置是否存在/格式，不读取描述文件内容、钥匙串，不加载打包依赖或下载runtime。即使配置齐全，也不会把configurationReady当成可提交。计划不回显profile路径、完整签名证书名称或profile正文。

## 必须显式配置

| 环境变量 | 要求 |
| --- | --- |
| MAS_BUNDLE_ID | 已注册的精确应用ID，不接受通配符，无默认local ID |
| MAS_TEAM_ID | 对应开发者Team ID，10位大写字母数字 |
| MAS_PROFILE | 本地绝对路径；仅实际build时读取 |
| MAS_SIGN_IDENTITY | 完整 Apple Distribution / Mac App Distribution / 3rd Party Mac Developer Application 证书名，尾部Team一致 |
| MAS_INSTALLER_IDENTITY | 完整 Mac Installer Distribution / 3rd Party Mac Developer Installer 证书名，尾部Team一致 |
| MAS_BUILD_VERSION | 显式正整数，不接受0、leading zero、版本小数或超出安全整数范围 |
| MAS_ARCH | 可选，arm64或x64；默认arm64，也可由--arch指定 |

正式构建只能显式运行 `node desktop-pet/scripts/package-mas.js --build --arch arm64`。缺项、证书不可用或profile不匹配时立即失败；**不回退ad-hoc、不改用darwin、不跳过签名**。

## 构建顺序与证据边界

1. 校验配置；要求macOS构建机。现有天气native编译器只编译host架构，故目标必须与host架构相同。x64在Intel构建机运行；Apple Silicon构建机暂不假装已支持交叉native构建。
2. 检查Xcode、有效App分发身份和Installer分发身份；随后以 `security cms -D -i` 解码指定profile，在内存中解析，不把正文/账号/device列表打印到终端。
3. 校验profile未过期、Mac平台、Team、精确AppID、非开发/设备分发profile；App签名证书指纹必须在profile的DeveloperCertificates中，所需Electron自有app group必须被该profile授权。
4. 直接复用既有 `make-icon.makeIcon`、`build-weather-location.buildWeatherLocation` 与 `package-mac.prepareStaging/buildPackagerOptions` 的明确导出。独立stage为 `desktop-pet/build/mas-staging/<arch>`，独立输出为 `dist/mas/<arch>`，不安装或覆盖正式App。
5. 强制 `@electron/packager` 的 `platform:'mas'`，不使用普通darwin缓存。营销版本去leading zero，CFBundleVersion采用显式构建号；主包设置ElectronTeamID，嵌入指定profile并使用正式distribution签名。
6. `@electron/osx-sign` 本地版本2.7.0的Promise API名为 **flat**；入口用 `flatAsync = signing.flatAsync || signing.flat` 适配已核的实际API，不调用不存在的方法。生成Mac Installer Distribution签名的pkg，随后 codesign严格验证和pkgutil签名检查。
7. 即使成功，也只报告签名分发包已生成，仍不标可提交。正式分发签名的MAS App不能拿来直接本机运行；开发证书/profile、TestFlight/商店处理、完整AI联动、用户验收与Apple审核分别完成。

## 权限

主权限模板 `desktop-pet/packaging/mas/main.entitlements.plist`：App Sandbox、用户主动选择文件读写、app-scoped bookmarks、出站网络。为保留现有天气定位组件，另含定位权限；用途文案复用现有构建定义，不新增猜测文案。定位仍需本人授权和最终MAS实机验收。

子组件模板 `child.entitlements.plist`：仅App Sandbox + inherit。主包身份与自有app group由osx-sign根据已校验Team/profile自动注入；不把主包权限复制给每个helper，不添加全盘读取、临时目录例外、摄像头、麦克风、额外监听服务、关闭Library Validation或绕过权限的键。

该构建入口不填写 App Store 隐私标签、加密出口声明、年龄分级、版权/素材授权或截图，不代表这些已完成。

## 官方依据与当前API

- Electron MAS沙盒、主/子权限、证书与profile：https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide
- osx-sign项目：https://github.com/electron/osx-sign
- 本地API权威：`node_modules/@electron/osx-sign/dist/index.d.ts`、`types.d.ts`；`@electron/packager/dist/types.d.ts`。
