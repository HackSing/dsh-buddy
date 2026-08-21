# Changelog

本项目所有显著变更记录于此；版本号遵循语义化版本，新条目置顶。

## [Unreleased]

## [0.4.1] - 2026-08-22

### Fixed

- **修复 macOS 安装包打开报「"DSH Buddy" 已损坏，无法打开」**：`build.mac` 声明了 `hardenedRuntime` 与 entitlements 却没有配 `identity`，构建机上又没有签名证书，electron-builder 遂静默跳过整个签名步骤（见 `macPackager.js` 的 `findSigningIdentity` 分支）。产物因此停在最坏的中间态——主可执行文件带着 Electron 出厂的 `adhoc, linker-signed` 签名（该签名声明必须有资源封印），bundle 里却没有 `_CodeSignature/`，`codesign --verify` 报 `code has no resources but signature indicates they must be present`。这是**签名破损**而非未签名，故 Gatekeeper 的措辞是「已损坏」而不是「身份不明的开发者」，且不提供任何放行入口。现改为 `identity: "-"` 显式 ad-hoc 签名：`Identifier` 由 `Electron` 修正为 `com.dshbuddy.app`，资源封印生成（19867 files），`syspolicy_check` 的 Fatal 级 Codesign Error 降为 Warning 级 Adhoc Signed App。**v0.4.0 及更早版本的 macOS 包均受此影响**，用户可用 `xattr -dr com.apple.quarantine` 救回旧包。
- 附带效应：`hardenedRuntime: true` 此前从未真正生效（签名步骤根本没跑，签名 flags 里没有 `runtime` 位），本次首次落实；`disable-library-validation` entitlement 已在位，node-pty / koffi 等原生模块加载不受影响。
- 修复 `package.json` 的 npm 脚本白名单与 lockfile 失配：白名单写的是 `koffi@3.1.5` / `node-pty@1.1.0`，而 lockfile 里的实际版本早已是 `koffi@3.1.6` / `node-pty@1.2.0-beta.15`，失配导致这两个原生模块的 install 脚本在 `npm ci` 时不会执行。同时补全 lockfile 中缺失的依赖图条目（`electron-winstaller`、`@electron/windows-sign`、`postject` 等 Windows 链，白名单早已列出但 lockfile 中不存在）。
- dsh.log 同步落盘，修复崩溃时日志为 0 字节。

### Added

- macOS 发布产物新增 `.zip` 与 `.zip.blockmap`：electron-updater 的 macOS 更新通道只认 zip（缺失即抛 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`），dmg 顶不上。该通道当前对 macOS 仍是关闭的——Squirrel.Mac 换装要校验新包满足旧包的 designated requirement，而 ad-hoc 签名的 DR 绑定在单次构建的 cdhash 上，跨版本必然不匹配。故 zip 是为 Developer ID 签名就绪预留：证书到位后只需放开 `isAutoUpdateSupported` 的 darwin 分支，发布流水线无需再改。

### Changed

- README 新增「首次打开」与「开始使用」两节：给出 macOS 逐步放行路径（并指明 macOS 15 起「右键 → 打开」已被系统移除，网上多数教程已失效）、Windows SmartScreen 处置、以及「已损坏」的判别与自救命令；更新说明中写明 ad-hoc 签名下每次升级都要重新放行一次，以及不能静默换装的原因。
- 移除随包 dsh-buddy-about 插件，dist-win 逻辑迁至 PowerShell。

## [0.4.0] - 2026-08-21

### Fixed

- 修复安装/重启后会话列表标题显示为工作区目录名、需逐个点开才刷新的问题：新增随包 host 插件 `dsh-buddy-title-repair`，dsh 启动时对投影缓存缺标题的冷会话做冷读回写（`coldSnapshot`），壳在加载页面前等待标题就绪（10s 上限，超时放行）；Windows 日常退出改为 1s 宽限后强杀，让 dsh 写后日志（200ms 批窗口）完成落盘。

### Added

- llm-pi-ai 多模态模型配置 UI：在 Models 设置页为 pi-ai provider 增加“默认输入模态”和模型级“输入模态”勾选；构建 web profile 时和应用启动时都会自动修补内置 profile，无需手动编辑 `settings.yaml`。

