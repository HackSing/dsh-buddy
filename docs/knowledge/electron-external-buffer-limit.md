> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# Electron 当 Node 跑内嵌 dsh 的原生能力边界：external buffer 被禁

- 修订：1
- 关键符号：`readUtf16`、`patch-dsh-picker`、`DSH_PICKER_BROWSE`、`browse-picker-patch`
- 资产指纹：`sha256:fe4624a05953063b238cf5f6b5134de28dc7cf64a3527668298a84193a716714`

## 摘要

本壳用 Electron 二进制当 Node 运行内嵌 dsh，上游任何走 external ArrayBuffer 的原生路径都会 napi fatal 崩进程；Win32 目录选择器已按此打补丁，browse 后端是降级退路

## 事实

### `electron.no-external-buffers`

Electron 运行时禁用 external ArrayBuffer（koffi doc/pointers.md 点名 Electron），koffi.view() 调用即 FATAL ERROR: Error::New napi_get_last_error_info 崩掉整个进程；同一份 koffi 3.1.5 与同一段代码在系统 Node 24 上三种长度全部正常，Electron 38.8.6 首次调用即崩——差异来自运行时而非 koffi 版本

证据：`scripts/patch-dsh-picker.js`

### `electron.runtime-inherited-by-dsh-children`

main.js 的 resolveLauncher 以 process.execPath + ELECTRON_RUN_AS_NODE=1 拉起内嵌 dsh，dsh 内部再以 process.execPath 派生的子进程（如 Win32 目录选择器 worker）继承同一 Electron 运行时，因此上游在真 Node 下正确的原生代码在本壳可能整条链路失效；判断上游 bug 归属时必须先区分「上游目标环境」与「本壳运行时」

证据：`main.js`、`scripts/patch-dsh-picker.js`

### `picker.native-patch`

@deepseek-ai/dsh-host-directory-picker-native 的 worker.cjs readUtf16 用 koffi.view 读对话框返回路径，用户选完目录即崩，前端报 win32 folder dialog worker exited before reporting a result；scripts/patch-dsh-picker.js 把它换成 lstrlenW 量长度 + koffi.decode 复制读，由 postinstall 自动重打、predist/dist:win 以 --check 把关，上游形状一变即硬失败而非静默错过

证据：`scripts/patch-dsh-picker.js`、`package.json`

### `picker.browse-fallback`

降级退路是 dsh 自带的 browse 目录选择：profile 的 cordis.patch.yml 里禁掉 id=directory-picker 的 auto 行，再 insert 后端 dsh-host-directory-picker-browse 与客户端 dsh-client-ui-directory-picker-browse 两张面（auto 插件同时挂两者，pin 时都要自己给）；已实证 loader 确实解析 insert 行——包名写错时 dsh 直接以 failed to import loader entry 启动失败

证据：`lib/browse-picker-patch.js`、`scripts/use-browse-picker.js`

### `picker.fallback-reach`

构建期 DSH_PICKER_BROWSE=1 让 build-web-profile.js 把降级块写进随包 profile，同时让 patch-dsh-picker.js 让开；但 lib/bundled-profile.js 的幂等解包对已存在 profile 直接跳过，存量用户拿不到随包降级，必须在本机跑 scripts/use-browse-picker.js 改 DSH_HOME 里的 patch 层

证据：`scripts/build-web-profile.js`、`lib/bundled-profile.js`、`scripts/use-browse-picker.js`
