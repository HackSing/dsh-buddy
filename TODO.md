# TODO

条目格式：`- [ ] 事项（owner，YYYY-MM-DD）`；完成后改为 `- [x]` 并保留在「已完成」。

## 待办

（暂无）

## 已完成

- [x] Windows 侧补 L4 验收证据（aiware，2026-08-22）

  c3 的 Windows 实机证据已补齐，被验产物是 Release v0.4.1 的 `DSH-Buddy-Setup-0.4.1.exe`，
  本地副本 sha256 与 release digest 逐字节一致（非重新构建物）。终跑 8 项断言全 PASS、退出码 0，
  记录 `acc-20260822T034245-01ca14a533`，`assets-check --strict` 0 违规 0 警告。

  脚本首跑暴露两处缺陷（均已修正并随证据提交）：
  1. **缺安装前安全阀**——electron-builder 的 NSIS 是 `perMachine:false`，按 appId 在 HKCU 注册
     全局安装记录，同一用户只能有一份。装到临时沙盒只隔离文件系统、隔离不了「安装身份」，
     沙盒安装接管该记录后，卸载会把机器上原有的 DSH Buddy（程序目录 + `%APPDATA%` userData）
     一并清除。**首跑实测确实卸掉了开发机上原有的安装**（`~/.dsh` 用户数据不受影响，已核验完好，
     事后用同一安装包恢复原路径）。现由 `assertNoExistingInstall` 在动手前拒绝在已装机器上运行。
     **在装有 DSH Buddy 的机器上跑此脚本前，请先卸载那份安装。**
  2. **把 NSIS 静默卸载当同步调用**——卸载器默认自我复制到 `%TEMP%` 再运行并立即返回，导致
     「卸载后主程序已移除」误判 FAIL、随后 `rmSync` 抛 `EPERM`；改用 NSIS 约定的 `_?=<dir>`
     强制原地同步执行，并手动收走该模式下不自删的卸载器。

  另：安全阀的沙盒例外判据一度是哑的（electron-builder 不写 `InstallLocation`，值为空），
  靠新增的 `reportRegistryEntry` 把注册记录打进日志才发现，改取 `UninstallString` 后复验通过。
  三处修正根因同类——**把异步操作当同步用**，与 c2 Windows 版的 taskkill 竞态同族。

- [x] Windows 侧补 L3 验收证据（aiware，2026-08-22）

  c2 的 Windows 实机证据已补齐：`c2-runtime-v2-windows.mjs` 与 macOS 版正文逐字一致（已 diff 校验），
  仅三处按 Windows 平台事实调整——`REPO_ROOT` 由脚本自身位置推导；`WORK` 取盘符根下短目录避开
  MAX_PATH(260) 对 `node_modules` 嵌套的硬约束；`bootAndProbe` 收尾等进程 exit 再返回。
  第三处系首跑实测暴露：`killProcessTree` 在 Windows 上是异步派发 `taskkill /T /F`，返回时句柄未释放，
  调用方紧接的 `rmSync` 抛 `ENOTEMPTY`（残留 dsh 尚未松手的 task-board 目录）；对照实验确认
  「杀完立即删=失败 / 杀完等 exit(335ms)再删=成功」后单点修复，未在 rmSync 处加重试。
  重跑 28 项断言全 PASS、0 失败、退出码 0，记录 `acc-20260822T014947-f88e526f78`，
  `assets-check --strict` 0 违规 0 警告。
