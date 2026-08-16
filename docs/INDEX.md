# 项目文档索引

项目文档从这里进入；Docs Harness 只维护下方任务方案区块。

## 方法论

- [开源项目发布基础设施三件套搭建指南](release-infra-playbook.md) — 状态：有效（方法论沉淀）；rc 追新值班 / tag 即发流水线 / 应用内更新提示的通用搭建方法与实战坑；关键符号：`dsh-compat.yml`、`release.yml`、`update-check`、`workflow_dispatch`

<!-- docs-harness:plans-index:start -->
## 任务方案

- [内嵌 dsh(零依赖分发)](plans/embedded-dsh-zero-dependency.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）；关键符号：`resolveEmbeddedEntry`、`resolveLauncher`、`ELECTRON_RUN_AS_NODE`、`asarUnpack`
- [dsh-buddy 薄壳 + plugins workspace 与 bundled preset 自动安装](plans/bundled-free-plugins.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）；关键符号：`installBundledPresets`、`dsh-anchored-standard`、`.agent-presets`、`ensureDsh`
- [构建机预装 web profile 随包分发链路](plans/bundled-web-profile.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）；关键符号：`build-web-profile`、`installBundledProfile`、`extraResources`、`preinstall-manifest`
- [发布基础设施:启动更新检查与 dsh rc 追新兼容验证 CI](plans/release-infrastructure.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）；关键符号：`checkForUpdate`、`lastNotifiedVersion`、`verify-dsh-compat`、`binEntryFrom`
- [Release CI:tag 触发双平台构建并发布 GitHub Release](plans/release-ci.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）；关键符号：`release.yml`、`dist:win`、`GITHUB_REF_NAME`、`gh release upload`
<!-- docs-harness:plans-index:end -->

<!-- docs-harness:knowledge-index:start -->
## 项目知识

- [bundled agent preset 安装拓扑约束](knowledge/bundled-preset-topology.md) — 状态：有效（现行事实）；关键符号：`BUNDLED_PRESET_DIRS`、`installBundledPresets`、`agent-presets`
- [插件预装协议门槛(license gate)](knowledge/plugin-license-gate.md) — 状态：有效（现行事实）；关键符号：`license_gate`、`preinstall-manifest`、`copyleft`
- [dsh-web-ui 协议尽调与预装子集决策](knowledge/dsh-web-ui-license-audit.md) — 状态：有效（现行事实）；关键符号：`preinstall-manifest`、`dsh-web-ui-all`、`cloudflared`、`@linxin666`
<!-- docs-harness:knowledge-index:end -->

<!-- docs-harness:acceptance-index:start -->
## 验收资产

- [内嵌 dsh(零依赖分发)验收](acceptance/embedded-dsh-zero-dependency.md) — 状态：已验收-仅追溯；关键符号：`resolveEmbeddedEntry`、`ELECTRON_RUN_AS_NODE`、`asarUnpack`
- [bundled preset 自动安装验收](acceptance/bundled-free-plugins.md) — 状态：已验收-仅追溯；关键符号：`installBundledPresets`、`dsh-anchored-standard`、`.agent-presets`
- [bundled web profile 链路验收](acceptance/bundled-web-profile.md) — 状态：已验收-仅追溯；关键符号：`build-web-profile`、`installBundledProfile`、`extraResources`
- [发布基础设施(更新检查 + dsh 追新兼容 CI)验收](acceptance/release-infrastructure.md) — 状态：已验收-仅追溯；关键符号：`checkForUpdate`、`lastNotifiedVersion`、`verify-dsh-compat`
- [Release CI 验收](acceptance/release-ci.md) — 状态：已验收-仅追溯；关键符号：`release.yml`、`dist:win`、`gh release upload`
<!-- docs-harness:acceptance-index:end -->
