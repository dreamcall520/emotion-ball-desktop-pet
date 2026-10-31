# R23 真实 Mac App Store 沙盒验证

2026-10-31，Apple Silicon 本机开发验证通过，尚未送审。详见同名 JSON。正式 App 未替换，未 push、合并或发布。

## 已确认

- Apple Development 证书、独立测试 App ID、当前 Mac 注册和开发描述文件就绪；官方 Apple 中间证书验证后导入，无信任覆盖、无私钥导出。
- 使用官方 Electron 43.4.1 MAS arm64 runtime，真实 process.mas、独立 Apple 容器、主程序与子进程沙盒权限、严格签名检查通过。
- Codex、WorkBuddy 官方登录及 ZCode 已有自定义模型，分别仅发送一条不调用工具的合成消息，均收到“球球沙盒已连接。”。共3条新增模型消息。ZCode 使用原 API 计费，官方套餐仍为空。
- 获本人明确批准后，三家原目录通过系统选择器授权；不修改原配置、不导出原聊天正文。Codex 周额度18%、部分日志任务11项；WorkBuddy 缓存探针52条/1匿名分区，归属、详细记录列表及实时性未确认。
- 空目录授权生命周期独立验证：保存、重启恢复、解除及再次重启保持解除。随后三家真实目录与聊天连接在最终包重启后自动恢复，没有重复选择目录、浏览器登录或新增消息。
- 修复只授权数据后聊天登录入口消失、登录等待误显示再次授权、可选步骤阻塞等问题；不支持的插件安装显示暂不可用，其他能力继续使用。增加原生“球球工具→工具连接”入口。
- 真实 MAS 中独立临时配置的组件初始化通过；不读取原凭据、不发模型消息。WorkBuddy 本地 gateway 连接不等同于厂商账号验证，stop 返回不等同于严格证明子进程退出。
- 真实 MAS 独立临时任务接收器：两家监听、401拒绝无授权、202接收已授权合成元数据、撤销与关闭通过。WorkBuddy Stop不确认终态，FinalStop只确认主回复；ZCode Stop不确认最终完成。所有合成事件隔离并清除，未写入真实工具卡或原插件配置。

## 仍未确认

- 原 ZCode/WorkBuddy 插件到本次真实 MAS 的实时任务闭环；隔离传输测试不能替代原软件端到端验证。
- 真实 MAS 自动安装插件保持关闭。其他 App 数据访问与插件安装需要按 Apple 2.4.5 的适用范围继续落实，沙盒测试通过不代表审核通过。
- ZCode 官方套餐聊天：当前空套餐，不能承诺开通后已验通过；已有自定义模型聊天已可用。
- WorkBuddy 剩余额度暂无已确认的公开共享登录接口，官网积分仍是可选补充；会话 token 消耗不能冒充剩余额度。
- Intel 真机、分发签名、App Store Connect 提交及审核。

官方依据：[Electron MAS 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)、[Apple 2.4.5](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility)、[WorkBuddy 用量说明](https://www.codebuddy.cn/docs/ide/Account/usage)、[ZCode Hooks](https://zcode.z.ai/en/docs/hooks)。

本机截图位于项目文档目录“验收记录/苹果商店真实沙盒-20261031/”；账号、设备标识、凭据和签名私钥不纳入此报告。
