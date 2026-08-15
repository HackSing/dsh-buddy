# DSH Buddy

A desktop buddy for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

把 dsh 的 Web UI 装进原生桌面窗口,并托管 dsh 服务进程的完整生命周期:启动即拉起、就绪才展示、退出即回收。

## MVP 能做什么

- 双击启动:自动拉起 `dsh` 服务进程(已在运行则直接复用)
- 健康检查:轮询等待服务就绪后才打开窗口,不给用户看白屏
- 生命周期托管:退出时回收 dsh 子进程,不留孤儿进程
- 单实例锁:重复启动只会聚焦已有窗口
- 外部链接自动交给系统浏览器

## 运行

```bash
npm install
npm start
```

## 配置

通过环境变量覆盖默认值(也可直接改 `main.js` 顶部的配置区):

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSH_CMD` | `npx` | 启动器命令(全局安装了 dsh 可改为 `dsh`) |
| `DSH_ARGS` | `@deepseek-ai/dsh@0.1.0-rc.6 web` | 启动参数(版本钉死,dsh 处于 developer preview,有破坏性变更风险) |
| `DSH_URL` | `http://127.0.0.1:3080` | Web UI 地址(dsh 默认端口 3080) |

> 默认配置依赖 Node.js:首次启动时 `npx` 会自动下载 `@deepseek-ai/dsh`,可能需要等待片刻。

## Roadmap

- [ ] 系统托盘 + 全局唤醒快捷键
- [ ] macOS 关窗常驻(Dock 保活)
- [ ] 多工作区切换
- [ ] 桌面通知(任务完成提醒)
- [ ] 打包分发(electron-builder)
