# R24 商店沙盒插件安装候选

2026-11-01。真实 MAS 外部空测试目录安装已通过；原软件迁移与真实事件尚未验证，新增写入用途确认待本人答复。未送审。

## 本轮实现

- 使用 Apple 公共 user-selected.executable 权限；主程序通过 Security.framework 查询自身实际签名，不凭构建标记或目录许可猜测。完整 sandbox/read-write/bookmark/executable 条件具备才开放随包固定插件安装；权限未知时关闭。
- 只有数据写入条件时提供已有插件重新配对：只更新2/3份 receiver.json，严格校验已有插件、注册来源、启用与固定源码；不写代码、市场或启用设置。不把配对许可升级为完整安装许可。
- 保留原工具退出等待、取消、系统安装锁、并发检查、条件回滚、其他设置字节保留。已有目录技术授权在本人确认新用途后复用，正常重启不重复授权。
- 开发候选原生菜单新增空目录验证，正式分发入口不设置该菜单标记。空目录必须为本次固定名称和唯一标记，拒绝已有原工具内容；测试授权不进入真实工具的授权存储。

## 已实测

- 真实 MAS 当前进程读取四项必需权限均为 true；主子签名与容器、独立组件和合成事件传输探针通过。
- 原生目录选择器授权球球自建的外部空测试目录后，实际 Node 安装器安装 ZCode/WorkBuddy 固定插件，重复安装内容不变。五份脚本0700且无 com.apple.quarantine；未移除隔离属性或改系统信任。
- 测试本地receiver已关闭/清除。授权lease关闭后业务访问守卫拒绝；这不宣称 macOS 在当前进程中已撤销所有隐式访问权限。
- 原软件未安装更新、未发送新模型消息、未宣称原软件实时任务接通。原正式 App 未替换。

## 审核边界

Apple 官方支持在用户选定位置创建可执行文件：[App Sandbox 文件权限](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)、[归档权限说明](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)。

这解决沙盒技术条件，不能代替审核判断。[2.4.5(ii)/(iv)](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility) 对共享位置安装代码和额外代码有要求；插件随包提交、固定代码、明确授权和私有工具目录需在送审材料中完整披露。没有查到 Apple 对这两个目录的明确裁定。[Apple DTS](https://developer.apple.com/forums/thread/811450?answerId=871171022) 也未替审核作通过保证。

下一步：本人确认写入用途后，在原软件已退出时复用已有授权完成安装/配对；本人同意测试才各发送一条不调用工具的合成消息，验证真实事件与重启恢复。ZCode Stop 不确认最终任务完成；WorkBuddy FinalStop 仅确认主回复，后台整体任务仍需可靠证据。

最终验证：3155项全量通过，469份非原生包内源码逐字节一致；最终签名包已正常打开并自动恢复三家聊天和数据目录授权。先前一次临时watcher计时失败，专项与最终全量复跑通过；新增权限的旧断言已按实际所需范围更新。配对许可不可升级为代码安装许可的回归通过。当前原目录写用途仍待本人确认，原生窗口停在“同意，自动安装”，未点击。
