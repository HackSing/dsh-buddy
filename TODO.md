# TODO

条目格式：`- [ ] 事项（owner，YYYY-MM-DD）`；完成后改为 `- [x]` 并保留在「已完成」。

## 待办

- [ ] Windows 侧补 L4 验收证据（aiware，2026-08-22）

  **为什么**：`docs/acceptance/plugin-incremental-update.json` 的 c2(L3) 与 c3(L4)，原 Windows 记录的证据都写在
  `.gitignore` 覆盖的 `build/` 下，从未进 git、本地清理后永久失效；两层的补记录都是在 macOS 上做的。
  于是 Windows 独有的路径——NSIS 安装器、pnpm junction 布局下的 profile 解包、taskkill 进程树回收——
  当前**没有任何有证据支撑的覆盖**，而这些正是 `.github/workflows/release.yml` 开头整段注释警告过的高风险区
  （bsdtar 打包 junction 后链接失真、解包需符号链接特权）。两个 criterion 的 status 仍是 passed，
  容易让人误以为双平台都验过。**c2(L3) 已于 2026-08-22 在 Windows 实机补齐**（见「已完成」），
  此条只剩 c3(L4)。

  **前置**：Windows x64 + Node 24 + 本仓库 clone（脚本靠自身位置推导仓库根，不要求特定盘符或目录名）。

  1. **L4**：`gh release download v0.4.1 --pattern "*.exe"`，然后
     `node docs\acceptance\evidence\plugin-incremental-update\c3-l4-nsis-windows.mjs <Setup.exe>`，
     日志用 `Tee-Object` 存到脚本同级目录。该脚本在 macOS 上编写、**未经 Windows 实机验证**——
     顶层代码与平台守卫已验，NSIS 静默安装、PowerShell 查询、taskkill 回收三处均未实跑；
     首次运行若因命令行细节报错，改好后把脚本修正一并提交，修正后的脚本本身就是证据的一部分。
     L3 实机踩到的坑同样适用于此：`killProcessTree` 只是**派发** `taskkill /T /F`，返回时句柄尚未释放，
     紧跟着删/改文件会撞 `ENOTEMPTY`/`EPERM`（macOS 的 unlink 语义踩不到，故 macOS 版脚本无此防护）。
     本脚本的 `reclaim` 已等 exit 事件并轮询 `waitForNoLeftover`，但安装/卸载目录操作仍需留意同一竞态。
  2. 日志就位后跑一次 `acceptance record --acceptance docs/acceptance/plugin-incremental-update.json
     --input <input.json>`（`criterion_id` 是 input JSON 里的字段而非命令行参数，填 c3；
     `--input` 路径必须在项目内，放 `build/` 下用完即删即可），最后
     `python scripts/harness.py assets-check --strict`。注意 harness 现在会拒绝落在 git 忽略路径的证据
     （`acceptance_evidence_ignored`），**证据必须放 `docs/acceptance/evidence/`，不要再写进 `build/`**。

## 已完成

- [x] Windows 侧补 L3 验收证据（aiware，2026-08-22）

  c2 的 Windows 实机证据已补齐：`c2-runtime-v2-windows.mjs` 与 macOS 版正文逐字一致（已 diff 校验），
  仅三处按 Windows 平台事实调整——`REPO_ROOT` 由脚本自身位置推导；`WORK` 取盘符根下短目录避开
  MAX_PATH(260) 对 `node_modules` 嵌套的硬约束；`bootAndProbe` 收尾等进程 exit 再返回。
  第三处系首跑实测暴露：`killProcessTree` 在 Windows 上是异步派发 `taskkill /T /F`，返回时句柄未释放，
  调用方紧接的 `rmSync` 抛 `ENOTEMPTY`（残留 dsh 尚未松手的 task-board 目录）；对照实验确认
  「杀完立即删=失败 / 杀完等 exit(335ms)再删=成功」后单点修复，未在 rmSync 处加重试。
  重跑 28 项断言全 PASS、0 失败、退出码 0，记录 `acc-20260822T014947-f88e526f78`，
  `assets-check --strict` 0 违规 0 警告。
