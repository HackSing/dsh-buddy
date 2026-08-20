> 状态：已验收-仅追溯
<!-- docs-harness:acceptance-document/v1 -->

# dsh 上游与预装插件的运行时更新通道验收

- 修订：7
- 关键符号：`profileUpgradeDecision`、`installBundledProfile`、`checkPluginChannel`、`plugin-channel.json`
- 资产指纹：`sha256:a722571e331a427133908665d049ce3cac9e52f24e795b51cb4cbab584fea314`
- 关联方案：`docs/plans/dsh-upstream-update-channel.json`

## 验收目标

验证插件热更通道全链路：检测→确认→下载校验→安装→备份→dsh 重启生效；热更结果不被随包旧 manifest 回滚；损坏包不污染现有 profile；失败不阻断 dsh 启动。

## 验收标准

### `c1` 纯逻辑单测全绿：profileUpgradeDecision 方向性四分支、channel JSON 解析与版本比对、sha256 校验失败路径

- 状态：passed
- 类型：contract_check
- 层级：L1
- 证据：`build/test-output-batch1-3.txt`

### `c2` 端到端热更流程：本地静态服务器挂真 channel JSON 与新版 tar，驱动检测→下载→安装，断言 profile 版本更新、旧目录备份存在、dsh 启动探测 HTTP 200

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`build/acceptance-runtime.log`

### `c3` 回滚免疫与损坏包防护：热更后模拟随包旧 manifest 启动不替换 profile；sha256 不符的包不触碰现有 profile 且错误可见

- 状态：passed
- 类型：behavior_acceptance
- 层级：L3
- 证据：`build/acceptance-runtime.log`

### `c4` 真实发布通道：GitHub 滚动 release 上传 channel 与 tar，客户端真拉取完成一次热更，由用户确认

- 状态：passed
- 类型：user_acceptance
- 层级：L5
- 证据：`build/acceptance-runtime.log`
