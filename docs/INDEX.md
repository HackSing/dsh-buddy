# 项目文档索引

项目文档从这里进入；Docs Harness 只维护下方任务方案区块。

<!-- docs-harness:plans-index:start -->
## 任务方案

- [内嵌 dsh(零依赖分发)](plans/embedded-dsh-zero-dependency.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）；关键符号：`resolveEmbeddedEntry`、`resolveLauncher`、`ELECTRON_RUN_AS_NODE`、`asarUnpack`
- [dsh-buddy 薄壳 + plugins workspace 与 bundled preset 自动安装](plans/bundled-free-plugins.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）；关键符号：`installBundledPresets`、`dsh-anchored-standard`、`.agent-presets`、`ensureDsh`
<!-- docs-harness:plans-index:end -->

<!-- docs-harness:knowledge-index:start -->
## 项目知识

- [bundled agent preset 安装拓扑约束](knowledge/bundled-preset-topology.md) — 状态：有效（现行事实）；关键符号：`BUNDLED_PRESET_DIRS`、`installBundledPresets`、`agent-presets`
- [dsh-web-ui 协议尽调与预装子集决策](knowledge/dsh-web-ui-license-audit.md) — 状态：有效（现行事实）；关键符号：`preinstall-manifest`、`dsh-web-ui-all`、`cloudflared`、`@linxin666`
- [插件预装协议门槛(license gate)](knowledge/plugin-license-gate.md) — 状态：有效（现行事实）；关键符号：`license_gate`、`preinstall-manifest`、`copyleft`
<!-- docs-harness:knowledge-index:end -->

<!-- docs-harness:acceptance-index:start -->
## 验收资产

- [内嵌 dsh(零依赖分发)验收](acceptance/embedded-dsh-zero-dependency.md) — 状态：已验收-仅追溯；关键符号：`resolveEmbeddedEntry`、`ELECTRON_RUN_AS_NODE`、`asarUnpack`
- [bundled preset 自动安装验收](acceptance/bundled-free-plugins.md) — 状态：已验收-仅追溯；关键符号：`installBundledPresets`、`dsh-anchored-standard`、`.agent-presets`
<!-- docs-harness:acceptance-index:end -->
