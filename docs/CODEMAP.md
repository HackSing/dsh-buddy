# CODEMAP：代码能力索引

动手写代码前先查本索引定位可复用模块；新增代码文件或公开接口变化时同步更新条目。
每行一个模块，格式如下（登记时去掉行首的"示例："）：

示例：- `src/example/module.py` — 职责：一句话说明；公开接口：`main_function`、`ExampleClass`

Structure 检查会校验登记路径存在、公开接口符号存活，并提醒未登记的新增代码文件；
测试文件不必登记。

- `lib/plugin-update.js` — 职责:插件热更安装编排,按通道 schema 分流 v1 整包/v2 逐插件切片,负责下载(两段式超时:响应头预算 + body 空闲判定)、sha256 校验与外科替换,失败折叠 failed 不动现有 profile;公开接口:`applyPluginUpdate`、`downloadTarball`、`PLUGIN_UPDATE_OUTCOME`、`DOWNLOAD_NAME`
