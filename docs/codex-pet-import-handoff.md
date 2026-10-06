# Codex 宠物导入交接

分支：`feature/codex-pet-import`。基线：公开 `main@7f5c291d34512f629c17275c93bed472f421e8b9`（0.4.00）。版本号未改；本会话只交付独立源码分支，由统一整合会话合并、打包、安装和发布。

## 已实现

- 定制页直接读取 `${CODEX_HOME}/pets`，未设置时使用 `~/.codex/pets`；支持自定义宠物 v1/v2 的 PNG/WebP，点选预览并保存，无上传入口。
- 保留原顶部渐变、按钮颜色及双栏布局；默认球球页签，三列列表内部滚动，超过六项显示名称搜索。按最后标注撤掉模块分隔线，以标题和留白分组，保留页签基准线与控件边框。
- 九类原始动作、暂停、透明度和设置菜单共用六档尺寸。保存失败保留原设置；尺寸持久化成功后才调整窗口。
- 保存时复制到 `userData/codex-pets`，设置只保存内容编号；图片在保存前经 Chromium 完整解码。来源移除后仍能载入副本、重启恢复启动形象、同步桌面和聊天头像；现有收藏继续支持保存、载入、改名和删除。
- 保留“临时换装”与“设为启动外观”区别，现有球球四种形态及轮廓/五官定制继续使用原实现。

## 验证

```sh
node --test desktop-pet/tests/*.test.js
PET_SMOKE_CUSTOMIZE_ONLY=1 node desktop-pet/scripts/smoke-electron.js
PET_CODEX_PETS_QA_OUT=/absolute/qa-output node desktop-pet/scripts/smoke-codex-pets.js
git diff --check
```

第三条创建临时素材及隔离设置目录，实际启动两个源码 Electron 进程；覆盖 30 条搜索/滚动、760×580 窗口、九类动作、六档尺寸双向同步、导入失败、临时/启动保存、聊天同步、来源移除后的退出重启。真实本机五套 WebP（v1×1、v2×4）另经只读原生验证：每套三行动画推进，选择一套复制到隔离数据并校验桌面/聊天；未修改真实 Codex 来源或正式 App 设置。

全量 Node 检查 1,417/1,417 通过；既有球球原生定制回归、上述源码原生流程及 `git diff --check` 通过。实际截图/报告记录在本地验收 README，不提交私人素材或截图。`nativeImage` 只用于 PNG 检查，WebP 使用容器校验及 Chromium 解码，参见 [Electron 格式说明](https://www.electronjs.org/docs/latest/api/native-image#supported-formats)。

## 整合与待确认

- 与主题分支可能冲突于 `main.js` 的尺寸/启动广播、定制页 HTML/renderer/CSS、桌面 renderer 及聊天头像。合并时保留主题变量；本分支没有新增主题选择器。
- 打包白名单新增 `codex-pets.css`、两个通用 lib 与原生验证 helper；勿把用户 Codex 素材目录复制进安装包。
- 合并后需在最终安装包复验导入、重启、副本库、头像及六档尺寸，并由用户确认实际外观。源码原生检查不等于打包或安装验收。
- 范围为本机自定义宠物；Codex 内置宠物未接入。v2 的额外两行注视动作未单独开放；人物沿用自己的九类动画，不支持球球专属的轮廓/五官编辑。
