#!/usr/bin/env node
// 内嵌 dsh 的模型设置 UI 补丁:给 llm-pi-ai 补上多模态(图片输入)配置项。
//
// 病灶:上游 @deepseek-ai/dsh-client-ui-settings-models 的编辑器是精简过的,
// 没有暴露 @deepseek-ai/dsh-llm-pi-ai 在 settings.yaml 里已经支持的
// `input` / `defaultInput` 字段;上游补齐之前,用户只能手改 YAML。
//
// 补丁目标为什么是仓库依赖树而不是 profile:模型设置 UI 由 profile 的
// dsh.profile.bundles 里的 @deepseek-ai/dsh-web-app 传递引入,而 bundles 是从
// **宿主(本仓/打包应用)的 node_modules** 解析的,不是 profile 的依赖。profile 的
// dependencies 只有 plugins/preinstall-manifest.json 里的第三方插件,
// dsh-client-ui-settings-models 从来不会出现在 profile 里(rc.6/rc.7 均已实证),
// 打在那边等于打在空处。因此本脚本走 postinstall,与 patch-dsh-picker 同一套路:
// 补丁落在仓库依赖树,electron-builder 打包时随 asar 一起带走。
//
// 上游补齐这两个字段后,本脚本连同 package.json 里的挂载点一起删除。
//
// 用法:
//   node scripts/patch-multimodal-ui.js               打补丁(幂等)
//   node scripts/patch-multimodal-ui.js --check       只报状态不写盘(CI/收尾校验)
//   node scripts/patch-multimodal-ui.js --target <f>  改另一棵依赖树里的同一文件,
//                                                     用于热修已安装的应用
const fs = require('fs');
const path = require('path');
const { patchClient, patchFile } = require('../lib/patch-multimodal-ui');

const REPO_ROOT = path.join(__dirname, '..');
// 补丁目标在包内的固定位置;仓库依赖树与已安装应用的 app.asar.unpacked 下同名同路径。
const TARGET_IN_TREE = path.join(
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-settings-models',
  'lib',
  'client.js'
);
const DEFAULT_TARGET = path.join(REPO_ROOT, TARGET_IN_TREE);

// --target 指向另一棵依赖树里的同一个文件——用于就地热修已安装的应用
// (…\resources\app.asar.unpacked\<TARGET_IN_TREE>);改完重启壳即生效。
function resolveTarget(argv) {
  const at = argv.indexOf('--target');
  if (at < 0) return DEFAULT_TARGET;
  const value = argv[at + 1];
  if (!value) {
    console.error('[patch-multimodal-ui] --target 缺少取值');
    process.exit(1);
  }
  return value;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const target = resolveTarget(process.argv);
  if (!fs.existsSync(target)) {
    console.error(`[patch-multimodal-ui] 目标不存在(依赖未安装?):${target}`);
    process.exit(1);
  }

  // patchClient 逐字匹配上游锚点,形状变了就抛——由人判断是上游已补齐(删补丁)
  // 还是产物形状变了(改锚点),而不是静默错过。
  if (checkOnly) {
    const original = fs.readFileSync(target, 'utf8');
    if (patchClient(original) !== original) {
      console.error(
        `[patch-multimodal-ui] 未打补丁:${target}(运行 node scripts/patch-multimodal-ui.js)`
      );
      process.exit(1);
    }
    console.log('[patch-multimodal-ui] check: patched');
    return;
  }

  const changed = patchFile(target);
  console.log(`[patch-multimodal-ui] ${changed ? 'applied' : 'already-patched'}: ${target}`);
}

main();
