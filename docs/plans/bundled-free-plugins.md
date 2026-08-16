> 状态：已实施-仅追溯（代码已是真源，2026-08-16 核对）
<!-- docs-harness:plan-document/v1 -->

# dsh-buddy 薄壳 + plugins workspace 与 bundled preset 自动安装

- 冻结合同：`sha256:0074b3b5e731ce8c78b61e22e3b985b312f98bd7022e94777b963edca3d245fe`
- 关键符号：`installBundledPresets`、`dsh-anchored-standard`、`.agent-presets`、`ensureDsh`

## 背景

架构定案:dsh-buddy = 薄 Electron 壳 + plugins/ workspace 承载随包开源插件。第一个随包资产 dsh-anchored-standard 实为 dsh agent preset 合集(anchored-standard/zero-anchored-standard/whoami-standard),安装方式是把目录拷入 $DSH_HOME/.agent-presets/ 而非 dsh plugin(pnpm)链路。关键事实:zero/whoami 两个 preset 的 agent.cordis.yml 与 zero-tool-bootstrap.mjs 通过 ../preset/ 相对路径引用共享模块(grep 证据),而 dsh-agent-presets 以目录名为 preset id 且每次实时扫描;因此安装必须保持源仓库原拓扑(preset/ 目录原名拷贝),上游 README 的改名指引会打断该引用。preset.yml 自带 name 展示名,目录 id 不影响 UI 显示。

## 目标

dsh-buddy 仓库新增 plugins/ npm workspace 并 vendor dsh-anchored-standard(不修改其内容);壳启动时在拉起 dsh 之前把随包 preset 目录幂等安装到 DSH_HOME(.agent-presets),用户开箱即在 dsh UI 的 preset 列表看到三个新 preset。

## 非目标

不做插件分发市场;不修改 vendored 插件的任何文件;不做 preset 升级覆盖策略(目标目录已存在即跳过,尊重用户本地修改);不接入 dsh plugin(pnpm)的 profile 插件链路;

## 成功标准

1) vendored 插件自带测试(node --test)全部通过;2) 指向临时 DSH_HOME 启动内嵌 dsh 后,preset 发现列出 preset/zero-anchored-standard/whoami-standard 三项且均非 broken;3) 安装器幂等:目标已存在时跳过不覆盖,重复启动无副作用;4) 壳的既有启动链路(ensureDsh→createWindow)行为不变。

## 执行范围

package.json(新增 workspaces、build.files 确认包含 plugins);plugins/dsh-anchored-standard/(vendor 拷贝,排除 .git);lib/bundled-presets.js(新模块:preset 目录映射常量+幂等拷贝安装);main.js(whenReady 中 ensureDsh 之前接线一次安装调用);README.md(补充 bundled plugins 说明)。

## 执行内容

批1:package.json 加 workspaces、vendor 插件目录、在 plugins/dsh-anchored-standard 运行 npm test 取证。批2:新建 lib/bundled-presets.js(IO 与路径映射分离,拷贝仅在目标缺失时执行,错误向上传递由 main.js 以非致命对话框呈现),main.js 接线,node --check 静态检查+临时 DSH_HOME 冒烟(安装/跳过两种路径)。批3:用 ELECTRON_RUN_AS_NODE 以临时 DSH_HOME 真实启动内嵌 dsh web,经浏览器/HTTP 验证三个 preset 出现在发现列表且非 broken;失败则回到拓扑假设重新定位。

## 验收方案

acceptance 资产逐条记录:A1 vendored 测试输出与退出码;A2 安装器冒烟(空 HOME 全量安装、二次运行全部跳过、已存在目录内容不被触碰);A3 真实 dsh web 启动后 preset 列表包含三项且非 broken 的证据(UI 或持久化输出);全部通过后 acceptance settle,再 plan settle。

## 是否需要 Acceptance 资产闭环

```json
true
```

## Knowledge 影响

updated

## 约束

vendored 插件文件保持与源仓库逐字节一致(仅排除 .git);防御代码准入:安装器只处理有证据可达的状态(目标存在/缺失/拷贝失败),不加投机 fallback;错误不吞:安装失败必须对用户可见但不阻断应用启动(preset 是增强项,dsh 本体不依赖它)。

## 风险与回滚

风险1:插件开发验证于 dsh 0.1.0-rc.5,本仓库内嵌 rc.6;README 已注明默认组装不依赖 bootstrapMaxTokens,批3 的真实启动即为兼容性验证。风险2:目录 id 为 preset(非 anchored-standard)可能在会话 header 等处留下不直观的 id,属外观问题,UI 展示名不受影响。回滚:删除 main.js 的一处接线调用、删除 lib/bundled-presets.js 与 plugins/ 目录、还原 package.json,即回到纯壳状态;已安装到用户 DSH_HOME 的 preset 目录不主动删除(用户资产)。

<!-- docs-harness:plan-governance:start -->
## 资产治理

- 关联验收：`docs/acceptance/bundled-free-plugins.json`
- 需要 Acceptance：true
- Knowledge 影响：updated
<!-- docs-harness:plan-governance:end -->
