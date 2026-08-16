> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# 内嵌 dsh(零依赖分发)验收

- 修订：7
- 关键符号：`resolveEmbeddedEntry`、`ELECTRON_RUN_AS_NODE`、`asarUnpack`
- 资产指纹：`sha256:bd110aae84913e8b4b145299372cf6ece5c25b105ea891fe74cdda6ab48b7a6e`
- 关联方案：`docs/plans/embedded-dsh-zero-dependency.json`

## 验收目标

验证 DSH Buddy 在无 Node 环境零依赖运行,且四级启动器解析、进程回收与复用语义全部符合方案约定。

## 验收标准

### `c1` 开发态内嵌启动:npm start 走 launcher=embedded 并加载 UI

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/2026-08-16-embedded-dsh-verification.md`

### `c2` 打包态零依赖:.app 在 node/npm/npx 全空的环境下启动并加载 UI

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/2026-08-16-embedded-dsh-verification.md`

### `c3` 进程回收:四级启动路径退出后端口释放、零孤儿进程

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/2026-08-16-embedded-dsh-verification.md`

### `c4` 复用不破坏:外部 dsh 不重复拉起、app 退出不误杀

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/2026-08-16-embedded-dsh-verification.md`

### `c5` 回归:env 覆盖与 npx 回退路径启动、加载、回收正常

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/2026-08-16-embedded-dsh-verification.md`
