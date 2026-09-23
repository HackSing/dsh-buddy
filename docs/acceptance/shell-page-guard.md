> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# 壳层页面守护:三类恢复路径与回归安全

- 修订：5
- 关键符号：`attachPageGuard`、`createReloadGovernor`、`probeBody`
- 资产指纹：`sha256:4c8a48d1717dee3a74aa3f201ddc7e72799e94a582e2899330cba90cb889c8f9`
- 关联方案：`docs/plans/shell-page-guard.json`

## 验收目标

验证壳层页面守护对渲染进程崩溃、服务代际更替的自动恢复行为,以及纯逻辑单测与既有套件回归安全

## 验收标准

### `c1` 渲染进程被 kill -9 后窗口自动恢复且事件落盘 page-guard.log

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/shell-page-guard/VERIFICATION.md`、`docs/acceptance/evidence/shell-page-guard/page-guard.log`、`docs/acceptance/evidence/shell-page-guard/c1-after-recover.png`

### `c2` dsh boot rev 变化后窗口在一个探测周期内自动刷新

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/shell-page-guard/VERIFICATION.md`、`docs/acceptance/evidence/shell-page-guard/page-guard.log`、`docs/acceptance/evidence/shell-page-guard/c2-after-genflip.png`

### `c3` page-guard 聚焦单测全绿且既有测试套件无回归

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/shell-page-guard/focused-tests.txt`、`docs/acceptance/evidence/shell-page-guard/full-suite.txt`
