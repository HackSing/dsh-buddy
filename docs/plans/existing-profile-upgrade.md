> 状态：已实施-仅追溯（代码已是真源，2026-08-19 核对）
<!-- docs-harness:plan-document/v1 -->

# 存量 profile 随包升级：幂等跳过改为版本比对后的备份替换

- 冻结合同：`sha256:2833068d28457a86fbe9df695fa5db062b018ed50790af21502f6be11c6a341a`
- 关键符号：`installBundledProfile`、`preinstall-manifest`、`profileUpgradeDecision`、`dsh.profile.bundles`

## 背景

lib/bundled-profile.js 的 installBundledProfile 对已存在的 dshHome/profiles/<name> 直接返回 'skipped'。该幂等设计的初衷是尊重用户已有环境，但代价是随包插件只送达全新安装：早于某次预装变更建立的 profile 永远拿不到后续新增或升级的插件。本次内嵌 dsh 升到 0.1.0-rc.7 把这个长期缺口变成了硬故障——rc.7 把客户端插槽 settings.plugin.item 从 list slot 改成 keyed slot，旧版插件缺 key 会让整条 client loader entry 装载失败。用户本机 ~/.dsh/profiles/web 仍是 @linxin666 六件套 0.1.16 + @aiwaretop/dsh-docs-harness 0.1.1，装上新版应用后内嵌 dsh 是 rc.7 而 profile 还是旧插件，页面只剩 Failed to load plugins。该现象已在本会话实测观察到（误连到以 ~/.dsh 为 DSH_HOME 的残留 dsh web 进程时复现）。缺口本身已登记在 docs/knowledge/preinstall-existing-user-gap.md 的 gap.idempotent-skip。

## 目标

让已存在 profile 的用户在升级应用后拿到随包清单声明的插件版本，同时不破坏用户自行安装的插件；无法安全升级时明确告知而不是静默跳过或静默覆盖。

## 非目标

- 不引入运行时 pnpm 或网络安装：桌面应用不携带 pnpm，升级只能来自随包 tar
- 不做逐包增量合并：profile 的 node_modules 是 pnpm 布局的整棵树，按包目录拼接会留下版本错配的传递依赖
- 不修 gap.virtual-store-drift（解包 profile 携带构建机 virtualStoreDir）：与本次根因无关，另案处理
- 不改 plugins/preinstall-manifest.json 的内容或 profile 构建链路

## 成功标准

- 已存在 profile 且其 dependencies 版本与清单一致时返回 up-to-date，不动磁盘
- 已存在 profile 且版本落后或缺包、且无清单外依赖时，旧 profile 备份后被随包版本替换，返回 upgraded
- 已存在 profile 但含清单外依赖时保留原样并返回 preserved 及具体包名，不覆盖不删除
- 无 profile 时行为与现状一致，返回 installed
- tar 资源缺失时返回 no-tarball，不视为错误
- 升级失败不阻断应用启动，且失败时旧 profile 仍可用

## 执行范围

- lib/bundled-profile.js：新增升级判定与备份替换，导出保持最小
- main.js：消费新的返回值，preserved 时提示用户
- scripts/verify-bundled-profile.js 或同层测试：补齐四种判定分支的用例

## 执行内容

- 读取现有 profile 的 package.json dependencies，与 plugins/preinstall-manifest.json 的 packages 比对，得出 up-to-date / upgraded / preserved 三态判定，判定函数纯函数化以便单测
- 判定为 upgraded 时：先把随包 tar 解到 staging（复用现有两遍解包），成功后把旧 profile 目录整体重命名为同级备份目录，再把 staging 结果 rename 到位；任一步失败回滚到旧目录
- main.js 按返回值分支输出日志；preserved 时用 dialog 告知用户哪些清单外插件挡住了升级以及如何手动处理

## 验收方案

以隔离 DSH_HOME 构造四种前置状态（无 profile、版本一致、版本落后无额外包、含额外包），分别跑 installBundledProfile 断言返回值与磁盘结果；再用真实打包应用对一份复刻自用户 live profile 的旧版 profile 做一次端到端升级，浏览器实读确认 8 插件全部已启用且无 Failed to load plugins。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

updated

## 约束

- 桌面应用无 pnpm、不保证有网络，升级来源只能是随包 tar
- profile 目录为纯派生物（package.json / node_modules / pnpm-lock.yaml / pnpm-workspace.yaml / cordis.yml / cordis.patch.yml），用户会话与设置在 DSH_HOME 根，不在 profile 内
- profiles/node_modules 的平铺回退 junction 由上游 dsh-app-boot 每次启动重建，替换 profile 目录不需要本仓处理

## 风险与回滚

- 误判为无额外依赖而替换，导致用户手装插件丢失 → 判定只信 profile package.json 的 dependencies，任何清单外条目一律 preserved；且替换前整目录备份，回滚即改名
- 备份目录累积占用磁盘 → 备份名带版本标识，同名复用，不无限累积
- 替换中途进程被杀 → 先 staging 解包成功再动旧目录，rename 为原子操作，最坏情况留下 staging 或备份目录，旧 profile 不丢

## 精确复现

1) 取一份 dependencies 为 @linxin666 六件套 0.1.16 + @aiwaretop/dsh-docs-harness 0.1.1 的 profile 放到隔离 DSH_HOME 的 profiles/web；2) 用内嵌 dsh 0.1.0-rc.7 起 web；3) 浏览器打开首页，页面出现 Failed to load plugins，插件列表缺第三方插件。本会话中该状态在 127.0.0.1:3080 的残留进程上实测到。

## 完整事件时间线

预装机制建立时 installBundledProfile 采用幂等跳过（尊重已有环境）→ 后续多次扩充 plugins/preinstall-manifest.json，存量 profile 均未收到 → 2026-08-19 内嵌 dsh 升 rc.7，settings.plugin.item 由 list slot 改 keyed slot → 旧版插件注册缺 key，client loader entry 整条装载失败 → 存量用户升级应用后首页只剩 Failed to load plugins。

## 首次偏离

installBundledProfile 在 dest 已存在时 return 'skipped'（lib/bundled-profile.js:77）——该分支不看版本，是随包插件永远到不了存量 profile 的唯一原因。

## 根因证据

lib/bundled-profile.js:77 的 if (fs.existsSync(dest)) return 'skipped'；用户 live ~/.dsh/profiles/web/package.json 的 dependencies 停在 0.1.16 与 0.1.1，与 plugins/preinstall-manifest.json 当前的 0.2.2/0.1.20/0.1.3/0.13.1 不一致；docs/knowledge/preinstall-existing-user-gap.md 的 gap.idempotent-skip 已登记同一事实。

## 修复边界

只改 installBundledProfile 的已存在分支与其调用点；不动解包实现（collectLinks/applyLinks/assertWithin）、不动 profile 构建链路、不动清单内容。

## 正向、负向与回归路径

正向：无 profile → installed；版本一致 → up-to-date 且磁盘 mtime 不变；版本落后无额外包 → upgraded 且备份目录存在、新版本落位。负向：含清单外依赖 → preserved 且原 profile 逐字节不变；staging 解包失败 → 旧 profile 不变且不留半成品。回归：scripts/verify-bundled-profile.js 现有解包用例全绿，npm test 全绿。

## 受影响模块

- lib/bundled-profile.js
- main.js
- scripts/verify-bundled-profile.js

## 验证范围

```json
{
  "mode": "affected_modules",
  "commands": [
    "node scripts/verify-bundled-profile.js",
    "npm test"
  ],
  "reused_passed_evidence": []
}
```

## 仓库级全量测试触发依据

```json
{
  "required": false,
  "reason_codes": [],
  "rationale": "改动局限于 lib/bundled-profile.js 的单一分支与其唯一调用点，不涉及公共契约、共享基建、构建链或跨模块数据流。"
}
```

## 失败归因规则

```json
{
  "categories": [
    "change_related",
    "environment",
    "flaky",
    "pre_existing",
    "unrelated"
  ],
  "separate_non_change_failures": true,
  "evidence_required": true
}
```

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/existing-profile-upgrade.json`
- 需要 Acceptance：true
- Knowledge 影响：updated
<!-- docs-harness:plan-governance:end -->
