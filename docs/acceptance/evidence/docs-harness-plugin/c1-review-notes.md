# c1 架构合同评审记录（主 agent 独立评审，2026-08-17）

评审对象：D:/Project/dsh-docs-harness @ fa5e1ba + dsh-buddy 工作区三文件改动。
对照合同：docs/plans/docs-harness-plugin.json（指纹 c6567e57…）。

## 逐项核对结论

1. **双闸门禁**（src/host/index.js:68-152）：治理开关默认开启（DEFAULT_GOVERNANCE_ENABLED），
   关闭时整个子 fiber dispose——工具/注入/投影/路由全部随之拆除；settings onChange 驱动
   reconcile；teardown 失败记日志不吞错。
2. **逐字注入**（src/host/rules-section.js + project-state.js:107-144）：正文取项目 AGENTS.md
   受管块原文（mtime+size+TTL 缓存），损坏回退种子同版本文本；仅追加工具适配注记。
   单测含注入文本与受管块逐字一致性断言。
3. **无懒启用为结构性保证**（src/host/routes.js + tool-support.js:35-39）：project
   init/upgrade/uninstall 不是 agent 工具，是仅限 loopback 的 HTTP 路由；操作目录只从
   session store 解析（routes.js:79-83），绝不取自请求体；未启用项目调 plan 工具收到
   NOT_ENABLED_HINT（constants.js:122），明确指示模型让用户去提示条/设置。
4. **投影语义**（src/host/plan-projection.js）：standing（无 turn/start 臂）；状态随
   tool/result 而非 tool/call 迁移；折叠内建事件绕开"自定义会话事件导致日志不可加载"
   的上游硬约束；同引用变更门避免无关事件推帧。
5. **确认门禁**（src/host/plan-review.js + tools.js:74-111）：plan create 冻结后阻塞在
   execute 内等用户裁决（复用内置 plan-review 意图）；退回/关卡均走工具错误路径，
   模型收到"不要开始实施"的明确文案。
6. **转圈态**（src/client/EnableNoticeBar.jsx）：working 态 spinner + aria-busy + 按钮
   disabled + busy ref 防重入。
7. **零内核补丁**：无对 @deepseek-ai 包的任何 patch；dsh-buddy 侧未触碰 main.js、
   现有 preset、lib/bundled-presets.js。
8. **体量红线**：src 最大文件 199 行（tools.js），全部低于 500 行红线。

## 偏差评估

执行报告所列 6 处偏差逐一复核，均属合理工程判断；其中"project 三操作做成路由而非工具"
强于方案原文的约束，予以认可并回写本记录。

## 修订（2026-08-17 下午）：设置面偏差与第三条上游硬约束

用户真机反馈「Docs Harness 设置卡片报 设置服务不可用」。根因定位（复现于打包运行时）：
上游 apiproxy 的 settings.describe/update 只服务编译进包的命名空间白名单
（api-proxy.ts:126 WEB_SETTINGS_NAMESPACES、:256 PRODUCT_SETTINGS_NAMESPACES、
:3268 describe 过滤、:2009 写拒绝），上游注释明说「插件自暴露命名空间」是 deferred
work。第三方插件设置区经通用 settings 传输在 web 客户端结构性不可达——host 侧注册
成功、值可解析、watch 正常，仅网关一层被滤。第一轮评审与 126 例单测未覆盖网关层，
故漏检。

偏差处置（v0.1.1 @ 72a68e2）：设置读写改走插件自有 /docs-harness-settings loopback
路由（与 project 三操作同构），client 以接口兼容的 HarnessSettingsStore 顶替
settingsScope 绑定；host 仍经 installSettingsSection 注册 + settings 服务读写，
settings.yaml 唯一真源、门禁 watch 实时翻转不变。控制面路由挂插件根 fiber（关态
存活，否则总开关成单行道），「关掉即等于没装」边界在 README 同步改述。评审结论：
偏差成立且必要，方案合同其余条款不受影响。
