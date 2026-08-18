> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# Anchored 预设相位化开放 prompt section 与插件发现的验收

- 修订：6
- 关键符号：`sealSectionsUntilPromotion`、`extraIndex`、`installBundledPresets`、`createEpochPromotion`
- 资产指纹：`sha256:ba28db8870be28e62658ca8b1b7f0b6312959ebf6baf83e4b05d6d009dcf5de9`
- 关联方案：`docs/plans/anchored-phased-prompt.json`

## 验收目标

让 Anchored Standard 预设在保持首轮请求 Minimal 逐字节精确的前提下，锚定建立后开放全部 prompt section 与常规注入，插件工具可被发现和解锁，且修复经指纹化同步到达存量用户。

## 验收标准

### `c1` 批1-3 模块单测全过（tool-bootstrap 相位矩阵、dev-tool-search extraIndex、bundled-presets 指纹三分支）

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/anchored-phased-prompt/batch1-3-node-test.txt`

### `c2` 首轮请求 system 与改造前逐字节等值（字节等值单测断言）

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/anchored-phased-prompt/batch1-node-test.txt`

### `c3` 真实会话日志取证：第 1 请求单行 persona 不变，第 2 请求起 system 含治理段，harness_plan_* 可解锁并产生工具事件

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/anchored-phased-prompt/batch4-real-link.md`、`docs/acceptance/evidence/anchored-phased-prompt/real-session.jsonl`

### `c4` 用户可见层：plan create 弹原生确认卡、PlanBubble 出现，用户确认

- 状态：passed
- 类型：user_acceptance
- 层级：L5
- 证据：`docs/acceptance/evidence/anchored-phased-prompt/batch4-real-link.md`、`docs/acceptance/evidence/anchored-phased-prompt/user-session-aiot.jsonl`、`docs/acceptance/evidence/anchored-phased-prompt/ui-fix-popover-hover.png`
