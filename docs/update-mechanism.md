# DSH Buddy 更新体系全链路（2026-08-20 核对，v0.3.0 时代）

状态：有效（现行事实）。本文是更新体系的追溯文档：应用本体整包更新、dsh 上游检测、
插件热更（schema v2 按包增量）三条链路的检测机制、下载机制、安装语义与已踩过的坑。
方法论层（为什么是这三条链）见 [release-infra-playbook.md](release-infra-playbook.md)；
实施合同见 [plans/plugin-incremental-update.md](plans/plugin-incremental-update.md)。

## 总览：三条更新链路

| 链路 | 检测源 | 获取方式 | 用户交互 | 客户端入口 |
|---|---|---|---|---|
| 应用本体（Windows 打包态） | GitHub latest release 的 `latest.yml`（electron-updater） | 整包下载（blockmap 差量）→ 重启换装 | 后台下载，就绪后弹「重启安装」 | `lib/auto-update.js` |
| 应用本体（macOS / 开发态） | GitHub REST `releases/latest` | 不下载，只引导去 Release 页 | 「发现新版本」弹窗 → 打开网页 | `lib/update-check.js` |
| dsh 上游本体 | npm registry dist-tags（`latest`/`next` 取较新者） | 不获取，纯提示；实际获取随应用整包 | 「dsh 上游已发布新版本」弹窗（每版一次） | `lib/plugin-channel.js` 的 `checkDshCore` |
| 预装插件（8 个） | 滚动 release `plugin-channel` 的 `plugin-channel.json`（schema v2） | 只下载变化插件的闭包切片 tar → 外科替换 profile | 「内置插件有 N 项更新」→ 确认后 dsh 短暂重启 | `lib/plugin-channel.js` + `lib/plugin-update.js` |

三者的共同纪律：**更新是纯增强项，一切失败折叠为具名 outcome 或一行日志，绝不抛进启动链**；
唯一打扰用户的时刻是「有新东西」或「下载完毕」。

---

## 一、应用本体更新（electron-updater 整包）

### 检测机制

- Windows 打包态：`lib/auto-update.js` 的 `scheduleAutoUpdate` 启动后调
  `autoUpdater.checkForUpdates()`。electron-updater 读 `package.json` 的
  `build.publish`（github provider），请求
  `https://github.com/HackSing/dsh-buddy/releases/latest` 指向的 release 里的
  `latest.yml`，比对 `version` 字段与当前版本。
- 通道启用的唯一判定：`isAutoUpdateSupported` = `platform === 'win32' && isPackaged`。
  macOS 自动更新硬依赖代码签名，未签名是天花板，故 mac 只走提示式通道。
- 提示式通道（mac/开发态）：`lib/update-check.js` 的 `checkForUpdate` 直接调
  GitHub REST `releases/latest`，`isNewerVersion` 逐段数值比较（预发布后缀不参与），
  24h 节流（`update-check.json` 状态文件，原子写），同版本只提示一次
  （`lastNotifiedVersion`）。
- 菜单「检查更新」（`main.js` 的 `checkUpdateManually`）`force=true` 绕过节流，
  三态反馈：发现新版（转下载）/ 已是最新 / 失败。

### 下载与安装

- 发现新版后 electron-updater 后台下载整包 exe（约 250MB），优先按 blockmap 差量；
  进度经 `download-progress` 事件推到进度浮层（见第四节）。
- 下载完毕 → `update-downloaded` → `notifyUpdateReady` 弹「立即重启安装 / 稍后」→
  确认后 `quitAndInstall()`，退出时 `before-quit` 照常回收 dsh 进程树。
- 错误哲学：`autoUpdater.logger = null`（自带 logger 会打含响应头的完整堆栈），
  失败只在 `[dsh-buddy] auto update: failed (...)` 落一行日志；下载已开始后的失败
  由浮层 error 态（带重试按钮）接管。

### 发版空窗治理（v0.3.0 起）

问题：双平台打包并行，先完成的 job 建好 release 后 electron-updater 的 latest 即指向它，
另一平台 `latest.yml` 还没传完，窗口期内用户点「检查更新」收到满屏 404 堆栈。

治理两层（`release.yml` + `lib/auto-update.js`）：

1. **草稿先行**：`profile` job 最先跑，先 `gh release create --draft`；macos/windows
   job 只往草稿传资产；末尾 `publish` job `gh release edit --draft=false` 统一转正。
   草稿对外不可见，`/releases/latest` 在整个构建窗口期始终指向上一版。
2. **客户端兜底**：`isPendingReleaseError`（"latest.yml + 404/cannot find"）把残缺
   release 的报错折叠为「已是最新」，兜住旧流水线留下的残缺 release。

### 产物命名的三方错位（已根治，追溯要点）

- electron-builder 磁盘产物名带空格：`DSH Buddy Setup 0.3.0.exe`；
- 它生成的 `latest.yml` 写的是**空格→连字符**的安全名：`DSH-Buddy-Setup-0.3.0.exe`；
- `gh release upload` 传到 GitHub 后资产名被转成**点号**：`DSH.Buddy.Setup.0.3.0.exe`。
- 结果：latest.yml 引用的 URL 404，应用内更新从第一版起就下不动（v0.3.0 实炸后才发现）。

修复：`release.yml` 两平台 job 上传前统一把 dist 产物改名为连字符形式（与 yml 对齐）；
v0.3.0 已发布资产用 GitHub API PATCH 资产名补救，未重打包。macos job 顺带补传了
`latest-mac.yml`（此前 mac 无更新元数据）。

---

## 二、dsh 上游检测（纯提示层）

- `lib/plugin-channel.js` 的 `checkDshCore`：查
  `https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags`，取 `latest` 与
  `next` 中较新者——rc/preview 阶段上游把候选发在 `next` 上，只认 `latest` 会永远漏报。
- 版本比较必须感知 rc 序号：`splitPrerelease` + `compareRelease`
  （`parseVersion` 会丢弃预发布后缀，本体全是 `0.1.0-rc.N` 形态）。
- 只提示不获取：本体实际获取走应用整包更新（内嵌 dsh 随包升级）。每个版本只提示一次
  （`lastNotifiedDshVersion` 记账）。
- 仓库侧另有值班 workflow `dsh-compat.yml`：每日 cron 比对 dist-tag 与
  `package.json` 钉住版本，发现新版跑 `scripts/verify-dsh-compat.js` 四项兼容验证
  并开 issue（同版本去重），**只报告不自动升版本**。

---

## 三、插件热更（schema v2 按包增量，本任务主体）

### 为什么不在用户机上跑 `dsh plugin add`

内嵌 dsh 不带 pnpm，且随包 tar 解出的 profile 其 pnpm 维护通道已坏（virtualStoreDir
漂移，见 docs/knowledge）。所以更新物以**成品 tar** 分发，安装链路全部复用随包
profile 的已实证路径（`lib/bundled-profile.js`）。

### 发布侧：`scripts/build-plugin-channel.js` + `plugin-channel.yml`

1. 版本集合：默认取 `plugins/preinstall-manifest.json` 各包的 registry `latest`；
   `--packages pins.json` 可显式钉版（回滚/灰度）。
2. `computeMinDshVersion`：扫各包 peerDependencies 里 `@deepseek-ai/dsh-*` 的 rc 声明，
   与内嵌版本取较大者——插件上游抬 dsh 版本时通道门槛必须跟着抬，否则等于向旧客户端
   担保它跑不动的插件集合。
3. 全量构建链路不变：`buildWebProfileTar` 在临时 DSH_HOME 里装出成品 profile；
   整包 tar 只是切片原料，不再是发布产物。
4. `materializeProfile`：ubuntu CI 产出的 tar 保留 pnpm 符号链接，解包后
   `dereference` 拷成实体化平铺布局（与 Windows 客户端安装产物同构）。
5. `sliceProfile`：按 `lib/profile-closure.js` 的 `computeClosure`（pnpm-lock.yaml
   传递闭包）逐插件切出 `plugin-<slug>.tar.gz`；`BOOKKEEPING_FILES`（7 件簿记：
   package.json / pnpm-lock.yaml / pnpm-workspace.yaml / cordis.patch.yml /
   .modules.yaml / .pnpm-workspace-state-v1.json / .pnpm/lock.yaml）打成
   `profile-bookkeeping.tar.gz`。
6. `buildChannelV2` 组装 channel JSON 并用**客户端同款校验器** `parseChannelV2`
   自验——发错 schema 会被全体客户端判 invalid-channel，发出前拦下。
7. 上传（`plugin-channel.yml`，手动 `workflow_dispatch` 触发）：滚动 release 固定
   tag `plugin-channel`，资产名恒定（不带版本号），`--clobber` 覆盖，客户端 URL
   永不变；**必须 `--prerelease`**——该 release 只是数据通道，若占住
   `/releases/latest`，应用整包更新会摸到这里找 latest.yml 得到 404。

v2 channel JSON 形状：`{ schema_version: "dsh-buddy/plugin-channel/v2",
packages: [{ name, version, tarball: {url, sha256, size} }], bookkeeping: {url, sha256,
size}, minDshVersion }`。

### 客户端检测：`lib/plugin-channel.js` 的 `checkPluginChannel`

- 24h 节流（`plugin-channel-check.json` 状态文件，点号 staging + rename 原子写）；
  菜单「检查插件更新」`force=true` 绕过。
- 边界校验即分流：`parseChannelV2` 优先，`parseChannel`（v1 整包）兜底通道未切换的
  窗口期；两者都不匹配 → `invalid-channel`，不误装不崩（v0.2.2 旧客户端读 v2 实测
  落此 outcome）。
- `diffChannelVersions`：本地缺失或版本不可解析一律视为需要更新（保守方向，无法证明
  足够新）。
- 版本集合指纹 `channelFingerprint`（`name@version` 排序拼接）去重：同一集合只提示一次。
- `installable = !isNewerRelease(channel.minDshVersion, currentDshVersion)`：
  通道要求的内嵌 dsh 比当前新时**只提示不安装**，提示用户先更应用本体。

### 下载机制：`lib/plugin-update.js` 的 `downloadTarball` / `downloadSlices`

- 流式两遍：fetch body → Transform 计字节（`onProgress({transferred,total})`）→
  写点号 staging 文件 → 另起读流算 sha256 → 不符即删临时文件抛错 → rename 转正。
- v2 聚合进度：`total` = 各切片 size 之和 + 簿记 size，`transferred` 累计跨文件，
  载荷形状与 electron-updater 的 progress 一致，浮层无感。
- 任一失败：失败文件自清 staging，编排层清掉已完成的切片——不留半成品。

### 安装语义（v2 外科替换）：`applyPluginUpdateV2`

时序：读本地 deps → `profileUpgradeDecision` 判定（**preserved 提到下载前**——
清单外插件不为注定不装的单白下几十 MB）→ 逐插件下载切片 + 簿记（全部 sha256 过）
→ `prepareInstall`（壳在这里才停 dsh，把停机压到安装前一刻；Windows 文件锁 +
运行中的 dsh 加载的是旧插件）→ 簿记解包 → **整目录复制 profile 到
`.web.installing` staging** → `applySlicesToStaging` → 备份旧目录 → rename 换入
（失败回滚）→ 壳重启 dsh 并刷新窗口。

`applySlicesToStaging` 三步（顺序不能乱）：

1. **切片覆盖**：`sliceRoots` 求 tar 条目的最深包目录集合（剔除嵌套包含），先删
   替换根再 `untarVerified` 解包（拒绝链接条目与越界路径——内容形状边界）。
2. **删除集 GC**：`planKeySets(旧 lockfile, 新 lockfile, 插件名)` 求「旧闭包减新
   lockfile 全引用」的独占旧键，经 `indexPackages` 磁盘索引翻译成目录删除；
   **跳过切片替换根覆盖的路径**（同名包新旧版本同路径，那里的旧内容已被替换根删过，
   再删会误伤新文件）。
3. **簿记最后落**：`BOOKKEEPING_FILES` 7 件整体换新（spike 实证 dsh 运行时不读
   pnpm-lock 决定加载，无副作用）。

结局四态（`PLUGIN_UPDATE_OUTCOME`）：`installed` / `upgraded`（旧目录备份于
`profiles/web.backup-<版本>`）/ `preserved`（清单外插件，未覆盖）/ `failed`
（原 profile 分毫不动）。v1 整包路径 `applyPluginUpdateV1` 保留为通道未切 v2 的
兼容窗口，入口 `applyPluginUpdate` 按 `update.schema` 分流。

### 布局前提（spike 实证，不要再验）

随包 tar 与 Windows 实体化安装产物的 node_modules 是**平铺真实目录**，`.pnpm`
虚拟存储为空，版本冲突以嵌套 node_modules 表达。闭包以 pnpm-lock.yaml 为准算键集合
（键 = `name@version`，可带 peer 后缀 `(peer@ver)`——任何按 `@` 切分前必须先
`stripPeerSuffix`），落盘时经磁盘索引翻译成目录。平台 optional 依赖
（lightningcss-\* 按 os/cpu 拆包）只影响磁盘翻译层，缺失键收进 `missing` 不报错。

---

## 四、下载进度浮层：`lib/update-overlay.js`

参考 Claude 桌面端左下角的 "Downloading update…" 卡片。无边框窗口的第三个
`WebContentsView`（壳自有 UI，不注入 dsh 页面，皮肤/重渲染不影响），
264×86，左下 16px 边距，随窗口 resize 重排。

- 生命周期 = 下载生命周期：`update-available` 即出现（不等首个 progress），
  下载完成（转重启安装弹窗）或安装收场时隐藏。
- 三态视图模型 `overlayViewModel`：hidden / downloading（百分比 + `x / y MB` +
  速度）/ error（截断 120 字 + 重试按钮）。应用更新与插件更新共用（`subject:
  'app'|'plugin'`，文案分别为「正在下载更新」「正在下载插件更新」）。
- 重试目标随主体走：`showDownloading({ onRetry })` 登记本次重试动作
  （应用更新 → `checkUpdateManually`；插件 → `checkPluginUpdateManually`），
  仅 error 态允许触发。
- `reportError` 在浮层不可见时静默略过：检查阶段的失败已有各自反馈（手动检查弹窗 /
  自动检查日志），浮层只接管「下载已开始但失败」这段盲区。
- IPC 与标题栏同款：一次性 `init` 拉当前状态，发送者校验（`event.sender !==
  view.webContents` 拒绝）挡住伪造调用。

---

## 五、本次发布（v0.3.0）实炸记录

| 问题 | 根因 | 修复 |
|---|---|---|
| 构建窗口期点「检查更新」弹满屏 404 | release 边建边传，latest 提前指向残缺 release | 草稿先行 + publish 转正 + `isPendingReleaseError` 折叠 |
| publish job 失败，草稿未转正 | job 无 checkout，`gh release edit` 靠 git remote 推断仓库报 not a git repository | 显式 `--repo "$GITHUB_REPOSITORY"` |
| 更新下载 "Cannot download" 404 | 产物名三方错位（空格 / 连字符 / 点号，见第一节） | workflow 上传前改名对齐 yml；已发布资产 API 改名补救 |
| mac 无应用内更新元数据 | macos job 只传 dmg，没传 `latest-mac.yml` | 上传清单补上 |

## 关键符号索引

- 应用更新：`isAutoUpdateSupported`、`isPendingReleaseError`、`scheduleAutoUpdate`、`checkForUpdateManually`、`quitAndInstall`、`notifyUpdateReady`
- 提示式通道：`checkForUpdate`、`UPDATE_OUTCOME`、`isNewerVersion`、`lastNotifiedVersion`
- 插件检测：`checkPluginChannel`、`parseChannelV2`、`diffChannelVersions`、`channelFingerprint`、`checkDshCore`、`compareRelease`、`installable`
- 插件安装：`applyPluginUpdateV2`、`downloadSlices`、`applySlicesToStaging`、`planKeySets`、`sliceRoots`、`BOOKKEEPING_FILES`、`prepareInstall`
- 发布侧：`build-plugin-channel.js`、`sliceProfile`、`materializeProfile`、`computeMinDshVersion`、`slugForPackage`
- 浮层：`createUpdateOverlay`、`overlayViewModel`、`OVERLAY_STAGE`
- CI：`release.yml`（draft → publish）、`plugin-channel.yml`（滚动 release）、`dsh-compat.yml`（值班）
