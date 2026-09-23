# c4 产物层证据:随包 web profile 重建与断言(2026-09-10)

## build-web-profile.js(产物本体 build/web-profile.tar.gz 不入 git)
```
$ node scripts/build-web-profile.js
Done in 515ms using pnpm v10.33.0
[build-web-profile] wrote D:\Project\dsh-buddy\build\web-profile.tar.gz (platform=win32)
build-exit=0
tar 字节数: 108269349
```

## verify-profile-tar.js
```
$ node scripts/verify-profile-tar.js
PROFILE ASSERT PASS: entries=15012 links=0 binaries=26 (D:\Project\dsh-buddy\build\web-profile.tar.gz)
verify-exit=0
```

## 安装进 tar 的插件(profile package.json)
```
@aiwaretop/dsh-dispatch 0.1.3
@aiwaretop/dsh-docs-harness 0.2.2
@linxin666/dsh-client-ui-git-graph 0.3.20
@linxin666/dsh-client-ui-skin-center 0.3.20
@linxin666/dsh-client-ui-web-ui-settings 0.3.20
@linxin666/dsh-pet 0.3.20
dsh-better-sidebar 0.19.0
```
