# 批4 真实链路取证（2026-08-18）

## 环境

- dsh 运行时：dsh-buddy 仓库 node_modules 内嵌 @deepseek-ai/dsh@0.1.0-rc.6，以 `node node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 3080` 启动（与桌面 app 打包态的 ELECTRON_RUN_AS_NODE 嵌入路径同一入口）。
- DSH_HOME：C:/Users/freed/.dsh（用户真实配置、真实 DeepSeek 官方 provider）。
- preset 副本：C:/Users/freed/.dsh/.agent-presets/preset 已按批1/2 手动迁移（备份 preset.bak-20260818；迁移后与随包版仅差 bashPath 一行本地修改，与指纹升级的 preserved 语义一致）。
- 工作区：D:/Project/AIGlasses；预设 Anchored Standard (experimental)；模型 DeepSeek-V4-Flash High。
- 原始会话日志：C:/Users/freed/.dsh/sessions/--D-Project-AIGlasses--/session-91531061-86e5-4522-9173-4b1c4ee06377/session.jsonl.zstd；逐帧解压后存 real-session.jsonl（同目录）。

## 取证结论（逐条对应 c3）

1. 第 1 请求单行 persona 不变：request/header #1（seq 10）`system` 完整内容逐字为
   `"You are a helpful software engineer assistant."`，`tools` 恰为 `[bash, str_replace_editor]`——与旧 `complete: true` 行为字节等值。
2. 第 2 请求起 system 含治理段：request/header #2（seq 93）`system` 长 12188 字符，含 Harness 身份段与完整 Docs Harness 治理段（命中 "Docs Harness"@1415、"harness_plan_create"@6851、"验收"@1597、"knowledge"@1604），含加固后的工具适配段（"在本应用中如何调用上述能力"，plan select/create/settle → harness_plan_* 映射、`plan_progress` 声明）；`tools` 开放为 `[bash, dev_tool_search, skill_load, skill_search, str_replace_editor]`。
3. harness_plan_* 可发现：turn 2 tool/call `dev_tool_search({"query":"harness_plan"})`，tool/result 返回 "Matching tools (4): harness_plan_select / harness_plan_create / harness_plan_settle / dev_tool_search" 并提示 `Unlock with dev_tool_search({"toolNames": [...]})`——extraIndex 注入生效。
4. harness_plan_* 可解锁并产生工具事件：turn 3 tool/call `dev_tool_search({"toolNames":["harness_plan_select"]})` 解锁成功，request/header #3 的 `tools` 变为 `[bash, dev_tool_search, harness_plan_select, skill_load, skill_search, str_replace_editor]`，模型随回报该工具描述开头。

## 复现命令

```bash
cd d:/Project/dsh-buddy
node node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 3080
# 浏览器开 http://127.0.0.1:3080，选 AIGlasses 工作区 + Anchored Standard (experimental)
# 依次发送:ping / 搜索 harness_plan 工具 / 解锁 harness_plan_select
```
