# Changelog

本项目所有显著变更记录于此；版本号遵循语义化版本，新条目置顶。

## [Unreleased]

### Fixed

- 修复安装/重启后会话列表标题显示为工作区目录名、需逐个点开才刷新的问题：新增随包 host 插件 `dsh-buddy-title-repair`，dsh 启动时对投影缓存缺标题的冷会话做冷读回写（`coldSnapshot`），壳在加载页面前等待标题就绪（10s 上限，超时放行）；Windows 日常退出改为 1s 宽限后强杀，让 dsh 写后日志（200ms 批窗口）完成落盘。

### Added

- llm-pi-ai 多模态模型配置 UI：在 Models 设置页为 pi-ai provider 增加“默认输入模态”和模型级“输入模态”勾选；构建 web profile 时和应用启动时都会自动修补内置 profile，无需手动编辑 `settings.yaml`。

