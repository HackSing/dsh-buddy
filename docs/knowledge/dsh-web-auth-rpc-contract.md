> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# dsh web 的浏览器授权门与 host API RPC 端点契约(0.1.5-rc.1 实证)

- 修订：1
- 关键符号：`launchTokenFrom`、`exchangeAuthCookie`、`AUTH_COOKIE_PREFIX`、`postSessionList`
- 资产指纹：`sha256:40d9e1263eccadf7a4fe2b9c6459244ae6b2c2eb9c7bf2afb1d7538397c6804e`

## 摘要

dsh 0.1.5-rc.1 的 web 对裸 / 与 /api/* 一律 401,只认 launch token 换出的 dsh-auth cookie;unary RPC 端点是两段斜杠且 payload 必须是单字段 args——壳与门禁消费这两条契约的单一来源是 lib/dsh-browser-auth.js 与 lib/session-titles.js

## 事实

### `auth.token-cookie-exchange`

授权流三步(上游 @deepseek-ai/dsh-client-connection 的 BrowserAuth):dsh web 启动结算后打印一行 `dsh web: <url>?token=<launch token>`(开 LAN 时后面还跟 ` (LAN: <url>)`,同前缀另有一行非 URL 的 opening the default browser 提示);GET /?token=X 回 303 + set-cookie `dsh-auth-<签名的 authority>`,并跳到干净的 /;之后 GET / 与 POST /api/* 只认该 cookie,没有就是 401。本机 0.1.5-rc.1 实测:裸 / = 401,带 token 的 / = 303,带 cookie 的 / = 200

证据：`lib/dsh-browser-auth.js`、`test/dsh-browser-auth.test.mjs`

### `auth.no-off-switch`

授权门没有关闭开关:client-connection 的 Config 只有 recovery/trustedHosts/cookieMaxAgeDays/maxRequestBodyBytes,没有 disable 项;cookie 值由 DSH_HOME credentials 里的持久密钥签发,壳无法自行伪造。launch token 只存在于 dsh 进程内存(PROCESS_LAUNCH_TOKENS WeakMap),不落盘——因此壳复用外部 dsh 时拿不到 token,只能依赖 Electron 会话里上次留下的 cookie(默认 30 天,按 authority 绑定)

证据：`lib/dsh-browser-auth.js`、`main.js`

### `auth.token-is-the-readiness-signal`

token 行在插件装载结算(loader.await)之后才打印,因此它同时是「UI 真能用」的就绪信号;HTTP 端口在此之前就会应答——clean DSH_HOME 实测首次可连为 404 @6.33s、token @6.38s,而用户真实 profile 里若有插件装载失败则端口 404 可连但 token 永不出现。只看「端口能应答」会让壳在 dsh 没装载完时就切页面,所以壳与门禁都以 token 为主判据、HTTP 探活只作回落

证据：`main.js`、`scripts/verify-dsh-compat.js`

### `rpc.endpoint-shape`

unary RPC 端点是 POST /api/<namespace>/<method>,method 字段必须与路径尾段一致且恰为两段(api-gateway 的 claimsEndpoint 要求 segments.length===2),payload 必须是恰含一个 args 字段的对象、args 内按 typert 参数 wire 名索引实参。0.1.1-rc.2 的点号形状 session.list 在 rc.5 回 404,payload {} 回 gateway/arguments-invalid(missing "_request");正确形状是 POST /api/session/list + method session/list + payload {args:{_request:{}}},返回 200 + result.ok/result.value.items(SessionListValue 的投影形状未变)

证据：`lib/session-titles.js`、`test/session-titles.test.mjs`

### `plugin.peer-resolves-to-host-tree`

rc.5 把一大批 @deepseek-ai 包从 dependencies 挪成 peerDependencies,而插件 profile 的 pnpm-workspace.yaml 固定 nodeLinker: hoisted + autoInstallPeers: false,profile 的 node_modules 永远不含 @deepseek-ai/*——插件里的 import '@deepseek-ai/xxx' 实际解析到宿主树。因此预装插件(含其 client 半边)需要的每个 @deepseek-ai 包都必须在本仓 package.json 显式钉版,否则装载报 Cannot find package;核对方法是把插件 tarball 里所有 @deepseek-ai import 与宿主 node_modules 求差

证据：`package.json`、`plugins/preinstall-manifest.json`

### `plugin.removed-export-kills-boot`

rc.5 删除了 @deepseek-ai/dsh-settings 的 installSettingsSection/settingsNamespace 导出,替代是 settings 服务的方法 installSection(owner, ns, schema, entry, {setSource,onChange})(ns 传普通字符串,内部 parseSettingsNamespace);任一插件仍 import 旧导出时,cordis loader 以 failed to import loader entry 抛错并让 web 进程 code 1 退出——一个插件的导入失败会带崩整个启动,不是只禁用它自己。抬 dsh 版本前应先静态核对每个预装插件的具名导入是否仍存在于宿主包导出里

证据：`plugins/preinstall-manifest.json`、`scripts/verify-dsh-compat.js`
