# 自动插件安装：沙盒目录写入边界

2026-10-31，只有临时合成目录，没有读取/修改原ZCode、WorkBuddy、真实用户配置、聊天或凭据，没有模型请求。原生ad-hoc App Sandbox对照，不是Electron MAS包验收或苹果审核结论。

## 已确认的本机边界

`probe/PluginInstallWriteProbe.swift`与`probe/run-plugin-write-probe.js`创建独立探针App、包内继承沙盒helper和临时synthetic-install-target。主App仅App Sandbox + user-selected.read-write + app-scope bookmark；helper仅App Sandbox + inherit。本人通过系统NSOpenPanel只选择该合成目录。

- 无授权：主进程及包内继承helper都拒绝写入（Cocoa513）。
- 选择目录并激活读写安全书签：主进程与helper均写入并回读合成JSON成功。
- 新进程恢复书签：主进程与helper仍可写入并回读。
- 删除本地书签、新进程启动：两者再次拒写。

结构化回执`plugin-install-sandbox-write-20261031.json`中parentWriteLifecycleObserved与inheritedHelperWriteLifecycleObserved均为true。探针退出0。没有通过修改系统防护、Accessibility、外部CLI或原工具数据取得权限。

## 后续程序写入限制（本报告只验证JSON）

后续`plugin-install-executable-write-20261031.md`已核Apple官方外部程序写入需要user-selected.executable；无该权限的合成脚本会产生quarantine标记。因此本报告一般JSON目录写入通过，不能直接扩展成当前MAS主权限允许外部安装可执行插件。

## 与球球现有代码的关系

`desktop-pet/packaging/mas/main.entitlements.plist`已有user-selected.read-write。`desktop-pet/lib/mas-directory-access.js:84`创建Electron securityScopedBookmarks，并未设置只读参数；withAccess在整个异步operation结束前保持scope。

Electron43.4.1官方源码`file_dialog_mac.mm:252–300`使用`NSURLBookmarkCreationWithSecurityScope`生成书签，没有加只读选项：[固定版本官方源码](https://github.com/electron/electron/blob/v43.4.1/shell/browser/ui/file_dialog_mac.mm#L252-L300)。相反，旧`AuthorizedProbe.swift:107`特意加securityScopeAllowOnlyReadAccess，因此旧证据只证明读取，不应拿它推论写入。

**工程边界结论：** 获得明确目录写入许可后，球球主进程或包内继承helper可在withAccess范围写入一般数据文件。外部插件脚本是程序，仍须满足后续executable权限与商店审核约束，不能据本JSON探针宣称可以正式安装。无须先获得控制原软件界面的辅助功能权限。原生探针也证明安全范围在本测试父子启动时继承；真实官方CLI的全部依赖路径、锁、缓存与写范围仍要逐项验证。

## 推荐落地顺序

1. 优先固定版本官方插件库，在球球主进程内部执行，仅带本地随包市场/插件，无远程搜索或运行时下载。只有插件存储和必要的启用元数据可写，按ID精确合并，不覆盖其他插件。
2. 若使用官方CLI，必须是随包签名的helper，显式限定home/storage/cwd到已授权目录，withAccess lease等子进程退出后才释放。不可执行原工具安装目录外部未签名CLI；不可把球球容器HOME误当原工具HOME，也不可用本机任意shell命令替代。
3. 首次在球球内展示安装内容和写入范围，并由用户明确确认。现有旧引导承诺只读额度/任务的业务许可，不能被悄悄扩大为修改原工具；系统目录选择可能无需再选，但产品层安装确认仍必须明确。
4. 安装成功由官方管理结果及精确插件元数据回读确认；接通成功仍等原工具真实事件。已安装、等待原软件新任务、事件已收到是三种不同状态。不要自动发送收费模型消息作为安装探针。

## 尚未验证

真正Electron MAS开发包（签名条件仍未齐备）、ZCode/WorkBuddy官方完整安装管理API的沙盒运行、原工具原生加载/热更新、App Review。不能把合成写目录成功宣称为两家自动安装已完成。官方库能否作为稳定可分发依赖、路径范围和许可需与另一路源码审计一起判断；不建议自己模仿内部配置schema来冒充官方安装。
