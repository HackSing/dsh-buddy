> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# dsh Web UI 插件开发规范:包结构/cordis patch 加载/settings.section 注册/DOM 注入自愈/出壳通道,详细指南落 docs/dsh-web-ui-plugin-guide.md

- 修订：1
- 关键符号：`dsh.client`、`cordis.patch.yml`、`settings.section`、`ctx.slots.register`
- 资产指纹：`sha256:7d773656378b5fe479d64935e63fb2e6f812186d20103bbfaeaa78cbc07b206f`

## 摘要

dsh Web UI 插件=package.json 声明 dsh.client + exports[./client] + cordis.patch.yml insert 即被 loader 发现;设置页走 settings.section list slot 注册(避开 rc.7 keyed slot 红线),面板外 UI 用纯 DOM+MutationObserver 自愈注入;插件无 Electron 先例,出壳唯一通道是 window.open 经壳 setWindowOpenHandler,详细规范与模板见 docs/dsh-web-ui-plugin-guide.md(2026-08-20 基于本机已装插件包核对)

## 事实

### `plugin.package-protocol`

dsh Web UI 插件协议字段:package.json 的 dsh.bundle.patch 指向 cordis.patch.yml(一行 insert 进 loader roster),dsh.client.inject 声明依赖的 cordis 服务做激活门控,exports["./client"] 是浏览器入口与 client 发现锚点;无 dsh.client 字段即纯 host 插件(对照 @linxin666/dsh-skins)

证据：`docs/dsh-web-ui-plugin-guide.md`、`plugins/preinstall-manifest.json`

### `plugin.settings-slot`

设置面板注册走 cordis 服务 ctx.slots:一级设置页注册 settings.section(list slot,带 id/order/label/inject,范本 @linxin666/dsh-pet);官方 settings.plugin.item 自 dsh 0.1.0-rc.7 起为 keyed slot,缺 key 会让插件整条 client loader entry 装载失败,新插件应优先用 settings.section 规避

证据：`docs/dsh-web-ui-plugin-guide.md`、`plugins/preinstall-manifest.json`

### `plugin.dom-injection`

设置面板之外的 UI 用 DOM 注入:body 级独立 React 根(范本 dsh-pet,SPA 路由切换不清除)或壳内纯 DOM+双 MutationObserver 自愈重挂(范本 dsh-client-ui-task-board 的 sidebar-entry-core.ts);壳 DOM 类名带构建哈希,定位只能用 [data-pane=sidebar] 类模糊选择器,注入必配自愈

证据：`docs/dsh-web-ui-plugin-guide.md`、`lib/immersive-titlebar.js`

### `plugin.shell-bridge`

插件运行在无 preload 的普通浏览器上下文,生态内无任何访问 Electron 的先例;唯一出壳通道是 window.open 经壳 setWindowOpenHandler 拦截,壳→页方向可用 webContents.executeJavaScript 注入数据;插件触发壳动作的最小方案是约定自定义 URL scheme 由壳识别转发

证据：`docs/dsh-web-ui-plugin-guide.md`、`lib/frameless-window.js`、`lib/immersive-titlebar.js`

### `plugin.distribution`

自研插件发布 npm 后登记 plugins/preinstall-manifest.json 随包预装(入单前先过协议门),运行时热更走 rolling release 插件通道复用 installBundledProfile 链路;新插件第一版可先手动 dsh plugin add 验证再入单

证据：`plugins/preinstall-manifest.json`、`docs/knowledge/plugin-channel-hot-update.md`、`docs/knowledge/plugin-license-gate.md`
