> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# 会话列表标题链路:投影缓存是唯一冷源,强杀丢尾帧,coldSnapshot 可修复

- 修订：1
- 关键符号：`coldSnapshot`、`session_projcache`、`writeBatchMaxDelayMs`、`dsh-buddy-title-repair`
- 资产指纹：`sha256:15e3fa7402b0c2880318cc9ea7de4a30a7ff02f8d7ced3c2afd271b09de0ec69`

## 摘要

侧栏冷会话标题只读 session_projcache 缓存;缓存节流丢失可从日志重折修复,日志写后 200ms 窗口内的丢失不可修复;壳通过标题修复插件 + 首屏就绪门 + Windows 宽限强杀三层处理。

## 事实

### `title-list-source`

session.list 冷会话行的标题唯一来源是 session_projcache 缓存(listProjectionsFor 只读缓存、失败即整列缺失);客户端 displayTitleOf 在 title 缺失时回退 cwd 目录名再回退 sessionId,即「标题显示成工作区名」症状。

证据：`lib/session-titles.js`、`plugins/dsh-buddy-title-repair/index.js`

### `cache-loss-recoverable`

session.history(detachedProjectionsFor)只现折不回写;只有 sessionProjectionCache.coldSnapshot 会重折并立即回写缓存(cold-read write-back),且无缓存行时 restoreFloor=0 走全量重折——壳的 dsh-buddy-title-repair 插件据此在 dsh 启动时修复全部缺标题冷会话。

证据：`plugins/dsh-buddy-title-repair/index.js`、`lib/title-repair-install.js`

### `log-write-behind`

会话日志是写后落盘(writeBatchMaxDelayMs 默认 200ms),taskkill /F 硬杀会丢掉窗口内事件(如刚生成的 LLM 标题)且不可恢复;POSIX 的 SIGTERM 走 dsh profile-boot 有界优雅停机(dispose 时 flush 全部 live 会话),Windows 无信号通道,壳用 detached cmd 延迟 1s 再强杀(QUIT_GRACE_MS)。

证据：`lib/process-tree.js`、`main.js`

### `install-quit-no-grace`

quitAndInstall 的安装态退出不走宽限(installPending):宽限期内 dsh 子进程仍持有 app 目录文件锁,会撞 NSIS 安装器文件替换;安装丢失的尾帧由下次启动的标题修复自愈。

证据：`main.js`
