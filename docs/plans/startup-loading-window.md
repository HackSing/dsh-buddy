> 状态：已实施-仅追溯（代码已是真源，2026-08-22 核对）
<!-- docs-harness:plan-document/v1 -->

# 启动加载窗口:首屏即时反馈与启动链解耦

- 冻结合同：`sha256:71c2559b8f2c13eac732214159ab1af82acf03ddd9dd329b369d444cb6ba4ab6`
- 关键符号：`installBundledProfile`、`attachContentExtras`、`buildStageScript`、`ensureDsh`

## 背景

2026-08-22 实测(安装于 D:\Project\dsh-buddy-verify-install 的 0.4.1 包):点击图标到窗口出现耗时约 99 秒——ensureBundledAssets 同步解压随包 profile(120.6 MB tar → 14,245 文件)约 18 秒,ensureDsh 等待内嵌 dsh 加载插件依赖树约 81 秒(首启叠加 Windows Defender 逐文件扫描)。main.js whenReady 的顺序是 ensureBundledAssets → await ensureDsh → waitForTitlesSettled → createWindow,窗口创建被整条启动链闸住,全程无任何用户可见反馈;期间再次点击图标,单实例锁使新实例立即退出,second-instance 处理器因 win 仍为 null 而静默无动作。用户感知为『点了没反应、再点还是没反应』。曾评估把 profile 解压前置到 NSIS 安装器,因升级决策状态机(up-to-date/upgraded/preserved)无法进 NSIS、macOS 无安装器、跨卷复制无收益而否决,改走本方案。

## 目标

应用启动后 2 秒内出现带加载状态的主窗口;加载页显示当前启动阶段(准备内置资产/启动 dsh 服务);dsh 就绪后同一窗口原地切换到 dsh 页面;启动期间重复点击图标聚焦已有加载窗口(复用现有 second-instance 处理器,win 提前存在后自然生效)。

## 非目标

不缩短 dsh 本体启动耗时(依赖树加载与 Defender 扫描不在本方案范围);不把 profile 解压搬入 NSIS 安装器(已否决,理由见背景);不为加载页增加错误态 UI(启动失败仍走现有 showDshFailure 对话框 + 退出);不改 macOS Dock 常驻行为;不改三种窗口模式的选择逻辑与标题栏行为。

## 成功标准

1) Windows 实机点击图标后 ≤2 秒出现主窗口且加载页可见(阶段文案随启动推进更新);2) 启动期间(dsh 未就绪)再次点击图标,已有窗口被聚焦/还原,新实例立即退出;3) dsh 就绪后窗口内容切换为 dsh 页面,后续行为(菜单/热更/皮肤同步)与现状一致;4) 同步解压改异步后,加载窗口在解压期间保持响应(可拖动、spinner 持续动画);5) node --test 聚焦测试(bundled-profile、loading-page、既有窗口相关测试)全绿;6) 启动失败路径(dsh 超时/spawn 失败)仍弹既有对话框并退出,不出现窗口残留。

## 执行范围

main.js(whenReady 启动时序重排、createWindow 初始 URL、macOS 分支 loadContent 对齐、ensureDsh 增加 quitting 前置守卫);lib/frameless-window.js(attachContentExtras 增加 loadContent,三种模式初始加载改为加载页);lib/bundled-profile.js(collectLinks/tar.x 由 sync 改 promise 模式,installBundledProfile 转 async);新增 lib/loading-page.js(LOADING_PAGE_PATH 与 buildStageScript 纯函数)与 lib/loading.html(静态加载页);test/bundled-profile.test.mjs(适配 async);新增 test/loading-page.test.mjs。不触碰:lib/plugin-update.js、lib/auto-update.js、NSIS 配置、随包 profile 构建链。

## 执行内容

批次1(加载页与窗口层):新增 lib/loading.html——纯静态页,背景 #f3f3f3 与 createShellWindow 底色一致,CSS spinner(动画在渲染进程合成,主进程短暂繁忙不冻结)+ 阶段文案元素,页内暴露 window.__setStage(text);新增 lib/loading-page.js 导出 LOADING_PAGE_PATH 与 buildStageScript(text)(JSON.stringify 转义,复用 buildBuddyInfoScript 的注入模式);lib/frameless-window.js 的 attachContentExtras 增加 win.loadContent(url) 与 win.setStartupStage(text)(executeJavaScript 注入,失败仅记 warn,与 buddy info 注入同款降级),三种创建器把末尾 loadURL(dshUrl) 改为加载 LOADING_PAGE_PATH,dshUrl 参数保留供后续导航;main.js macOS 沉浸式分支同样先 loadFile 加载页,并补挂同形 loadContent/setStartupStage。批次2(解压异步化):lib/bundled-profile.js 的 collectLinks 与 tar.x 去掉 sync:true 改 await promise 模式,installBundledProfile 转 async(返回值形状不变,staging/rename/回滚逻辑不动,applyLinks 保持同步——链接条目数量小);main.js ensureBundledAssets 转 async 并 await;test/bundled-profile.test.mjs 各用例改 await。批次3(启动时序重排):whenReady 改为 createWindow(加载页)→ setStartupStage('正在准备内置资产…')→ await ensureBundledAssets → installTitleRepair → setStartupStage('正在启动 dsh 服务…')→ await ensureDsh → 标题就绪门 → win.loadContent(DSH_URL) → scheduleUpdateCheck/schedulePluginChannelCheck(位置不变,保持与启动链解耦);ensureDsh 在 spawn 前检查 quitting(用户在启动期关闭加载窗口触发 window-all-closed → app.quit 是本方案新引入的可达状态,防止退出后再 spawn dsh 遗留孤儿进程);runPluginInstall 的 macOS 分支 win.loadURL(DSH_URL) 统一改 win.loadContent(DSH_URL)。second-instance 处理器零改动:win 提前存在后现有 restore+focus 即为启动期反馈。

## 验收方案

层1 契约/单测:node --test 聚焦 test/bundled-profile.test.mjs(async 化后全部用例)、test/loading-page.test.mjs(buildStageScript 转义/LOADING_PAGE_PATH 存在)、test/borderless-window.test.mjs 等既有窗口测试回归。层2 开发态运行:npm start 观察窗口即时出现、阶段文案推进、dsh 就绪后原地切换;窗口在解压期间可拖动。层3 Windows 实机(打包态):dist:win 产物安装后冷启动计时(点击→窗口 ≤2s;总时长与现状持平不劣化),启动期间二次点击验证聚焦;dsh 页面加载后按 rc.7 经验开浏览器/窗口实际目验插件 client 侧完好,不以 HTTP 200 作为通过依据。失败路径:临时将 DSH_URL 指向不可达端口验证超时对话框与退出无窗口残留。User Acceptance:用户实机确认『点击即有窗口、二次点击有反应』后结项。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

unchanged

## 约束

installBundledProfile 的三态决策(up-to-date/upgraded/preserved)与 staging→rename 原子替换语义不得改变,仅执行方式转异步;加载页为本地静态文件,不引入新依赖、不发网络请求;窗口基础参数(尺寸/底色)沿用 createShellWindow 单一来源;阶段文案注入失败只降级不阻断(与既有 buddy info 注入同一策略);提示词与代码流程同步规则不适用(本改动不涉及工具解锁/状态机提示词)。

## 风险与回滚

风险1:tar promise 模式与 sync 模式在链接条目处理上行为差异→由既有 bundled-profile 测试套件(含 symlink/hardlink 用例)兜住,任何差异在层1 即暴露。风险2:加载页→dsh 页导航与 attachBuddyInfo/attachThemeSync 的 did-finish-load 监听交互(加载页也会触发注入/探针)→注入对无关页面是无害 no-op,皮肤探针读到加载页 #f3f3f3 与底色一致;层2 目验。风险3:启动期关窗的退出竞态→ensureDsh 的 quitting 守卫 + 既有 before-quit 回收链覆盖,层3 验证无孤儿进程。回滚:三批次各自独立可逆,整体回滚即恢复 whenReady 原顺序与 sync 解压,无数据迁移、无持久状态变更。

## 用户与场景

Windows 桌面用户(主场景:NSIS 安装或整包升级后的首次启动,冷启动总耗时可达 99 秒;次场景:日常启动,dsh 加载仍需数十秒)。用户动作:双击桌面/开始菜单图标;等待期间可能再次点击图标。macOS 用户同样受益(时序重排与加载页跨平台)。

## 入口与用户流程

入口:桌面快捷方式/开始菜单/Dock。流程:点击图标 → ≤2s 出现主窗口(加载页:logo/产品名 + spinner + 阶段文案『正在准备内置资产…』)→ 文案切换『正在启动 dsh 服务…』→ dsh 就绪后同窗口原地导航到 dsh 页面,进入现有使用流程。分支A(启动期二次点击):新实例立即退出,已有加载窗口还原并聚焦。分支B(启动失败):showDshFailure 对话框(含日志路径与最近输出)→ 确认后应用退出。分支C(启动期用户关窗):窗口关闭即退出,dsh 不再拉起、已拉起的整树回收。

## 完整状态矩阵

内容视图状态(单字段线性流转):loading.assets(准备内置资产)→ loading.dsh(启动 dsh 服务)→ content(dsh 页面);任一 loading 态遇失败 → 对话框 → 退出(无独立错误页状态)。窗口模式 × 状态:native/legacy/borderless/macOS 沉浸式四种模式下 loading 与 content 均经同一内容视图承载,标题栏/菜单/拖拽行为按各模式现状不变;legacy 皮肤同步在 loading 态读到加载页底色(与标题栏默认色一致,无跳变),content 态恢复跟随 dsh 皮肤。second-instance × 状态:win 存在(loading 或 content)→ restore+focus;win 为 null(仅 whenReady 之前的极短窗口)→ 维持现状无动作。

## 组件与交互

loading.html(静态页:品牌区、spinner、阶段文案,暴露 __setStage);loading-page.js(路径常量 + 注入脚本纯函数,接口先行、仅导出这两项);attachContentExtras 扩展(loadContent/setStartupStage,与既有 reloadContent/updateOverlay 同一挂载点,复用而非新写);main.js whenReady 作为唯一编排者驱动阶段推进与最终导航。交互:阶段文案由主进程单向推送,加载页无回传、无 IPC 通道、无 preload;二次点击交互完全复用既有 second-instance 处理器。

## 视觉与响应式

加载页背景 #f3f3f3 与 BaseWindow backgroundColor 一致,窗口出现无白闪;内容水平垂直居中(flex),1280×800 默认尺寸与用户任意缩放下均居中;spinner 为纯 CSS 动画;深浅色:MVP 固定浅色(与窗口底色单一来源一致),dsh 页面加载后由其自身皮肤接管;文案中文(与应用菜单默认 locale 一致),不引入字体资源,系统字体栈。

## 可访问性

阶段文案为真实 DOM 文本(非图片),屏幕阅读器可读;spinner 容器标注 role=status + aria-live=polite,阶段切换可被播报;颜色对比:文本 #333 于 #f3f3f3 底,对比度 ≥ 4.5:1;无交互元素,无键盘陷阱;动画尊重 prefers-reduced-motion(减弱为静态指示)。

## 设计系统复用

复用既有单一来源:窗口底色/尺寸取自 createShellWindow,注入转义模式复用 buildBuddyInfoScript 同款 JSON.stringify 纯函数拼装,降级策略复用 buddy info 注入的 warn-only;不引入组件库/样式框架(加载页是应用内唯一自绘页面,与 frameless-titlebar.html 同级的内联样式静态文件,风格对齐其简洁形态);无重复逻辑新增——loadContent 统一了此前 reloadContent 之外散在 main.js 的两处导航写法。

## 真实页面或桌面运行态验收

见 acceptance_plan 层2/层3:开发态 npm start 与 Windows 打包实机双层运行态验收,含启动计时、二次点击聚焦、解压期窗口响应性、失败路径对话框、dsh 页面浏览器级目验(不以 HTTP 200 为准);最终以用户实机确认原话结项 User Acceptance。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/startup-loading-window.json`
- 需要 Acceptance：true
- Knowledge 影响：unchanged
<!-- docs-harness:plan-governance:end -->
