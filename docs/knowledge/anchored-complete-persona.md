> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# complete persona 压制插件 prompt section 的根因与相位化密封方案

- 修订：1
- 关键符号：`sealSectionsUntilPromotion`、`extraIndex`、`installBundledPresets`、`complete`
- 资产指纹：`sha256:6941c56ad53b0bd6379a3e260f07a0f6865a05f4ec9687e476e5a9627e879020`

## 摘要

dsh-persona 的 complete:true 是 scope 级静态注册，会让 dsh-system-prompt assemble() 全程只保留 persona 一个 section、静默丢弃所有插件注入段；修法是把密封做成跟随 epoch 晋升的相位行为（tool-bootstrap 配置键），锚定后全量开放。

## 事实

### `complete-persona-suppresses-plugin-sections`

persona 行的 complete:true 在 scope 注册期生效，assemble() 在 waterfall 之后把 complete section 恢复为唯一 prompt section，导致 Anchored Standard 预设下插件 section（含 docs-harness 治理段）整个会话不可达；2026-08-18 事故实证。

证据：`plugins/dsh-anchored-standard/preset/agent.cordis.yml`、`docs/plans/anchored-phased-prompt.md`

### `phase-aware-seal-replaces-complete`

tool-bootstrap 的 sealSectionsUntilPromotion/sealContextsUntilPromotion 配置键把密封挂到 epoch 晋升状态上：未晋升时 sections 只剩 persona、contexts 为空（与旧 complete 首轮字节等值），晋升后全部 section 与常规注入恢复；缺省不配置则行为零变化。

证据：`plugins/dsh-anchored-standard/preset/tool-bootstrap.mjs`、`plugins/dsh-anchored-standard/test/tool-bootstrap.test.mjs`

### `plugin-tools-need-extraindex`

dev_tool_search 的硬编码索引只覆盖内置工具，部署侧注册的插件工具（如 harness_plan_*）模型无从发现；dev-tool-search 的 extraIndex 配置键由预设在 yml 里显式列出这些工具，搜索即返回并可用 toolNames 解锁。

证据：`plugins/dsh-anchored-standard/preset/dev-tool-search.mjs`、`plugins/dsh-anchored-standard/preset/agent.cordis.yml`

### `fingerprint-sync-preserves-local-edits`

installBundledPresets 以 .bundled-fingerprint.json 记录上次安装的随包哈希逐文件三路比对：用户没动过的文件随版本更新，用户改过的（如 bashPath）保留并按随包版本去重通知一次，旧版无指纹安装一律按用户修改保守保留。

证据：`lib/bundled-presets.js`、`test/bundled-presets.test.mjs`
