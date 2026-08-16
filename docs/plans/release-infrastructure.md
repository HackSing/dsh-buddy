> 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）
<!-- docs-harness:plan-document/v1 -->

# 发布基础设施:启动更新检查与 dsh rc 追新兼容验证 CI

- 冻结合同：`sha256:8f84739aa86061d612784ef810018e9efdf950406c3b49dcce18d285cf42866c`
- 关键符号：`checkForUpdate`、`lastNotifiedVersion`、`verify-dsh-compat`、`binEntryFrom`

## 背景

壳应用已完成内嵌 dsh + bundled preset/profile 的零依赖分发,但两条发布侧链路缺失:一是用户装好 .app 后没有任何渠道知道有新版本(仓库 HackSing/dsh-buddy 用 GitHub Release 分发);二是内嵌的 @deepseek-ai/dsh 仍是 developer preview(当前钉 0.1.0-rc.6),上游 rc 迭代快,人工追新会在装包链、preset 装载、插件安装链上踩坑而无人发现。main.js 里已有 binEntryFrom(按 package.json bin 字段解析 dsh 入口)与 isUp/waitForServer(HTTP 探测轮询),但都内联在 Electron 主进程文件中,纯 Node 的 CI 脚本无法复用。

## 目标

1) 应用启动后异步查询 GitHub Release,仅在远端版本数值更新时用非阻塞对话框提示一次,带 24 小时节流与同版本去重,失败(离线/超时/尚未发布 release)完全静默;2) 每日 CI 比对 npm dist-tag 与钉住版本,发现新 rc 时在干净工作区跑四项兼容验证(装包+入口解析、preset 单测、bundled preset 装载后 web 启动、manifest 六插件安装后 web 启动),把逐项结论开成 issue,只报告不改版本。

## 非目标

不做自动下载、自动安装或静默升级(只给下载页链接);不做增量/差分更新;不做 Windows 与 Linux 的发布通道适配;CI 不自动修改 package.json 依赖版本、不自动开 PR、不自动重建 web-profile tar;不引入任何第三方依赖(HTTP 用全局 fetch 与 node:http,YAML 只写不解析,issue 用 runner 自带 gh)。

## 成功标准

1) 纯逻辑(版本解析与比较、24 小时节流判定、同版本去重判定)有 node 冒烟脚本逐条断言且全绿;2) IO 编排在本地 stub 下走通全部命名结果:节流跳过、404 尚未发布、限流不可达、有新版本触发通知且状态落盘、同版本第二次不再通知;3) 真实启动 Electron 壳(临时 DSH_HOME + 空闲端口)时更新检查不阻塞 ensureBundledAssets/ensureDsh/createWindow,窗口正常出现,日志出现一行 update check 结果且无对话框;4) 已有启动链路(内嵌 dsh 解析与 HTTP 就绪等待)重构后行为不回归;5) workflow YAML 能被 python yaml.safe_load 解析且 permissions 恰为 contents:read + issues:write;6) verify-dsh-compat.js 以当前钉住版本 0.1.0-rc.6 作为候选版本参数在本机跑通,四项全绿、退出码 0、产出逐项 markdown 报告。

## 执行范围

新增 lib/update-check.js(纯逻辑 + fetch/状态文件 IO 编排,零 electron 依赖);新增 lib/dsh-entry.js(从 main.js 抽出 binEntryFrom,主进程与 CI 脚本共用);新增 lib/http-probe.js(从 main.js 抽出 HTTP 探测与轮询,主进程与 CI 脚本共用);修改 main.js(改用两个新 lib、增加 notifyUpdate/scheduleUpdateCheck 并在 createWindow 之后非阻塞调用);新增 scripts/verify-dsh-compat.js(四步兼容验证 + markdown 报告);新增 .github/workflows/dsh-compat.yml(每日 cron + 手动触发,查版本、跑验证、开 issue)。不改 dist/、不重新打包、不改 package.json 依赖版本。

## 执行内容

批1(共用抽象与启动链重构):lib/dsh-entry.js + lib/http-probe.js,main.js 改为薄适配器调用,真实启动壳验证不回归。批2(更新检查):lib/update-check.js 定义 UPDATE_OUTCOME 单字段结果与纯逻辑函数,再写 fetch/状态文件编排;main.js 增加提示层与接线;冒烟脚本断言纯逻辑,stub 脚本断言 IO 编排全部分支;真实启动验证不阻塞。批3(兼容验证 CI):scripts/verify-dsh-compat.js 逐步独立 try 汇总,临时工作区与两个临时 DSH_HOME,子进程结束必杀;workflow 用 step output 传版本、用 env 传参避免表达式注入,gh issue list 去重后 gh issue create;本机以 0.1.0-rc.6 完整跑一遍并用 python yaml.safe_load 校验 YAML。

## 验收方案

acceptance 资产六条:c1 更新检查纯逻辑冒烟全绿(L2);c2 更新检查 IO 编排 stub 覆盖节流/404/限流/通知/去重五分支(L2);c3 真实启动壳验证更新检查不阻塞启动链且无弹窗(L3);c4 启动链重构后内嵌 dsh 解析与就绪等待不回归(L3,与 c3 同一次真实启动取证);c5 workflow YAML 语法与权限契约校验(L1);c6 verify-dsh-compat.js 本机对 0.1.0-rc.6 四项全绿退出码 0(L3)。全部通过后 settle。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

unchanged

## 约束

不新增第三方依赖;错误不吞:更新检查的可预期状态(节流、尚未发布 release、网络不可达)返回具名结果并只落一行日志,非预期错误在单一边界 catch 处记录且绝不弹窗、绝不影响启动;兼容验证脚本每步独立 try 但失败必须体现在退出码与报告里;防御代码准入:状态文件用 staging+rename 写入使半截文件不可达,故不为损坏 JSON 加兜底分支;不碰 ~/.dsh,验证一律用临时 DSH_HOME;不在公开仓库文件里出现分发定价相关措辞。

## 风险与回滚

风险:GitHub API 未认证限流(60 次/小时/IP)会让检查落到不可达分支,24 小时节流已把单机频次压到极低;CI 的 ubuntu-latest 与本机 macOS 存在环境差异(pnpm 布局、原生模块),本机全绿不等于 CI 全绿,首跑需人工看 issue;dsh rc 上游可能改 bin 字段或 web 子命令参数,这正是本 CI 要暴露的信号;预发布后缀不参与版本比较,rc 版 tag 不会被当作更新推给用户(保守取向)。回滚:删除三个 lib 新文件与 scripts/verify-dsh-compat.js、.github/workflows/dsh-compat.yml,并把 main.js 的 binEntryFrom/isUp/waitForServer 内联实现与去掉更新检查接线即回到当前状态。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/release-infrastructure.json`
- 需要 Acceptance：true
- Knowledge 影响：unchanged
<!-- docs-harness:plan-governance:end -->
