> 状态：已实施-仅追溯（代码已是真源，2026-08-23 核对）
<!-- docs-harness:plan-document/v1 -->

# dispatch vendored sqlite 多平台化,解除 Windows 挂账

- 冻结合同：`sha256:e804d20d090c9b1a98a0a3c87887d3c58dd4910fb10ecb1c3811db0aa3b443d8`
- 关键符号：`seedNativeAddons`、`patchDatabaseJs`、`platformDirs`、`PREBUILD_TARGETS`

## 背景

docs/plans/preserved-quiet-manifest-swap 落地时,@aiwaretop/dsh-dispatch vendor 的 better_sqlite3.node 仅有构建机(darwin-arm64)一份 Electron-ABI 二进制,Windows 版 dsh-buddy 的 dispatch 插件装载失败降级 runtime-unavailable,当时按『macOS 先行』挂账并在 verify-profile-tar 加了 singlePlatformExemption 豁免。用户现要求解除挂账。已钉死事实:better-sqlite3 12.11.1,两仓 Electron 38.8.6(ABI 139 实测),上游 WiseLibs releases 对 electron-v139 的 darwin-arm64 与 win32-x64 官方 prebuild 均存在;vendored database.js 的 bindings 加载行可精确锚点替换。

## 目标

dispatch 插件的 npm 包携带 darwin-arm64 与 win32-x64 两份官方 Electron-ABI prebuild 并按 process.platform-arch 运行时选择;dsh-buddy 预装清单消费 0.1.2;verify-profile-tar 豁免机制删除,dispatch 回归标准双平台覆盖断言;release.yml windows job 新增 sqlite 装载 smoke,把 Windows 可用性从推断变为 CI 实证。

## 非目标

不改 dispatch core 的 db API(nativeBinding 选项不启用,补丁收敛在 seed-vendor 分发层);不支持 macOS x64 / Linux(不在发布目标);不做 prebuild 的 sha256 固定(上游 release 走 TLS + 魔数断言);不回收存量 0.1.1 安装(channel/整包升级自然覆盖)。

## 成功标准

1) dsh-plugin npm test 在 Electron-as-Node 下全绿且真实加载 darwin 新布局;2) 0.1.2 tgz 含双平台二进制、不含 bindings;3) dsh-buddy profile tar 门禁在无豁免下 PASS 且 sqlite 二进制恰好两份;4) macOS 真实装载 app:status 返回 0.1.2;5) release.yml windows job 的 sqlite smoke 在真实 Windows runner 上输出 WIN32 SQLITE LOAD OK;6) 两仓既有测试无回归。

## 执行范围

dispatch 仓 dsh-plugin/:scripts/seed-vendor.mjs(多平台下载/落位/魔数断言/锚点补丁)、scripts/verify-package.mjs、package.json(0.1.2)。dsh-buddy 仓:plugins/preinstall-manifest.json(0.1.2 + comment 改写)、scripts/verify-profile-tar.js(删豁免机制,dispatch 标准双平台条目)、.github/workflows/release.yml(windows job smoke step)。npm publish 0.1.2 由用户人工执行(已完成)。

## 执行内容

seed-vendor:PREBUILD_TARGETS 数据驱动(平台×魔数),version 取父仓 better-sqlite3/package.json,ABI 用 ELECTRON_RUN_AS_NODE=1 electron -p process.versions.modules 运行时推导,下载缓存于父仓 node_modules/.cache/bs3-prebuilds(离线可复跑),解出 build/Release/better_sqlite3.node 落位 build/Release/<platform-arch>/,魔数不符删文件抛错;patchDatabaseJs 对 database.js 的 bindings 加载行做精确字符串替换(锚点未命中抛错要求人工重验);bindings/file-uri-to-path 移出 vendor。verify-package 断言双二进制与补丁形态。dsh-buddy:manifest 0.1.2;verify-profile-tar 删 singlePlatformExemption(机制+条目),dispatch 标准条目 platformDirs 指向 Release/<平台>/;release.yml windows job(defaults shell bash)在打包前解出 vendored better-sqlite3 子树,electron.exe ELECTRON_RUN_AS_NODE 建内存库读写断言。

## 验收方案

L2:两仓聚焦测试(dsh-plugin Electron-as-Node 11 例;dsh-buddy npm test + verify-bundled-profile)。L4:tgz 双二进制+魔数亲验;profile tar 门禁无豁免 PASS;Windows CI smoke(发版流水线 windows job,真实 win32-x64 runner 加载并读写内存库)。L3:macOS 临时 DSH_HOME 真实拉起,SSE/task:list/app:status 实证 0.1.2。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

unchanged

## 约束

Kimi CLI 分批执行、主控会话逐批亲手复核;npm publish 人工门已由用户完成;Windows 证据只能由 tag 触发的 release 流水线产生,acceptance 的该条 criterion 在流水线绿后补记再结项。

## 风险与回滚

上游 prebuild 与本仓 Electron ABI 升级不同步时 seed-vendor 硬失败(下载 404),届时按锚点纪律人工重验;better-sqlite3 升级改动加载行时锚点补丁抛错,不会静默出错包。回滚:manifest 钉回 0.1.1 即恢复挂账态;npm 0.1.2 不可撤但可再发补丁版。

## 源与目标

源:vendor 单一 darwin-arm64 二进制 + bindings 动态解析 + verify-profile-tar singlePlatformExemption 豁免。目标:vendor 双平台官方 prebuild + 锚点补丁按 platform-arch 直拼 + 标准双平台断言 + Windows CI 装载实证。

## 版本与产物

@aiwaretop/dsh-dispatch@0.1.2(npmjs);dsh-buddy v0.4.3(计划);build/web-profile.tar.gz(binaries=26,sqlite 二进制 2 份);plugin-channel 待 v0.4.3 发布后重建(registry latest 已是 0.1.2)。

## 兼容与灰度

发布顺序沿用 v0.4.2 纪律:先应用后 channel。存量 0.1.1 profile:bundled 路径按版本落后判 upgrade 整目录替换;channel 路径 diff 出 0.1.1→0.1.2 切片更新;开发机 file: 覆盖不受影响(判满足)。老客户端无新增语义依赖,窗口期行为与 v0.4.2 相同。

## 数据安全

所有验证在隔离/临时 DSH_HOME;seed-vendor 只写 vendor/ 与父仓 node_modules/.cache;魔数断言防错平台二进制出包;安装侧仍有 staging+备份+原子 rename 链路,未改动。

## 监控与停止条件

观察点:release run 的 windows smoke step 输出、macOS/Windows 用户端 dispatch 面板可用性。停止条件:windows smoke FAIL 即停发版(tag 不推进 channel),按锚点/ABI 排查;用户端出现 darwin 回归立即回退 manifest 版本重发。

## 回滚

应用层 electron-updater 可退上一 Release;manifest 单文件 revert;vendor 布局变更只影响 0.1.2 包,0.1.1 仍在 registry 可钉回;profile 整目录备份机制未变,用户侧可手工恢复。

## 交付层分离

L1 契约:verify-package/verify-profile-tar 静态断言;L2 聚焦测试:两仓套件;L3 本地运行:macOS 真实装载 0.1.2;L4 包/安装:tgz 与 profile tar 核对 + Windows CI smoke(真实 win32 runner);L5 用户可见:Windows 用户 dispatch 面板可用性待真实用户反馈,不以 CI 层替代。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/multiplatform-sqlite-vendor.json`
- 需要 Acceptance：true
- Knowledge 影响：unchanged
<!-- docs-harness:plan-governance:end -->
