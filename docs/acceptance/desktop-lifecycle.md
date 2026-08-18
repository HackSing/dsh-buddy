> 状态：有效（待验收）
<!-- docs-harness:acceptance-document/v1 -->

# 对标通用桌面产品的安装/更新/卸载流程

- 修订：5
- 关键符号：`auto-update`、`deleteAppDataOnUninstall`、`checkForUpdate`、`quitAndInstall`
- 资产指纹：`sha256:f1f62cc6593d42a1ff50ce18abf2d31f05bc88e24ed38a83341a6b8cccd4a55c`
- 关联方案：`docs/plans/desktop-lifecycle.json`

## 验收目标

Windows 安装器升级为 assisted(可选目录)、卸载清理壳自身 userData(不动 ~/.dsh)、Windows 应用内自动更新(electron-updater 后台下载+重启安装,macOS 保持提示式)、菜单「检查更新」真实检查三态反馈、Release 挂载 latest.yml/blockmap、README 三节同步。

## 验收标准

### `c1` 安装器形态:本机 dist:win 产出 assisted 安装器,/S /D= 静默安装与交互目录选择均可用,安装后真实启动冒烟通过

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/desktop-lifecycle/c1-c2-install-uninstall-smoke.txt`

### `c2` 卸载清理:卸载后程序目录与壳 userData(%APPDATA%/DSH Buddy)已清,临时 DSH_HOME 不动

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/desktop-lifecycle/c1-c2-install-uninstall-smoke.txt`

### `c3` 手动检查更新:force 绕过 24h 节流真实查询,三态反馈分支正确,自动检查节流语义不回归

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/desktop-lifecycle/c3-manual-check-smoke.txt`

### `c4` Windows 自动更新全链:双 prerelease tag(test1→test2)实证装 test1 启动后自动下载安装到 test2,Release 挂载 latest.yml/blockmap

- 状态：pending
- 类型：behavior_acceptance
- 层级：L4
- 证据：尚无

### `c5` 文档同步:README 安装/卸载/更新节与 Roadmap 和实际行为一致

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`README.md`、`package.json`、`lib/auto-update.js`
