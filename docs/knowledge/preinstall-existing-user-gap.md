> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# 预装插件存量缺口与 CI 安装位污染

- 修订：6
- 关键符号：`installBundledProfile`、`preinstall-manifest`、`virtualStoreDir`、`healProfilesModuleFallback`
- 资产指纹：`sha256:1bac5dda810c19d0eebf5cbaab8eee357c6ecadf6b7797b8b0bc2392b631715f`

## 摘要

存量 profile 幂等跳过缺口已由版本比对+备份替换根治（2026-08-19）；解包出的 profile 带着构建机 pnpm 元数据导致用户机上插件增删被挡死；NSIS 做 CI 安装验证会改写真实安装位与快捷方式，平铺回退 junction 随之指进 Temp 易失目录；NSIS 全局安装记录使沙盒安装/卸载会连带清除机器上原有安装

## 事实

### `gap.idempotent-skip`

已修复（2026-08-19，方案 docs/plans/existing-profile-upgrade.json）：installBundledProfile 对已存在 profile 改为读其 package.json dependencies 与 preinstall-manifest 比对——一致返回 up-to-date 不动磁盘；落后或缺包且无清单外依赖时旧目录整体备份为 profiles/<name>.backup-<旧版本标识>（同名复用）后原子替换，返回 upgraded；含清单外依赖或 package.json 不可读返回 preserved 并报名，由 main.js 弹窗告知；升级中解包失败不触碰旧目录。历史事实：幂等跳过曾使存量 profile 永远拿不到后续新增插件，用户报『丢失了其他的插件』实为从未送达

证据：`lib/bundled-profile.js`、`main.js`、`plugins/preinstall-manifest.json`、`docs/plans/existing-profile-upgrade.json`

### `gap.virtual-store-drift`

随包 tar 解包出的 profile 带着构建机的 pnpm 元数据：node_modules/.modules.yaml 的 virtualStoreDir 指向构建期临时目录（dsh-buddy-profile-*），该目录被清理后用户机上任何 pnpm add/remove 都被 ERR_PNPM_UNEXPECTED_VIRTUAL_STORE 挡死；因 Windows 分支打包前做过 dereference 实体化，node_modules 内容完整、运行态无感，坏的只有维护通道——2026-08-18 实测修法：改 profile 的 package.json（dependencies 与 dsh.profile.bundles 两处）→ 删 node_modules → dsh plugin --profile web install 重建，virtualStoreDir 回落本地后起 web 探测 HTTP 200。注意：随包升级（upgraded 分支）整树替换后此漂移随之复位，但 preserved 分支保留的旧 profile 仍带漂移

证据：`scripts/build-web-profile.js`、`lib/bundled-profile.js`、`plugins/preinstall-manifest.json`

### `repair.manual-add`

存量修复手法：按 plugins/preinstall-manifest.json 的 packages 清单以 dsh plugin --profile web add 钉版补装八个包（@linxin666 六件套 @0.1.16、@aiwaretop/dsh-docs-harness@0.1.1、dsh-better-sidebar@0.13.0），全部为 registry spec 不再涉及本地 tarball；2026-08-17 曾以本地 tarball 装过非 scoped 旧名 dsh-docs-harness 的存量 profile（含用户本机，2026-08-18 已迁移完毕）必须先去掉旧名再装 scoped 名，否则同功能插件双份注册且旧名的 file: spec 会在后续 pnpm 操作中断裂。2026-08-19 起应用层升级机制（gap.idempotent-skip 修复）已覆盖无清单外依赖的存量 profile，手工补装只剩 preserved 场景需要

证据：`plugins/preinstall-manifest.json`、`scripts/build-web-profile.js`、`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`

### `lesson.ci-install-pollution`

经验教训：用真实 NSIS 安装器做 CI 安装验证（/D 装入 Temp）会把安装位写进注册表并让开始菜单/桌面快捷方式指向临时目录，用户随后点快捷方式就长期运行 Temp 副本；profiles/node_modules 的平铺回退 junction（healProfilesModuleFallback）随该副本启动被重指到 Temp，一旦临时目录被清理，第三方插件依赖解析全体断链——安装验证要么用隔离环境要么装后立即卸载还原；2026-08-22 的 L4 实机验收撞出更重的后果:electron-builder 的 NSIS 是 perMachine:false,按 appId 在 HKCU 注册全局安装记录、同一用户只能有一份,所以装到临时沙盒只隔离了文件系统、隔离不了「安装身份」——沙盒安装接管该记录后,其卸载会把机器上原有的那份 DSH Buddy(程序目录 + %APPDATA% 下 userData)一并清除(~/.dsh 里的用户数据不受影响);对策已固化为验收脚本在动手前查 HKCU Uninstall 并拒绝在已装机器上运行(c3-l4-nsis-windows.mjs 的 assertNoExistingInstall)

证据：`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`、`docs/acceptance/evidence/plugin-incremental-update/c3-l4-nsis-windows.mjs`
