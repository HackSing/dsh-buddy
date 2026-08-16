# 内嵌 dsh(零依赖分发)验收证据记录

- 记录日期:2026-08-16
- 被验提交:`5c034fb`(feat: embed dsh for zero-dependency distribution)
- 执行者:实现子智能体(Opus),主会话复核
- 测试端口:3991–3999(用户在 3080 的自有 dsh 实例全程未受影响,每个检查点均确认)

## C1 开发态内嵌启动 — PASS

`DSH_URL=http://127.0.0.1:3991 npm start` 输出:

```
[dsh-buddy] launcher=embedded entry=.../node_modules/@deepseek-ai/dsh/lib/bin.js cmd=.../Electron args=[...,"web","--host","127.0.0.1","--port","3991"]
dsh web: http://127.0.0.1:3991
```

UI 加载以 4 条 renderer→3991 的 ESTABLISHED 连接确认(非仅 HTTP 200)。

## C2 打包态无 Node 环境启动 — PASS

环境:`env -i HOME=$HOME PATH=/usr/bin:/bin:/usr/sbin:/sbin`,先验证 `command -v node/npm/npx` 全部为空。

- 直接执行 `DSH Buddy.app/Contents/MacOS/DSH Buddy`:`launcher=embedded`,入口位于 `Contents/Resources/app.asar.unpacked/...`,HTTP 200,8 条 ESTABLISHED 连接
- `open --env DSH_URL=... "DSH Buddy.app"`(LaunchServices/双击路径)同样通过,无 Gatekeeper 阻断(本机构建)

## C3 进程回收零孤儿 — PASS

四级启动路径全测。dsh 子进程位于独立 pgid(例:主进程 65113 → dsh 65127,pgid 65127),`process.kill(-pid)` 整组回收。优雅退出(`osascript` quit)与 SIGTERM 双路验证;所有测试端口释放,`ps` 零残留。

## C4 复用外部服务不破坏 — PASS

外部 dsh 于 3992 先行启动 → app 日志 `[dsh-buddy] reusing live dsh at http://127.0.0.1:3992`,监听进程唯一(pid 64433 不变,无重复拉起);app 退出后外部 dsh 仍存活。打包态单实例锁复验:二次启动 exit 0、无日志、监听数不变。

## C5 启动路径回归(env 覆盖 / npx 回退)— PASS

- env 级:`DSH_CMD=node DSH_ARGS=...` → `launcher=env`,启动、加载、回收正常
- npx 级:隐藏 `node_modules/@deepseek-ai/dsh` 后 → `launcher=npx`,启动、加载、回收正常(测后恢复)
- 过程中发现并修复真实缺陷:npx 冷启动实测约 200s(需下载 500+ 包),原 120s 超时导致误报失败;env/npx 级超时调整为 300s,修复后温缓存 npx 端到端复验通过

## 遗留与边界

- .app 体积 469MB(asarUnpack 全量 + dsh 依赖树);arm64/dir target,未签名未公证
- 原生模块 ABI 兼容依赖 4 个依赖(node-pty、koffi、sharp、node-addon-require-builtin)的 N-API 预编译,dsh 升版本时列为回归重点
- L5(签名分发后的真实设备)未覆盖,属方案非目标
