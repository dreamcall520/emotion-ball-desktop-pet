# ZCode 实验 host 的来源选择

此为独立实验，尚未代表厂商公开 SDK 或 MAS 审核通过。不由球球自动启动或安装。

默认命令仅使用既有 ZCode 官方账号/套餐，不回退用户配置的付费 API：

```bash
node desktop-pet/scripts/start-zcode-local-chat-service.js
```

仅在用户明确选择“沿用原工具已配置的自定义模型及其原计费”后，才运行：

```bash
node desktop-pet/scripts/start-zcode-local-chat-service.js --account-source configured-custom
```

- 自定义来源仅使用现有配置，不新建 key、不购买套餐，也不会在失败后反向借用官方套餐。
- 自定义模型仍按原供应商与原 API 配置计费，不能称为原 ZCode 订阅额度。
- 继续复用原聊天模块的账号/配置变更校验、禁工具/禁审批、专用工作区与临时600私有运行配置。不会修改原 ZCode 账号或模型配置文件。
- 配对文件和 ready 状态标记 accountSource；日志只显示配对目录，不显示 token。候选只选择配对目录，不打开或预览 pairing.json。
- 切换来源需要用户停止原 host、明确启动新来源并重新配对；不通过后台自动切换，不沿用旧 host 的会话归属。
- 默认来源与显式自定义来源均需真实模型可用性验收；合成测试不代表真实聊天成功。

2026-10-31 只读核验：当前官方账号的体验/活动余额接口返回空集合，未发现既有套餐访问 key；模型目录本身正常。另有既有自定义模型配置，因此不能把“官方套餐未能验证”表述成“整个 ZCode 没有模型”。是否沿用这些既有配置由用户选择；等待答复期间不触发真实模型。
