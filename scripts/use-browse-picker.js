#!/usr/bin/env node
// 目录选择降级开关:把某个 dsh profile 的目录选择钉在 browse 交互上。
//
// 什么时候用:scripts/patch-dsh-picker.js 打不上补丁(上游改了形状),或原生对话框
// 在某台机器上仍不可用时。browse 在网页内选目录,不弹系统对话框,因此绕开
// Electron 运行时禁用 external buffer 引发的 worker 崩溃。
//
// 作用域:
//   node scripts/use-browse-picker.js                     改本机 DSH_HOME 里的 web profile(立刻生效,重启壳即可)
//   node scripts/use-browse-picker.js --profile-dir <dir>  改指定 profile 目录
//   node scripts/use-browse-picker.js --revert             撤销,换回原生对话框
//   node scripts/use-browse-picker.js --status             只报当前状态
//
// 要让降级进入安装包,构建时带上 DSH_PICKER_BROWSE=1(build-web-profile.js 会把
// 同一块写进随包 profile,patch-dsh-picker.js 的 --check 也随之跳过)。
const os = require('os');
const path = require('path');
const { defaultDshHome } = require('../lib/bundled-presets');
const { statusOf, applyBrowsePicker, revertBrowsePicker, patchPath } = require('../lib/browse-picker-patch');
const preinstallManifest = require('../plugins/preinstall-manifest.json');

// 默认目标 = 本机 DSH_HOME 里随包预装的那个 profile(profile 名由预装清单单一来源给出)
function defaultProfileDir() {
  return path.join(defaultDshHome(process.env, os.homedir()), 'profiles', preinstallManifest.profile);
}

function parseArgs(argv) {
  const at = argv.indexOf('--profile-dir');
  return {
    profileDir: at >= 0 ? argv[at + 1] : defaultProfileDir(),
    revert: argv.includes('--revert'),
    statusOnly: argv.includes('--status'),
  };
}

function main() {
  const { profileDir, revert, statusOnly } = parseArgs(process.argv.slice(2));
  if (!profileDir) {
    console.error('[use-browse-picker] --profile-dir 缺少取值');
    process.exit(1);
  }
  if (statusOnly) {
    console.log(`[use-browse-picker] status=${statusOf(profileDir)} file=${patchPath(profileDir)}`);
    return;
  }
  const result = revert ? revertBrowsePicker(profileDir) : applyBrowsePicker(profileDir);
  console.log(`[use-browse-picker] ${result}: ${patchPath(profileDir)}`);
  console.log('[use-browse-picker] 重启 DSH Buddy 后生效(dsh 在启动时解析 patch 层)');
}

main();
