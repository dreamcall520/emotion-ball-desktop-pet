# 高清本地伙伴导入

基线：`1dcdbf8`。隔离分支：`feature/chuge-hd-import`。仅源码候选；未安装、未覆盖用户配置、未发布。

## 原问题与结果

旧版仅接受 1536×1872（9 行）或1536×2288（11 行），播放器始终绘制到192×208的画布，再用CSS放大。即使用户选择260px，原始细节也只有208px高。

本次允许原格式的1、2、3倍等比例图集，不增加pet.json字段；倍率从实际图片尺寸推导。PNG/WebP均适用，8列与9/11行动作布局、逐帧时长保持。旧包与内容编号保持兼容。

| 倍率 | 9行图集 | 11行图集 | 单帧 |
| --- | --- | --- | --- |
| 1 | 1536×1872 | 1536×2288 | 192×208 |
| 2 | 3072×3744 | 3072×4576 | 384×416 |
| 3 | 4608×5616 | 4608×6864 | 576×624 |

播放器把完整原生帧直接绘制到同尺寸canvas，再以CSS设置逻辑尺寸，避免先降到192×208。原生画布不会随DPR变化丢弃细节；624px高单帧可覆盖当前最大260px桌面及300px预览的2×屏幕。3×屏幕最大档需要780/900px高素材，超出本次素材范围，不能承诺无损；2倍源也不足以覆盖2×屏幕最大档。

只接受整数倍率1/2/3、宽高同倍率、既定行列。压缩文件上限仍16 MiB，未放宽路径、符号链接、格式、完整性、真实解码与会话失效拦截。最大允许11行3倍共31,629,312像素，单张完整RGBA解码约120.7 MiB；单个3倍canvas约1.37 MiB。实际资产的内存和流畅度还需随交付包验证。把低清图放大不等于增加原始细节。

## 检查

- 修改前：原有store/player 16项通过；新增高清导入及播放测试在旧代码上出现「宠物精灵图尺寸不合法」「error != ready」「208 != 624」，证据见 `red.tap`。
- 原生矩阵在旧代码上同样拒绝3倍图集，见 `native-red.tap`。
- store/player单测覆盖6种倍率/行数、九动作精确裁帧、六档尺寸及300px预览、DPR变化、旧包重载；拒绝分数、过大和宽高不一致倍率。
- `local-pets-native.test.js` 在独立临时profile与隐藏Chromium里执行真实main.js导入回调，检查PNG/WebP×9/11行×1/2/3倍共12种；实际播放器在2×DPR下保留原生画布且输出非空像素，损坏压缩数据仍被拒绝。
- `customize-local-pets-dom.test.js` 使用真实定制页DOM和播放器，检查导入、预览、保存以及说明。
- 实际楚哥素材、最终ASAR、用户视觉接受尚待主任务验证；单色合成fixture不代表楚哥动作或画质已验收。

## 本轮结果

`node --test --test-concurrency=1 desktop-pet/tests/*.test.js`：2344项通过，0失败/0跳过，约52秒。完整输出见 `full.tap`。其中store/player针对20项及原生/DOM 2项均通过，见 `targeted.tap` 与 `native-green.tap`。`git diff --check` 通过。

## 独立候选App

使用现有 `desktop-pet/scripts/package-mac.js` 打包，仅生成本工作树 `dist/球球桌宠-darwin-arm64/球球桌宠.app`，未生成DMG。保留产品名和Bundle ID，不安装到Applications。

- `package-verification.json`：staging全部333文件与ASAR逐项回读；Packager会移除package.json的`private`字段，除此之外元数据严格相同；4项生产修改与源文件SHA256一致，ASAR内各文件完整性校验通过。
- `codesign --verify --deep --strict` 通过，签名为adhoc；未进行公证。
- `PET_LOCAL_SOURCE_ROOT=<最终app.asar> node --test desktop-pet/tests/local-pets-native.test.js` 通过，使用隐藏Chromium及临时profile实际读取最终ASAR，运行12种高清导入与原生画布检查；见 `packaged-native.tap`。
- 未正常启动候选App，当前用户已安装App/配置均未修改。

验收启动器：本工作树 `dist/开始楚哥高清验收.command`。它直接执行候选二进制并指定 `dist/楚哥高清验收数据` 独立profile，不使用`open -a`；已通过`bash -n`。请用该启动器，不要双击同名App或将其复制到Applications。启动器目前未运行；实际楚哥素材与完整用户交互由主任务继续核验。

## 真实楚哥整包保存返修与验收

完整候选App首轮验收发现 `prepareCodexAppearance` 的保存/收藏门禁仍硬编码1倍尺寸，导致3倍图可以预览但保存失败。保留首轮失败记录，没有以先前导入和播放器检查替代保存检查。

补充运行时descriptor的实际倍率，并按该倍率核验已复制素材的真实解码尺寸。回归测试在旧门禁上复现失败后通过，主进程 `main-motion.test.js` 全部231项通过（包括9/11行×1/2/3倍保存与收藏、损坏及错误尺寸拒绝）；没有把之前2344项全量结果冒充本次返修后重新执行全量。

重新打包后再次通过333文件/4项生产修改逐字节核对和adhoc deep strict签名验证，播放器与当前高清预览脚本字节一致。最终App以全新临时profile、真实楚哥素材执行 `PET_SMOKE_TEST=1 PET_SMOKE_CODEX_PETS_ONLY=1 PET_CODEX_PETS_QA_PHASE=local`，读取、三动作推进、真实隔离副本保存、启动偏好、桌宠及chat DOM同步通过，输出成功标记后code0自行退出，临时profile已删除。已安装ASAR、已安装settings.json和源素材前后SHA256保持。

完整App证据位于 `<task-workspace>/output/楚哥-20261026/高清桌宠-v3/证据/完整App验收/`，包含 `report-local.json`、`run.json`、定制页/桌宠/chat截图及 `attempt-1/` 失败证据。主Agent复跑实际素材单项另行保存。

边界：本次完整App smoke借用Codex格式素材来源页选择真实楚哥字节副本，没有自动点击「其他伙伴」的系统文件夹选择器；聊天RPC是显式mock，真实模型调用为0；没有重启进程验收。定制页与桌宠截图已复看楚哥显示正常，chat DOM为楚哥canvas ready，但chat原生截图仍显示初始球球，因此聊天最终可见视觉未确认，不将DOM就绪作为视觉通过。
