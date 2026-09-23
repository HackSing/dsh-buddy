# c3c 运行层证据:页面守护代际探测走授权 cookie(2026-09-23)

合并 origin/main 后,页面守护(lib/page-guard.js)每 30s 读首页 __DSH_BOOT__ rev。dsh 0.1.5-rc.1 起裸 GET / 回 401,
合并解决时新增 main.js probeWithSessionAuth 带窗口会话的授权 cookie 探测。下面用仓库 node_modules 里的 dsh 真实拉起 web,
以 lib/http-probe.js probeBody + lib/page-guard.js extractBootRev 对比两种探测(脚本在会话临时目录,逻辑:waitForLaunchToken → probeBody 裸探 → exchangeAuthCookie → probeBody 带 cookie)。

```
token? true
bare   status 401 rev null
cookie status 200 rev 88406ba5ad13
```

结论:裸探 401 且 rev 取不到(远端原写法在 0.1.5 下代际检测静默失效);带 cookie 200 且取到 rev。未覆盖:Electron 窗口内 probeWithSessionAuth 从 session.defaultSession 取 cookie 这一段未单独验证(page-guard.log 的 baseline rev 行未核对)。
