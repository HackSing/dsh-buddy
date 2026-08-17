> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# dsh 网关 settings 白名单：第三方插件设置面必须自建路由

- 修订：1
- 关键符号：`WEB_SETTINGS_NAMESPACES`、`settings.describe`、`docs-harness-settings`、`HarnessSettingsStore`
- 资产指纹：`sha256:77e98246ff06d56c0ec7047f4d4658f2a8f654dd806e3d3303e5072ca3a7f418`

## 摘要

上游网关只为编译死的命名空间白名单服务 settings API，第三方插件设置区在 web 端结构性不可达；修法是插件自有 loopback 路由，教训是插件用户可见面必须打包运行时端到端验证

## 事实

### `gateway.allowlist`

上游 apiproxy 的 settings.describe/settings.update 只服务编译进包的命名空间白名单（WEB_SETTINGS_NAMESPACES、PRODUCT_SETTINGS_NAMESPACES、模型提供方三源合并），第三方插件注册的命名空间读时被过滤、写时被拒，上游注释明说插件自暴露命名空间是 deferred work——host 侧注册全程成功、值可解析、watch 正常，仅网关一层拦截，症状是设置卡片报『设置服务不可用』且『不再提示』永不生效

证据：`docs/acceptance/evidence/docs-harness-plugin/c1-review-notes.md`

### `workaround.own-routes`

dsh-docs-harness v0.1.1 的修法：设置读写走插件自有 /docs-harness-settings loopback 路由（与 project 三操作同构），host 侧仍经 installSettingsSection 注册并通过 settings 服务读写，settings.yaml 保持唯一真源、门禁 watch 实时翻转；控制面路由必须挂在总开关之外，否则关掉开关就无法再开回

证据：`docs/acceptance/evidence/docs-harness-plugin/c1-review-notes.md`、`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`

### `lesson.e2e-verification`

经验教训：host 内注册成功加聚焦单测全绿不能证明 web 端功能可用——本例网关过滤发生在被测包之外的 apiproxy 包，126 例单测全绿仍漏检；插件的每个用户可见表面（设置卡片、提示条按钮等）必须在打包运行时环境做一次端到端验证才算验收

证据：`docs/acceptance/evidence/docs-harness-plugin/c2-unit-tests.txt`、`docs/acceptance/evidence/docs-harness-plugin/c3-live-install.txt`
