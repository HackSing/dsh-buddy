> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# 存量 profile 随包升级验收：四态判定 + 端到端旧 profile 升级

- 修订：7
- 关键符号：`installBundledProfile`、`profileUpgradeDecision`
- 资产指纹：`sha256:1f782774ef63aa2b13fedad743373646baab6bbeedd526754101ef01558e2c94`
- 关联方案：`docs/plans/existing-profile-upgrade.json`
- 关联知识：`docs/knowledge/preinstall-existing-user-gap.json`

## 验收目标

让已存在 profile 的用户在升级应用后拿到随包清单声明的插件版本，同时不破坏用户自行安装的插件；无法安全升级时明确告知而不是静默跳过或静默覆盖。

## 验收标准

### `c1` 隔离 DSH_HOME 四态判定：installed / up-to-date / upgraded / preserved / no-tarball 返回值与磁盘结果全部符合成功标准

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/existing-profile-upgrade/c1-verify.txt`

### `c2` 回归：node scripts/verify-bundled-profile.js 与 npm test 全绿

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/existing-profile-upgrade/c1-verify.txt`、`docs/acceptance/evidence/existing-profile-upgrade/c2-npm-test.txt`

### `c3` 端到端：真实打包应用对复刻自用户 live 的旧版 profile 完成升级，浏览器实读确认 8 插件全部启用且无 Failed to load plugins

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/existing-profile-upgrade/c3-e2e-app.log`、`docs/acceptance/evidence/existing-profile-upgrade/c3-plugins-list.yml`、`docs/acceptance/evidence/existing-profile-upgrade/c3-profile-dirs.txt`

### `c4` 用户确认升级后本机真实环境插件可用

- 状态：passed
- 类型：user_acceptance
- 层级：L5
- 证据：`docs/acceptance/evidence/existing-profile-upgrade/c3-e2e-app.log`
