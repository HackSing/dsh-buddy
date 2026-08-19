> 状态：有效（待验收）
<!-- docs-harness:acceptance-document/v1 -->

# better-sidebar 预装与 rc.7 升级验收

- 修订：8
- 关键符号：`verify-profile-tar`、`dsh-better-sidebar`、`DSH_VERSION`、`prebuilds`
- 资产指纹：`sha256:ccf18d410c1aaa507b0e93840bf5fde7db736e0782e6400166b9a8e5d6c50aa9`
- 关联方案：`docs/plans/better-sidebar-preinstall.json`

## 验收目标

把 dsh-better-sidebar@0.13.1 纳入随包预装清单(7 个包扩为 8 个),内嵌 dsh 从 0.1.0-rc.6 升至 0.1.0-rc.7 以满足其 peer 约束,并把 profile tar 的平台二进制断言由零二进制改为路径白名单加双平台覆盖,使发布流水线在产物含原生 prebuilds 的前提下仍守住 profile 跨平台可解的原始意图。

## 验收标准

### `c1` verify-dsh-compat 对 0.1.0-rc.7 四项验证全过(升级门禁)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/better-sidebar-preinstall/c1-verify-dsh-compat-rc7.md`

### `c2` build-web-profile 退出 0 且 tar 内 8 个包齐全、better-sidebar 的 lib 与 cordis.patch.yml 在位

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/better-sidebar-preinstall/c2-profile-contents.md`

### `c3` verify-profile-tar 对新 tar 通过,对注入白名单外二进制的构造样例 FAIL 并列出路径

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/better-sidebar-preinstall/c2-c3-verify-profile-tar.txt`、`docs/acceptance/evidence/better-sidebar-preinstall/c3-assert-negative-cases.txt`

### `c4` dsh web 返回 HTTP 200 且真实会话中侧边栏终端能执行命令并回显

- 状态：pending
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/better-sidebar-preinstall/c4-c5-packaged-app-run.md`

### `c5` Windows 安装包打出,隔离 DSH_HOME 实机运行出现 bundled profile: installed 且 8 插件落位

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/better-sidebar-preinstall/c4-c5-packaged-app-run.md`

### `c6` 用户在真机确认侧边栏文件树、Git 面板与终端交互可用

- 状态：pending
- 类型：user_acceptance
- 层级：L5
- 证据：

### `c7` assets-check 通过(Plan/Knowledge/Acceptance 闭环)

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`docs/acceptance/evidence/better-sidebar-preinstall/c7-assets-check.txt`
