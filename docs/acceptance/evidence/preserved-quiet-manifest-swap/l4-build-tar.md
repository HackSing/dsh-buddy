# L4 构建产物证据(2026-08-23,批次 3 构建 + 主控会话复核)

```
npm_config_registry=https://registry.npmjs.org node scripts/build-web-profile.js
[build-web-profile] wrote build/web-profile.tar.gz (platform=darwin)
# pnpm 安装日志确认 + @aiwaretop/dsh-dispatch 0.1.1
# peer 仅缺 @deepseek-ai/cordis,与其余插件同为 warning 级,宿主注入解决
```

主控会话独立复核(2026-08-23 12:14 产物,129,495,012 字节):

```
tar -tzf build/web-profile.tar.gz | grep -c "web/node_modules/@aiwaretop/dsh-dispatch/"
58
tar -tzf build/web-profile.tar.gz | grep -c "task-board"
0
```

即产物含 dispatch 全部 58 个条目(含 vendor/.../better_sqlite3.node),task-board 0 条目,换血完成。构建走 npmjs 直连(本机默认 registry 为 npmmirror 镜像,新包未同步)。
