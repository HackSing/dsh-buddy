> 状态：有效（现行事实）
<!-- docs-harness:knowledge-document/v1 -->

# 插件预装协议门槛(license gate)

- 修订：2
- 关键符号：`license_gate`、`preinstall-manifest`、`copyleft`
- 资产指纹：`sha256:018afcddbafbe9a19856538271dfb8e4285c18f6cc02abc81557e09b3867c460`

## 摘要

每个新插件进入预装清单前必须过协议门:MIT/BSD/Apache/ISC 绿灯,MPL 黄灯,GPL/AGPL/SSPL/BUSL 红灯,结论记入 preinstall-manifest

## 事实

### `gate.rule.tiers`

预装协议三级门:绿灯 MIT/BSD/Apache-2.0/ISC(无传染,可进分发物,义务=保留 LICENSE/NOTICE、改动需注明);黄灯 MPL(文件级 copyleft,须逐案评估且不得修改其文件后闭源);红灯 GPL/AGPL/SSPL/BUSL(进同一分发物可能强制开源组合作品或限制使用场景,一律不进本项目分发物)

证据：`plugins/preinstall-manifest.json`

### `gate.rule.evidence`

过门证据不得只看 README 自述:须核对仓库 LICENSE 文件全文与每个包 package.json 的 license 字段一致性,并检查 install/postinstall 脚本与敏感依赖(隧道、凭据存储、二进制下载);结论与版本 pin 一并记入 preinstall-manifest.json,分发触发义务而自用不触发

证据：`plugins/preinstall-manifest.json`、`docs/knowledge/dsh-web-ui-license-audit.md`
