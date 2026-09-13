# Changelog

本项目所有显著变更记录于此；版本号遵循语义化版本，新条目置顶。

## [Unreleased]

### Changed

- **预装插件同步上游最新**:`dsh-better-sidebar` 0.13.1 → 0.17.1,`@linxin666/dsh-client-ui-git-graph` 0.2.2 → 0.3.6,`@linxin666/dsh-pet` 0.2.2 → 0.3.6,`@linxin666/dsh-client-ui-web-ui-settings` 0.2.2 → 0.3.6,`@linxin666/dsh-skins` 0.2.2 → 0.2.9;协议门复验通过(Apache-2.0/MIT,发布包无 install 脚本,better-sidebar 新增依赖仅 @codemirror/lang-vue、dompurify、react-icons,无敏感依赖),各包 peer 要求 ≤ 内嵌 dsh 0.1.1-rc.2。内嵌 dsh 本体(registry latest)已是 0.1.1-rc.2,无更新。

### Fixed

- **修复插件更新在慢网络下必然超时失败**:热更下载原先把 `AbortSignal.timeout(30s)` 挂在整个 fetch 上,该信号连同 body 下载一起计时——数十 MB 的更新包在网速低于「切片大小 ÷ 30s」时必然被掐断,弹「下载失败: The operation was aborted due to timeout」,且重试同样失败。改为两段式超时:建连+响应头 15s 预算,body 只看连续无进展(30s 无数据判停滞)不设总时长上限,慢而流动的下载可完成;连接失败与停滞的报错改为可读中文,并新增真实 HTTP 栈回归用例覆盖慢速、无响应、停滞三类形态。

- **修复 Windows 退出应用时闪出终端窗口**:日常退出的宽限强杀原先派生一个 `detached` 的孤儿 `cmd`(先 `timeout` 再 `taskkill`)来承担 1s 宽限,而 Windows 会给 `detached` 子进程强制分配控制台窗口(`windowsHide` 对其无效),这个孤儿恰活在退出后的宽限期里,就是用户看到的「退出时闪终端」。改为 `before-quit` 内 `preventDefault` 拦住退出,主进程自己等满宽限期后再非 detached 强杀(默认隐藏窗口)并 `app.exit`。宽限语义(给 dsh 写后会话日志留 drain 窗口)不变,安装态与 POSIX 退出行为不变。

## [0.4.4] - 2026-08-23

### Fixed

- **修复 Docs Harness 升级提示方向倒挂**:治理插件 `@aiwaretop/dsh-docs-harness` 0.2.0 的升级判定是「版本不等即提示」,不做方向比较——项目内 harness 比插件 vendored 种子更新时(如 2.10.2 对种子 2.9.1)会弹出「升级到更旧版本」的假提示,点 Upgrade 会把项目的 managed files 回写成旧版。0.2.1 改为数值分段比较(`versionBehind`),仅当种子严格更新时才提示;vendored 种子同步抬到 2.10.2。预装清单钉版升至 0.2.1。

### Changed

- 内嵌 dsh 由 0.1.1-rc.1 升至 0.1.1-rc.2,`@deepseek-ai/*` 全家族 19 个钉版整组同抬。
- Release body 改由 `scripts/release-notes.js` 从 CHANGELOG.md 提取(下载指引 + 当版段落 + 比对链接),正式版缺 changelog 条目则发版失败——changelog 纪律前移为发版门禁。

## [0.4.3] - 2026-08-23

### Changed

- **预装 dispatch 插件升至 0.1.2,Windows 可用性由推断转为 CI 实证**:npm 包 vendor 不再只带构建机单平台的 `better_sqlite3.node`,改为按构建期运行时推导的 Electron ABI 从上游 WiseLibs releases 下载 darwin-arm64 与 win32-x64 两份官方 prebuild(落位 `build/Release/<platform-arch>/`,魔数断言硬失败),vendored `database.js` 的 bindings 加载行锚点替换为按 `process.platform-arch` 直拼(锚点不中即抛错要求人工重验);`bindings`/`file-uri-to-path` 随之移出 vendor。
- `verify-profile-tar` 删除 0.4.2 引入的 `singlePlatformExemption` 豁免机制,dispatch 回归标准双平台覆盖断言(prefix 收窄到 vendored better-sqlite3,插件混入其他二进制仍判 FAIL)。

### Added

- release 流水线 windows job 新增「dispatch sqlite 装载 smoke」门禁:打包前从分发的 profile tar 解出 vendored better-sqlite3,在真实 win32-x64 runner 上以 `ELECTRON_RUN_AS_NODE=1` 建内存库读写断言——此后任何破坏 Windows 装载的改动都推不出 tag。

## [0.4.2] - 2026-08-23

### Fixed

- **preserved 弹窗降噪**:启动时 profile 升级判定原先只要存在清单外插件就弹「内置插件包有更新」,即使实际没有任何待升级。判定层拆为五态——清单外插件存在且清单内确有落后/缺包才 `preserved`(弹窗),清单内全部满足则 `preserved-current`(仅日志不弹窗);`package.json` 不可读维持保守弹窗。热更 v1/v2 链路同步折叠,无真实更新不再打扰。
- `file:` spec 视为开发者本地覆盖判满足:此前「不可解析即落后」会让手工 `file:` 安装的插件每次启动被整目录替换回滚,热更检测也反复提示假更新;现启动链不回滚、`diffChannelVersions` 跳过。

### Changed

- **预装清单换血**:`@linxin666/dsh-client-ui-task-board` 退役,由自研 `@aiwaretop/dsh-dispatch@0.1.1`(任务收件箱/agent 调度)取代。清单新增 `retired` 机制完成存量清退——退休包不计清单外、出现即触发整目录备份替换,替换后的新 profile 自然不含退休包;直接删条目会让存量用户被判永久 preserved,该机制即为避开此坑。
- 已知限制(0.4.3 已解除):本版 dispatch 插件的 sqlite 二进制仅 darwin-arm64,Windows 端 dispatch 面板不可用(fail-soft 降级,不影响其他功能);`verify-profile-tar` 以显式 `singlePlatformExemption` 豁免登记该挂账。

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

