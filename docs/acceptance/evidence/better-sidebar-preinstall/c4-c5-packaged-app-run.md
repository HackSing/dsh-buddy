# c4/c5 真实安装包 + 隔离 DSH_HOME 运行证据

- 安装包: `dist/DSH Buddy Setup 0.1.0.exe` (266,057,965 B, electron-builder exit 0, 含 latest.yml 与 blockmap)
- 运行体: `dist/win-unpacked/DSH Buddy.exe` (与安装包同一份载荷)
- 隔离 DSH_HOME: scratchpad/realhome2,启动前为空目录
- 内嵌 dsh 0.1.0-rc.7,监听 127.0.0.1:3080(已核对端口归属进程即打包应用)

## 插件装载(浏览器实读 DOM,不是 HTTP 200 探针)

- 页面无 `Failed to load plugins`
- 插件列表共 141 条,其中 115 条已启用
- 8 个第三方插件全部「已启用」:docs-harness / ui-git-graph / ui-task-board / ui-web-ui-settings / live-stats / pet / ui-skin-center / better-sidebar
- 设置导航齐全:通用设置 / 模型 / 插件 / Agent 预设 / 侧边卡片 / Web UI 插件 / 皮肤中心 / 宠物
- Docs Harness 客户端半边渲染正常:设置卡 4 项控件,会话内启用提示条可见
- better-sidebar 面板可展开,文件树读到工作区内的 README.md,底部面板出现 powershell 终端页签

## 原生二进制在发行运行时下的实测

以 `ELECTRON_RUN_AS_NODE=1` 走打包应用自己的 Electron 运行时,require 随包 profile 里的原生模块。

### node-pty(better-sidebar 终端的底座)

```
node-pty version: 1.1.0
shell: powershell.exe  pid: 54696
marker occurrences: 2
--- tail of pty output ---
]0;C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exeWindows PowerShell
Copyright (C) Microsoft Corporation. All rights reserved.PS D:\Project\dsh-buddy> echo PTY_ECHO_OK_7391
PTY_ECHO_OK_7391
PS D:\Project\dsh-buddy> 
PTY_EXIT=0
```

marker 出现 2 次 = 输入回显 + 命令真实执行输出,证明 pty 双向通。

### lightningcss(skin-center 0.2.x 的运行时依赖)

```
lightningcss transform => .a{color:red}
LCSS_EXIT=0
```

## 未覆盖

- 侧边栏终端的**可视交互**未自动验证:本会话的浏览器面板不合成画面(截图报 "not compositing frames"),xterm 容器因此始终 0 子元素,属测试环境限制而非产品缺陷——底层 pty 已由上面的实测证明可用。该层留给用户真机确认(c6)。
- NSIS 安装器本身未执行:已知历史隐患是安装到 Temp 目录后快捷方式被改指(见 docs/knowledge),为不动用户现有安装,改用同载荷的 win-unpacked 验证。
