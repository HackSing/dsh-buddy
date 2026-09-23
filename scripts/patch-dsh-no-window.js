#!/usr/bin/env node
// 内嵌 dsh 的 Windows 子进程「闪终端」补丁:给 @deepseek-ai/dsh-win32-process 的
// CreateProcess 创建标志补上 CREATE_NO_WINDOW。病灶、原理与退役条件见
// lib/patch-dsh-no-window.js。
//
// 补丁目标是仓库依赖树:dsh-win32-process 由宿主(本仓/打包应用)的 node_modules
// 解析,profile 的 node_modules 永远不含 @deepseek-ai/*。与 patch-multimodal-ui 同一
// 套路:postinstall 打上,electron-builder 打包时随 asar 一起带走。
//
// 用法:
//   node scripts/patch-dsh-no-window.js               打补丁(幂等)
//   node scripts/patch-dsh-no-window.js --check       只报状态不写盘(CI/收尾校验)
//   node scripts/patch-dsh-no-window.js --target <f>  改另一棵依赖树里的同一文件,
//                                                     用于热修已安装的应用
const fs = require('fs');
const path = require('path');
const { patchSource, patchFile } = require('../lib/patch-dsh-no-window');

const REPO_ROOT = path.join(__dirname, '..');
// 补丁目标在包内的固定位置;仓库依赖树与已安装应用的 app.asar.unpacked 下同名同路径。
const TARGET_IN_TREE = path.join('node_modules', '@deepseek-ai', 'dsh-win32-process', 'lib', 'index.js');
const DEFAULT_TARGET = path.join(REPO_ROOT, TARGET_IN_TREE);

// --target 指向另一棵依赖树里的同一个文件——用于就地热修已安装的应用
// (…/resources/app.asar.unpacked/<TARGET_IN_TREE>);runner 每次 spawn 都新起进程读盘,
// 改完重启壳即生效。
function resolveTarget(argv) {
  const at = argv.indexOf('--target');
  if (at < 0) return DEFAULT_TARGET;
  const value = argv[at + 1];
  if (!value) {
    console.error('[patch-dsh-no-window] --target 缺少取值');
    process.exit(1);
  }
  return value;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const target = resolveTarget(process.argv);
  if (!fs.existsSync(target)) {
    console.error(`[patch-dsh-no-window] 目标不存在(依赖未安装?):${target}`);
    process.exit(1);
  }

  // patchSource 逐字匹配上游锚点,形状变了就抛——由人判断是上游已修复(删补丁)
  // 还是产物形状变了(改锚点),而不是静默错过。
  if (checkOnly) {
    const original = fs.readFileSync(target, 'utf8');
    if (patchSource(original) !== original) {
      console.error(`[patch-dsh-no-window] 未打补丁:${target}(运行 node scripts/patch-dsh-no-window.js)`);
      process.exit(1);
    }
    console.log('[patch-dsh-no-window] check: patched');
    return;
  }

  const changed = patchFile(target);
  console.log(`[patch-dsh-no-window] ${changed ? 'applied' : 'already-patched'}: ${target}`);
}

main();
