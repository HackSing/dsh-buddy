# c4 产物层证据:随包 web profile 重建与断言(2026-09-23 重录,HEAD 0f68b7a)

原证据(c4-profile-tar.md)按 9-10 的 7 包清单构建;此后 git-graph、web-ui-settings 退出预装,按现清单重建。

## build-web-profile.js(产物本体 build/web-profile.tar.gz 不入 git)
```
$ node scripts/build-web-profile.js
[build-web-profile] wrote D:\Project\dsh-buddy\build\web-profile.tar.gz (platform=win32)
build-exit=0
tar 字节数: 107904001
```

## verify-profile-tar.js
```
$ node scripts/verify-profile-tar.js
PROFILE ASSERT PASS: entries=14829 links=0 binaries=26 (D:\Project\dsh-buddy\build\web-profile.tar.gz)
verify-exit=0
```

## 安装进 tar 的插件(web/package.json dependencies)
```
@aiwaretop/dsh-dispatch 0.1.3
@aiwaretop/dsh-docs-harness 0.2.2
@linxin666/dsh-client-ui-skin-center 0.3.20
@linxin666/dsh-pet 0.3.20
dsh-better-sidebar 0.19.0
```

与 plugins/preinstall-manifest.json 的 5 个 packages 名称、版本逐一一致;退休包均未出现。
