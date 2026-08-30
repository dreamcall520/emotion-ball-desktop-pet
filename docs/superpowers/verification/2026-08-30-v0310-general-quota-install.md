# 球球桌宠 0.3.10 通用额度识别与安装验证

## 本轮范围

- 额度卡片和额度提醒只统计通用 `limit_id=codex`。
- 通用 `codex` 中 `windowDurationMins=300` 识别为 5 小时，`10080` 识别为周额度。
- `codex_bengalfox` / GPT-5.3-Codex-Spark、`gpt-reserve` 及其他非通用限额不补位通用额度。
- 标准卡片手动选 5 小时或周额度时只展示所选一项；自动模式保留原有主周期与双周期展开逻辑。

## 识别依据

- OpenAI Codex 官方计费说明表明 ChatGPT 套餐共享 5 小时窗口，另可有周限额；GPT-5.3-Codex-Spark 是 Pro 研究预览且使用单独限额。
- 本机 Codex app-server 官方 schema 中，`rateLimitsByLimitId` 以 `limit_id` 分组，窗口包含 `windowDurationMins`。
- 只读回读当前账号时，通用 `codex` 只返回 10080 分钟；`codex_bengalfox` 单独返回 300/10080 分钟。本轮没有读出或保存账号标识、百分比和重置时刻。

## 验证结果

- 全量自动测试：755/755 通过。
- 源码真实窗口烟测：通过，包含浅/深色、标准/小巧、手动单周期、自动双周期、五档球球尺寸与负坐标副屏。
- 冻结打包版首次烟测在活动状态阶段受真实鼠标进入球球窗口干扰，尚未进入额度验收；把鼠标移离后，使用同一冻结包复跑全部通过，未重编。
- 打包应用与 DMG 内应用校验一致：267 个文件、14 个符号链接；`app.asar` SHA-256 为 `97d61880da721bb87c3ac2db3f7f458059ca0deef31cd6ff14cc4e7205b338f4`。

## 安装与交付

- DMG：`/Users/allan/Documents/个人创作/球球桌宠-0.3.10-Apple芯片.dmg`，123,812,165 字节。
- DMG SHA-256：`8c0ad8652f38d6e6ebbf558e2b4b1ed50a6ca1a6713ef70117389b4e8e4918ea`；`hdiutil verify` 通过。
- 已从该 DMG 安装到 `/Applications/球球桌宠.app` 并启动，版本 0.3.10，严格签名检查通过。
- 从旧 0.3.9 到新安装版，除运行期最新 `x/y` 位置外，其他设置完全一致；最终冻结包替换前后及启动后，`settings.json` SHA-256 均为 `1c7efd764ff7f96e7c02f4b897a3468b6c3078e18c6979a71936e2bbf9eb4e6d`。
- 旧 0.3.9 应用和安装前设置可从 `/Users/allan/.Trash/球球桌宠-0.3.9-更新前-20260830-2205/` 恢复。
- 未通过未知周期终审的预最终 0.3.10 候选应用、DMG 与设置备份已放入 `/Users/allan/.Trash/球球桌宠-0.3.10-最终替换前-20260830-2215/`，不作为交付版。
- 新分享 ZIP：`/Users/allan/Documents/个人创作/球球桌宠-0.3.10-Apple芯片-分享用.zip`，121,143,962 字节，SHA-256 为 `364d7e5283ab29f756adf1dbb8aa92dc530b23a15c6f504a4734b941e95c257f`。ZIP 解压后只含一个 DMG，与本地交付 DMG 逐字节一致。
- 已发布 [GitHub Release v0.3.10](https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/tag/v0.3.10)，标签指向产品提交 `27a66557d40f6a4f60c756c3ddef3528ac5cff2c`，不是草稿或预发布。
- Release 只保留两个清晰英文文件名的资源：推荐的分享 ZIP 和单独 DMG；远端大小、SHA-256 与本地一致。已从 Release 重新下载两个文件，重新执行 ZIP 解压检查、逐字节比对与 `hdiutil verify`，全部通过。
- 已将 `codex/light-companion` 普通快进合并到公开默认分支 `main`，未强制覆盖；远端两分支最终指向同一提交。GitHub `main` 回读版本为 0.3.10，通用额度规则与 README 均为最新内容；不覆盖 0.3.9 及更早的历史分享 ZIP。
