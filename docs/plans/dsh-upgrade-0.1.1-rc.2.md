> 状态：已实施-仅追溯（代码已是真源，2026-08-23 核对）
<!-- docs-harness:plan-document/v1 -->

# 内嵌 dsh 0.1.1-rc.1 → 0.1.1-rc.2 全家族钉版同抬

- 冻结合同：`sha256:6d20a30f38386d9bfab1b8fd864214bcf2037832274848ed455f0080f5fcfff2`
- 关键符号：`DSH_VERSION`、`@deepseek-ai/dsh`、`allowScripts`

## 目标

把 package.json 里 19 个 @deepseek-ai/dsh* 钉版、allowScripts 的 dsh-subprocess-local key 与 main.js DSH_VERSION 从 0.1.1-rc.1 整组同抬到 0.1.1-rc.2(全家族 20 个包已确认在 npm 发布 rc.2),补丁契约与回归全绿。

## 范围

package.json(dependencies 19 项 + allowScripts 1 项)、package-lock.json(npm install 刷新)、main.js:41 DSH_VERSION 常量。不动应用 version 字段(归发版流程)、不动 plugins/preinstall-manifest.json、不改补丁脚本。

## 关键步骤

- package.json 内 0.1.1-rc.1 整组替换为 0.1.1-rc.2(19 钉版 + allowScripts key),main.js DSH_VERSION 同步
- npm install 刷新 package-lock.json,postinstall 补丁(worker.cjs / settings-models 锚点)在 rc.2 树上实际执行
- npm test 全量回归(含补丁契约测试)
- node scripts/verify-dsh-compat.js 0.1.1-rc.2 本地纯净树验证(此时 extras 钉版已为 rc.2,即先例 fc16b6d 所称纯净树口径),期望 4/4
- grep 全仓确认无 0.1.1-rc.1 残留引用,assets-check 收尾

## 验收方案

npm test 退出码 0;verify-dsh-compat 0.1.1-rc.2 纯净树 4/4;grep 无 rc.1 残留;CI dsh-compat 已实证混装 4/4(run 32624769885)。不含 dist 出包与真机浏览器验收——本次仅升钉版不发版,该两层随下次 release 验收。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：无
<!-- docs-harness:plan-governance:end -->
