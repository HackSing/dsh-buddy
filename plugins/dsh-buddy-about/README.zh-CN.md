# dsh-buddy-about

[English README](./README.md)

由 [DSH Buddy](../../README.md) 桌面壳随附的 dsh Web UI 插件：在 dsh 设置
面板注册一级"关于"页面，并在 dsh 侧边栏底部注入一行版本号小字。

本项目为社区项目，非 DeepSeek 官方插件，与 DeepSeek 无隶属或背书关系。

## 功能

- **设置 → 关于**：显示 DSH Buddy 版本号、dsh 版本号（宿主提供时才显示），
  以及"检查更新""检查插件更新"两个按钮。第一期两个按钮都降级为
  `window.open` 打开 GitHub releases 页；触发真正检查更新的壳侧桥接是
  第二期工作。
- **侧栏版本行**：在壳"设置"行附近注入 `DSH Buddy vX.Y.Z` 小字，颜色使用
  dsh CSS 变量，跟随皮肤切换。

## 版本来源

- DSH Buddy 版本：优先读 `window.__DSH_BUDDY__.version`（壳第二期注入），
  读不到时降级为构建期从本包 `package.json` 的 version 打入的常量。
- dsh 版本：尝试读 `window.__DSH_BOOT__.version`；当前 boot 图线格式
  （rc.8）没有该字段，因此该行在宿主发布版本号之前保持隐藏。

## 开发

```sh
npm install --workspaces=false   # 独立安装（仓库根使用 npm workspaces）
npm run build                    # tsdown -> lib/client.js
```

构建产物为 dsh client loader 期望的
`window.__ModuleLoader__.load({id, factory})` 懒 CJS 信封，`react` 保持
external（运行时由 loader 解析，本包以 peerDependency 声明）。纯逻辑在
`src/shared/`，由仓库测试覆盖：在仓库根运行
`node --test test/dsh-buddy-about.test.mjs`。

## 目录结构

```
├── package.json          # dsh.bundle.patch + dsh.client + exports["./client"]
├── cordis.patch.yml      # 一行 roster insert
├── tsdown.config.mjs     # ModuleLoader 信封 + 版本号打入
└── src/
    ├── client/           # apply() 入口、About 页、侧栏注入
    └── shared/           # 纯常量与版本解析（有测试）
```

本包遵循的插件契约见
[`docs/dsh-web-ui-plugin-guide.md`](../../docs/dsh-web-ui-plugin-guide.md)。
