# 自动安装前关闭原工具：原生沙盒生命周期边界

2026-10-31，只创建和操作固定bundle `local.xiaokun.emotionball.lifecyclefixture` 的自有惰性合成App。没有退出、启动或修改真实ZCode/WorkBuddy，没有读取用户数据、账号或凭据，没有模型请求。原生ad-hoc沙盒及包内继承helper，不是真正Electron MAS包验收。

## 实测

探针主App权限仅App Sandbox、user-selected.read-write及app-scope bookmark；包内helper仅App Sandbox+inherit。没有Automation、Accessibility、AppleEvents或临时例外权限。

| 操作 | 无沙盒对照 | 沙盒继承helper |
| --- | --- | --- |
| NSRunningApplication按固定bundle只读枚举 | 1个，成功 | 1个，成功 |
| 对该合成App调用normal terminate() | 返回true，实际退出 | 返回false，等待8秒仍未退出 |
| NSWorkspace启动合成App | 回调成功，实际运行 | 单独launch-only回调成功，实际运行 |

启动能力是独立对照：无沙盒测试harness仅清理自己刚创建的惰性fixture，沙盒probe启动时枚举0个，再由继承helper调用NSWorkspace打开这个合成App并观察到1个。没有用强制退出绕过沙盒拒绝，没有对真实软件做同样操作。脚本结束仅按已知自有fixture的canonical executable路径清理自己的测试进程。`/var`与`/private/var`路径规范化已纳入该清理匹配。

## 对产品方案的直接影响

原生证据支持“球球内检查原工具是否正在运行，并代用户重新打开”的方向，但不支持“球球无额外权限自动正常退出原工具”。不能靠原生系统API名字就假设它能绕过沙盒。

因此若为了避免直写插件设置与原工具并发写入，最少且诚实的链路应是：

1. 用户在球球点安装并确认写入范围。
2. 若原工具仍运行，球球显示“请本人关闭原工具（⌘Q），球球会自动继续”；不要要求找插件菜单或打开终端。
3. 球球只读检测原工具退出后执行受限安装，完成后尝试通过系统NSWorkspace代为重新打开。
4. 安装完成与原工具新任务事件接通分别标识，不自动发送收费测试消息。

仍须验证固定真实工具bundle和真正MAS包的只读检测/启动行为。本探针只证明合成App在当前原生sandbox下的系统API边界；不证明两家完整安装链或Apple审核已通过。

源码：`probe/PluginInstallerAppLifecycleProbe.swift`、`probe/run-plugin-app-lifecycle-probe.js`。脱敏回执：`plugin-install-app-lifecycle-20261031.json`。
