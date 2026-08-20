> 状态：有效（待验收）
<!-- docs-harness:acceptance-document/v1 -->

# 插件按包增量更新验收

- 修订：3
- 关键符号：`applyPluginUpdate`、`installBundledProfile`、`buildWebProfileTar`、`checkPluginChannel`
- 资产指纹：`sha256:4c3479614f5f0058e11c58322c2575b77edeb532ae850569191d1032ccd137fe`
- 关联方案：`docs/plans/plugin-incremental-update.json`
- 关联知识：`docs/knowledge/plugin-channel-hot-update.json`

## 验收目标

验证按插件拆包的增量热更:客户端只下载变化的插件闭包并完成外科替换,dsh 重启后插件版本正确、其余插件不受影响,失败整体回滚不污染现有 profile,新旧通道 schema 分流不互误导。

## 验收标准

### `c1` 依赖闭包计算/垃圾回收/schema 分流单测全绿

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`test/profile-closure.test.mjs`、`test/plugin-channel-slice.test.mjs`、`test/plugin-update-slices.test.mjs`、`test/plugin-channel.test.mjs`、`test/plugin-update.test.mjs`

### `c2` 真实 profile 外科替换后 dsh 启动 HTTP 200、目标插件版本断言、非目标插件不受影响、失败回滚

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`build/acceptance-runtime-v2.log`

### `c3` 打包安装态验证(随包 profile + 增量热更链路)

- 状态：pending
- 类型：behavior_acceptance
- 层级：L4
- 证据：尚无

### `c4` 用户验收:真实发布单插件新版本,客户端只下载该插件并完成热更

- 状态：pending
- 类型：user_acceptance
- 层级：L5
- 证据：尚无
