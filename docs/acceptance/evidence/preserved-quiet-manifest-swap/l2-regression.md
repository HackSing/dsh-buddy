# L2 聚焦回归证据(2026-08-23,darwin-arm64,主控会话亲跑)

## npm test(node --test 全量单测)

```
cd /Users/aiware/projects/dsh-buddy && npm test
ℹ tests 381
ℹ pass 380
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1   # 既有 skip:build/spike-run 不存在时跳过的集成断言,与本次无关
退出码 0
```

覆盖本次新增用例:bundled-profile 五态/retired/file: 判定 11 例、plugin-channel 的 diffChannelVersions file: 跳过、plugin-update V1/V2 的 preserved-current→up-to-date 折叠(V2 断言不发起 fetch)。

## verify-bundled-profile 隔离 DSH_HOME 场景

```
node scripts/verify-bundled-profile.js .
…
ok   posix symlink 内容可解析
SMOKE PASS
退出码 0(46 项 ok,0 FAIL)
```

含新增:d3(全满足+外挂→preserved-current)、d3b(落后+外挂→preserved)、d6/d7(retired 判定)、5e(preserved-current 不动磁盘)、5f(退休包存量迁移:判 upgraded、备份目录含旧 deps、新 profile 不含退休包、无 staging 残留)。场景 1 的 win32 实体化断言加平台门控——HEAD 原码在 macOS 恒 FAIL 已由主控会话用 detached worktree 复现确认为既有平台错配。
