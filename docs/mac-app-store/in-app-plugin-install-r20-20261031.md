# 球球内自动安装任务插件 R20

2026-10-31，独立feature/mac-app-store候选，承接R18/c6ec31b。用户要求启用授权后不用去原软件找插件入口，本轮实现受限离线安装及统一引导。

## 用户路径

球球工具卡→启用授权/继续连接→安装并启用→本人确认写入插件和相关设置。已有技术RW书签在新用途获准后复用，没有则预定位系统目录选择一次。原读取业务授权不自动变成写入用途，写用途单独保存。

原软件未运行时直接安装；正在运行时显示请先结束任务、切到原软件按⌘Q，球球自动检测退出后继续。R20等待最长120秒；最终源码改为15分钟，随时可取消；关窗口/退出球球不会留下迟到安装或新的写入许可。仅安装成功且未取消/未关闭时，对原先运行的软件请求重新打开，不声称插件已经加载或任务事件已收到。没有terminate、forceTerminate、Accessibility或AppleEvents能力。

安装器只处理固定两家球球插件及固定摘要的随包文件；不运行完整原账号CLI、不下载/联网、不读取独立登录凭据文件或聊天正文，不发送模型消息。插件市场源落在原工具获授权目录的独立managed-sources，和官方catalog/installed cache分开。其他插件与JSON字段原始字节保留；旧手工安装仅在自有源/完整摘要匹配时迁移，不修改未知同名来源。版本/schema不支持、链接、冲突均停止。Darwin系统独占锁随进程结束自动释放，残留锁文件不阻塞重试。

检测到原工具重新运行或配置变化会停止/回滚可识别的本次写入；哈希检查+rename本身不是真正的系统原子CAS，不能承诺能对抗任意第三方同时写入。因此要求原工具退出，并逐次提交前复核退出状态。不能把“保留其他字段”扩为任意并发场景绝不丢更改。

## 已验证

- 两家官方CLI在临时HOME、原工具目录/Keychains拒读、外网拒绝的隔离stage，真实手工注册安装→球球安装器迁移→官方列表仍识别enabled插件、catalog可见。不是手写schema自证，不接真实账号。
- 最终3104项全量通过。覆盖固定内容/schema、原始字节保留、受控迁移、链接/冲突、失败回滚、guard等待/取消、进程锁释放及异常进程退出恢复、主窗口关闭/替换/锁屏后的迟到确认拒绝、独立写用途许可及恢复、UI等待时取消不触发二次安装、聊天保持。
- 原生合成App Sandbox：RW书签前主/helper拒写，授权后可写/读回，新进程恢复成功，撤销后再次拒写；只在自有临时目录，不替代真正Electron MAS。
- 原生生命周期对照：sandbox可识别固定fixture并请求启动，但不能正常退出另一fixture；因此不承诺替用户退出原软件。
- 外部程序写入对照：RW无executable也能写mode700脚本但带quarantine；加executable后无quarantine。当前合成host执行成功不能覆盖官方entitlement要求，不移除quarantine、不绕过安全提示。主App权限未扩张。

## 商店边界

[Apple文件沙盒文档](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)要求向用户选择位置写程序使用`com.apple.security.files.user-selected.executable`；[审核规则2.4.5(ii)/(iv)](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility)另有限制共享位置安装代码/资源及额外代码安装。这些要求对原工具插件目录的适用性需进一步确认，不能因为有RW书签就声称可上架。

**自动安装当前仅开放diagnostic隔离候选；非诊断MAS构建在弹授权或写目录前拒绝自动安装，并在引导显示待商店验证。** 当前没有扩张主App entitlement、提交审核或发布。真正签名MAS测试仍缺有效签名身份等条件；其他AI聊天/既有只读能力不因该实验失败被关闭。

## 本机原工具实际验收

用户明确允许两家插件及相关记录/启用设置更新，并分别亲自按⌘Q退出。两家首次等待超时后，球球沿用既有独立安装许可重试成功，无需重复授权。原生UI均显示插件已安装启用；受限只读inspect分别核对installed-configured、enabled true、installedConfigured true。未发送模型消息、未强退原软件，本次迁移尚无新的任务事件证明。实际自动重开未覆盖，因为重试时原软件已退出。

已补充高级安装入口立即展开引导、显示等待和取消，等待时间延长为15分钟。R21验证记录另见最终回执；正式App未替换，未push、合main或送审。
