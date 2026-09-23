# Changelog

本项目所有显著变更记录于此；版本号遵循语义化版本，新条目置顶。

## [Unreleased]

### Changed

- **内嵌 dsh 由 0.1.1-rc.2 升至 0.1.5-rc.1**:`@deepseek-ai/*` 钉版由 19 个扩到 33 个整组同抬。rc.5 把一批包从 `dependencies` 挪成 `peerDependencies`,而预装插件里的 `import '@deepseek-ai/xxx'` 实际解析到宿主树(profile 的 `node_modules` 永远不含 `@deepseek-ai/*`),因此 `dsh-session-query`、`dsh-settings`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`、`dsh-client-store` 等必须在本仓显式钉版,否则插件装载报 `Cannot find package`。
- **适配 rc.5 的 web 浏览器授权门**:rc.5 起裸 `GET /` 一律回 401,必须用启动行打印的 launch token 走 `GET /?token=X` → 303 + `dsh-auth-<authority>` cookie,之后 `/` 与 `/api/*` 只认该 cookie。壳因此改三处:窗口加载带 token 的 URL(由浏览器自己完成 303 换 cookie);首屏标题门先换出 cookie 再调 `/api`,换不出就跳过而不是空转满 10s;就绪判据从「HTTP 端口能应答」改为「启动行打印 token」——端口在插件装载结算前就会应答(实测回 404),单看端口会让壳在 dsh 没装载完时就切页面。新增 `lib/dsh-browser-auth.js` 作为这道门的单一来源。复用外部 dsh 时拿不到 token,若 Electron 会话里也没有历史授权 cookie,改为弹框说明原因与出路,而不是让用户看一页 `unauthorized`。
- **适配 rc.5 的 host API RPC 端点改形**:unary 端点从点号改为两段斜杠(`/api/session.list` → `/api/session/list`,`method` 同改 `session/list`),payload 从 `{}` 改为单字段 `args` 包住按参数名索引的实参(`{args:{_request:{}}}`);旧形状在 rc.5 分别回 404 与 `gateway/arguments-invalid`。`lib/session-titles.js` 的端点契约集中在三个常量,契约测试按新形状重写并补 401 回路。
- **预装插件清单重整**:`@linxin666` 的 pet / web-ui-settings 由 0.2.2 抬到 0.3.20(git-graph 同批抬版后因闪窗问题退出预装,见 Removed);`dsh-better-sidebar` 由 0.13.1 抬到 0.19.0(@deepseek-ai peer 全家族对齐 ^0.1.5-rc.1,取代同期上游同步的 0.17.1);治理插件 `@aiwaretop/dsh-docs-harness` 抬到 0.2.2(该版把设置区安装从 rc.5 已删除的 `installSettingsSection` 自由函数改为 `settings` 服务的 `installSection` 方法)。
- **门禁 `verify-dsh-compat` 的 web 探活改走授权门**:先等 launch token(同时作为装载结算信号)、再换 cookie、再带 cookie 探 200;token 超时、授权失败、带 cookie 仍不出 200 三类失败各自独立报出,不折叠成一句「等 200 超时」。

### Removed

- **`@linxin666/dsh-client-ui-web-ui-settings` 退出预装**:该包是 dsh-web 家族插件的聚合配置入口(设置侧栏一级分区「Web 插件」),按产品决策不再随包分发,并进退休清单——存量 profile 中出现即强制整目录备份替换清退,否则旧 profile 会一直保留该入口,并把后续 profile 升级挡在 `preserved-current`。**用户可见变化**:设置侧栏「Web 插件」入口与其内的家族插件配置卡片消失;皮肤、宠物等插件自带的设置分区与其余预装插件不受影响。随包 profile tar 由 `scripts/build-web-profile.js` 按新清单重建,产物不再含该包。

- **`@linxin666/dsh-client-ui-git-graph` 退出预装**:该插件的分支芯片每 30s 对每个订阅会话跑约 6 次 git(`rev-parse`/`status --porcelain`/`worktree list` 等),窗口每次获焦再跑一批,全部经 dsh 的 Windows Job runner 派生;runner 用 `CreateProcessW` 不带 `CREATE_NO_WINDOW`,GUI 进程链下每次 git.exe 都弹出一个可见控制台窗口,是 Windows 上「运行时频繁闪终端」的主要触发源。分支切换/worktree/提交图非本壳必需,整包进退休清单,存量 profile 中出现即强制整目录备份替换清退。**用户可见变化**:输入框上方的分支芯片与分支/worktree 弹层消失;git 操作改用 better-sidebar 的源代码管理面板或 agent 命令。agent 自身 bash/rg 调用的闪窗不在本条范围,由后续 `CREATE_NO_WINDOW` 补丁处理。

- **皮肤包由 `@linxin666/dsh-skins` 换为 `@linxin666/dsh-client-ui-skin-center@0.3.20`**:上游已把 dsh-skins 标为「已退役的兼容载具」且锁死 skin-center 0.2.9,而 0.2.9 仍 import rc.5 已删除的导出。**用户可见变化**:随包内置皮肤由 18 个减到 1 个(blue-fantasy),其余皮肤改为在皮肤中心卡片内从 dsh-market.com 按需一键安装到 `$DSH_HOME/skins/<id>/`(用户主动行为,不随安装联网)。dsh-skins 进退休清单,存量 profile 中出现即强制整目录备份替换清退。
- **`@linxin666/dsh-live-stats` 退出预装**:上游 latest 0.1.20(2026-08-17 发布)仍 import rc.5 已删除的 `installSettingsSection`,装载即让 web 进程 code 1 退出,且无兼容版本可抬。已进退休清单,存量 profile 中出现即强制清退——否则老插件会把新 dsh 的启动直接搞崩。上游发布适配版后可重新入单。
- **`scripts/patch-dsh-picker.js` 补丁退役**:rc.5 的 `dsh-host-directory-picker-native` worker 已改用 pointer buffer + `koffi.decode('str16')`,不再触碰 Electron 的 external buffer 上限,补丁按自身预案删除。`postinstall`/`predist`/`dist:win` 与 `dist-win.ps1` 的挂载点同步摘除;降级工具 `use-browse-picker`/`browse-picker-patch` 保留,作为原生对话框不可用时的退路。

### Fixed

- **修复 Windows 运行期间频繁闪出终端窗口**:dsh 在 Windows 上默认走 Win32 Job 容器路径——每个 `ctx.subprocess.spawn` 先起一个 runner(本壳下即 Electron 二进制),runner 再用 koffi 直调 `CreateProcessW` 拉起目标。上游创建标志只有 `CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT`,没有 `CREATE_NO_WINDOW`,而 Electron 主进程、dsh web 进程、runner 全是 GUI 子系统程序、整条链上没有控制台,于是每个控制台程序目标(git / bash / rg …)都被新开一个可见控制台窗口,目标退出即关。上游用 Node 跑 dsh 时终端控制台被继承,看不到此现象,属本壳运行时选择带来的表现。新增 `scripts/patch-dsh-no-window.js`(变换在 `lib/patch-dsh-no-window.js`),给 `@deepseek-ai/dsh-win32-process` 三处 CreateProcess 创建标志按位或上 `CREATE_NO_WINDOW`,与 `patch-multimodal-ui` 同一套路挂 `postinstall`,`predist`/`dist:win` 以 `--check` 把关,`dist-win.ps1` 阶段表同步登记;上游修复后按预案删除。实测:以 Electron run-as-node 作无控制台父进程走同一 API 拉起 `cmd.exe`,补丁前弹出一个标题为 cmd.exe 的 Windows Terminal 窗口,补丁后无新窗口且 stdout 仍经句柄正常回收。同批补齐本壳两处漏掉的 `windowsHide`:`lib/process-tree.js` 的 `taskkill`(插件热更重启、退出强杀各闪一下)与 `main.js` 拉起 dsh 的 `spawn`(仅 npx/env 启动器经 shell 时有窗)。
- **修复随包标题修复插件在 rc.5 上静默空转**:`plugins/dsh-buddy-title-repair` 调的两个投影缓存读法在 rc.5 都换了形状,且都不报错只是什么都不做——`persistence.list()` 改返回 `{ header, revision, sizeBytes }`(按 `meta.cwd` 取字段使每条都被判为「无 cwd」而整趟跳过),`coldSnapshot` 第一参从 sessionId 改为 header 且不再自己查持久层(整份日志要调用方给)。改为按 `{ header }` 解构、用 `@deepseek-ai/dsh-session-query` 导出的 `readColdSessionLog` 取日志后再调 `coldSnapshot(header, inheritedEventCount, events)`;缓存命中判定先开只读句柄做零日志读的探测,只有判缺标题才付整日志读。插件同时补上跳过原因分桶日志(no-cwd / live / already-titled / probe-failed)与缓存探测失败的 warn——上一次之所以没被发现,正是因为这趟扫描的失败是完全静默的。本机实测:修复后缺标题会话从 11 降到 8(剩下 8 条的日志里本就没有标题事件,重折也无从恢复),投影缓存可见重折回写的真实标题行。
- **随包 agent preset 适配 rc.1 的 `dsh-persona` 配置改形**:0.1.5-rc.1 把 persona 行的必填键由 `text` 改为 `prefix`(新增可选 `suffix`),prompt section 名由 `deployment:persona` 拆为 `deployment:persona-prefix`/`-suffix`。三个随包 preset 仍写 `text`,新版 schema 校验直接拒绝挂载,凡触发 session resume 的动作(发消息、切模型)都报 `agent-presets: preset "preset" failed to mount … $.prefix missing required value`。三个 `agent.cordis.yml` 改用 `prefix`;主 preset 的 `sealSectionsUntilPromotion` 同步改为 `deployment:persona-prefix`——否则字段改完后不再报错,但 tool-bootstrap 找不到该 section 会静默关闭首请求 prompt 封印。已在本地改过 preset 的用户(同步逻辑按设计保留本地版)需手动把这两处改到 `$DSH_HOME/.agent-presets/preset/agent.cordis.yml`。
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

