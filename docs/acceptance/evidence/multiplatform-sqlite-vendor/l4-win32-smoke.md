# L4 证据:Windows CI 装载 smoke(v0.4.3 发版流水线,2026-08-23)

release run 32621000695(tag v0.4.3,commit 3d8d1e8)四 job 全绿;windows job(windows-latest 真实 win32-x64 runner)的「dispatch sqlite 装载 smoke」step 日志:

```
05:43:44 tar -xzf build/web-profile.tar.gz -C "$smoke_dir" web/node_modules/@aiwaretop/dsh-dispatch/vendor/node_modules/better-sqlite3
05:43:44 ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe "$smoke_dir/smoke.cjs" ".../better-sqlite3"
05:43:45 WIN32 SQLITE LOAD OK
```

即:从分发的 profile tar 解出的 vendored better-sqlite3,在真实 Windows 上经 Electron-as-Node require 成功(锚点补丁选中 win32-x64 二进制),`:memory:` 建表、插入、查询断言全部通过。smoke step 位于打包前,此后 electron-builder 产出的 `DSH-Buddy-Setup-0.4.3.exe` 即含该已实证 profile。

Release v0.4.3 资产:mac dmg/zip + Windows Setup exe + 双 updater feed,非 draft 非 prerelease。
