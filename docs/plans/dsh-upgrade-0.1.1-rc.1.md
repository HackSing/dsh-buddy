> 状态：已实施-仅追溯（代码已是真源，2026-08-21 核对）
<!-- docs-harness:plan-document/v1 -->

# 内嵌 dsh 升级:0.1.0-rc.8 → 0.1.1-rc.1

- 冻结合同：`sha256:2838540c73ab7e913bfaec60689da316cccd76b4b62c7b151b2f61b47bfcfe90`
- 关键符号：`DSH_VERSION`、`patchClient`、`buildWebProfileTar`、`checkDshCore`

## 背景

上游 @deepseek-ai/dsh 家族于 2026-08-21 发布 0.1.1-rc.1(npm next 标签;latest 仍指 0.1.0-rc.7),全家族 20 个本仓依赖包均已齐发,上游 tag dsh-v0.1.1-rc.1 = commit 528c682e06。dsh-buddy 当前钉 0.1.0-rc.8。预调查已确证的事实:①dsh 主包依赖图谱零增删,仅版本平移;②两个 postinstall 补丁目标——dsh-host-directory-picker-native/lib/worker.cjs 新旧版本逐字节一致,dsh-client-ui-settings-models/lib/client.js 仅一行差异(事件重命名),且 lib/patch-multimodal-ui.js 的 patchClient 六处锚点对 0.1.1-rc.1 产物实跑通过(哨兵齐全);③KNOWN_SESSION_EVENT_TYPES 封闭集与网关 WEB_SETTINGS_NAMESPACES 白名单在本跨度内零变更,docs-harness 插件的三条上游硬约束规避方案继续有效;④settings.plugin.item keyed slot 契约未再变化(rc.6→rc.7 事故形态未复发);⑤新增 conversation.session.header.lineage slot 与 renderSlot 可选 fallback 参数,均为纯增量;⑥host↔client 事件 credentials/updated 重命名为 credentials/reference-updated,本仓源码经 grep 无监听者,第三方插件未知;⑦credentials-local 新增 boot 时对旧 flat .credentials.yaml 的单向迁移(重写为 refs: 嵌套的版本化布局,值逐字节保留),rc.8 解析器无法读取新布局。

## 目标

把内嵌 dsh 全家族 20 个依赖从 0.1.0-rc.8 升到 0.1.1-rc.1,重建 web-profile 与 plugin-channel 产物并产出可安装的 Windows 整包;8 个预装插件在新版本 client 运行时下经浏览器实证可装载;凭证数据迁移安全且回滚路径完整。

## 非目标

不做 0.1.1-rc.1 新能力的产品化接入(subagent header lineage slot 的自绘标题栏联动、credentials/authorization 登录流的 UI 利用,均另立任务);不改插件增量热更 v2 方案本身;不动 preinstall-manifest 的包组成与排除清单;不引入 dsh 本体运行时热替换(维持 dsh-upstream-update-channel 已冻结的非目标边界);不修第三方插件监听旧事件名 credentials/updated 的问题(仅浏览器验证时观察并记录上报);不补多模态补丁的单测欠债(零覆盖现状记录在案,另立任务)。

## 成功标准

①node scripts/verify-dsh-compat.js 0.1.1-rc.1 四步全绿;②版本同抬后 npm install 的 postinstall 两补丁实打成功、npm test 全绿、两补丁 --check 通过;③build/web-profile.tar.gz 重建成功且 8 个预装插件逐包断言落地;④dist:win 出包、NSIS 装机后浏览器验证:页面无 Failed to load plugins、设置页插件条目数符合预期、Models 页多模态开关可操作、原生目录选择器可用;⑤预置旧 flat .credentials.yaml 的环境 boot 迁移后 Models 页 key 存续且模型请求成功;⑥回滚演练:恢复备份凭证文件 + 装回旧包后功能完好。

## 执行范围

必改文件:package.json(dependencies 19 个 @deepseek-ai/dsh* 钉版整组同抬 + allowScripts 的 @deepseek-ai/dsh-subprocess-local@0.1.0-rc.8 带版本 key)、main.js:32 的 DSH_VERSION 常量、package-lock.json(npm install 重生成)。重建产物:build/web-profile.tar.gz(8 插件重装)、plugin-channel JSON(minDshVersion 从 package.json 自动跟随,无需手改)、NSIS 安装包。文档同步:docs/dsh-web-ui-plugin-guide.md 的基线声明(:3、:223-225)、README.md:119/121 两处本已过期的 rc.6 引用、lib/plugin-channel.js:237 与 scripts/build-plugin-channel.js:89 的版本注释。明确不改:test/ 下 fixture 版本值(手造值,与真源无关,rc.8>rc.7 类断言语义不变)、docs/acceptance 历史验收记录、preinstall-manifest 的 8 包版本组成。

## 执行内容

批次 0(前置,用户决策):当前工作树有一批未提交改动(自绘标题栏方案C 收尾、dsh-buddy-about 插件删除、scripts/dist-win.ps1 新增),先由用户落定(提交或 stash),升级改动在干净基线上单独成 commit,不与功能改动混批。批次 1(零改动兼容验证):运行 node scripts/verify-dsh-compat.js 0.1.1-rc.1(四步:装包+bin 解析/preset 单测/preset 装载后 web 200/8 插件装载后 web 200);同时观察 pnpm 对跨元组 peer 声明(@aiwaretop/dsh-docs-harness 的 ^0.1.0-rc.6、dsh-better-sidebar 的 ^0.1.0-rc.7 按 semver 预发布规则均不含 0.1.1-rc.1)是仅警告还是硬失败——这是本次升级新出现的形态,rc.8 时代同元组不触发。批次 2(版本同抬):package.json 19 pins 与 allowScripts key 改 0.1.1-rc.1、main.js DSH_VERSION 同步;npm install 触发 postinstall 两补丁真打;npm test 回归;两补丁 --check 复验。批次 3(产物重建):npm run dist:win 全链(patch --check → build-web-profile 重装 8 插件 → electron-builder);若批次 1 证实 peer 硬失败,docs-harness 在真源仓 D:\Project\docs-harness\dsh-plugin 发放宽 peer 范围的补丁版并更新 preinstall-manifest 钉版,dsh-better-sidebar 属第三方,报告用户决策。批次 4(真机验收):NSIS 装机(避开 Temp 安装位陷阱,装正常目录);浏览器验证插件装载(查 document.body 是否含 Failed to load + 设置页数插件条目,明令禁止以 HTTP 200 探针替代);Models 页多模态开关;原生目录选择器;标题栏三态与皮肤跟随回归;docs-harness 设置面 loopback 读写;凭证迁移场景(预置 flat 布局 → boot 迁移 → key 存续 + 模型请求成功)。收尾:文档与注释同步、knowledge 更新、acceptance settle、plan settle,统一 assets-check。

## 验收方案

acceptance create 建立与本 Plan 关联的验收资产,按五层逐条 record:①契约层——patchClient 对 0.1.1-rc.1 产物实跑与 --check 输出;②测试层——npm test 全量输出(模块级回归);③运行层——verify-dsh-compat.js 四步退出码与日志;④安装层——dist:win 产物与 NSIS 装机结果;⑤用户可见层——浏览器插件清单截图/条目数、多模态开关操作、凭证迁移前后对照。失败修复后显式 --reaccept;五层证据不得相互替代;User Acceptance 仅在收到用户明确确认原话后以 --user-confirmed 记录,最终 acceptance settle 结项。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

updated

## 约束

升级 commit 不夹带任何功能改动;用户机无 pnpm 且 dsh plugin add 通道已坏(ERR_PNPM_UNEXPECTED_VIRTUAL_STORE),预装只能依赖构建机 tar 链路,不得引入用户机 pnpm 依赖;浏览器验证不可用 HTTP 200 探针替代(rc.7 keyed slot 事故的假阳性前科);0.1.1-rc.1 属 next 预览通道而非 latest,正式对外发布节奏由用户决定,本方案只交付到可安装验收态。

## 风险与回滚

R1 跨元组 peer 不匹配:docs-harness/better-sidebar 的 peer 范围不含 0.1.1-rc.1;pnpm 默认非 strict 预期仅警告,若硬失败则 docs-harness 发新版放宽(真源在手可控),better-sidebar 报告用户决策。R2 凭证单向迁移:升级 boot 后 .credentials.yaml 变为 rc.8 不可读的版本化布局,回滚必须连同恢复备份文件,否则 Models 页 key 全部失联。R3 第三方插件若监听旧事件 credentials/updated 会静默失效,浏览器验证时观察,不阻断本次升级。R4 预装插件在新 client 运行时装载失败(keyed slot 类前科):verify 第四步与真机浏览器双保险,失败则逐插件二分定位。R5 上游预览通道可能快速跟发后继 rc,冻结本方案时以 0.1.1-rc.1 为唯一目标,后继版本重新走增量评估。

## 源与目标

源:@deepseek-ai/dsh 家族 0.1.0-rc.8(npm registry;本仓钉版位置为 package.json dependencies 19 包、allowScripts 1 个带版本 key、main.js DSH_VERSION 常量)。目标:同家族 0.1.1-rc.1(npm next 标签,2026-08-21 发布;上游仓库 tag dsh-v0.1.1-rc.1 = commit 528c682e06,本地上游镜像 D:\Project\deepseek-harness 已 fetch 到该 tag)。

## 版本与产物

dsh-buddy 应用版本从 0.3.0 上抬(上游跨 minor,建议 0.4.0,最终版号由用户在发布时定夺);产物清单:NSIS 安装包(scripts/dist-win.ps1 → electron-builder)、build/web-profile.tar.gz(buildWebProfileTar 重建,8 插件重装)、plugin-channel JSON(schema v2,minDshVersion 由 build-plugin-channel.js 从 package.json 读取自动跟随)、package-lock.json(npm install 重生成,数百条 0.1.0-rc.8 引用自动平移)。

## 兼容与灰度

证据前置:批次 1 在零改动状态完成四步兼容验证后才动版本号;构建机先行、真机后行;真机采用独立目录 side-by-side 安装验证,不覆盖用户现役安装;对外发布沿用既有 electron-updater 整包通道,推送时点由用户决定;8 个预装插件版本不动,兼容性以浏览器实证为准;应用内 checkDshCore 升级后与上游一致,不应再弹新版本提示(负向验证点)。

## 数据安全

受影响用户数据:DSH_HOME 下 .credentials.yaml(0.1.1-rc.1 boot 单向迁移为 refs: 嵌套版本化布局,上游承诺值逐字节保留)、profiles/ 目录(整包 tar 替换,无格式迁移)、会话数据(本跨度 session 包变更经核对为快照/投影内部实现,无持久化格式变化)。动作:真机验收前备份 .credentials.yaml;迁移后核对 key 值与迁移前一致;回滚流程把恢复该备份列为必做步骤;验收环境使用测试凭证,不动用户真实生产 key。

## 监控与停止条件

停止条件:verify-dsh-compat 任一步红灯→停,先归因再继续;npm test 出现非 fixture 语义的失败→停;浏览器出现 Failed to load plugins→停,逐插件二分;凭证迁移后模型请求失败→停并立即恢复备份。监控:装机首启日志(plugin-channel 检测线、补丁降级线)、dsh-compat.yml 每日 CI 在升级合入后应恢复绿灯(它比对 latest 标签,升级后 latest 仍为 rc.7 时该 CI 逻辑对 next 不告警,属预期,不据此判定失败)。

## 回滚

仓库侧:git revert 升级 commit → npm install 重打补丁 → 重建产物即可,无不可逆改动。真机侧:卸载新包、装回旧 NSIS 包,并恢复备份的 .credentials.yaml(关键步骤:不恢复则 rc.8 解析器读不了迁移后布局,凭证全部失联);profile 为整包分发,旧包自带旧 profile,无残留状态。已经 electron-updater 推送的场景:按其单调版本号约束,回退需以更高版本号发布回退包,该场景仅在用户决定正式推送后才存在。

## 交付层分离

契约层(补丁函数对新产物的实跑与 slot/事件契约核对)、测试层(npm test)、运行层(verify-dsh-compat 的 web 200 四步)、安装层(NSIS 装机)、用户可见层(浏览器插件清单、多模态开关、目录选择器、凭证可用性)五层分离,逐层独立记录证据,不得相互替代;HTTP 200 明确不计入用户可见层证据;每层证据随 acceptance record 落资产。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/dsh-upgrade-0.1.1-rc.1.json`
- 需要 Acceptance：true
- Knowledge 影响：updated
<!-- docs-harness:plan-governance:end -->
