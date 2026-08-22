> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# 启动加载窗口:首屏即时反馈验收

- 修订：6
- 关键符号：`buildStageScript`、`installBundledProfile`、`setStartupStage`
- 资产指纹：`sha256:067f7f24dac8037932d1b9ec02cbc235323b95ef55e6198638f9e2525721a61e`
- 关联方案：`docs/plans/startup-loading-window.json`

## 验收目标

验证启动加载窗口方案落地:点击图标 ≤2 秒出现加载窗口且阶段文案推进,解压异步化后窗口保持响应,启动期二次点击聚焦已有窗口,dsh 就绪后原地切换到 dsh 页面,失败路径仍弹既有对话框退出。

## 验收标准

### `c1` 聚焦单测全绿:bundled-profile 异步化后既有用例、loading-page 新增用例、既有窗口相关测试回归

- 状态：passed
- 类型：behavior_acceptance
- 层级：L2
- 证据：`docs/acceptance/evidence/startup-loading-window/c1-focused-tests.txt`

### `c2` 开发态运行:npm start 窗口即时出现、阶段文案推进、解压期间窗口可拖动、dsh 就绪后原地切换

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`docs/acceptance/evidence/startup-loading-window/c2-l3-dev-runtime-windows.mjs`、`docs/acceptance/evidence/startup-loading-window/c2-l3-dev-runtime-windows.log`

### `c3` Windows 打包实机:安装包冷启动点击→窗口 ≤2 秒、启动期二次点击聚焦、失败路径对话框无窗口残留、dsh 页面浏览器级目验插件 client 完好

- 状态：passed
- 类型：behavior_acceptance
- 层级：L4
- 证据：`docs/acceptance/evidence/startup-loading-window/c3-l4-install-launch-windows.mjs`、`docs/acceptance/evidence/startup-loading-window/c3-l4-install-launch-windows.log`

### `c4` 用户实机确认:点击即有窗口、二次点击有反应

- 状态：passed
- 类型：user_acceptance
- 层级：L5
- 证据：
