> 状态：有效（待验收）
<!-- docs-harness:acceptance-document/v1 -->

# Release CI 验收

- 修订：3
- 关键符号：`release.yml`、`dist:win`、`gh release upload`
- 资产指纹：`sha256:0d6a6c788efd5350008889de75bfa114533b68261ddc97b7a4ebf48058b0eb5e`
- 关联方案：`docs/plans/release-ci.json`

## 验收目标

v* tag 触发双平台构建并自动发布 Release;测试 prerelease tag 全链验证 macOS 侧

## 验收标准

### `c1` 跨平台重构后的构建脚本本地产出有效 tar

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/release-ci/c1-build-script.txt`

### `c2` release.yml YAML 有效且版本守卫逻辑正确

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/release-ci/c2-yaml-guard.txt`

### `c3` 真实 tag 推送触发 macOS 构建,Release 自动创建且 dmg 资产挂载

- 状态：pending
- 类型：behavior_acceptance
- 层级：L4
- 证据：尚无
