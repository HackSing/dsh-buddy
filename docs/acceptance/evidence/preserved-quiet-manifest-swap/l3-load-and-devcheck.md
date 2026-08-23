# L3 真实装载与开发机判定证据(2026-08-23)

## 临时 DSH_HOME 真实装载(批次 3 执行)

build/web-profile.tar.gz 解至临时 DSH_HOME,以生产姿势(Electron 二进制 + ELECTRON_RUN_AS_NODE=1)拉起内嵌 dsh web profile:

- 纯 Node 首次拉起 `task:list` 返回 `runtime-unavailable`——符合预期,vendor 的 better_sqlite3.node 为 Electron ABI(139),该失败即 ABI 契约的反向证据;
- 生产姿势下:`GET /api/dispatch/events` → `200 text/event-stream`(对照未知插件路由 404);
- `POST /api/dispatch/invoke/ping` → `{"ok":false,"error":{"code":"unknown-channel",…}}`(插件域内处理器应答,非 404);
- `POST …/task:list` → `{"ok":true,"value":[…]}`,从 SQLite 读出 `~/.dispatch` 真实任务记录(vendored better-sqlite3 装载成功);
- `POST …/app:status` → `{"ok":true,"value":{"version":"0.1.1","dbSchemaVersion":3,"platform":"darwin"}}`;
- 启动日志仅两行(skin-center 迁移提示 + 监听地址),无报错;验收后进程已杀、临时目录已清、pgrep 无残留。

## 开发机 profile 判定自查(主控会话亲跑,只读)

以真实 `/Users/aiware/.dsh/profiles/web/package.json` 的 dependencies + 新清单 packages + retired 名单调用 `profileUpgradeDecision`:

```
{"status":"up-to-date"}
DEV MACHINE OK: 弹窗与替换均不会触发
```

即 dispatch 的 `file:` 开发安装判满足不回滚,task-board 本就不在,新版应用启动后弹窗消失。

## 未覆盖

macOS x64 / Windows / Linux 未验;Windows 为已知挂账(better_sqlite3.node 仅 darwin-arm64 Electron ABI,fail-soft 降级 runtime-unavailable 不 crash);全量 Electron 壳端到端(npm run dist 安装包)未跑,止于 profile 层验收。
