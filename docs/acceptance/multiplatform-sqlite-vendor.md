> 状态：有效（待验收）
<!-- docs-harness:acceptance-document/v1 -->

# dispatch 多平台 sqlite vendor 验收

- 修订：4
- 关键符号：`seedNativeAddons`、`patchDatabaseJs`、`platformDirs`
- 资产指纹：`sha256:5de007e7e914da2f55750e1ec6747021ddbe955aa3faa203a11a986a4f97c4ab`
- 关联方案：`docs/plans/multiplatform-sqlite-vendor.json`

## 验收目标

验证 dispatch 插件多平台 sqlite vendor 在测试层、包/产物层、macOS 运行层与 Windows CI 装载层全部成立

## 验收标准

### `c1` 两仓聚焦回归全绿(dsh-plugin Electron-as-Node 11 例真实加载 darwin 新布局;dsh-buddy npm test + verify-bundled-profile)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/multiplatform-sqlite-vendor/l2-l4-build.md`

### `c2` 产物核对(0.1.2 tgz 双平台二进制+魔数;profile tar 门禁无豁免 PASS,sqlite 二进制恰好两份)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/multiplatform-sqlite-vendor/l2-l4-build.md`

### `c3` macOS 真实装载(临时 DSH_HOME + Electron 拉起,SSE/task:list 通,app:status 返回 0.1.2)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/multiplatform-sqlite-vendor/l3-load-mac.md`

### `c4` Windows CI 装载 smoke(release.yml windows job 在真实 win32-x64 runner 上加载 vendored sqlite 并读写内存库,输出 WIN32 SQLITE LOAD OK)

- 状态：pending
- 类型：behavior_acceptance
- 层级：L4
- 证据：尚无
