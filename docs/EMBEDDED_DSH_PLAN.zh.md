# 内嵌 dsh(零依赖分发)实施方案

目标:用户下载 DSH Buddy 后**双击即用**——不要求机器上有 Node.js、npm 或任何预装的 dsh。

## 原理

Electron 自带完整 Node 运行时。设置环境变量 `ELECTRON_RUN_AS_NODE=1` 后,用 `process.execPath`(Electron 自身二进制)启动的子进程就是一个纯 Node 进程。因此可以:

1. 把 `@deepseek-ai/dsh`(钉死版本 `0.1.0-rc.6`)作为 npm 依赖装进 `node_modules`
2. 运行时用 Electron 自身的 Node 直接执行 dsh 的入口脚本
3. 打包时把 dsh 相关文件放进 `asarUnpack`,保证能以独立进程运行

参考先例:WorkBuddy 即采用此架构(`Electron .../app.asar.unpacked/cli/bin/codebuddy --serve`)。

## 启动器解析顺序(main.js)

按优先级:

1. **环境变量覆盖**(`DSH_CMD`/`DSH_ARGS`)— 开发者逃生通道,行为不变
2. **复用**:`DSH_URL` 已有存活服务 → 直接连接(现有行为,保留)
3. **内嵌 dsh**(新增,成为默认):解析 `node_modules` 中 dsh 的 bin 入口脚本
   - 开发态:`require.resolve` / 读取包 `package.json` 的 `bin` 字段
   - 打包态:`process.resourcesPath/app.asar.unpacked/node_modules/...`
   - spawn:`process.execPath` + `env: { ELECTRON_RUN_AS_NODE: '1' }` + `[dshEntry, 'web', '--port', ...]`
4. **npx 回退**:内嵌解析失败时走现有 npx 路径(钉版本)

进程回收:内嵌路径没有 npx 包装层,子进程即 dsh 本体,但保留 detached + 进程组整组回收逻辑(dsh 自身也可能再派生子进程)。

## 打包(electron-builder)

- 新增 devDependency `electron-builder`,配置 `asarUnpack: ["node_modules/@deepseek-ai/dsh/**"]`(以及 dsh 运行必需的传递依赖——以实测为准,宁可多 unpack 不可少)
- 产出 macOS `.app`(MVP 先只做 mac,签名/公证暂缓)
- `dsh` 依赖必须放 `dependencies` 而非 `devDependencies`,否则不会被打进包

## 验收标准(全部通过才算完成)

1. **开发态**:`npm start` 走内嵌路径拉起 dsh(日志可辨识),窗口正常加载 UI
2. **打包态**:`.app` 在**清空 PATH 中 Node 痕迹**的环境下启动成功(模拟无 Node 用户):
   `env -i HOME="$HOME" open dist/mac*/DSH\ Buddy.app` 或等效验证
3. **回收**:app 退出后无孤儿进程、端口释放(复用先前的 lsof/ps 检查法)
4. **复用不破坏**:外部已运行 dsh 时不重复拉起、退出不误杀
5. 现有三条已验证路径(拉起/复用/回收)回归通过

## 边界

- 不做:代码签名、公证、自动更新、Windows/Linux 打包(后续迭代)
- 端口策略维持 3080 默认 + 环境变量覆盖
