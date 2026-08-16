> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# 发布基础设施(更新检查 + dsh 追新兼容 CI)验收

- 修订：8
- 关键符号：`checkForUpdate`、`lastNotifiedVersion`、`verify-dsh-compat`
- 资产指纹：`sha256:43990ec3bf2b8c17265eab14699303ce20e103173d25f018c41a6df66f219241`
- 关联方案：`docs/plans/release-infrastructure.json`

## 验收目标

启动更新检查非阻塞、可节流、可去重且失败静默;dsh 追新兼容验证脚本与每日 CI 能对新 rc 逐项取证并只报告不改版本

## 验收标准

### `c1` 更新检查纯逻辑(版本解析比较、24 小时节流、同版本去重)冒烟全绿

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/release-infrastructure/c1-update-check-pure.txt`

### `c2` 更新检查 IO 编排覆盖节流/尚未发布/不可达/通知/去重五个具名结果

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/release-infrastructure/c2-update-check-io.txt`

### `c3` 真实启动壳:更新检查不阻塞启动链且无弹窗

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/release-infrastructure/c3-shell-boot-update-check.txt`

### `c4` 启动链重构后内嵌 dsh 入口解析与 HTTP 就绪等待不回归

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/release-infrastructure/c4-startup-chain-no-regression.txt`

### `c5` dsh-compat workflow YAML 语法与最小权限契约成立

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`docs/acceptance/evidence/release-infrastructure/c5-workflow-yaml-contract.txt`

### `c6` verify-dsh-compat.js 本机对 0.1.0-rc.6 四项全绿且退出码 0

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/release-infrastructure/c6-verify-dsh-compat-run.txt`
