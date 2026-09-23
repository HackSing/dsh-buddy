# c1 契约层证据:钉版形状与预装清单(2026-09-23 重录,合并 origin/main 之后,HEAD 0f68b7a)

## package.json 中的 @deepseek-ai 钉版
```
条目数: 33
@deepseek-ai/cordis-plugin-group 1.0.1
@deepseek-ai/dsh 0.1.5-rc.1
@deepseek-ai/dsh-anonymous-user-id 0.1.5-rc.1
@deepseek-ai/dsh-atomic-write 0.1.5-rc.1
@deepseek-ai/dsh-attachment 0.1.5-rc.1
@deepseek-ai/dsh-authorization 0.1.5-rc.1
@deepseek-ai/dsh-bash-local 0.1.5-rc.1
@deepseek-ai/dsh-client-store 0.1.5-rc.1
@deepseek-ai/dsh-client-ui-primitives 0.1.5-rc.1
@deepseek-ai/dsh-client-ui-slots 0.1.5-rc.1
@deepseek-ai/dsh-code-runtime 0.1.5-rc.1
@deepseek-ai/dsh-compaction 0.1.5-rc.1
@deepseek-ai/dsh-fs 0.1.5-rc.1
@deepseek-ai/dsh-hook-protocol 0.1.5-rc.1
@deepseek-ai/dsh-invariants 0.1.5-rc.1
@deepseek-ai/dsh-jobs 0.1.5-rc.1
@deepseek-ai/dsh-output-retention 0.1.5-rc.1
@deepseek-ai/dsh-sandbox 0.1.5-rc.1
@deepseek-ai/dsh-scope 0.1.5-rc.1
@deepseek-ai/dsh-sdk-protocol 0.1.5-rc.1
@deepseek-ai/dsh-session-persistence 0.1.5-rc.1
@deepseek-ai/dsh-session-query 0.1.5-rc.1
@deepseek-ai/dsh-session-telemetry 0.1.5-rc.1
@deepseek-ai/dsh-session-title-llm 0.1.5-rc.1
@deepseek-ai/dsh-settings 0.1.5-rc.1
@deepseek-ai/dsh-shell 0.1.5-rc.1
@deepseek-ai/dsh-spill 0.1.5-rc.1
@deepseek-ai/dsh-subagent-in-process-driver 0.1.5-rc.1
@deepseek-ai/dsh-subprocess 0.1.5-rc.1
@deepseek-ai/dsh-timeout 0.1.5-rc.1
@deepseek-ai/dsh-util-time 0.1.5-rc.1
@deepseek-ai/dsh-util-workspace-path 0.1.5-rc.1
@deepseek-ai/dsh-workflow 0.1.5-rc.1
```

## package-lock.json 中的 rc.2 残留
```
@deepseek-ai 条目: 254
version===0.1.1-rc.2 的条目数: 0
dsh 家族(路径末段为 @deepseek-ai/dsh*)非 0.1.5-rc.1 的条目数: 0
```

## 预装清单 packages / retired
```
packages (5):
  @linxin666/dsh-client-ui-skin-center@0.3.20
  @linxin666/dsh-pet@0.3.20
  @aiwaretop/dsh-dispatch@0.1.3
  @aiwaretop/dsh-docs-harness@0.2.2
  dsh-better-sidebar@0.19.0
retired:
  @linxin666/dsh-client-ui-git-graph
  @linxin666/dsh-client-ui-task-board
  @linxin666/dsh-live-stats
  @linxin666/dsh-skins
  @linxin666/dsh-client-ui-web-ui-settings
```

## main.js 的 DSH_VERSION
```
48:const DSH_VERSION = '0.1.5-rc.1'; // 与 package.json dependencies 保持一致(dsh 仍是 developer preview)
```
