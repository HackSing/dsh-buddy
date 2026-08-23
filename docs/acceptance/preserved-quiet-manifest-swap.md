> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# preserved 弹窗降噪与清单换血验收

- 修订：2
- 关键符号：`profileUpgradeDecision`、`preserved-current`、`retiredPackages`
- 资产指纹：`sha256:30d5747455388a2d81c00b7c7221202307c7996dedc0f5f8971070215b4f8f96`
- 关联方案：`docs/plans/preserved-quiet-manifest-swap.json`

## 验收目标

验证 preserved/preserved-current 五态判定、file: 开发覆盖、retired 存量清退与 dispatch 预装换血在测试层、构建产物层与真实装载层全部成立

## 验收标准

### `c1` 判定层与热更链聚焦回归全绿(npm test + verify-bundled-profile 含五态/retired/file:/迁移用例)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/preserved-quiet-manifest-swap/l2-regression.md`

### `c2` 构建产物换血核对(web-profile.tar.gz 含 dispatch 58 条目、task-board 0 条目)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/preserved-quiet-manifest-swap/l4-build-tar.md`

### `c3` 真实装载与开发机判定(Electron ABI 拉起 dsh:SSE/task:list/app:status 全通;真实 profile 判定 up-to-date)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/preserved-quiet-manifest-swap/l3-load-and-devcheck.md`
