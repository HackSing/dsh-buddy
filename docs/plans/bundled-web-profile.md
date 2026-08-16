> 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）
<!-- docs-harness:plan-document/v1 -->

# 构建机预装 web profile 随包分发链路

- 冻结合同：`sha256:dadccaea4eae42f7279bb647126f1f1a10f1ecb5bc251166b0c30eab18d2cdc8`
- 关键符号：`build-web-profile`、`installBundledProfile`、`extraResources`、`preinstall-manifest`

## 背景

preinstall-manifest 的六个插件走 dsh plugin(pnpm)链安装,零依赖终端环境无法在用户机安装。已实证:空 DSH_HOME 下运行 dsh plugin --profile web 子命令会自动初始化 profile(输出 initialized profile web,生成 cordis.patch.yml/package.json/pnpm-workspace.yaml)。pnpm 的 node_modules 布局含相对符号链接与硬链接,electron-builder 对符号链接的打包处理不可靠,故构建产物采用 tar.gz(符号链接原样保留、硬链接落地为实体文件,自包含),运行时解包到用户 DSH_HOME。

## 目标

npm run dist 之前自动在构建机生成内含 manifest 六插件的干净 web profile tar 包并随 .app 分发;壳启动时用户 DSH_HOME 无 profiles/web 则解包安装、已存在则跳过;新机器首启即获得与随包插件清单一致的完整体验。

## 非目标

不覆盖或合并已存在的 profile;不安装 manifest excluded 组件;不做 Windows 打包;开发态(非打包、无 tar 资源)不安装 profile,视为正常状态。

## 成功标准

1) 构建脚本产出 tar 包,web/package.json 依赖与 manifest 六包完全一致且 node_modules/@linxin666 下六目录齐全;2) 空 DSH_HOME 解包后以内嵌 dsh 真实启动,UI 出现插件元素(侧栏任务看板);3) profiles/web 已存在时跳过且内容不被触碰;4) npm run dist 产物 Resources 内含 web-profile.tar.gz。

## 执行范围

scripts/build-web-profile.js(新,读 preinstall-manifest 为单一真源,临时 DSH_HOME 初始化+装包+打 tar);lib/bundled-profile.js(新,运行时幂等解包,staging 后 rename);main.js(启动接线,与 ensurePresets 同点位);package.json(predist 钩子、build.extraResources);.gitignore(build/ 产物目录)。

## 执行内容

批1:构建脚本+tar 内容验证(依赖清单与目录齐全)。批2:运行时安装器+main.js 接线+冒烟(空 HOME 安装、已存在跳过、tar 缺失时开发态静默跳过)。批3:空 DSH_HOME 真实启动内嵌 dsh 验证任务看板出现;npm run dist 验证资源进包。

## 验收方案

acceptance 资产四条:c1 tar 内容与 manifest 一致(L2);c2 真实启动 UI 出现任务看板(L3);c3 已存在 profile 幂等跳过(L3);c4 dist 产物含 tar 资源(L4)。全部通过后 settle。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

updated

## 约束

不新增第三方依赖(tar 用系统命令);错误不吞:构建脚本任何一步失败即非零退出;运行时安装失败非致命对话框呈现,不阻断 dsh;防御代码准入:只处理已实证可达状态。

## 风险与回滚

风险:pnpm 硬链接落地实体使 tar 体积增大(可接受);profile 与 dsh rc.6 耦合,升级 dsh 必须重建 tar(predist 自动保证);用户曾用过 dsh(已有 profile)则不获得六插件,留文档说明。回滚:移除 predist/extraResources/main.js 接线与两个新文件即回退。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/bundled-web-profile.json`
- 需要 Acceptance：true
- Knowledge 影响：updated
<!-- docs-harness:plan-governance:end -->
