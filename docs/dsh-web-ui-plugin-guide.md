# dsh Web UI 插件开发指南

> 状态：有效（2026-08-20 基于本机安装包与 dsh 0.1.0-rc.8 源码核对）

本指南沉淀 dsh Web UI 插件（浏览器侧 UI 插件）的开发规范与可照搬的示例，
供后续编写新插件时直接参考。所有结论均以本机 `~/.dsh/profiles/web/node_modules/`
下已装插件包和 `node_modules/@deepseek-ai/` 官方包源码为证据，文中标注路径。

参考实现（本机安装包，Windows 为 `C:\Users\<user>\.dsh\profiles\web\node_modules\`）：

| 包 | 角色 | 可照搬的能力 |
| --- | --- | --- |
| `@linxin666/dsh-pet`（宠物） | 双半插件 | 一级设置页注册、设置读写、body 级全局 UI |
| `@linxin666/dsh-client-ui-task-board`（任务看板） | 双半插件 | 侧栏 DOM 注入 + 自愈、fetch/SSE 通信 |
| `@linxin666/dsh-client-ui-web-ui-settings`（Web UI 插件管理） | 双半插件 | 设置页 + 子 slot 组合 |
| `@linxin666/dsh-live-stats` | client 插件 | 注册进家族子 slot 的最小样本 |
| `@linxin666/dsh-skins`（皮肤中心） | 纯 host 插件 | 对照组：无 `dsh.client` 即无浏览器 UI |

## 1. 插件包结构

以 `@linxin666/dsh-pet/package.json` 为完整样本，dsh 插件协议字段：

```jsonc
{
  "main": "lib/index.js",            // host 半入口（可选，纯 client 插件不需要）
  "exports": {
    "./client": "./lib/client.js"    // 浏览器入口，client 发现机制的锚点
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },  // host 侧 cordis loader 补丁
    "client": {
      "inject": [                    // 声明依赖的 cordis 服务包，loader 据此做激活门控
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings"
      ],
      "platform": "web"
    }
  }
}
```

`cordis.patch.yml` 的内容就是一行 insert，把自己插进 loader roster：

```yaml
- insert:
    - id: my-plugin
      name: '@scope/my-plugin'
```

关键文件：

- `cordis.patch.yml` — roster 插入；
- `lib/client.js` — 浏览器半，打包成 `window.__ModuleLoader__.load({id, factory})` 的懒 CJS 格式；
- `lib/index.js` — host 半（可选；pet 用它注册 `/api/pet/*` HTTP 服务）；
- `src/` — pet / task-board 附带了 TS 源码，可直接当范本读。

判据：package.json 有 `dsh.client` 字段 = 有浏览器 UI；没有（如 dsh-skins）= 纯 host 侧包。

## 2. 加载机制

- profile 组合：`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 列出全部 bundle，
  各插件包的 `cordis.patch.yml` 逐层 patch 进 cordis 树。
- client 发现：`@deepseek-ai/dsh-client-modules` 的 Node 半扫描 host loader 条目，
  **包启用 + 声明 `dsh.client` + 有 `exports["./client"]` → 进启动图**，
  bundle 经 `/plugins` 路径下发（`dsh-client-modules/lib/index.js:67-68` 注释）。
- 浏览器执行：script 加载只注册 factory，物化时才执行模块体（懒 CJS，CSS 注入也在 factory 里）。
- 启用/禁用两层：
  - 包级：cordis patch 支持 insert / config overrides / disables（见 profile 的 `cordis.patch.yml` 头注释）；
  - 业务级：插件自查自己 settings 命名空间里的 `enabled` 开关
    （`dsh-pet/src/client/index.ts:114-119`），状态落在 `~/.dsh/settings.yaml`。

## 3. 设置面板集成

注册 API 是 cordis 服务 `ctx.slots`（`@deepseek-ai/dsh-client-runtime` 的 SlotRegistry，
类型见 `dsh-client-runtime/lib/types/client/slots.d.ts`）：

- `ctx.slots.inject(slotName, callback)` — 等目标 slot 被声明后执行 callback（未声明则挂起等待）；
- `ctx.slots.register(options, Component)` — 注册条目，返回 unregister；callback 返回 disposer 做清理。

### 3.1 一级设置页（推荐，无版本红线）

slot 名 `settings.section`，kind 为 `list`。范本 `dsh-pet/src/client/index.ts:125-138`：

```ts
ctx.slots.inject('settings.section', () => {
  const unregister = ctx.slots.register({
    name: 'settings.section',
    id: 'my-plugin',              // 条目 key，驱动左侧导航过滤
    order: 130,                   // 左侧导航排序，数值越大越靠后
    label: () => ctx.locale.bind('my-plugin')('settings.title'),  // 本地化显示文本
    locale: 'my-plugin',
    inject: () => mySettings.inject(),  // 注入面；纯展示页可省略
  }, MySettingsSection)           // 插件自绘的 React 组件
  return () => { mySettings.dispose(); unregister() }
})
```

### 3.2 注册进"Web UI 插件"家族的子 slot

`web-ui-settings` 在设置页里声明了子 slot `web-ui.plugin.item`（`kind: 'list'`），
家族插件（task-board、live-stats）往里面注册卡片，范本
`dsh-live-stats/src/client/index.ts:82-94`：

```ts
ctx.slots.register({
  name: 'web-ui.plugin.item',
  id: 'my-plugin',
  order: 110,
  locale: NS,
  inject: () => ...
}, MyCard)
```

### 3.3 keyed slot 红线（rc.7+）

官方 `settings.plugin.item` 自 dsh 0.1.0-rc.7 起是 `kind: 'keyed'`
（契约：`dsh-client-ui-settings-plugins/lib/types/client/slot-contract.d.ts:19-24`），
注册**必须**给 `key: <settings 命名空间>`，缺 key 会让该插件整条 client loader entry 装载失败。
keyed 条目没有 id/order/label，卡片自绘全部内容。

规避法：新插件优先走 3.1（一级 `settings.section`，list slot，无此约束）或 3.2。

## 4. 设置读写与表单

- 设置通道：`ctx.settingsScope.bind({ namespace: 'my-plugin' })`
  （`dsh-pet/src/client/index.ts:112-113`）；数据落在 `~/.dsh/settings.yaml` 的同名命名空间。
  snapshot 带 `base`/`user`/`writable`/`revision`，可据此判断字段是否被用户覆盖。
- **dsh 不提供可复用的表单组件。** pet 设置页的 `PluginSettingsCard`、`BooleanField`、
  `ChoiceField`、`ValueField` 和"已覆盖/恢复默认"控件全部来自插件自己的
  `dsh-pet/src/client/PluginSettingsCard.tsx` / `settings-form.ts`，文件头注明是
  `sync-shared.mjs` 从官方 ui-plugin-config 源码同步后各自内联的副本。
  新插件需要表单时，照抄 pet 的 `src/client/` 这套自包含组件即可。
- 纯展示型页面（如"关于"页）更简单：register 的组件不碰 settingsScope，只渲染静态内容。

## 5. 全局 DOM 注入（设置面板之外的 UI）

官方壳没有 root 级全局浮层席位可用（`shell.overlay` 是壳声明的子 slot，可用性取决于壳组合，
pet 作者因此选择更稳的直挂），两套成熟先例：

### 5.1 body 级独立 React 根（范本：pet）

`dsh-pet/src/client/index.ts:299-304`：`document.createElement('div')` 打上
`data-dsh-pet-root` 挂到 `document.body`，`createRoot(container)` 渲染，本体 fixed 定位。
**挂在 body 而不是 `#root` 内部，SPA 路由切换/会话切换都不会清掉它**，
生命周期 = 页面生命周期，卸载靠插件自己的 disposer。

### 5.2 壳内 DOM 注入 + MutationObserver 自愈（范本：task-board 侧栏条目）

`dsh-client-ui-task-board/src/client/sidebar-entry-core.ts`，三条纪律缺一不可：

1. **模糊选择器定位**：壳 DOM 类名带构建哈希，用 `[data-pane="sidebar"]`、
   `[class*="sidebarCol"]` 这类属性/子串选择器 + 几何探测（58-76 行），不用精确类名；
2. **纯 DOM 元素**（非 React），"can never disturb the shell's reconciliation"；
3. **双 MutationObserver 自愈**：body 级 watcher 应对整树重建，root 级 observer 在
   React 重渲染把节点挤掉时同帧重插（139-186 行）；幂等靠 `data-*` 属性查重（132-134 行）。

壳侧同款先例：本仓 `lib/immersive-titlebar.js` 的 macOS 拖拽带注入也是
"MutationObserver 常驻 + 失联即重挂"。

**注入必配自愈**：React 重渲染/皮肤切换会拔掉注入节点，没有例外。

## 6. 与外部通信

插件运行上下文 = 普通浏览器页面（dsh 内容视图 `contextIsolation: true`，无 preload，
见 `lib/frameless-window.js:146-148`）。可用通道：

| 通道 | 用法 | 先例 |
| --- | --- | --- |
| fetch 同源 HTTP | 打 host 半插件注册的 `/api/<plugin>/*` 端点 | `dsh-pet/src/client/index.ts:61-69` |
| EventSource (SSE) | 服务端推送 | `dsh-client-ui-task-board/src/client/host-api.ts:56-103` |
| localStorage | 小状态直存 | `host-api.ts:33-50` |
| cordis 服务面 | `ctx.connection.api.*`、`ctx.remote.$on(...)`、`ctx.sessions`、`ctx.locale` | `dsh-client-ui-web-ui-settings/lib/client.js:437` |
| window.open | **唯一出壳通道**：壳的 `setWindowOpenHandler` 拦截转系统浏览器 | `main.js:595-598`、`lib/frameless-window.js:161-164` |
| 壳 → 页面 | `webContents.executeJavaScript`（壳侧主动注入数据） | `lib/immersive-titlebar.js:70` |

注意：**插件生态没有任何访问 Electron/壳能力的先例**（全量 grep 无 `electron`/`ipcRenderer`
命中）。插件要触发壳动作（如检查更新），最小方案是约定自定义 URL scheme
（`window.open('dsh-buddy://...')`）由壳在 `setWindowOpenHandler` 里识别转发，零 preload 改动。

`window` 上的宿主暴露面只有 loader 自身的 `window.__ModuleLoader__` 和启动图
`window.__DSH_BOOT__`（`dsh-client-modules/README.md`），没有面向插件的业务 API。

## 7. 版本兼容性约束与坑

- 当前基线：dsh `@deepseek-ai/dsh@0.1.0-rc.8`（本仓 `package.json`），
  插件 devDependencies 钉 `^0.1.0-rc.8`。
- keyed slot 红线见 3.3；rc.6→rc.8 官方 apiproxy 只放行硬编码命名空间，
  家族插件靠 `webUiSettings` 桥兜底（`dsh-client-ui-web-ui-settings/lib/client.js:14-24`），
  不读写第三方命名空间的插件不受影响。
- 壳 DOM 类名带构建哈希 → 注入定位只能用模糊选择器（见 5.2）。
- 注入必配 MutationObserver 自愈（见 5.2）。
- `engines.node: ^22.19.0 || >=24.0.0`（仅影响 host 半与构建机）。
- 换 dsh 版本时必须重验 slot 契约（预装清单注释已有这条纪律，
  见 `plugins/preinstall-manifest.json`）。

## 8. 最小纯 client 插件模板

```
my-plugin/
├── package.json          # dsh.bundle.patch + dsh.client + exports["./client"]
├── cordis.patch.yml      # 一行 insert
└── lib/client.js         # 浏览器入口（或 src/client/index.ts 打包产出）
```

`lib/client.js` 骨架（注册一个静态设置页）：

```js
window.__ModuleLoader__.load({
  id: 'my-plugin/client',
  factory: (require, module, exports) => {
    // ctx 由 loader 物化时注入；实际签名参照 dsh-live-stats/src/client/index.ts
    module.exports.activate = (ctx) => {
      ctx.slots.inject('settings.section', () => {
        const unregister = ctx.slots.register({
          name: 'settings.section',
          id: 'my-plugin',
          order: 900,
          label: () => '我的插件',
        }, MySection) // React 组件或自绘 DOM
        return unregister
      })
    }
  },
})
```

## 9. 分发

- 自研插件发布 npm 后进 `plugins/preinstall-manifest.json` 随包预装；
  **入单前先过协议门**（规则：`docs/knowledge/plugin-license-gate.md`，
  绿灯：MIT/BSD/Apache-2.0/ISC）。
- 运行时热更新走插件通道（rolling release + 成品 tar），
  见 `docs/knowledge/plugin-channel-hot-update.md`。
- 新插件第一版可先不入预装清单，手动 `dsh plugin add` 验证稳定后再入单。
