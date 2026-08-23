# L2/L4 证据:两仓聚焦回归与产物核对(2026-08-23,主控会话亲跑复核)

## dispatch 仓 dsh-plugin(0.1.2 发布物)

- `npm test`:exit 0,11/11(Electron-as-Node,pretest 重跑 seed-vendor:上游 prebuild 缓存命中、锚点补丁、**真实加载 darwin-arm64 新布局二进制**)。
- 双平台二进制魔数亲验:`darwin-arm64/better_sqlite3.node` 头 4 字节 `cffaedfe`(Mach-O),`win32-x64/better_sqlite3.node` 头 `4d5a`(PE/MZ)。
- `database.js:48` 已补丁为 `require(path.join(__dirname,'..','build','Release',process.platform+'-'+process.arch,'better_sqlite3.node'))`,全文件 0 处 `require('bindings')`。
- `aiwaretop-dsh-dispatch-0.1.2.tgz`:39 文件,两份二进制入包,bindings/file-uri-to-path 不再入包;npm publish 后 `npm view` 确认 0.1.2 上架 npmjs。

## dsh-buddy 仓(消费 0.1.2)

- `npm_config_registry=https://registry.npmjs.org node scripts/build-web-profile.js`:exit 0。
- `node scripts/verify-profile-tar.js build/web-profile.tar.gz`:**PROFILE ASSERT PASS: entries=15186 links=12 binaries=26**——`singlePlatformExemption` 豁免机制已删除,dispatch 走标准双平台覆盖断言。
- `tar -tzf build/web-profile.tar.gz | grep -c better_sqlite3.node` = **2**(darwin-arm64 与 win32-x64 各一)。
- `npm test` 380/380(1 既有 skip)、`node scripts/verify-bundled-profile.js .` SMOKE PASS——均为主控会话独立复跑。
