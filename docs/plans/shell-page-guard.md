> 状态：已实施-仅追溯（代码已是真源，2026-08-23 核对）
<!-- docs-harness:plan-document/v1 -->

# 壳层页面守护:内容页死亡检测与自动恢复

- 冻结合同：`sha256:86ef019fd3fcb00051259ce6f0088aaffafd48d5bd86f145b64cabc11a416dda`
- 关键符号：`attachPageGuard`、`createReloadGovernor`、`extractBootRev`、`probeBody`

## 背景

2026-08-23 mac 端白屏事故:壳窗口内 dsh 页面运行中死亡(主 UI 消失、到 3080 的 WebSocket 断开、仅皮肤精灵 DOM 残留),受控复现实验(scratchpad repro-hotswap)证实文件级触发不产生客户端推送,触发源仍未确认。壳当前对页面死亡零感知:loadContent 之后不监听任何 webContents 生命周期事件,也不感知外部 dsh(restart-web.sh 管理的守护进程)的代际更替。

## 目标

壳成为「窗口内容活性」不变量的所有者:检测页面硬死亡(渲染进程崩溃)、软死亡(主帧加载失败、持续无响应)与服务端代际更替(__DSH_BOOT__ 顶层 rev 变化),带风暴抑制地自动恢复,事件落盘 userData/logs/page-guard.log 供事后诊断。

## 非目标

不接管或重启外部 dsh 守护进程(所有权在 restart-web.sh);不做页面内 DOM 结构心跳探测(耦合 dsh 内部结构,防御代码准入证据不足);不修热替换触发源(证据未到,另案);不新增第三方依赖。

## 成功标准

①渲染进程被 kill -9 后窗口自动恢复且事件落盘;②dsh boot rev 变化后窗口在一个探测周期(30s)内自动刷新;③主帧加载失败自动重试且受风暴抑制(5 分钟最多 3 次、两次间隔≥30s),超限只记日志不再刷;④page-guard 纯逻辑与事件路径单测全绿;⑤既有测试套件无回归。

## 执行范围

lib/page-guard.js(新增)、lib/http-probe.js(新增 probeBody)、lib/dsh-log.js(导出 openLogFile 复用)、lib/frameless-window.js(beginStartupLoading 暴露 contentWebContents)、main.js(挂载守护 + 抽取 refreshWindowContent)、test/page-guard.test.mjs(新增)。

## 执行内容

批1:lib/page-guard.js——extractBootRev/createReloadGovernor 为纯逻辑(时钟可注入),attachPageGuard 为接线层(probe/log/refresh 依赖注入,electron 事件:render-process-gone、unresponsive/responsive 宽限 15s、did-fail-load 仅主帧且排除 ERR_ABORTED);lib/http-probe.js 增 probeBody(状态+响应体);dsh-log.js 导出 openLogFile;单测。批2:beginStartupLoading 增设 win.contentWebContents(全窗口模式单一通道);main.js 抽取 refreshWindowContent(win, url)(runPluginInstall 两处 + 守护恢复共三处消费)并在 loadContent(DSH_URL) 后 attachPageGuard;探测在 contents.isLoading() 时跳过,did-finish-load 后重置 rev 基线,避免与插件热更流程的 reload 撞车。批3:真实验证与资产结算。

## 验收方案

L2:node --test 聚焦 page-guard 单测(governor 时窗/间隔/超限、extractBootRev 提取与容错、fake contents 的事件→refresh 路径)+ 全套件回归。L3:DSH_URL 指向本地受控假 dsh 服务启动壳,kill -9 渲染进程验证自愈,翻转假服务 rev 验证代际自动刷新;证据(page-guard.log 摘录、验证脚本输出)存 docs/acceptance/evidence/shell-page-guard/。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

unchanged

## 约束

防御代码准入:仅覆盖本次事故证实的死亡形态与 Electron 官方生命周期语义,不加投机性防护;业务默认值(探测间隔、宽限、风暴抑制参数)具名常量单一来源;守护完全可卸载(main.js 一处调用)。

## 风险与回滚

风险:代际探测与插件热更自身的 reload 撞车导致双重刷新——以 isLoading 跳过 + did-finish-load 基线重置 + 最小间隔 30s 三重吸收;风险:假阳性 reload 打断用户输入——恢复动作仅由确定性死亡信号或 rev 实变触发,不做启发式。回滚:移除 main.js 的 attachPageGuard 调用即完全停用,新模块无反向耦合。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/shell-page-guard.json`
- 需要 Acceptance：true
- Knowledge 影响：unchanged
<!-- docs-harness:plan-governance:end -->
