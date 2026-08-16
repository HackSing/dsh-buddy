> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# bundled web profile 链路验收

- 修订：6
- 关键符号：`build-web-profile`、`installBundledProfile`、`extraResources`
- 资产指纹：`sha256:deff23036c700e06d348264ad19addfc161e69306207bb253611687e762a6ffd`
- 关联方案：`docs/plans/bundled-web-profile.json`

## 验收目标

构建机生成含六插件的 web profile tar 随包分发,新机器首启解包获得完整体验,已有 profile 不被触碰

## 验收标准

### `c1` tar 内容与 manifest 六包一致且目录齐全

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/bundled-web-profile/c1-tar-contents.txt`

### `c2` 空 DSH_HOME 解包后真实启动,UI 出现任务看板

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/bundled-web-profile/c2-fresh-boot.txt`

### `c3` 已存在 profiles/web 时跳过且不触碰

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/bundled-web-profile/c3-installer-smoke.txt`

### `c4` dist 产物 Resources 含 web-profile.tar.gz

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/bundled-web-profile/c4-dist-resource.txt`
