# 商店 WorkBuddy 任务入口：打包门禁验证

> 以下为任务增量打包前的历史门禁检查。当前已完成真实 MAS 开发签名测试包及部分实号任务验收，最新范围与边界见[最终验证记录](2026-11-21-mas-workbuddy-quota.md)。

2026-11-21，`feature/mas-workbuddy-quota-20261121`，`1514031` 之后的本地增量。用户追加官网同款「进行中／待查看」入口，本轮验证源码与暂存资源，不代表已有安装包包含该增量。

## 已完成

- MAS 保留 `workbuddy-tasks-reader.js`、`workbuddy-tasks.js`、`workbuddy-tasks-renderer.js` 和独立 `mas-workbuddy-task-access.js`。后者同时进入 `package-mac.js` 的显式暂存清单。
- 不再删除详情 HTML 中的任务脚本。真实 `prepareStaging` 再执行 MAS 裁剪后，额度卡和详情 HTML 与官网源码逐字节相同，页面引用的本地资源均存在；由 `tasksEnabled` 控制独立授权的任务能力。
- 裁剪后的额度、任务和授权模块可实际 `require`；额度卡仍可在没有游戏模块时以 `quotaOnly` 创建和销毁。
- WorkBuddy 聊天、CLI、网站 I/O、厂商运行时、guard 游戏和插件模块继续剔除；官网渠道不执行该裁剪。

## 验证结果

先确认原裁剪导致任务 reader、真实模块加载和最终暂存资源三项失败，修改门禁后通过。以下八个文件共 **80 项测试通过**：

```text
mas-workbuddy-quota-package.test.js
public-source.test.js
package-script.test.js
package-mas-development.test.js
package-mas.test.js
workbuddy-tasks-reader.test.js
workbuddy-tasks.test.js
workbuddy-tasks-renderer.test.js
```

使用本轮临时 Node `/tmp/qiuqiu-workbuddy-node-20261121`；日志为 `/tmp/qiuqiu-workbuddy-task-packaging-20261121.log`。`git diff --check` 通过。

本轮没有打包、安装或访问真实 WorkBuddy 账号与任务。真实 MAS 沙盒下的第三项目录授权、任务元数据读取、合法深链跳转与重启恢复，需由最终包含本次增量的测试包分别验收。
