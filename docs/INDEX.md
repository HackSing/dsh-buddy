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
- [Windows 安装包转正](plans/windows-installer.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-17 核对）；关键符号：`installBundledProfile`、`build-web-profile`、`DSH_SKIP_PROFILE`、`release.yml`
- [Docs Harness 插件化：双闸激活治理与 plan 前端流程](plans/docs-harness-plugin.md) — 状态：有效（实施中）；关键符号：`harnessPlan`、`harnessProject`、`plan_progress`、`dsh-docs-harness`
- [对标通用桌面产品的安装/更新/卸载流程](plans/desktop-lifecycle.md) — 状态：有效（实施中）；关键符号：`auto-update`、`deleteAppDataOnUninstall`、`checkForUpdate`、`quitAndInstall`
- [Anchored Standard 预设：锚定后开放 prompt section 与插件工具发现](plans/anchored-phased-prompt.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-18 核对）；关键符号：`createEpochPromotion`、`sealSectionsUntilPromotion`、`UNLOCKABLE_INDEX`、`installBundledPresets`
- [预装 dsh-better-sidebar:内嵌 dsh 升 rc.7 与 profile 二进制断言白名单化](plans/better-sidebar-preinstall.md) — 状态：有效（实施中）；关键符号：`verify-profile-tar`、`dsh-better-sidebar`、`DSH_VERSION`、`prebuilds`
- [存量 profile 随包升级：幂等跳过改为版本比对后的备份替换](plans/existing-profile-upgrade.md) — 状态：已实施-仅追溯（代码已是真源，2026-08-19 核对）；关键符号：`installBundledProfile`、`preinstall-manifest`、`profileUpgradeDecision`、`dsh.profile.bundles`
- [dsh 上游与预装插件的运行时更新通道](plans/dsh-upstream-update-channel.md) — 状态：有效（实施中）；关键符号：`profileUpgradeDecision`、`installBundledProfile`、`checkPluginChannel`、`plugin-channel.json`
<!-- docs-harness:plans-index:end -->

<!-- docs-harness:knowledge-index:start -->
## 项目知识

- [bundled agent preset 安装拓扑约束](knowledge/bundled-preset-topology.md) — 状态：有效（现行事实）；关键符号：`BUNDLED_PRESET_DIRS`、`installBundledPresets`、`agent-presets`
- [插件预装协议门槛(license gate)](knowledge/plugin-license-gate.md) — 状态：有效（现行事实）；关键符号：`license_gate`、`preinstall-manifest`、`copyleft`
- [dsh-web-ui 协议尽调与预装子集决策](knowledge/dsh-web-ui-license-audit.md) — 状态：有效（现行事实）；关键符号：`preinstall-manifest`、`dsh-web-ui-all`、`cloudflared`、`@linxin666`
- [Windows 随包 profile 构建与解包约束](knowledge/windows-profile-packaging.md) — 状态：有效（现行事实）；关键符号：`installBundledProfile`、`build-web-profile`、`DSH_SKIP_PROFILE`、`npmRebuild`
- [dsh 网关 settings 白名单：第三方插件设置面必须自建路由](knowledge/dsh-settings-gateway-allowlist.md) — 状态：有效（现行事实）；关键符号：`WEB_SETTINGS_NAMESPACES`、`settings.describe`、`docs-harness-settings`、`HarnessSettingsStore`
- [Electron 当 Node 跑内嵌 dsh 的原生能力边界：external buffer 被禁](knowledge/electron-external-buffer-limit.md) — 状态：有效（现行事实）；关键符号：`readUtf16`、`patch-dsh-picker`、`DSH_PICKER_BROWSE`、`browse-picker-patch`
- [complete persona 压制插件 prompt section 的根因与相位化密封方案](knowledge/anchored-complete-persona.md) — 状态：有效（现行事实）；关键符号：`sealSectionsUntilPromotion`、`extraIndex`、`installBundledPresets`、`complete`
- [预装插件存量缺口与 CI 安装位污染](knowledge/preinstall-existing-user-gap.md) — 状态：有效（现行事实）；关键符号：`installBundledProfile`、`preinstall-manifest`、`virtualStoreDir`、`healProfilesModuleFallback`
- [插件热更通道:滚动 release channel + 成品 tar 分发,运行时复用 bundled-profile 安装链路](knowledge/plugin-channel-hot-update.md) — 状态：有效（现行事实）；关键符号：`checkPluginChannel`、`applyPluginUpdate`、`plugin-channel.json`、`profileUpgradeDecision`
<!-- docs-harness:knowledge-index:end -->

<!-- docs-harness:acceptance-index:start -->
## 验收资产

- [内嵌 dsh(零依赖分发)验收](acceptance/embedded-dsh-zero-dependency.md) — 状态：已验收-仅追溯；关键符号：`resolveEmbeddedEntry`、`ELECTRON_RUN_AS_NODE`、`asarUnpack`
- [bundled preset 自动安装验收](acceptance/bundled-free-plugins.md) — 状态：已验收-仅追溯；关键符号：`installBundledPresets`、`dsh-anchored-standard`、`.agent-presets`
- [bundled web profile 链路验收](acceptance/bundled-web-profile.md) — 状态：已验收-仅追溯；关键符号：`build-web-profile`、`installBundledProfile`、`extraResources`
- [发布基础设施(更新检查 + dsh 追新兼容 CI)验收](acceptance/release-infrastructure.md) — 状态：已验收-仅追溯；关键符号：`checkForUpdate`、`lastNotifiedVersion`、`verify-dsh-compat`
- [Release CI 验收](acceptance/release-ci.md) — 状态：已验收-仅追溯；关键符号：`release.yml`、`dist:win`、`gh release upload`
- [Windows 安装包转正验收](acceptance/windows-installer.md) — 状态：已验收-仅追溯；关键符号：`installBundledProfile`、`build-web-profile`、`DSH_SKIP_PROFILE`、`release.yml`
- [Docs Harness 插件化验收](acceptance/docs-harness-plugin.md) — 状态：有效（待验收）；关键符号：`dsh-docs-harness`、`harnessPlan`、`plan_progress`
- [对标通用桌面产品的安装/更新/卸载流程](acceptance/desktop-lifecycle.md) — 状态：有效（待验收）；关键符号：`auto-update`、`deleteAppDataOnUninstall`、`checkForUpdate`、`quitAndInstall`
- [Anchored 预设相位化开放 prompt section 与插件发现的验收](acceptance/anchored-phased-prompt.md) — 状态：已验收-仅追溯；关键符号：`sealSectionsUntilPromotion`、`extraIndex`、`installBundledPresets`、`createEpochPromotion`
- [better-sidebar 预装与 rc.7 升级验收](acceptance/better-sidebar-preinstall.md) — 状态：有效（待验收）；关键符号：`verify-profile-tar`、`dsh-better-sidebar`、`DSH_VERSION`、`prebuilds`
- [存量 profile 随包升级验收：四态判定 + 端到端旧 profile 升级](acceptance/existing-profile-upgrade.md) — 状态：已验收-仅追溯；关键符号：`installBundledProfile`、`profileUpgradeDecision`
- [dsh 上游与预装插件的运行时更新通道验收](acceptance/dsh-upstream-update-channel.md) — 状态：有效（待验收）；关键符号：`profileUpgradeDecision`、`installBundledProfile`、`checkPluginChannel`、`plugin-channel.json`
<!-- docs-harness:acceptance-index:end -->

<!-- docs-harness:adr-index:start -->
## 架构决策

<!-- docs-harness:adr-index:end -->
