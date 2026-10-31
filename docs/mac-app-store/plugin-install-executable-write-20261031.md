# 外部插件脚本写入：executable 权限与隔离属性对照

2026-10-31，只在两个各自独立的自有临时synthetic-script-target目录创建和执行固定printf脚本。没有修改主App权限、真实工具或其配置，没有读取用户数据/凭据，没有模型调用，没有清除隔离属性或绕过任何安全提示。原生ad-hoc沙盒对照，不是真正Electron MAS或App Review结论。

## 官方要求先于实测偶然可用

已读取[Apple官方沙盒文件访问说明](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)的官方Markdown版本。Apple明确区分用户所选文件访问与程序：用户选择文件的权限不允许沙盒App任意运行外部程序；将程序写入用户选择的位置需要`com.apple.security.files.user-selected.executable`。

因此先前JSON写入成功不能直接证明球球可以按当前主权限把可执行插件脚本安装到外部原工具目录。当前主App只有read-write/bookmark等权限，没有这一executable权限；本轮只给独立合成对照App加它，没有改主权限。

## 对照方式

两个不同bundle避免改签与旧书签绑定混淆。两者都有App Sandbox、user-selected.read-write、app-scope bookmark，分别由系统NSOpenPanel选择自己的合成目录；一组另加user-selected.executable。各包内helper仅sandbox+inherit。主与helper使用Foundation Data.write(atomic)写固定脚本，再POSIX chmod0700；退出沙盒probe后，由不带沙盒的自有Node测试harness直接启动这两个脚本，脚本只调用printf输出固定标记。

## 结果

| 项目 | 仅read-write | read-write + executable |
| --- | --- | --- |
| 主进程写脚本、chmod0700 | 成功 | 成功 |
| 继承helper写脚本、chmod0700 | 成功 | 成功 |
| 两份脚本com.apple.quarantine | 均出现0082标记 | 均没有该属性 |
| 当前非沙盒合成host直接执行 | 都成功输出固定标记 | 都成功输出固定标记 |
| 删除书签后再写新脚本 | 513拒绝 | 513拒绝 |

这里记录的是当前系统、该特定脚本与Foundation写法的行为。没有验证其他脚本/二进制、Node最终安装器写法、真实原工具加载或未来系统规则。当前host能够执行带隔离属性的合成shell脚本，不等于可忽略官方executable权限要求，更不等于苹果商店允许向其他软件共享位置安装代码。

## 对落地决策的影响

当前自动直写插件只可继续作为明确标识的诊断候选实验。真正MAS构建应在缺少经确认的权限和审核路线时拒绝外部程序写入，而不是以JSON探针或这次shell执行成功宣称合规。是否能增加权限以及共享代码安装是否符合商店条款，需另行确认；本报告不作审核承诺。

源码：`probe/PluginExecutableWriteProbe.swift`与`probe/run-plugin-executable-write-probe.js`。精确脱敏结果：`plugin-install-executable-write-20261031.json`。原生探针脚本正常退出0，实际工具未触碰。
