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

// npm 的 JS 入口。和上面拉起 dsh 同一个套路(process.execPath + 入口文件),
// 不走 npm/npm.cmd:Node 20 起 spawn 一个 .cmd 不带 shell 直接 EINVAL,带
// shell 又要自己处理路径引号。npm_execpath 只在 npm 生命周期里有值(predist
// 走这条),直接 node 跑脚本时回落到与当前 Node 同装的那份 npm。
function npmCliEntry() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) {
    if (c && c.endsWith('.js') && fs.existsSync(c)) return c;
  }
  throw new Error('cannot locate npm-cli.js next to the current Node runtime');
}

// 本仓自研、尚未发布 npm 的插件:先在源码目录 npm pack 成 tarball,再按
// pnpm 的文件 spec 装进 profile。pack 会跑该包的 prepack(构建 client bundle +
// 自检),所以进 tar 的一定是完整产物,不会是只剩 src 的半成品。
// 打到空目录里再读文件名:npm pack 的 stdout 混有 lifecycle 脚本输出,解析
// 它不如直接看落地产物可靠。
function packLocal(entry) {
  const src = path.resolve(REPO_ROOT, entry.source);
  if (!fs.existsSync(path.join(src, 'package.json'))) {
    throw new Error(
      `local plugin source missing: ${entry.name} expected at ${src}. `
      + '需要该仓库与 dsh-buddy 同级检出;插件发布 npm 后请把它移到 manifest.packages 并删除 local 条目。'
    );
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-buddy-pack-'));
  execFileSync(process.execPath, [npmCliEntry(), 'pack', '--pack-destination', out], {
    cwd: src,
    stdio: 'inherit',
  });
  const tarballs = fs.readdirSync(out).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`npm pack produced ${tarballs.length} tarballs for ${entry.name}, expected 1`);
  }
  return path.join(out, tarballs[0]);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const specs = manifest.packages.map((p) => `${p.name}@${p.version}`);
  if (specs.length === 0) throw new Error('preinstall-manifest packages is empty');
  const local = manifest.local || [];
  const localTarballs = local.map((entry) => packLocal(entry));

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-buddy-profile-'));
  try {
    // 初始化 + 安装:dsh plugin 子命令对空 HOME 会自动初始化 profile(已实证)
    dshPlugin(home, manifest.profile, ['add', ...specs, ...localTarballs]);

    const profileDir = path.join(home, 'profiles', manifest.profile);
    for (const p of manifest.packages) {
      const dir = path.join(profileDir, 'node_modules', ...p.name.split('/'));
      if (!fs.existsSync(dir)) throw new Error(`installed package missing: ${p.name}`);
    }
    // 自研插件多查一层 client 产物:它是 npm pack 时才生成的,漏了就是装了个
    // 只有 host 半边的插件,界面一片空白而进程不报错。
    for (const entry of local) {
      const dir = path.join(profileDir, 'node_modules', ...entry.name.split('/'));
      if (!fs.existsSync(dir)) throw new Error(`installed local package missing: ${entry.name}`);
      const clientBundle = path.join(dir, 'lib', 'client.js');
      if (!fs.existsSync(clientBundle)) throw new Error(`local package client bundle missing: ${clientBundle}`);
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
