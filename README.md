# DSH Buddy

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)的桌面发行版**——打包、策展、集成、信任。

dsh 是一个强大且快速演进的 agent harness;DSH Buddy 把它变成双击即用的桌面应用:
**从下载到第一个 agent 会话不超过一分钟——不需要 Node,不需要终端,不需要自己判断哪个插件能装。**

> 本项目是社区项目,与 DeepSeek 无隶属关系,不代表其认可或背书。DeepSeek 及相关商标归其权利人所有。

## 下载

| 平台 | 入口 | 说明 |
|---|---|---|
| **macOS**(Apple Silicon) | [下载最新版 dmg](https://github.com/HackSing/dsh-buddy/releases/latest) | 拖入「应用程序」即完成安装。产物为 ad-hoc 签名、未公证,**首次打开要手动放行一次**,步骤见[首次打开](#首次打开) |
| **Windows**(x64) | [下载最新版 exe](https://github.com/HackSing/dsh-buddy/releases/latest) | 双击运行安装器,可按向导选择安装目录(默认装在用户目录,无需管理员/开发者模式)。产物未签名,**首次运行要过一次 SmartScreen**,步骤见[首次打开](#首次打开) |

> Release 页上 macOS 侧还有一个 `.zip` 与 `.blockmap`:那是留给应用内更新通道的元数据,
> 人工下载请认准 `.dmg`。

## 首次打开

两个平台的安装包都没有购买商业签名证书,首次打开各需手动放行一次。放行是**按版本**记的:
放行后当前版本双击即用,升级到新版本时要再放行一次(原因见[更新与卸载](#更新与卸载))。

### macOS

1. 打开 dmg,把 **DSH Buddy** 拖进「应用程序」,然后从「应用程序」双击启动;
2. 系统弹出「**Apple 无法验证"DSH Buddy"是否包含恶意软件**」——点「**完成**」,**不要点「移到废纸篓」**;
3. 打开「**系统设置 → 隐私与安全性**」,下滑到「**安全性**」区块,会看到一行「已阻止使用"DSH Buddy"」,点右侧「**仍要打开**」;
4. 在确认框里再点一次「**仍要打开**」,按提示输入密码或用 Touch ID;
5. 应用启动。以后双击直接进,不再提示。

> **macOS 15 起,「右键 → 打开」这条老路已被系统移除**,网上多数教程还停留在那一步;
> 现在唯一的放行入口就是上面的「系统设置 → 隐私与安全性」。

**如果看到的是「"DSH Buddy"已损坏,无法打开」**——那是 v0.4.0 及更早版本的签名缺陷
(打包时漏做代码签名,留下不完整的签名状态,被 Gatekeeper 判定为损坏),不是下载出错、也不是真的有病毒。
升级到 **v0.4.1 或更新版本**即可;想先救回手上这一份,在终端执行:

```bash
xattr -dr com.apple.quarantine "/Applications/DSH Buddy.app"
```

### Windows

1. 双击安装器,SmartScreen 提示「**Windows 已保护你的电脑**」→ 点「**更多信息**」→「**仍要运行**」;
2. 按向导选择安装目录(默认装在用户目录,不需要管理员权限,也不需要开发者模式);
3. 首次启动时 Windows 防火墙会询问网络访问——**允许**,dsh 服务要在本机 `127.0.0.1` 上监听。

## 开始使用

双击图标之后,壳会自动完成这些事,你不需要装 Node、也不用开终端:

1. 拉起随包分发的 `dsh` 服务进程(已经在跑就直接复用,不会重复启动);
2. 轮询健康检查,**服务就绪后才打开窗口**——所以窗口一出现就是能用的状态,不会给你看白屏;
3. 把内置的 agent preset 幂等安装到 `$DSH_HOME/.agent-presets/`(目录已存在则跳过,不覆盖你改过的版本)。

首次启动要解包随包资产,比之后几次慢一些,属正常。窗口打开后:

- 在 dsh 的 **preset 选择器**里可以选到随包的三个实验性 preset(见[内置插件](#内置插件));
- 会话与配置都落在 `~/.dsh`,**与你命令行里的 `dsh` 共用同一份**,两边看到的是同一批会话;
- 菜单「**帮助 → 检查更新**」可随时手动查新版本(平台差异见下一节);
- 退出应用时会整组回收 dsh 进程树,不留后台残余。

## 更新与卸载

**更新**:
- **Windows**:应用内自动更新——启动后后台检查 GitHub Releases,发现新版本自动下载,就绪后提示「立即重启安装」。也可用菜单「帮助 → 检查更新」手动触发(实时反馈:有新版本/已是最新/检查失败)。
- **macOS**:启动时检查更新,有新版本提示前往 Release 页下载新 dmg 覆盖安装
  (拖进「应用程序」选择替换即可,`~/.dsh` 里的会话与配置不受影响)。
  **新版本要重走一次[首次打开](#首次打开)的放行步骤**:ad-hoc 签名的标识绑定在每次构建的哈希上,
  换了版本在系统眼里就是另一个未验证的应用,此前的放行不会继承。
  **也暂不支持应用内静默换装**,这是系统级约束而非偷懒:macOS 的换装通道 Squirrel.Mac 会校验新包满足旧包的
  designated requirement,而 ad-hoc 签名的 DR 恰恰绑死在单次构建的 cdhash 上,跨版本必然不匹配——
  这条路要通,只能等 Developer ID 签名到位(见 [Roadmap](#roadmap))。发布产物里的 `.zip` 与 `.blockmap`
  已经为那一天备好,届时无需改动发布流水线。
  换言之,**签名证书一到位,「每次更新都要手动放行」与「不能静默换装」会同时消失**。

**卸载**:
- **Windows**:「设置 → 应用」或控制面板卸载。卸载会删除程序文件与壳自身数据(`%APPDATA%\DSH Buddy`,仅日志与更新检查状态);**`~/.dsh` 会保留**——它是 dsh 的会话与配置目录,与 dsh 命令行共享,如确认不再使用 dsh 可手动删除。
- **macOS**:把应用拖入废纸篓;`~/.dsh` 同理保留,按需手动删除。

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

### Docs Harness

`@aiwaretop/dsh-docs-harness` 是本项目自研的治理插件,随 web profile 一起预装:把方案
(plan)生命周期做成工具族、把项目自己的治理规则注入 agent 提示词、把方案进度做成
输入框上方的进度气泡,并提供 Docs Harness 引擎在项目里的安装 / 升级 / 移除入口。

三条边界值得先说清楚:

- **写盘只由你发起**。往仓库里写文件的动作只挂在输入框上方的提示条和「设置 → 插件」
  里,agent 拿不到这类工具;它在没启用的项目里调用方案工具,只会拿到一句「让用户去
  那两个入口启用」的说明。
- **总开关默认开,关掉即等于没装**。关掉后不注册工具、不注入提示词、不建投影、不挂
  路由,会话行为与未安装该插件完全一致。
- **注入的规则就是项目自己的规则**,取自项目 `AGENTS.md` 的受管块原文,不做删改;
  只把「怎么调用」从命令行改写为工具名。

源码唯一真源是 [docs-harness](https://github.com/HackSing/docs-harness) 仓库,已发布为 npm 包
`@aiwaretop/dsh-docs-harness`,与其余六个预装插件走同一条链路:构建时
`scripts/build-web-profile.js` 按 `plugins/preinstall-manifest.json` 的 `packages` 清单钉版
从 registry 装进 profile。

## 运行

前置依赖(仅从源码构建需要;下载「## 下载」里的安装包不需要以下任何一项):

- **Node.js 24**(CI 固定此版本;`npm install`/`npm run dist*` 都要用)
- **pnpm**(全局装好;`dsh plugin` 子命令把插件安装转发给它,`npm install` 不会带出它)
- 能访问 npm registry(拉内嵌 dsh 与预装的 7 个插件包)

```bash
git clone https://github.com/HackSing/dsh-buddy.git
npm install
npm start        # 开发态
npm run dist     # 打包 macOS .app → dist/mac-arm64/DSH Buddy.app
npm run dist:win # 打包 Windows 安装包 → dist/DSH Buddy Setup <ver>.exe(CI/干净终端用)
scripts\dist-win.bat # 本机 Windows 打包入口(IDE 终端里务必走它):委托 scripts\dist-win.ps1 清 IDE 注入的 ELECTRON_* 变量 + dist 锁预检 + 单行进度条,完成后按任意键打开安装包所在文件夹
```

> 打包产物为 ad-hoc 签名(`build.mac.identity: "-"`)、未公证:macOS 首次打开需在「系统设置 → 隐私与安全性」中放行,
> Windows 安装器会触发 SmartScreen 提示。ad-hoc 签名不是可选项而是底线——缺了它,
> Electron 出厂的 linker-signed 签名会因资源封印缺失被 Gatekeeper 判为「已损坏」,连放行入口都不会给
> (v0.4.0 及更早版本即如此)。

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
| `DSH_ARGS` | `@deepseek-ai/dsh@0.1.1-rc.1 web` | 逃生通道的启动参数(仅在 `DSH_CMD`/`DSH_ARGS` 任一被设置时生效) |

> dsh 版本在 `dependencies` 中钉死为 `0.1.1-rc.1`——它仍处于 developer preview,有破坏性变更风险。

## Roadmap

- [x] 打包分发(electron-builder,macOS arm64 dmg)
- [x] 随包资产:精选 agent preset 预装 + 插件 profile 随包
- [x] 发布流水线(推 tag 即自动构建并发 Release;profile 产物独立构建经 artifact 分发,Windows 已转正)
- [x] 应用内更新提示(检查 GitHub Releases,24h 节流)
- [x] Windows 桌面生命周期对标:assisted 安装器(可选安装目录)、卸载清理壳自身数据(保留 `~/.dsh`)、应用内自动更新(electron-updater 后台下载 + 重启安装,NSIS 通道不要求签名)
- [x] dsh 追新兼容验证(每日自动值班,新版本自动开 issue 报告)
- [x] Windows 安装包转正(profile 产物改为单独构建经 artifact 分发,绕开 bsdtar × pnpm junction;纯 Node 两遍解包支持无特权普通用户)
- [x] Docs Harness 插件随包(方案工具族 + 规则注入 + 进度气泡 + 用户发起的项目安装/升级/移除)
- [ ] 代码签名 + 公证 + macOS 全自动更新(Developer ID 就绪后同一发布流升级:
      发布侧的 `.zip`/`.blockmap` 与 `latest-mac.yml` 已就位,只需放开 `isAutoUpdateSupported` 的 darwin 分支;
      公证同时消除首次打开的手动放行。Windows 自动更新已先行落地)
- [ ] 存量用户随包资产增量更新(版本戳分流;profile:未改动整体替换、有自定义则自动只加不改合并;preset:未改动替换、已改动保留用户版本;均先备份,异常回滚)
- [ ] Docs Harness 后续:knowledge / acceptance 资产的前端可视化;插件发布 npm 后清单条目从 `local` 转 `packages`;引擎种子版本升级走上面那条随包资产增量更新的同一套语义
- [ ] 系统托盘、关窗常驻等桌面体验(按用户反馈驱动)

搭建思路见[发布基础设施三件套指南](docs/release-infra-playbook.md)。
