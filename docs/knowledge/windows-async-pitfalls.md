> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# Windows 进程回收与 NSIS 安装器的异步陷阱

- 修订：1
- 关键符号：`killProcessTree`、`killAndWaitExit`、`assertNoExistingInstall`、`reportRegistryEntry`
- 资产指纹：`sha256:f2b8704d1d70cb5114894e577e75c868c7303f7d859f338502780d1fd1a6a108`

## 摘要

Windows 侧 taskkill、NSIS 安装/卸载均为派发即返回,把它们当同步用会误判与撞锁;附 profile 目录文件锁的实测边界

## 事实

### `win.kill-is-dispatch`

killProcessTree 在 Windows 上 spawn 的是 taskkill /pid /T /F,发出即返回——语义是「派发杀」而非「杀干净」,函数返回时进程未退、文件句柄未释放;调用方若紧接着删除该进程用过的目录会撞 ENOTEMPTY。2026-08-22 对照实验:dsh 被杀后立即 rmSync 整个 DSH_HOME 失败并残留 DSH_HOME 根下的 task-board 运行时数据目录,改为先等 child 的 exit 事件(实测 335ms)再删则成功;进程树完全归零约 512ms。POSIX 侧发的是 SIGTERM 且 unlink 允许删除已打开文件,没有这条约束,故 macOS 版脚本的 fire-and-forget 写法在那边是对的。修复应落在「确保已停」这一不变量(c2-runtime-v2-windows.mjs 的 killAndWaitExit),而不是给 rmSync 加重试

证据：`lib/process-tree.js`、`docs/acceptance/evidence/plugin-incremental-update/c2-runtime-v2-windows.mjs`、`docs/acceptance/evidence/plugin-incremental-update/c2-runtime-v2-windows.log`

### `win.nsis-uninstall-async`

NSIS 静默卸载(/S)默认把卸载器自我复制到 %TEMP% 再从那里运行(这样它才能删掉自己所在目录),原进程随即退出,因此 spawnSync 返回时卸载仍在后台进行:断言「主程序已移除」会误判 FAIL、紧接的 rmSync 抛 EPERM,而目标目录最终确实变空。用 NSIS 约定的 _?= 参数指定卸载器工作目录可阻止自我复制、令卸载同步执行;代价是该模式下卸载器不自删,需调用方手动收走

证据：`docs/acceptance/evidence/plugin-incremental-update/c3-l4-nsis-windows.mjs`

### `win.nsis-install-async`

NSIS 安装器同理:目标 exe 出现不等于安装完成。2026-08-22 实测,exe 就位时文件数仅 131,安装器继续解包到 19938 才收尾,而注册表记录、卸载器、开始菜单快捷方式都在最后阶段才写入;判定安装完成必须等安装器进程退出,以「目标 exe 是否存在」为准会拿到半成品状态

证据：`docs/acceptance/evidence/plugin-incremental-update/c3-l4-nsis-windows.mjs`

### `win.registry-install-location-empty`

electron-builder 的 NSIS 不写 HKCU Uninstall 项的 InstallLocation(值为空字符串),要判断安装位置必须取 UninstallString(其值是带引号的卸载器绝对路径,后跟 /currentuser);DisplayName 形如 DSH Buddy 0.4.1(带版本号)。据 InstallLocation 做路径判定的逻辑会静默失效而非报错——c3-l4-nsis-windows.mjs 的安全阀例外判据一度因此形同虚设,靠 reportRegistryEntry 把注册记录打进日志才发现

证据：`docs/acceptance/evidence/plugin-incremental-update/c3-l4-nsis-windows.mjs`、`docs/acceptance/evidence/plugin-incremental-update/c3-l4-nsis-windows.log`

### `win.profile-dir-lock-scope`

2026-08-22 实测(node 直接拉起 dsh、profile 为随包纯 JS 构成、dsh 刚 HTTP 200 就绪):dsh 存活期间对 profiles 下的 profile 目录做 renameSync(换出与换入)与 rmSync 均成功,未被文件锁阻挡;dsh 握住的句柄在 DSH_HOME 根下的运行时数据目录(如 task-board)而非 profile 目录内。这与已记录的「宽限期内 dsh 子进程持有 app 目录文件锁会撞 NSIS 安装器文件替换」不矛盾——作用对象一个是安装目录、一个是 profile 目录。边界未覆盖:Electron 打包环境下拉起的 dsh、长时间使用后的句柄状态、profile 内含原生模块的情形(.node 被内存映射后删除必然失败,而 rename 父目录通常仍可行)。因此不能据此断言「文件锁从不挡住 profile 替换」,main.js 中 prepareInstall 一处的该说法暂标存疑,未据此改动代码

证据：`main.js`、`lib/plugin-update.js`
