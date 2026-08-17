> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# Windows 安装包转正验收

- 修订：2
- 关键符号：`installBundledProfile`、`build-web-profile`、`DSH_SKIP_PROFILE`、`release.yml`
- 资产指纹：`sha256:236404271a03c03676b281cbd6609159058359a1805a36fb6dfdf168938fe54a`
- 关联方案：`docs/plans/windows-installer.json`

## 验收目标

Windows 正式发布通道:profile 产物独立构建经 artifact 分发,纯 Node 两遍解包支持无特权普通用户,本机与 CI 全链验证,README/Roadmap 转正

## 验收标准

### `c1` 解包器冒烟全绿

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/windows-installer/c1-unpacker-smoke.txt`、`docs/acceptance/evidence/windows-installer/c1-unpacker-smoke.stderr.txt`

### `c2` 本机构建与安装冒烟

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/windows-installer/c2-c3-install-smoke.txt`、`docs/acceptance/evidence/windows-installer/c2-c3-run.stdout.log`

### `c3` 本机启动链不回归

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/windows-installer/c2-c3-install-smoke.txt`、`docs/acceptance/evidence/windows-installer/c2-c3-run.stdout.log`

### `c4` CI 三 job 全链

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/windows-installer/c4-ci-chain.txt`

### `c5` 文档同步

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`docs/acceptance/evidence/windows-installer/c5-docs.txt`、`README.md`
