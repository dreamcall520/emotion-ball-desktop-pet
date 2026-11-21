# 商店版 WorkBuddy 额度：本地接入与验证

- 日期：2026-11-21。
- 分支：`feature/mas-workbuddy-quota-20261121`。
- 基线：`release/app-store@f6dbd04`，保持 `mas-first` 配置。

## 已完成

设置中心新增 WorkBuddy 入口，沿用商店 Codex 的用途说明、应用选择和账号目录选择流程。两项授权原子保存；取消不覆盖旧授权，后台启动只恢复已有授权。解除连接停止查询并撤销授权，设置写入失败仍执行撤权；重授权会清理旧查询代际并实际发起新查询。

使用授权的 WorkBuddy 官方组件查询余额和用量，复用官网积分卡、分类、到期信息及消耗详情。只开放 `quota`、`usage`；不增加商店聊天来源，不初始化 WorkBuddy 任务、插件、网站登录或游戏。页面不接收凭据或书签。子进程确认退出后释放目录作用域；账号变化、取消和撤权期间的迟到结果被丢弃。

## 验证结果

- 最终全量：`node --test --test-concurrency=4 desktop-pet/tests/*.test.js`，3617/3617 通过，0 失败。
- 独立集成复审：66/66 通过，未发现待修阻塞；覆盖 Codex 原链、额度连接、裁剪、窗口与 UI 安全门禁。
- 新增授权、runner、helper 及控制器测试覆盖合成目录/凭据、取消、失效、撤销、账号切换、自然退出与超时；没有读取本机登录或调用真实额度接口。
- 真实 Electron 源码启动与裁剪后暂存目录启动均通过。设置页可见 WorkBuddy，未授权连接及无关操作被拒绝。此项使用 darwin runtime 和隔离资料，**不是真正 MAS 沙盒验收**。
- `git diff --check` 和修改脚本语法检查通过。

本机系统 `node` 来自 ChatGPT App，原生依赖受其签名校验限制。本次使用复制后临时签名的独立 Node 执行检查，未修改系统 Node；新工作树依赖独立安装，Electron 使用原商店工作树已有的 darwin runtime。

## 仍待验证

本机 `security find-identity -v -p codesigning` 返回 0 个有效身份。未制作新的 MAS 签名 App，未替换已安装正式版，未上传或提审。恢复 Apple 开发签名后，需用真正 MAS 沙盒候选验证双授权、重启恢复、WorkBuddy 专有原生存储组件执行和真实额度对账；源码测试不能代替这一步。

完整日志、设置页截图及安全回执：`/Users/allan/Documents/ChatGPT/F03｜球球桌面宠物/验收记录/商店WorkBuddy额度-20261121/`。
