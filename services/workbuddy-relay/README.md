# WorkBuddy OAuth 服务端 Broker

独立 Node.js 22+ 模块，无自动部署、监听端口、建应用、真实请求或消息发送。测试仅使用合成凭据：

```sh
node --test services/workbuddy-relay/test/oauth-broker.test.js
```

`oauth-broker.js` 导出 `configuration(env)`、`createOAuthBroker(options)`。环境配置必须包含 `WORKBUDDY_CLIENT_ID`、`WORKBUDDY_CLIENT_SECRET`、`WORKBUDDY_REDIRECT_URI`。回调必须是本人控制并在平台登记的 HTTPS 地址，禁止用户信息、端口、query、hash；未配置时失败关闭。没有预置或假造服务域名。域名与应用审核未落实前只能执行mock测试。

```js
const broker = createOAuthBroker({
  config: configuration(process.env),
  tokenStore, // async get(key), set(key, record), delete(key)
  fetch, clock: Date.now, random, // random optional，默认crypto随机32字节
});
const { authorizationUrl, expiresAt } = broker.beginAuthorization(bindingId, scopes);
await broker.handleCallback(bindingId, callbackURL); // 返回connected/scopes/expiresAt，无凭据
const tokenPort = {
  getAccessToken: options => broker.getAccessToken(bindingId, options)
}; // 仅同一可信服务端进程注入OpenAPI client
await broker.revoke(bindingId);
```

bindingId 必须由已认证的球球服务端会话映射得到，16–200位ASCII字母数字下划线或短横线，不能直接信任HTTP用户给的账号key。每次授权state绑定此ID、默认5分钟、单次消费；完整回调严格匹配scheme/host/path并拒绝重复state/code。成功只投影安全连接状态。若HTTP callback没有原会话Cookie，router应通过自己的安全一次性设备绑定记录恢复bindingId，再传入broker；不可按未校验query自选用户。

`getAccessToken(bindingId,{requiredScopes,signal,forceRefresh})` 返回 `{accessToken,scopes,expiresAt}`，仅供服务端内部使用，绝不序列化为桌面HTTP响应。signal已取消或等待结束后取消不发布票据；共享刷新的网络请求不因单个调用方取消而中断。刷新按用户singleflight，使用真实expires_in，提前30秒续期；没有自动无限重试。revoke删除本地授权记录并令待回调/刷新失效，不代表调用了平台令牌撤销API（当前公开契约未提供该接口）。

## 部署前必须补齐

- 已获批的WorkBuddy应用及四个按需scopes；本人控制的HTTPS域名、TLS、准确回调登记。
- HTTP router自身的认证、设备绑定、CSRF、请求限制和安全响应；broker不是可公开访问的完整服务。
- 生产tokenStore：加密、权限隔离、备份恢复和密钥管理。record含accessToken/refreshToken，不能用普通JSON文件或日志存储。本模块刻意无默认持久store，避免悄悄落盘凭据；测试Map只用于mock。
- 单实例/粘性路由：state与singleflight当前仅进程内；重启会使未完成授权失效，多实例部署必须外置原子state消费及刷新互斥后再启用。
- 禁止记录callback query、授权code、state、secret、token、请求体、原始provider异常或响应。只输出固定错误code；HTTP响应也不能包含内部tokenPort输出。
- secret只在服务端环境/密钥管理注入，不写入desktop-pet、renderer、安装包、Git或部署示例真实值。不要在CLI命令行传真实密钥。

换票/刷新仅向固定官方HTTPS token端点POST，redirect manual且拒绝3xx；超时覆盖响应体，限制64KiB；错误不带原始响应。真实回调、平台审核、真实授权、部署和端到端聊天均尚未验收。公开契约详见 `../../docs/mac-app-store/workbuddy-openapi-contract.md`。

## 加密存储适配器

`encrypted-store.js` 的 `createEncryptedStore({directory,keyBase64})` 提供相同 async get/set/delete 接口，可存任意JSON记录。directory必须显式绝对路径；keyBase64必须为32字节规范Base64密钥，由服务端环境/密钥管理注入，无默认值。tokenStore和设备/幂等ledgerStore务必使用不同目录与实例；不在桌面生成或持有此密钥。磁盘采用AES-256-GCM、随机IV、opaque key作为AAD，目录700文件600、临时文件原子替换。Key丢失则不可恢复旧记录；生产部署仍需备份密钥和密文、隔离目录及运维权限。

`getConnectionState(bindingId)` 只读存储并返回 `{connected,scopes,expiresAt}`，不刷新且不返回任何票据。connected表示存在授权记录；访问票据过期时仍可能通过refresh_token续期，并非已经验证当前上游可调用。未连接时scopes为空、expiresAt为null。
