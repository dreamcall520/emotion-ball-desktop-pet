# 天气独立验收版实施计划

Goal: 按v8确认稿交付独立验收App，正式额度卡与云朵皮肤保持。
Architecture: 独立天气数据服务、窗口控制器与渲染页面；复用现有定位布局/主题/打包。独立profile存储weather.json，不读取正式账号或覆盖设置。
Tech Stack: Electron 43 / Node / 原生HTML CSS SVG / Open-Meteo。

- [ ] 数据：城市搜索、当前/逐小时/七天/AQI，30分钟缓存与并发去重，失败明确标注，按城市时区显示。
- [ ] UI：真实额度卡材质；收起128×32流光，展开无流光；今天/七天；竖区间/横双折线；选城/定位/刷新。
- [ ] 控制器：独立weather.json，IPC来源验证、经纬度边界校验、切城隔离、锁屏/睡眠/隐藏与恢复、跟随宠物且避让其他卡。
- [ ] 天气互动：只叠加云朵天气效果，保留原形态；AQI标准明确；常规/贴边提醒与聊天相关语境共用有效天气，去重冷却。
- [ ] 验证：数据/控制器/渲染定向检查、现有测试；最终包运行资源核验、签名与独立profile启动；截图视觉待用户验收。
- [ ] 打包：球球桌宠-天气验收，独立bundle id与userData，不替换Applications正式版、不发布。

涉及文件：lib/weather-service.js、lib/weather-window.js、weather.html/css/renderer/preload、lib/weather-pet-effects.js、main.js、renderer.js、preload.js、index.html、pet.css、scripts/package-weather-acceptance.js、package-mac.js清单、tests/weather-*.test.js。保持现有额度卡实现不变。

数据源边界：Open-Meteo免费服务仅非商用；本轮私人验收，不作为商业发布授权。macOS定位受系统权限/提供者可用性影响；拒绝或失败后手动选城，不使用IP冒充当前位置。
