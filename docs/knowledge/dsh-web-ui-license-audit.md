> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# dsh-web-ui 协议尽调与预装子集决策

- 修订：1
- 关键符号：`preinstall-manifest`、`dsh-web-ui-all`、`cloudflared`、`@linxin666`
- 资产指纹：`sha256:79723fbf0ebf1d0b3e92731b20098180d09f571b0c698b5652525ca07f7f1a85`

## 摘要

dsh-web-ui(@linxin666 系列)为 Apache-2.0,与 MIT 主仓兼容;预装限安全 UI 子集,走 dsh plugin(pnpm)链而非 preset 拷贝

## 事实

### `webui.license.apache2`

dsh-web-ui 仓库 LICENSE 为标准 Apache-2.0 且全部 12 个包 license 字段一致;与 dsh-buddy 顶层 MIT 兼容,分发时义务为保留其 LICENSE/NOTICE、README 标注该子树协议、修改需注明;无 copyleft,自带专利授权

证据：`plugins/preinstall-manifest.json`

### `webui.install.pnpm-chain`

dsh-web-ui 各包经 dsh plugin --profile web add 安装(转发 pnpm 到 profile 目录),内嵌 dsh 不带 pnpm,终端用户零依赖环境无法启动时自动安装;发布前预装须在构建机装好 profile 随包分发,清单以 plugins/preinstall-manifest.json 为准

证据：`plugins/preinstall-manifest.json`

### `webui.subset.security`

预装限六包安全 UI 子集(task-board/git-graph/skins/pet/live-stats/web-ui-settings,均 0.1.16);dsh-ssh(明文凭据)与 dsh-remote-web-ui(cloudflared 公网隧道)及聚合包 dsh-web-ui-all 明确排除,理由记录于 manifest 的 excluded 字段;pnpm 10 默认拦截 cloudflared 构建脚本可作为二线防护但不可依赖

证据：`plugins/preinstall-manifest.json`
