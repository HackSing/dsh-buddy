> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# 内嵌 dsh 0.1.5-rc.1 升级的五层验收

- 修订：12
- 关键符号：`launchTokenFrom`、`exchangeAuthCookie`、`postSessionList`、`DSH_VERSION`
- 资产指纹：`sha256:7a084e40fe7396183a5be6465a49d655ea22be2e9d55f5ffdbc625f05d9d81f1`
- 关联方案：`docs/plans/dsh-upgrade-0.1.5-rc.1.json`

## 验收目标

证明内嵌 dsh 抬到 0.1.5-rc.1 后,钉版形状、壳的 rc.5 授权消费链、门禁四门与随包 profile 产物在真实执行下全部成立。

## 验收标准

### `c1` 钉版与预装清单形状:30+ 个 @deepseek-ai 钉版同为 0.1.5-rc.1,manifest 无 rc.5 不兼容包

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`docs/acceptance/evidence/dsh-upgrade-0.1.5-rc.1/c1-pins-and-manifest-0923.md`

### `c2` 单元与契约测试:npm test 全绿,含 rc.5 RPC 新形状与授权模块测试

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/dsh-upgrade-0.1.5-rc.1/c2-npm-test-0923.txt`

### `c3` 门禁四门:verify-dsh-compat 0.1.5-rc.1 报告 4/4

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/dsh-upgrade-0.1.5-rc.1/c3-verify-dsh-compat-report-0923.md`、`docs/acceptance/evidence/dsh-upgrade-0.1.5-rc.1/c3c-page-guard-auth-probe.md`、`docs/acceptance/evidence/dsh-upgrade-0.1.5-rc.1/c3b-title-repair-runtime.md`

### `c4` 随包 web profile 产物:build-web-profile 产 tar 且 verify-profile-tar 通过

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/dsh-upgrade-0.1.5-rc.1/c4-profile-tar-0923.md`

### `c5` 用户最短确认:壳窗口真的进 dsh UI(非 unauthorized),皮肤中心与插件面符合预期

- 状态：passed
- 类型：user_acceptance
- 层级：L5
- 证据：
