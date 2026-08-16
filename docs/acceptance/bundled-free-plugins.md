> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# bundled preset 自动安装验收

- 修订：5
- 关键符号：`installBundledPresets`、`dsh-anchored-standard`、`.agent-presets`
- 资产指纹：`sha256:f8ca70371ddc7960b83fe3ab8e95c3a1cbca924d1d82c1c22d2cf07984ab638f`
- 关联方案：`docs/plans/bundled-free-plugins.json`

## 验收目标

dsh-buddy vendor dsh-anchored-standard 并在壳启动前把三个 agent preset 幂等安装到 DSH_HOME,真实 dsh 发现列表包含且非 broken

## 验收标准

### `c1` vendored 插件自带测试全部通过(node --test)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/bundled-free-plugins/c1-node-test.txt`

### `c2` 安装器冒烟:空 HOME 全量安装、二次运行跳过、已存在目录不被触碰

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/bundled-free-plugins/c2-installer-smoke.txt`

### `c3` 真实内嵌 dsh web 启动后 preset 发现列表包含三项且非 broken

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/bundled-free-plugins/c3-dsh-preset-discovery.txt`
