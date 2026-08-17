> 状态：有效（待验收）
<!-- docs-harness:acceptance-document/v1 -->

# Docs Harness 插件化验收

- 修订：6
- 关键符号：`dsh-docs-harness`、`harnessPlan`、`plan_progress`
- 资产指纹：`sha256:d5f525771e62e17a9ef366bd90ef39f3b020e5cda3b0ed88a48c016048406820`
- 关联方案：`docs/plans/docs-harness-plugin.json`

## 验收目标

验证 dsh-docs-harness 插件与 dsh-buddy 集成满足 docs/plans/docs-harness-plugin.json 的成功标准：双闸激活治理、plan 前端流程（确认卡片/todolist/进度气泡）、用户显式触发的项目安装升级移除

## 验收标准

### `c1` 架构合同评审：零内核补丁、双闸门禁、逐字注入、无懒启用结构性保证

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`docs/acceptance/evidence/docs-harness-plugin/c1-review-notes.md`

### `c2` 插件项目聚焦单测全过（host+client，126 例）

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/docs-harness-plugin/c2-unit-tests.txt`

### `c3` 包与安装层：npm pack 产物经 dsh plugin add 装入本机真实 web profile 并进 bundles 层栈

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`

### `c4` 本机运行态全流程：启用提示→转圈→方案确认→todolist→气泡实时刷新→关开关回归

- 状态：pending
- 类型：behavior_acceptance
- 层级：L3
- 证据：尚无

### `c5` 用户真实体验确认（原话记录）

- 状态：pending
- 类型：user_acceptance
- 层级：L5
- 证据：尚无
