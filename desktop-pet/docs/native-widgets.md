# 系统原生小组件

在 Apple 芯片、macOS 14 及以上系统中，主程序包含 WidgetKit 扩展；当前有日历、时间、天气、待办和总览共16类26种尺寸组合。小组件使用与球球相同的待办和已选城市天气，不另行读取系统日历、联网或定位。

## 数据和刷新

- `lib/native-widget-sync.js` 只读当前 profile 的三份来源文件，剔除便签正文等未使用内容，经有界 stdin 交给包内签名的 `QiuqiuWidgetBridge`。
- Swift helper 严格校验、按来源隔离并原子写入当前父 App 的 App Group；切换来源、城市或撤回同意时清理旧值。错误状态不伪装成空清单或新鲜天气。
- helper 是短生命周期工具，不拥有父 App 的 `Bundle.main`。真正的 WidgetCenter 刷新由父进程的 `widget-center.node` 执行，只请求发生变化的类型。
- 主程序退出后保留最后一次结果；系统决定最终展示和刷新时机。表盘使用分钟时间线，没有模拟实时秒针。

## 构建和签名

`qiuqiuNativeWidgets: true` 开启原生构建。`build-native-widgets.js` 从仓库根目录构建 `.appex`、helper、配置及父进程 NAPI 模块。扩展放在 `Contents/PlugIns`，helper 放在 `Contents/Helpers`，NAPI 模块经 ASAR unpack 正常加载。

扩展使用独立的 sandbox + 父 App Group 权限，不能套用 Electron 子进程的 inherit 模板；helper 继承父权限。签名列表显式包含 `.appex` wrapper，不能只签其内部 Mach-O。开发包使用现有 MAS development 身份及 profile；开发运行、分发签名、TestFlight/App Store处理与审核是不同阶段。

`qiuqiu-widget://` 仅支持四个固定内部目标，不接受路径、查询参数或外部目标。冷启动、已有实例均由当前主程序打开对应界面。

这次代码在独立1.0.4分支开发。审核中的1.0.3源树和已交付包保持独立；构建或推送开发分支不执行上传、关联构建或提审。
