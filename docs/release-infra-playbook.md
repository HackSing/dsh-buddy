# 开源项目发布基础设施三件套搭建指南

状态：有效（方法论沉淀，2026-08-16 首版，基于本仓库真实落地经验）。

适用对象：依赖一个快速迭代上游的开源分发型项目（本仓库是 Electron 壳 + 内嵌上游 CLI 的形态，但方法论与技术栈无关）。三件套在本仓库的活实现即最佳参考：[dsh-compat.yml](../.github/workflows/dsh-compat.yml)、[release.yml](../.github/workflows/release.yml)、[update-check.js](../lib/update-check.js)。

## 为什么是这三件，为什么是这个顺序

**发版成本决定迭代速度。** 手工发版（本机构建 + 手动传包 + 手写 Release）每次要付一小时以上的"手工税"，你会不自觉地攒改动、少发版，反馈循环随之变慢。把三件事交给机器后，人只做两个决策：**要不要升上游版本**（看值班报告）、**什么时候发版**（打个 tag）。

三件套构成一个从上游到用户的完整传导链：

```
上游发新版 ──→ ① rc 追新值班(每日 cron)
                  自动验证兼容性,开 issue 报告
                  人看报告,决定升级,提交版本 bump
                          │
你要发版 ────→ ② 发版流水线(tag 即发)
                  git tag v0.2.0 && git push --tags
                  云端双平台并行构建 → 安装包自动挂上 Release
                          │
用户侧 ──────→ ③ 应用内更新提示(Release 即达)
                  老用户下次启动 → 查 releases/latest → 弹提示
```

缺任何一环，链条断在哪里就要人肉补哪里。

## 件一：rc 追新值班（每日 cron）

**解决的问题**：上游处于 rc/preview 阶段、破坏性变更频繁时，"新版本出了吗、我的东西还能用吗"不该靠人记得去查。

**组成**：一个定时 workflow + 一个分层验证脚本。

```yaml
on:
  schedule:
    - cron: '23 2 * * *'   # 挑一个非整点,避开 GitHub cron 高峰排队
  workflow_dispatch:        # 手动触发口,调试必备
permissions:
  contents: read
  issues: write             # 只给最小权限
```

流程：查上游最新版本（npm dist-tag / GitHub Release API）→ 与本仓库钉死的版本比对 → 相同则静默结束；不同则运行验证脚本 → 无论结果好坏都开 issue 报告。

**验证脚本的设计要点**（见 [verify-dsh-compat.js](../scripts/verify-dsh-compat.js)）：

1. **分层验证，逐项独立**：从便宜到贵排列（装包成功 → 单元测试 → 真实启动 → 完整集成），每项独立 try，一项失败继续跑后面的，最后汇总成 `N/M ✅` 报告——一次运行拿到全部信息，而不是修一个错再跑一次才见下一个；
2. **只报告，绝不自动升版本**：版本号钉死在依赖声明里，升级永远由人看着绿灯提交。自动升级 = 把上游的破坏性变更直接送进你的分发物；
3. **issue 按标题去重**：`gh issue list --search '"<版本> 兼容性" in:title'` 先查后建，避免每日 cron 重复轰炸；
4. **外部输入经 env 传递**：上游版本号是外部数据，写 `env: VER: ${{ ... }}` 再在脚本里用 `"$VER"`，不要直接拼进 run 模板——防注入的习惯问题。

## 件二：发版流水线（tag 即发）

**解决的问题**：把"发一个版本"压缩成一条命令。

```yaml
on:
  push:
    tags: ['v*']
permissions:
  contents: write
```

每个平台一个 job 并行构建，最后用 runner 自带的 `gh` 发布（不引第三方 action，供应链面最小）：

```bash
gh release create "$TAG" --title "$TAG" --generate-notes $prerelease || true
gh release upload "$TAG" dist/*.dmg --clobber
```

**四个经过实战校准的设计**：

1. **版本守卫**：构建前校验 tag 与 manifest 版本一致（`case "$tag" in "v$ver"|"v$ver"-*)`），不一致快速失败。否则 tag 是 v0.2.0、产物文件名却是 0.1.0，用户下载后一脸问号；
2. **prerelease 约定**：tag 带 `-` 后缀（如 `v0.1.0-test1`）自动加 `--prerelease`。GitHub 的 `/releases/latest` 天然排除 prerelease——于是测试 tag 不会污染"最新版本"，件三的更新提示也不会把测试版推给用户。**这让你可以用真实 tag 全链实测流水线，测完删掉 Release 和 tag，零污染**；
3. **并发竞态收敛**：多平台 job 同时到达发布步骤时都想创建 Release——`create || true` + `upload --clobber`，谁先创建都行，上传幂等；
4. **实验平台隔离**：未在真机验证过的平台加 `continue-on-error: true`，让它失败也不阻塞已验证平台的发布。等它稳定几轮再转正。

## 件三：应用内更新提示（Release 即达）

**解决的问题**：发了新版，存量用户怎么知道。

**先知道天花板在哪**：macOS 的全自动静默更新（electron-updater/Squirrel.Mac）**硬依赖代码签名**。没签名预算时，正确的低配版是"检查 + 提示下载"——它未签名也能工作，且升级路径平滑（签名后换 electron-updater，Releases 发布流不用动）。

低配版的完整需求清单（见 [update-check.js](../lib/update-check.js)）：

1. 启动后**异步**查 `releases/latest`（拿到的天然是最新正式版，prerelease 已被 API 排除），不进启动链，失败不影响任何功能；
2. **版本比较保守化**：逐段数值比较，解析不了就不提示——宁可漏报不误报；
3. **节流**：本地状态文件记 lastCheckedAt，24 小时最多查一次（GitHub API 未认证限流 60 次/小时/IP，共享出口 IP 的用户经不起每次启动都查）；
4. **同版本只提示一次**：记 lastNotifiedVersion，决定提示时就落盘——用户点了"忽略"不该每次启动都被同一版本纠缠；
5. **一切失败都是可预期状态**：离线、超时、限流、仓库还没发过 Release（404），全部静默折叠成一行日志。更新提示是增强项，增强项没有资格打扰用户;
6. 状态文件用"临时文件 + rename"原子写，读取端永远看不到半截 JSON。

## 踩过的坑（每条都付过学费）

| 坑 | 现象 | 解法 |
|---|---|---|
| 官方 action 版本陈旧 | `checkout@v4`/`setup-node@v4` 报 Node 20 弃用警告 | 升 v5，一行事 |
| Windows tar × pnpm | Windows bsdtar 处理不了 pnpm 的 junction 目录链接，打包炸 exit 2 | 平台无关的产物（如预装资源包）单独用一个 ubuntu job 构建一次，经 artifact 分发给各平台打包任务——顺带保证多平台字节一致 |
| Release 不触发级联 | `GITHUB_TOKEN` 创建的 Release 不会触发其他 workflow | GitHub 防递归的刻意设计；确需级联用 PAT |
| cron 首跑幻觉 | 上游没有新版本时，值班工作流只走"版本相同→跳过"的快路径，绿色≠完整链路验证过 | 用 workflow_dispatch + 已知旧版本号强制跑一次完整验证 |
| tag 漂移 | tag 与 manifest 版本不一致，产物命名错乱 | 版本守卫，构建前快速失败 |

## 成本

公开仓库的 GitHub Actions 免费（含 macOS/Windows runner）。三件套全部用 runner 自带工具（`gh`、`npm`、系统 tar），零第三方 action、零运行时新依赖。

## 落地检查清单

- [ ] 值班：cron + 手动触发口；版本比对短路；分层验证逐项独立；issue 去重；只报告不升版本
- [ ] 发版：tag 触发；版本守卫；prerelease 约定；`create || true` + `upload --clobber`；实验平台 continue-on-error
- [ ] 提示：异步不进启动链；保守比较；节流 + 同版本一次；失败静默；原子写状态
- [ ] 全链实测：prerelease tag 走一遍 → 验证 Release 与资产 → 删除测试产物
- [ ] 权限最小化：每个 workflow 显式声明 permissions
