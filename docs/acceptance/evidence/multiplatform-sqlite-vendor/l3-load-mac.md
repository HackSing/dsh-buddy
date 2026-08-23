# L3 证据:macOS 真实装载 0.1.2(2026-08-23,批次 C 执行)

build/web-profile.tar.gz 解至临时 DSH_HOME,Electron + `ELECTRON_RUN_AS_NODE=1` 拉起内嵌 dsh web profile:

- 约 6s 就绪;`GET /api/dispatch/events` → `200 text/event-stream`(对照未知插件路由 404);
- `POST /api/dispatch/invoke/task:list` → `{"ok":true,"value":[…真实任务记录…]}`(补丁后的多平台加载路径在 darwin 上读库成功);
- `POST /api/dispatch/invoke/app:status` → `{"ok":true,"value":{"version":"0.1.2","dbSchemaVersion":3,"platform":"darwin"}}`——**装入的确是 0.1.2**;
- 启动日志仅两行(skin-center 迁移提示 + 监听地址),无报错;进程已杀、临时目录已清、pgrep 无残留。
- 插曲如实记录:首跑验收脚本因 SSE 长连接 curl `--max-time` 退出码 28 被 `set -e` 中断,属脚本缺陷非产物问题,重跑通过。

Windows 端装载证据见 l4-win32-smoke.md(release.yml windows job 的 sqlite smoke,发版流水线产生)。
