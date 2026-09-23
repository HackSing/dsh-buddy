# dsh 0.1.5-rc.1 兼容性验证

- 候选版本: `0.1.5-rc.1`
- 当前钉住: `0.1.5-rc.1`
- 结论: **4/4** 项通过
- 环境: win32-x64 / node v24.14.1
- 时间: 2026-09-10T09:09:10.173Z

| 项 | 结果 | 说明 |
| --- | --- | --- |
| ① npm install 与 bin 入口解析 | ✅ | 入口 node_modules\@deepseek-ai\dsh\lib\bin.js |
| ② 随包 preset 单元测试 | ✅ | plugins/dsh-anchored-standard 的 node --test 全绿 |
| ③ 随包 preset 装载后 web 启动 | ✅ | 装入 3 个 preset(preset, zero-anchored-standard, whoami-standard),web 返回 HTTP 200 |
| ④ manifest 预装插件安装后 web 启动 | ✅ | 7 个插件安装到位,web 返回 HTTP 200 |

> 本工作流只报告,不会自动修改 package.json 里钉住的 dsh 版本。
