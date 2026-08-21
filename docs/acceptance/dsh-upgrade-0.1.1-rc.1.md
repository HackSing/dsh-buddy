> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# 内嵌 dsh 升级 0.1.0-rc.8 → 0.1.1-rc.1 的五层验收

- 修订：7
- 关键符号：`DSH_VERSION`、`patchClient`、`buildWebProfileTar`、`checkDshCore`
- 资产指纹：`sha256:0917198e906851626e77a471aeaf2ad0de9151edf56c7a166f75d2f8d9f55bb1`
- 关联方案：`docs/plans/dsh-upgrade-0.1.1-rc.1.json`
- 关联知识：`docs/knowledge/dsh-web-ui-plugin-guide.json`

## 验收目标

内嵌 dsh 全家族升至 0.1.1-rc.1 后,补丁契约、模块回归、运行时装配、安装包与真机用户可见层逐层取得真实证据

## 验收标准

### `c1` 契约层:双补丁对 0.1.1-rc.1 产物实打成功且 --check 通过;picker 目标 worker.cjs 新旧逐字节一致、settings-models client.js 仅一行事件重命名差异均经 diff 核对

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`build/upgrade-report-batch12.md`

### `c2` 测试层:版本同抬并重装后 npm test 全套通过(262 通过/0 失败/1 设计内跳过)

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`build/upgrade-report-batch12.md`

### `c3` 运行层:verify-dsh-compat 四步(装包+bin/preset 单测/preset 装载 web/8 插件装载 web)在混装树与纯净 0.1.1-rc.1 树上各 4/4 全绿

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`build/upgrade-report-batch12.md`、`build/verify-rerun-clean-tree.md`

### `c4` 安装层:dist-win.bat 全链出包(补丁 check→web-profile 重建 8 插件→NSIS)退出 0,NSIS 静默装机退出 0,plugin-channel 构建 minDshVersion=0.1.1-rc.1 且 9/9 切片哈希一致

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`build/upgrade-report-batch3.md`、`build/dist-win.log`、`build/plugin-channel.log`

### `c5` 用户可见层:真机隔离 HOME 双场景浏览器验收——全新 HOME(8 插件全部已启用、无 Failed to load、多模态补丁哨兵在浏览器加载的 bundle 内、docs-harness 设置读写闭环、flat 凭证 boot 迁移值逐字节保留)与存量 HOME(profileUpgradeDecision 升级 docs-harness 0.1.3→0.2.0、5 张设置卡齐全),另附无框窗口冒烟通过

- 状态：passed
- 类型：behavior_acceptance
- 层级：L5
- 证据：`build/batch4-acceptance-log.md`
