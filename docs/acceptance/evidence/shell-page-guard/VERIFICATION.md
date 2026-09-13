# 壳层页面守护 L3 验证记录

日期:2026-08-23(UTC 时间戳见日志)。环境:macOS 26.5.2,开发态 `electron .`。
方法:`DSH_URL=http://127.0.0.1:3399` 将壳指向受控假 dsh(scratchpad fake-dsh.js,
`__DSH_BOOT__` 顶层 rev 从 rev.txt 实时读取),`--remote-debugging-port=9223` 供 CDP 断言。
真实 dsh 守护进程(3080)全程未触碰。

## c1 渲染进程崩溃自愈(L3 local_runtime)

- 08:37:08Z 对壳的 `Electron Helper (Renderer)`(pid 72042)执行 `kill -9`。
- page-guard.log 同秒记录 `recover: render process gone (killed)`(见 page-guard.log)。
- CDP DOM 断言:恢复后页面 `readyState=complete`,正文 `loaded at 2026-08-23T08:37:08.857Z`
  证明为崩溃后的新加载;截图 c1-after-recover.png。

## c2 服务代际更替自动刷新(L3 local_runtime)

- 08:37:22Z 将假服务 rev 由 `gen-alpha-001` 翻转为 `gen-beta-002`。
- 08:37:46Z(24 秒,<30s 探测周期)记录
  `recover: server generation changed (gen-alpha-001 -> gen-beta-002)`,
  随后 `baseline rev gen-beta-002` 基线对齐;仅一次恢复,无重复刷新循环。
- CDP DOM 断言:页面正文 `fake-dsh generation gen-beta-002`,`loaded at 08:37:46.729Z`;
  截图 c2-after-genflip.png。

## c3 单测与回归(L2 focused_test)

- 聚焦:`node --test test/page-guard.test.mjs` → 12/12 通过(focused-tests.txt)。
- 全套件:`npm test` → 393 项,392 通过、1 跳过(既有)、0 失败(full-suite.txt)。

## 未覆盖项

- `unresponsive` 超宽限路径仅有单测覆盖(真实触发需人为挂死渲染进程,收益不抵成本)。
- 风暴抑制参数(3 次/5 分钟、间隔 30s)仅有单测覆盖,未做真实 reload 风暴演练。
- Windows/Linux 三种窗口模式的接线(win.contentWebContents)与 macOS 同源同代码路径,
  未在真实 Windows/Linux 上运行验证。
