# 受限离线任务插件安装器

2026-10-31。仅实现模块及自有临时目录验证；本Agent没有读取原用户配置、聊天、独立凭据文件，未安装到真实用户工具，未发模型消息。主Agent另行控制安装用途授权、真实安装和验收。

## 接口

`createManagedPluginInstaller({provider,directoryAccess,getMarketplaceDirectory,assertHostStopped,now,onChange})`：provider仅workbuddy或zcode；默认无IO。directoryAccess必须是主进程独立安装用途授权，并在每次inspect/install期间以`withAccess(provider, operation)`包住访问。不能默认复用读取任务用途。assertHostStopped为必传回调；安装读原配置前及每次提交前都必须确认目标工具已退出，false即HOST_RUNNING，保留聊天连接。inspect只读不要求工具退出。

`install({approved:true,signal})`：当次明确同意后，只处理固定球球市场及固定插件。`inspect()`只检查固定插件库存、自己缓存/市场与对应启用字段，不读独立auth文件、不加载其他插件代码。`getState()`只给安全状态、中文message、代码和安装阶段，不含路径、配置、token或原字段内容。

内部状态：idle/not-installed/needs-authorization/working/staged/committing/installed-configured/unavailable/cancelled。主Runtime可投影为UI的idle/checking/installing/installed/blocked/error。只有installed-configured且enabled表示安装配置齐备，`eventVerified`恒false、`requiresNewSession`恒true；真正接通必须等主接收器收到原工具新任务事件。

## 真实官方schema互验

先使用官方CodeBuddy2.179.0、固定公开ZCode3.17.1源码构建CLI，在合成HOME/host下完成官方marketplace add/install，原用户.workbuddy/.codebuddy/.zcode及Keychains禁止读，外网禁止，仅WorkBuddy启动所需localhost通讯放行。安装source采用球球生产生成形态的四个固定资产+receiver，不含额外文档。然后由本模块迁移，再由两家官方CLI的list和marketplace/catalog真实加载。两家均列出enabled球球插件与市场，非仅手写schema对照。

WorkBuddy已核5.9.3系列库存契约：`plugins/known_marketplaces.json`是无version的市场名→记录映射；`plugins/installed_plugins.json`是version2、plugins按id→user scope记录数组；`settings.json`的`enabledPlugins[id]`。只接受同ID唯一user记录、固定版本和预期缓存位置。

ZCode已核3.16.3/3.17.1契约：`cli/plugins/known_marketplaces.json`是version1+marketplaces数组；installed_plugins是version1+plugins数组；`cli/config.json`的`plugins.enabledPlugins[id]`。官方catalog缓存必须有`marketplaces/<id>/marketplace.json`，不能只复制源头.claude-plugin文件。原官方cacheTransactionId及其他字段保持不变。

两家稳定本地source放`<plugins-root>/qiuqiu-managed-sources/<market>`；ZCode官方catalog snapshot另放`marketplaces/<market>`，installed plugin放官方`cache/<market>/<plugin>/<version>`。避免原工具长期指向球球私有沙盒容器或临时stage。

## 约束与故障行为

- 不调用完整CLI、不启动子进程、不请求网络、不发送模型消息，不接受任意包名、命令、下载源。所有静态资产以固定SHA256核对，receiver仅允许固定127.0.0.1端点及严格能力schema。
- 只受控迁移source等于当前球球预备marketplace绝对路径或当前受管理路径的同名市场；同ID不同来源、不同代码、不同版本、额外scope或额外未知缓存文件均拒绝，不覆盖。
- 严格JSON span parser保留所有无关值的原始字节，包含未知设置、大整数、转义与格式；只补我们记录和启用键。配置可能包含其他设置，但不会解析其值/输出到状态或上报。损坏、重复key、未知schema、链接、大小/深度异常均停止。
- Darwin授权目录内固定专用lockfile以O_EXLOCK(0x20)|O_NONBLOCK|O_NOFOLLOW持有，finally关fd且不unlink；进程退出后OS自动释放，旧空lockfile不会阻塞重试。非Darwin写安装failclosed为PLATFORM_UNSUPPORTED。先stage全部内容，再对所有基线作摘要比较；每文件提交前再次比较，提交后验证，abort前后检查。异常只在目标仍等于本次写入时恢复本次旧值；并发更新保留并报ROLLBACK_INCOMPLETE，不声称成功。新目录只在全部文件仍等于本次内容时移除。
- **并发边界**：安装必须由主Runtime证明原工具已退出；首次读取metadata前及每次提交前都等待该门禁，等待后再查abort、源文件摘要、safePath与CAS，工具重新出现则回滚。Node的摘要比较与rename仍不是OS原子CAS，本模块锁只控制球球安装器，不能阻止任意不遵守门禁的第三方写配置；已观察到的并发修改拒绝或保留，不声称对恶意外部writer绝对原子。
- 仅检查库存schema，不额外要求选择.app包；未知格式直接blocked。已核版本格式不等于所有未来版本支持。
- 官方输出说明安装/启用后需`/reload-plugins`或新会话；球球不自动重启原软件或动已有任务，用户正常新建任务即可观察事件。

23项定向测试：固定源/无外联路径、原字段保留、双家schema、安装/inspect/idempotent、明确启用已停用项、同名冲突、损坏JSON/duplicate/version、symlink、并发CAS、失败/abort rollback、保留并发新值、真实手工旧source迁移、独立授权及原型名拒绝、必传host门禁/运行中阻止/中途重开回滚/异步等待后取消和源变化、Darwin锁互斥/释放、非Darwin拒绝。无App源码整合/真正MAS运行结论。结构化回执见同名JSON；临时官方互验日志在`/tmp/qiuqiu-managed-installer-official-interop.log`。
