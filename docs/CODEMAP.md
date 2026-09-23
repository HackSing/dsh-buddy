# CODEMAP：代码能力索引

动手写代码前先查本索引定位可复用模块；新增代码文件或公开接口变化时同步更新条目。
每行一个模块，格式如下（登记时去掉行首的"示例："）：

示例：- `src/example/module.py` — 职责：一句话说明；公开接口：`main_function`、`ExampleClass`

Structure 检查会校验登记路径存在、公开接口符号存活，并提醒未登记的新增代码文件；
测试文件不必登记。

## 壳与 dsh 的交互层

- `lib/dsh-browser-auth.js` — 职责:dsh 0.1.5-rc.1 web 浏览器授权门的单一来源(解析 launch token、拼带 token 的 URL、token 换授权 cookie);公开接口:`launchTokenFrom`、`authenticatedUrl`、`waitForLaunchToken`、`exchangeAuthCookie`、`AUTH_COOKIE_PREFIX`
- `lib/http-probe.js` — 职责:「此刻这个 HTTP 端点通不通」的探测与轮询等待(可带授权 cookie 头),不可达折叠成 null 不抛;公开接口:`probeHttp`、`probeBody`、`waitForHttp`
- `lib/page-guard.js` — 职责:壳层页面守护,内容页死亡(崩溃/加载失败/持续无响应)与服务端代际更替的检测和风暴抑制下的自动恢复;公开接口:`attachPageGuard`、`createReloadGovernor`、`extractBootRev`
- `lib/session-titles.js` — 职责:首屏标题就绪门,按 host API 契约取会话列表并判定标题是否回写完;公开接口:`waitForTitlesSettled`、`untitledSessions`、`titleOf`、`postSessionList`
- `lib/dsh-entry.js` — 职责:从 dsh 包目录按 bin 字段解析可执行入口;公开接口:`binEntryFrom`
- `lib/dsh-log.js` — 职责:dsh 子进程输出三路分发(落盘/内存尾部/透传控制台);公开接口:`createDshLogger`
- `lib/process-tree.js` — 职责:整组回收进程树,不留孤儿;公开接口:`killProcessTree`
- `lib/patch-dsh-no-window.js` — 职责:给内嵌 dsh-win32-process 三处 CreateProcess 创建标志补 CREATE_NO_WINDOW 的幂等文本变换(消 Windows 运行时闪终端);公开接口:`patchSource`、`patchFile`、`MARKER`、`CREATE_NO_WINDOW`
- `scripts/patch-dsh-no-window.js` — 职责:上述补丁的目标定位与 CLI(postinstall 打上、--check 把关、--target 热修已安装应用);公开接口:命令行入口
- `lib/plugin-update.js` — 职责:插件热更安装编排,按通道 schema 分流 v1 整包/v2 逐插件切片,负责下载(两段式超时:响应头预算 + body 空闲判定)、sha256 校验与外科替换,失败折叠 failed 不动现有 profile;公开接口:`applyPluginUpdate`、`downloadTarball`、`PLUGIN_UPDATE_OUTCOME`、`DOWNLOAD_NAME`
