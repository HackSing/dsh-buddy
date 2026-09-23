# c3 运行层追加证据:随包标题修复插件在 rc.5 上真正回写(2026-09-10)

门禁 4/4 之后发现的 in-flight 缺陷:`plugins/dsh-buddy-title-repair` 在 dsh 0.1.5-rc.1 上
静默空转(`persistence.list()` 与 `coldSnapshot` 两处形状都变了,且都不报错)。修复后
以真实启动壳的方式验证——判据是投影缓存里出现「本次重折写回」的标题行。

## 投影缓存回写(`$DSH_HOME/storages/session_projcache/sessions/*.json`)

修复前该目录 15 个会话行的 mtime 全部停在 16:45:42(上一次 dsh 自己写的),
修复后启动壳,重折在 17:23–17:28 逐条回写:

```
16:45:42 06fe9714 '手机声音通过开发板麦克风'
17:23:40 1ae99053 None
16:45:42 1be0ec54 'AIOT眼镜对接方案要素'
17:28:52 2d67380f None
17:28:57 50561415 None
16:45:42 51e2e9df 'Pull origin branch to local worktree'
17:28:39 545d597e None
16:45:42 69c959c7 None
17:24:33 91e80ee5 None
16:45:42 aa15ae35 None
17:25:20 ba1854de '你好'
16:45:42 ca70cc99 '你好'
17:26:51 ca928f28 '你好'
17:27:20 cc68fb87 '你好'
17:23:45 d5f30e64 None
files 15 with-title 7 written-after-17:20 9
```

其中 `ba1854de` / `ca928f28` / `cc68fb87` 三行是重折新写出的真实标题
(缓存行形如 `"title": {"ver": 1, "seq": 30, "val": "你好"}`),证明
`readColdSessionLog` → `coldSnapshot(header, inheritedEventCount, events)` 这条新链路生效。

## session/list 侧计数(壳启动时的首屏标题门)

修复前:缺标题 11 / 有标题 6;修复后:缺标题 8 / 有标题 7。

剩余 8 条**不是缺陷**:它们的会话日志里本就没有标题事件(从未产生过标题),
重折也无从恢复。副作用是首屏标题门每次都会烧满 10s 超时后 fail-soft 放行
(`lib/session-titles.js` 的既有设计:超时不挡启动),这是本机数据分布决定的,
不是本次引入。
