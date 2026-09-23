> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# 会话列表标题链路:投影缓存是唯一冷源,强杀丢尾帧,coldSnapshot 可修复

- 修订：2
- 关键符号：`coldSnapshot`、`session_projcache`、`writeBatchMaxDelayMs`、`dsh-buddy-title-repair`
- 资产指纹：`sha256:807acfde2f3f1a07d21aa20431710e0c5028d051e6b338e191a01ef8de3da66f`

## 摘要

侧栏冷会话标题只读 session_projcache 缓存;缓存节流丢失可从日志重折修复,日志写后 200ms 窗口内的丢失不可修复;壳通过标题修复插件 + 首屏就绪门 + Windows 宽限强杀三层处理。

## 事实

### `title-list-source`

session/list 冷会话行的标题唯一来源是 session_projcache 缓存(listProjectionsFor 只读缓存、失败即整列缺失);客户端 displayTitleOf 在 title 缺失时回退 cwd 目录名再回退 sessionId,即「标题显示成工作区名」症状。

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

### `coldsnapshot-caller-owns-the-log`

dsh 0.1.5-rc.1 把投影缓存的两个读法都改了形状,且都是静默失配(不报错,只是什么都不做):cachedSnapshot(header, inheritedEventCount, keys) 与 coldSnapshot(header, inheritedEventCount, events) 第一参都是 header 对象而非 sessionId,且 coldSnapshot 明确不再查持久层——整份日志要调用方自己给;同时 persistence.list() 返回 { header, revision, sizeBytes } 而不是裸 meta,按 meta.cwd 取字段会让每条都被判为「无 cwd」而整趟空转。取日志用 @deepseek-ai/dsh-session-query 导出的 readColdSessionLog(persistence, id) —— 它开句柄、读全量、补齐被中断 turn 的收尾事件,返回 { header, inheritedEventCount, events } 正好是 coldSnapshot 的三个实参

证据：`plugins/dsh-buddy-title-repair/index.js`、`test/title-repair-plugin.test.mjs`

### `repair-cannot-invent-titles`

重折只能恢复日志里本来就有的标题事件:日志中从未生成过标题的会话(早期会话、标题生成前就结束的会话)重折后 title 仍是 null,untitledSessions 永远非空,首屏标题门必然等满 10s 才放行。本机 2026-09-10 实测:19 行会话里 8 行属于这一类,修复把缺标题从 11 降到 8 后不再下降

证据：`lib/session-titles.js`、`plugins/dsh-buddy-title-repair/index.js`
