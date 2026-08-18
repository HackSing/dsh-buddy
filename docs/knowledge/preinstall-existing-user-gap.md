> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# 预装插件存量缺口与 CI 安装位污染

- 修订：4
- 关键符号：`installBundledProfile`、`preinstall-manifest`、`virtualStoreDir`、`healProfilesModuleFallback`
- 资产指纹：`sha256:b4313327bdd3984d4dac3c4f5c8f20e21b337f4174e6d9f13af60a753c82c64f`

## 摘要

幂等解包让预装插件永远到不了存量 profile；解包出的 profile 带着构建机 pnpm 元数据导致用户机上插件增删被挡死；NSIS 做 CI 安装验证会改写真实安装位与快捷方式，平铺回退 junction 随之指进 Temp 易失目录

## 事实

### `gap.idempotent-skip`

lib/bundled-profile.js 的幂等解包对已存在的 profile 直接跳过，预装插件只送达全新安装；早于预装机制建立的存量 profile 永远拿不到后续新增插件——用户报『丢失了其他的插件』实为从未送达，需要 roadmap 中的应用层增量升级机制才能根治

证据：`lib/bundled-profile.js`、`plugins/preinstall-manifest.json`、`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`

### `gap.virtual-store-drift`

随包 tar 解包出的 profile 带着构建机的 pnpm 元数据：node_modules/.modules.yaml 的 virtualStoreDir 指向构建期临时目录（dsh-buddy-profile-*），该目录被清理后用户机上任何 pnpm add/remove 都被 ERR_PNPM_UNEXPECTED_VIRTUAL_STORE 挡死；因 Windows 分支打包前做过 dereference 实体化，node_modules 内容完整、运行态无感，坏的只有维护通道——2026-08-18 实测修法：改 profile 的 package.json（dependencies 与 dsh.profile.bundles 两处）→ 删 node_modules → dsh plugin --profile web install 重建，virtualStoreDir 回落本地后起 web 探测 HTTP 200

证据：`scripts/build-web-profile.js`、`lib/bundled-profile.js`、`plugins/preinstall-manifest.json`

### `repair.manual-add`

存量修复手法：按 plugins/preinstall-manifest.json 的 packages 清单以 dsh plugin --profile web add 钉版补装八个包（@linxin666 六件套 @0.1.16、@aiwaretop/dsh-docs-harness@0.1.1、dsh-better-sidebar@0.13.0），全部为 registry spec 不再涉及本地 tarball；2026-08-17 曾以本地 tarball 装过非 scoped 旧名 dsh-docs-harness 的存量 profile（含用户本机，2026-08-18 已迁移完毕）必须先去掉旧名再装 scoped 名，否则同功能插件双份注册且旧名的 file: spec 会在后续 pnpm 操作中断裂

证据：`plugins/preinstall-manifest.json`、`scripts/build-web-profile.js`、`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`

### `lesson.ci-install-pollution`

经验教训：用真实 NSIS 安装器做 CI 安装验证（/D 装入 Temp）会把安装位写进注册表并让开始菜单/桌面快捷方式指向临时目录，用户随后点快捷方式就长期运行 Temp 副本；profiles/node_modules 的平铺回退 junction（healProfilesModuleFallback）随该副本启动被重指到 Temp，一旦临时目录被清理，第三方插件依赖解析全体断链——安装验证要么用隔离环境要么装后立即卸载还原

证据：`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`
