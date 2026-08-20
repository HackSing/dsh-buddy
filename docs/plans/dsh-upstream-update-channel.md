> 状态：已实施-仅追溯（代码已是真源，2026-08-20 核对）
<!-- docs-harness:plan-document/v1 -->

# dsh 上游与预装插件的运行时更新通道

- 冻结合同：`sha256:3ca6eab1a0e1b88faffd9ec8f76606ea6c2591e770f95d96ad6828029b2341f5`
- 关键符号：`profileUpgradeDecision`、`installBundledProfile`、`checkPluginChannel`、`plugin-channel.json`

## 背景

dsh-buddy 把 dsh 上游分三层集成：dsh 本体+核心插件钉在 package.json 随安装包分发（main.js 用 ELECTRON_RUN_AS_NODE spawn 内嵌 dsh，另有两处 postinstall 源码补丁）；预装插件（plugins/preinstall-manifest.json 八包）由构建机 scripts/build-web-profile.js 打 tar 随包分发，运行时 lib/bundled-profile.js 解包到 DSH_HOME/profiles。上游更新后用户目前只能等新安装包。热更的硬约束已由 Knowledge 实证：内嵌 dsh 不带 pnpm，dsh plugin add 转发 pnpm；且随包 tar 解出的 profile 带构建机 pnpm 元数据（virtualStoreDir 指向已清理的临时目录），用户机上 pnpm add/remove 被 ERR_PNPM_UNEXPECTED_VIRTUAL_STORE 挡死——终端机上的 dsh plugin 维护通道不可用，热更不能走用户机 pnpm。

## 目标

用户安装 DSH Buddy 后，dsh 上游或预装插件更新时能通过应用内通道获取最新内容：预装插件走运行时热更（下载整 profile 更新 tar，复用 installBundledProfile 已实证的解包/备份/回滚链路，不依赖用户机 pnpm）；dsh 本体更新走检测提示 + 现有 electron-updater/update-check 整包通道。

## 非目标

不做 dsh 本体的运行时热替换（与两处源码补丁、ELECTRON_RUN_AS_NODE 运行时耦合，风险不可控）；不在用户机上运行 pnpm/dsh plugin add；不覆盖用户自行安装的清单外插件（preserved 语义不变）；不改 bundled presets 的随包更新机制；不做增量 diff 包（整 profile tar 已足够小且链路已实证）。

## 成功标准

1) 插件 channel 发布新版后，用户端 24h 节流内检测到并在确认后完成热更，dsh 重启后 HTTP 200、新插件生效；2) 热更后的 profile 在下次启动时不被随包旧 manifest 回滚；3) dsh 本体上游发新版时用户收到具名提示；4) 下载损坏（sha256 不符）时不污染现有 profile；5) 全链路失败只落日志与弹窗，不阻断 dsh 启动。

## 执行范围

lib/bundled-profile.js（决策方向性）、新增 lib/plugin-channel.js（检测）、新增 lib/plugin-update.js（下载安装编排）、main.js（启动接线+菜单入口）、test/ 新增单测、scripts/build-plugin-channel.js（发布侧）、CI/release 通道。

## 执行内容

批 1（前提修正）：profileUpgradeDecision 增加方向性比较——复用 lib/update-check.js 的 parseVersion/isNewerVersion，当 profile 中全部清单包版本 ≥ manifest 版本时返回 up-to-date，仅当存在 profile 版本落后或缺包时才 upgrade；extras/preserved 语义不动。配套单测覆盖『热更领先不被回滚』『随包新版正常升级』『版本不可解析保守升级』。批 2（检测层）：新增 lib/plugin-channel.js，拉取 GitHub 滚动 release 的 plugin-channel.json（版本集合+tar url+sha256+所需 dsh 版本下限），与本地 profile package.json dependencies 比对（readProfileDeps 从 bundled-profile 导出复用），24h 节流+状态文件+原子写复用 update-check 模式；同时查 npm registry @deepseek-ai/dsh dist-tags 与 DSH_VERSION 比对，本体有新版仅产生提示数据。批 3（安装编排+接线）：新增 lib/plugin-update.js——下载 tar 到 userData staging、sha256 校验、调 installBundledProfile（manifestPackages 取 channel 版本集合）；main.js 在 ensureBundledAssets 后、ensureDsh 前做自动检测，有更新弹窗确认后先装再起 dsh；菜单加『检查插件更新』手动入口，运行中更新走 killDsh 停进程树→装→重新 ensureDsh。批 4（发布侧）：scripts/build-plugin-channel.js 复用 build-web-profile 链路按新版本集合产出 tar 与 channel JSON，gh release 上传滚动 tag；文档与 release-infra-playbook 补一节。

## 验收方案

acceptance create 建立验收目标后逐条 record：1) 单测 node --test 覆盖批 1-3 纯逻辑全绿；2) 端到端真实流程：本地静态服务器挂 channel JSON+新版 tar，驱动检测→确认→下载→安装，断言 profiles/web/package.json 版本更新、旧目录备份存在、dsh 启动探测 HTTP 200；3) 回滚免疫验证：热更后模拟随包旧 manifest 启动，断言 profile 不被替换；4) sha256 损坏包验证：断言现有 profile 原样、错误可见；5) assets-check 收尾。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

updated

## 约束

终端用户机无 pnpm 且随包 profile 的 pnpm 维护通道已坏（Knowledge 实证），排除运行时 dsh plugin add 路线；dsh 本体与两处 postinstall 补丁、Electron 运行时耦合，排除本体热替换；Windows 普通用户无 symlink 特权，复用纯 Node 两遍解包。

## 风险与回滚

主要风险：批 1 决策方向性改变既有升级语义（用单测钉死四分支）；channel 发布基建需滚动 release 权限（失败时降级为只交付检测+提示层，安装引导用户等整包）；插件新版与内嵌 dsh 不兼容（channel 的 minDshVersion 门槛拦截）。

## 源与目标

源：npm registry（dsh 本体 dist-tags，提示层真源）与 GitHub 滚动 release 的 plugin-channel.json（插件热更唯一真源，避免出现『registry 有新版但我们还没出包』的空窗）；目标：用户机 DSH_HOME/profiles/web 经 installBundledProfile staging→解包→rename 原子替换。

## 版本与产物

产物：plugin-channel.json（schema 含 packages 版本集合、tarball url、sha256、minDshVersion）、web-profile-plugins.tar.gz（与随包 tar 同构，顶层目录=profile 名）；客户端状态 userData/plugin-channel-check.json（lastCheckedAt/lastNotifiedFingerprint）；构建侧复用 build/web-profile.tar.gz 链路。channel 的 minDshVersion 高于内嵌 DSH_VERSION 时只提示不安装（插件 keyed slot 等兼容性由 manifest comment 已实证的教训管控）。

## 兼容与灰度

旧版应用无检测逻辑，行为不变；新版应用对已有 profile 只做读取比对，首次热更即走已实证的升级路径；preserved（清单外插件）场景维持不覆盖并提示；批 1 的决策方向性变化对存量用户等价（随包 manifest 与 profile 同源时仍走原升级路径）。灰度：channel 由我们手动发布，发错可撤回 asset 或改回 JSON，客户端 24h 内自然收敛。

## 数据安全

安装前整目录备份（installBundledProfile 现有 backup 机制），替换失败回滚旧目录；下载先落 staging 文件且 sha256 校验通过才触碰 profile；热更全程在 ensureDsh 前或 killDsh 后执行，不写运行中的 dsh 工作目录；用户清单外插件触发 preserved 不覆盖。

## 监控与停止条件

各环节单行具名日志（[dsh-buddy] plugin channel: <outcome>），outcome 单字段线性（throttled/unreachable/up-to-date/notified/installed/failed）；停止条件：连续失败不自动重试当前会话，等下一节流窗口；sha256 不符或解包失败即中止该次更新并保留现场日志。

## 回滚

用户侧：安装失败自动回滚到备份目录；更新后异常可删 profiles/web 重启应用，随包 tar 重装。发布侧：channel JSON 改回旧版本集合即停止推送；批 1 决策方向性若有回归，git revert 单文件即恢复旧语义。

## 交付层分离

交付分四层互不替代：1) 单测（决策/解析/校验纯逻辑）；2) 本地端到端（静态服务器+真 tar+真 dsh 启动探测）；3) 发布侧通道（真实 GitHub 滚动 release 上传+客户端真拉取一次）；4) 安装包层（新机制随下次 dist 出包，electron-updater 换装后生效，macOS 走提示式通道）。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/dsh-upstream-update-channel.json`
- 需要 Acceptance：true
- Knowledge 影响：updated
<!-- docs-harness:plan-governance:end -->
