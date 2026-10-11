# 球球自有反馈 API

球球官网和 App 的反馈表单共用此 Cloudflare Worker。用户无需注册、登录或跳到第三方问卷；文字和截图写入 D1。

2026-10-11 已部署 `qiuqiu-feedback` Worker 和同名 D1。经本机已配置代理，真实提交、相同内容重试、管理员鉴权、文字回读与截图逐字节下载通过；三张各1MiB图片也已远端保存并下载核验。本机绕过 HTTP 代理访问默认 `workers.dev` 地址15秒超时，改为下述 Pages 接入后健康检查、真实提交、回读、截图下载与 CORS 预检直连通过。此结果仅代表本机当次网络，不保证国内各运营商可用；证据见项目 `验收记录/意见反馈-20261011/cloudflare/`。

### 保留官网现有 DNS 的接入

`pages-gateway/` 是已部署的 `qiuqiu-feedback-entry` Pages 项目。它只通过 Service binding 转发现有 Worker，继续使用同一 D1、管理员密钥、CORS 与限流配置，不复制业务逻辑。官网/App 可直接使用 `https://qiuqiu-feedback-entry.pages.dev/api/feedback`，无需改变 `qiuqiu.pet` 现有 DNSPod NS 或 GitHub Pages 指向。

```bash
cd pages-gateway
wrangler pages deploy --project-name qiuqiu-feedback-entry --branch main
```

可选的 `feedback.qiuqiu.pet` 仅需在 Pages 控制台关联该子域名，再在 DNSPod 新增指向 `qiuqiu-feedback-entry.pages.dev` 的 CNAME。当前未关联此自有子域名，未更改官网解析；无需为反馈迁移整个域名。[官方外部 DNS 子域名说明](https://developers.cloudflare.com/pages/configuration/custom-domains/#add-a-custom-subdomain)、[Service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)。

## 本地检查

需要 Node.js 22 或更高版本及 npm；项目运行代码没有第三方依赖，Wrangler 仅用作开发和部署工具。

```bash
node --test worker.test.mjs
```

测试通过临时目录启动真实 `workerd`、D1 和原生限流绑定，检查 HTTP 提交、幂等重试、错误图片、大小限制、CORS、管理员权限、附件读取以及截图写入失败的事务回滚。测试不登录 Cloudflare，不访问远端 D1，结束后清理本次临时状态。

手工开发：

1. 在此目录创建不入库的 `.dev.vars`，设置 `ADMIN_TOKEN="仅本地测试的长随机值"` 及 `CORS_ORIGINS="http://localhost:你的官网开发端口"`。
2. 执行：

```bash
npm exec --yes --package=wrangler@4.149.0 -- wrangler d1 execute qiuqiu-feedback --local --file schema.sql
npm exec --yes --package=wrangler@4.149.0 -- wrangler dev --ip 127.0.0.1 --port 8787
```

App 应通过 Electron 主进程请求 API；无需允许来源不明确的 `Origin: null`。浏览器开发页面必须把精确来源加入 `CORS_ORIGINS`。

## Cloudflare 部署

1. 登录账号，并创建 D1 数据库：

```bash
npm exec --yes --package=wrangler@4.149.0 -- wrangler login
npm exec --yes --package=wrangler@4.149.0 -- wrangler d1 create qiuqiu-feedback
```

2. 把命令返回的真实 `database_id` 填入 `wrangler.jsonc`，将 `CORS_ORIGINS` 改为实际官网来源（如 `https://你的官网域名`，多个来源用逗号分隔，不写路径、不用 `*`）。确保 `namespace_id` 在此账号中专用于球球反馈。
3. 在密码管理器中生成并保存管理员随机密钥，然后交互设置 secret。不要把这个密钥放入官网或 App：

```bash
npm exec --yes --package=wrangler@4.149.0 -- wrangler secret put ADMIN_TOKEN
npm exec --yes --package=wrangler@4.149.0 -- wrangler d1 execute qiuqiu-feedback --remote --file schema.sql
npm exec --yes --package=wrangler@4.149.0 -- wrangler deploy
```

4. 绑定自有域名，例如 `feedback.你的域名`，并把官网/App 的 API 地址设为 `https://feedback.你的域名/api/feedback`。可在 Worker 控制台添加 Custom Domain，或在 Wrangler 配置中设置 `routes: [{ "pattern": "feedback.你的域名", "custom_domain": true }]`；确认自有域名有效后可设 `workers_dev: false`。
5. 从正式官网、正式 App 分别提交包含截图的反馈，使用管理员 API 回读文字和图片。另在国内关闭 VPN 的真实网络检查加载、提交和回读；自有域名与 Cloudflare 本身不能当作国内可达性保证。

`GET /health` 仅返回服务存活状态，不能替代提交后的 D1 回读。上线还需实际检查 Workers CPU 与请求配额，尤其是三张大截图的情况。

## 接口

`POST /api/feedback`，`Content-Type: application/json`：

```json
{
  "submissionId": "9c512dfc-568b-4ba6-a12e-56cfcc4d6155",
  "type": "problem",
  "title": "窗口偶尔无法移动",
  "detail": "具体操作步骤与预期结果……",
  "contact": "可选联系方式",
  "version": "可选 App 版本",
  "os": "可选系统信息",
  "source": "app",
  "attachments": [{ "name": "截图.png", "type": "image/png", "data": "纯base64，不含data:前缀" }]
}
```

- `type` 为 `problem`、`suggestion` 或 `feature`；`source` 为 `app` 或 `website`。
- 标题最多100字，详细说明必填且最多5000字，联系方式最多200字，版本最多80字，系统信息最多120字；字段长度使用 JavaScript `String.length`。
- 最多3张截图，每张最多1MiB（1,048,576字节），总 JSON 最多5MiB。支持 PNG、JPEG、GIF、WebP，校验 MIME、base64 和文件签名；不解码或重新编码图片。截图按受保护附件下载，不作为网页执行。
- 首次持久化成功返回 `201 {"id":"UUID"}`。同编号同内容重试返回 `200`；同编号内容改变返回 `409`。保存失败返回 `503`，客户端应保留输入及编号以便重试，禁止展示成功。
- 错误返回 `{"error":"错误标识","message":"中文说明"}`；过于频繁时 `429` 并带 `Retry-After: 60`。
- 反馈和截图通过 D1 `batch()` 一起提交；任意截图失败不会留下已成功的反馈记录。

## 查看与管理

### 私密反馈管理页

打开 `https://qiuqiu-feedback-entry.pages.dev/admin/`，输入管理员专用密码后可查看文字、分类、时间、联系方式、版本、系统和来源；截图支持预览与下载，列表按提交时间倒序并支持加载更多。

管理员密码沿用 Worker 的 `ADMIN_TOKEN`，只保存在本机 `/Users/allan/Library/Application Support/球球反馈服务/admin-token`（0600）及 Worker secret，不放入网页、App、URL或Git。页面不将密码写入 localStorage/sessionStorage；登录成功签发7天、绑定来源的 HMAC Cookie，设为 HttpOnly、Secure、SameSite=Strict。

- `POST /api/admin/session`：同源 JSON `{ "password": "管理密码" }`，通过原生限流后验证，成功返回 `{ "ok": true }` 与会话 Cookie。
- `POST /api/admin/logout`：同源 JSON `{}`，清除当前浏览器 Cookie。退出、过期及离开页面时清空已展示文字和截图 blob；签名会话本身在7天后到期，轮换 `ADMIN_TOKEN` 可令所有现有会话失效。
- 列表及附件接口同时接受 Cookie 和原有 Bearer token；管理 API 不接受跨域页面访问，未授权返回401，不提供公共截图链接。
- 页面及敏感响应均 no-store，无第三方脚本/统计，限制 CSP、禁止嵌入及索引。其他人打开页面只会看到登录框。

页面不提供删除、工单状态或邮件通知。

### 管理员接口

设置本地环境变量 `FEEDBACK_ADMIN_TOKEN` 为密码管理器中保存的密钥；示例域名需替换为实际地址。

```bash
curl --fail -H "Authorization: Bearer $FEEDBACK_ADMIN_TOKEN" 'https://feedback.你的域名/api/admin/feedback?limit=50'
curl --fail -H "Authorization: Bearer $FEEDBACK_ADMIN_TOKEN" 'https://feedback.你的域名/api/admin/feedback/反馈UUID/attachments/attachment-1.png' --output screenshot.png
```

列表返回 `{items, nextCursor}`，每次最多100条；下一页传 `cursor`（URL编码）。列表含文字及截图元信息，不含截图 base64。附件和列表都需要同一个管理员 Bearer token，没有公共截图链接。数据库管理或导出也可使用 Cloudflare D1 控制台；删除反馈时外键级联删除对应截图。

## 已知边界

- 截图 base64 单独存一行，1MiB 原图约1.4MB，低于 [D1 单行/字符串2,000,000字节上限](https://developers.cloudflare.com/d1/platform/limits/)。免费单库500MB，适合低频、小规模反馈；接近额度时需导出清理或将截图迁往对象存储。没有引入 R2 或额外付费服务。
- [原生 Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) 按 IP 在单个 Cloudflare 位置约束每60秒10次，是近似限流；共享 IP 可能共用额度，不能保证全球精确计数或抵御所有垃圾反馈。
- CORS 约束浏览器来源，无法阻止直接调用公开提交 API。管理员读取单独鉴权；日志不记录反馈内容、联系方式、图片或管理员密钥。IP 仅用作限流 key，不写入反馈表。
- 无邮箱通知、普通用户登录或工单处理状态；管理员可用私密管理页查看当前小规模反馈，也保留管理员 API 和 D1 控制台。

官方依据：[D1 batch 事务行为](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。
