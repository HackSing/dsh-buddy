#!/usr/bin/env node
// 构建机预装链路:在临时 DSH_HOME 里初始化干净的 web profile,按
// plugins/preinstall-manifest.json 安装插件,打成 tar.gz 供 electron-builder
// 以 extraResources 随包分发。任何一步失败即非零退出,不产出半成品。
//
// 前置:构建机需有 pnpm(dsh plugin 转发给它)。产物 build/web-profile.tar.gz
// 不入 git(见 .gitignore),每次 npm run dist 由 predist 钩子重建,保证与
// 当前内嵌 dsh 版本耦合一致。
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');

const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'plugins', 'preinstall-manifest.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'build', 'web-profile.tar.gz');
const DSH_PKG_DIR = path.join(REPO_ROOT, 'node_modules', '@deepseek-ai', 'dsh');
const { binEntryFrom } = require('../lib/dsh-entry');
const { applyBrowsePicker } = require('../lib/browse-picker-patch');

// 随包 profile 要在两个发布目标(macOS arm64 / Windows x64)上都能跑,但 pnpm 默认只装
// 构建机那一个平台的 optionalDependencies。lightningcss 是
// @linxin666/dsh-client-ui-skin-center 0.2.x 的运行时依赖且按平台拆包分发,只带构建机
// 那一份会让 skin-center 在其他平台 require 失败、整个插件装载不起来(CI 在 ubuntu 构建
// profile,若不干预则 mac 与 win 用户拿到的都是 linux 二进制)。
// 注意 supportedArchitectures 是"替换"而非"叠加"语义:声明了就只装声明的,所以构建机
// 自身平台也必须列进来。代价是取到 os×cpu 的叉积(4 份,约 35MB),多出的
// darwin-x64/win32-arm64 是 pnpm 无法按平台对精确取值的必然开销。
// 只列发布目标的两个 os:linux 开发机在本地构建的 profile 因此缺 linux 分包,
// skin-center 在其本机跑不起来——本仓不发 linux,该场景不在支持面内。
const SUPPORTED_ARCHITECTURES = { os: ['win32', 'darwin'], cpu: ['x64', 'arm64'] };

// CI artifact 分发:profile 产物由独立 job 构建后经 download-artifact 落到
// build/web-profile.tar.gz,消费方(macos/windows dist job)以 DSH_SKIP_PROFILE=1
// 跳过本步,避免重复构建与平台差异。tar 缺失时直接报错退出,防止 CI 漏拉
// artifact 后静默产出无 profile 的安装包。
if (process.env.DSH_SKIP_PROFILE === '1') {
  if (fs.existsSync(OUTPUT_PATH)) {
    console.log(`[build-web-profile] DSH_SKIP_PROFILE=1, tar exists, skip: ${OUTPUT_PATH}`);
    process.exit(0);
  }
  console.error(`[build-web-profile] DSH_SKIP_PROFILE=1 but ${OUTPUT_PATH} missing (CI download-artifact 漏拉?); refusing to build`);
  process.exit(1);
}

// 本脚本自身就运行在 Node 里,用同一个运行时(process.execPath)拉起 dsh 即可:
// 跨平台一致(Windows 上没有 .bin/electron 这个 POSIX 路径),也少一层间接。
function dshPlugin(dshHome, profile, args) {
  const entry = binEntryFrom(DSH_PKG_DIR);
  if (!entry) throw new Error(`cannot resolve dsh bin entry from ${DSH_PKG_DIR}`);
  execFileSync(process.execPath, [entry, 'plugin', '--profile', profile, ...args], {
    env: { ...process.env, DSH_HOME: dshHome },
    stdio: 'inherit',
  });
}

/** 把跨平台安装声明写进 profile 的 package.json,供随后的 install 拉齐各平台分包。 */
function pinSupportedArchitectures(profileDir) {
  const pkgPath = path.join(profileDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.pnpm = { ...pkg.pnpm, supportedArchitectures: SUPPORTED_ARCHITECTURES };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const specs = manifest.packages.map((p) => `${p.name}@${p.version}`);
  if (specs.length === 0) throw new Error('preinstall-manifest packages is empty');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-buddy-profile-'));
  try {
    // 初始化 + 安装:dsh plugin 子命令对空 HOME 会自动初始化 profile(已实证)
    dshPlugin(home, manifest.profile, ['add', ...specs]);

    const profileDir = path.join(home, 'profiles', manifest.profile);
    // add 已按构建机平台装了一遍;补上跨平台声明后再 install 一次拉齐其余平台分包
    pinSupportedArchitectures(profileDir);
    dshPlugin(home, manifest.profile, ['install']);

    for (const p of manifest.packages) {
      const dir = path.join(profileDir, 'node_modules', ...p.name.split('/'));
      if (!fs.existsSync(dir)) throw new Error(`installed package missing: ${p.name}`);
    }

    // 降级出包:把目录选择钉在 browse 交互上,随包 profile 自带该 patch 层。
    // 只在原生对话框那条路走不通时使用(见 scripts/patch-dsh-picker.js 的失败提示),
    // 因此是显式 env 开关而非默认。
    if (process.env.DSH_PICKER_BROWSE === '1') {
      console.log(`[build-web-profile] browse picker: ${applyBrowsePicker(profileDir)}`);
    }

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.rmSync(OUTPUT_PATH, { force: true });
    // tar 顶层目录名必须等于 profile 名(解包器按 staging/<profileName> rename)。
    // Windows 上 pnpm 用 junction 布局(Node 视为 symlink,linkname 为指向 store
    // 的绝对路径),系统 tar 打包后链接失真、终端解包还需符号链接特权;先
    // dereference 实体化副本再打包,产物无链接条目、跨平台可解。
    // 代价:仅 Windows 本机构建的 tar 体积翻倍,CI(ubuntu)产物不受影响。
    let tarCwd;
    if (process.platform === 'win32') {
      const materialized = path.join(home, 'materialized');
      fs.cpSync(profileDir, path.join(materialized, manifest.profile), {
        recursive: true,
        dereference: true,
      });
      tarCwd = materialized;
    } else {
      tarCwd = path.join(home, 'profiles');
    }
    // 打 tar 用 npm tar 包(项目依赖,与 lib/bundled-profile.js 解包端同款),
    // 不依赖系统 tar:Git Bash 环境的 GNU tar 会把 D:\ 盘符当远程主机
    // ("Cannot connect to D")导致打包失败;bsdtar 只在部分环境可用。
    // follow 默认 false:POSIX 符号链接保留为链接条目,硬链接落地实体。
    tar.c({ file: OUTPUT_PATH, cwd: tarCwd, gzip: true, sync: true }, [manifest.profile]);
    console.log(`[build-web-profile] wrote ${OUTPUT_PATH} (platform=${process.platform})`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main();
