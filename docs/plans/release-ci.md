> 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）
<!-- docs-harness:plan-document/v1 -->

# Release CI:tag 触发双平台构建并发布 GitHub Release

- 冻结合同：`sha256:e16f009c1bfa7dc55b381c45d936ad9616db413a83b6a616e3f21d61500eb800`
- 关键符号：`release.yml`、`dist:win`、`GITHUB_REF_NAME`、`gh release upload`

## 背景

发布目前是手工流程(本机 npm run dist + 手动建 Release),成本高导致迭代慢。已有 dsh-compat 工作流验证了 runner 基础环境。构建脚本 build-web-profile.js 原用 node_modules/.bin/electron(POSIX 路径)拉起 dsh,在 Windows runner 上不存在;脚本本身运行于 Node,改用 process.execPath+binEntryFrom 即跨平台且少一层间接。

## 目标

推送 v* tag 后,GitHub Actions 并行在 macos-14 与 windows-latest 构建安装包(dmg/nsis exe)并自动创建同名 Release 上传;tag 含 - 后缀自动标记 prerelease(不占 releases/latest,不触发应用内更新提示);tag 与 package.json 版本不一致时快速失败。

## 非目标

不做代码签名与公证;不做自动更新的 latest.yml 发布;Windows 侧标记实验性(continue-on-error),真机验证由用户的 Windows 手工打包任务沉淀后再转正;不改变本地手工构建能力。

## 成功标准

1) 重构后的 build-web-profile.js 本地产出 tar 内容不变;2) release.yml 通过 YAML 解析且版本守卫逻辑正确;3) 推送测试 prerelease tag 后 macOS 任务端到端成功:Release 自动创建、dmg 资产挂载、标记 prerelease;4) 测试后清理测试 tag 与 Release。

## 执行范围

scripts/build-web-profile.js(跨平台重构);package.json(dist:win 脚本与 build.win nsis 配置);.github/workflows/release.yml(新)。

## 执行内容

批1:构建脚本重构+本地验证。批2:win 配置+release.yml+YAML 校验。批3:推送 v0.1.0-test1 预发布 tag 实测 macOS 全链,gh 验证 Release 与资产,清理测试产物;Windows 任务结果仅观察记录,不作为通过条件。

## 验收方案

c1 重构脚本本地产 tar(L2);c2 YAML 解析与守卫(L2);c3 真实 tag 触发 macOS 构建并出 Release+dmg(L4);全部通过后 settle。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

unchanged

## 约束

不新增第三方 action(只用官方 checkout/setup-node 与 runner 自带 gh);版本号经 env/GITHUB_REF_NAME 传递不拼模板表达式;公开仓库禁用词 grep 自查。

## 风险与回滚

风险:windows-latest 上原生模块与 nsis 首跑未验证(已用 continue-on-error 隔离);双任务并发创建 Release 有竞态(|| true + upload --clobber 收敛);GITHUB_TOKEN 创建的 Release 不触发其他 workflow(GitHub 设计,如未来要级联需 PAT)。回滚:删 release.yml 即回手工发布,脚本重构独立可保留。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/release-ci.json`
- 需要 Acceptance：true
- Knowledge 影响：unchanged
<!-- docs-harness:plan-governance:end -->
