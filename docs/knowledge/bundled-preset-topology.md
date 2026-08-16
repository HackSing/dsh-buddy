> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# bundled agent preset 安装拓扑约束

- 修订：1
- 关键符号：`BUNDLED_PRESET_DIRS`、`installBundledPresets`、`agent-presets`
- 资产指纹：`sha256:2d3b074a1708456a4b380028efa966b130ebd261fb216d99fabfaae0e7a94403`

## 摘要

随包 dsh-anchored-standard 三 preset 必须按源仓库原拓扑装入 $DSH_HOME/.agent-presets,preset/ 目录不得改名

## 事实

### `preset.topology.shared-modules`

zero-anchored-standard 与 whoami-standard 的 agent.cordis.yml 及 zero-tool-bootstrap.mjs 通过 ../preset/ 相对路径引用 preset/ 内共享模块,安装时 preset/ 目录必须保持原名,上游 README 的改名为 anchored-standard 的指引会打断该引用

证据：`plugins/dsh-anchored-standard/whoami-standard/agent.cordis.yml`、`plugins/dsh-anchored-standard/zero-anchored-standard/zero-tool-bootstrap.mjs`

### `preset.discovery.id-is-dirname`

dsh-agent-presets 以目录名为 preset id(须匹配 [a-z0-9][a-z0-9-]*),每次 list/resolve 实时扫描不缓存,UI 展示名取自 preset.yml 的 name 字段,故目录 id 为 preset 不影响展示;发现层 broken 判定只覆盖组装 YAML 可加载性,模块引用在挂载时才解析

证据：`docs/plans/bundled-free-plugins.md`

### `preset.install.idempotent`

壳启动时经 lib/bundled-presets.js 的 installBundledPresets 幂等安装:目标目录已存在即跳过不覆盖(尊重用户本地修改),staging 目录以点号开头故不会被 preset 发现机制误认,安装失败以非致命对话框呈现且不阻断 dsh 启动

证据：`lib/bundled-presets.js`、`main.js`
