# DSH Buddy

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)的桌面发行版**——打包、策展、集成、信任。

dsh 是一个强大且快速演进的 agent harness;DSH Buddy 把它变成双击即用的桌面应用:
**从下载到第一个 agent 会话不超过一分钟——不需要 Node,不需要终端,不需要自己判断哪个插件能装。**

> 本项目是社区项目,与 DeepSeek 无隶属关系,不代表其认可或背书。DeepSeek 及相关商标归其权利人所有。

## 下载

| 平台 | 入口 | 说明 |
|---|---|---|
| **macOS**(Apple Silicon) | [下载最新版 dmg](https://github.com/HackSing/dsh-buddy/releases/latest) | 拖入「应用程序」即完成安装。产物暂未签名公证,首次打开请右键 → 打开(或在「系统设置 → 隐私与安全性」放行) |
| **Windows** | 即将推出 | Star 本仓库或关注 [Releases](https://github.com/HackSing/dsh-buddy/releases) 获取上线通知 |

## 发行版的四个职能

| 职能 | 具体动作 |
|---|---|
| 打包 | dsh 随应用零依赖分发,双击启动,进程生命周期托管 |
| 策展 | 精选社区 preset 与插件,过协议门和安全审查后随包提供 |
| 集成 | 幂等安装、沉浸式窗口、开箱即用的默认配置 |
| 信任 | 协议逐包核验、安全敏感组件默认不启用、版本钉死可复现 |

## 策展承诺

进入随包清单的每个组件都要过三道门:

1. **协议门**:核对 LICENSE 全文与每个包的 license 字段,copyleft 组件不进分发物
   (规则见 [plugin-license-gate](docs/knowledge/plugin-license-gate.md));
2. **安全门**:涉及凭据存储、网络隧道、远程访问的组件默认不预装,由用户自行决定;
3. **版本门**:版本钉死在 [preinstall-manifest](plugins/preinstall-manifest.json),升级须重新过门。

## 壳能力

- **零依赖**:dsh 随应用分发,用 Electron 自带的 Node 运行时执行,用户机器无需安装 Node.js
- 双击启动:自动拉起 `dsh` 服务进程(已在运行则直接复用)
- 健康检查:轮询等待服务就绪后才打开窗口,不给用户看白屏
- 生命周期托管:退出时整组回收 dsh 进程树,不留孤儿进程
- 单实例锁:重复启动只会聚焦已有窗口
- 外部链接自动交给系统浏览器

## 内置插件

`plugins/` 是免费开源插件的 npm workspace。当前随包分发
[dsh-anchored-standard](plugins/dsh-anchored-standard/README.zh-CN.md):三个实验性
agent preset(Anchored / Zero-Anchored / Whoami Standard)。应用启动时把它们幂等安装到
`$DSH_HOME/.agent-presets/`——目录已存在则跳过,不覆盖你的本地修改——启动后即可在
dsh 的 preset 选择器中选用。

## 运行

```bash
npm install
npm start        # 开发态
npm run dist     # 打包 macOS .app → dist/mac-arm64/DSH Buddy.app
```

> 打包产物未做代码签名与公证,首次打开可能需要在「系统设置 → 隐私与安全性」中放行。

## 启动器解析顺序

`main.js` 按以下优先级决定怎么把 dsh 跑起来:

1. **环境变量覆盖**(`DSH_CMD` / `DSH_ARGS`):开发者逃生通道,完全按给定命令行执行
2. **复用存活服务**:`DSH_URL` 已经能连通 → 直接连接,不拉起也不回收(不会误杀用户自己启动的 dsh)
3. **内嵌 dsh**(默认):`ELECTRON_RUN_AS_NODE=1` + `process.execPath` 执行随包分发的 `@deepseek-ai/dsh`
4. **npx 回退**:内嵌入口解析不到时,退回 `npx @deepseek-ai/dsh@<pinned> web`(需要机器上有 Node)

## 配置

通过环境变量覆盖默认值(也可直接改 `main.js` 顶部的配置区):

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DSH_URL` | `http://127.0.0.1:3080` | Web UI 地址;同时决定内嵌 dsh 的 `--host` / `--port` |
| `DSH_CMD` | *(未设置)* | 设置后走逃生通道,自定义启动器命令 |
| `DSH_ARGS` | `@deepseek-ai/dsh@0.1.0-rc.6 web` | 逃生通道的启动参数(仅在 `DSH_CMD`/`DSH_ARGS` 任一被设置时生效) |

> dsh 版本在 `dependencies` 中钉死为 `0.1.0-rc.6`——它仍处于 developer preview,有破坏性变更风险。

## Roadmap

- [x] 打包分发(electron-builder,macOS arm64 dmg)
- [x] 随包资产:精选 agent preset 预装 + 插件 profile 随包
- [x] 发布流水线(推 tag 即自动构建并发 Release;Windows 侧实验性)
- [x] 应用内更新提示(检查 GitHub Releases,24h 节流)
- [x] dsh 追新兼容验证(每日自动值班,新版本自动开 issue 报告)
- [ ] Windows 安装包转正(profile 产物改为单独构建经 artifact 分发,绕开 bsdtar × pnpm junction)
- [ ] 代码签名 + 公证 + 全自动更新(签名就绪后同一发布流升级)
- [ ] 存量用户随包资产增量更新(版本戳分流;profile:未改动整体替换、有自定义则自动只加不改合并;preset:未改动替换、已改动保留用户版本;均先备份,异常回滚)
- [ ] 系统托盘、关窗常驻等桌面体验(按用户反馈驱动)

搭建思路见[发布基础设施三件套指南](docs/release-infra-playbook.md)。
