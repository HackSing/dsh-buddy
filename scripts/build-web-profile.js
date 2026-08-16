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

const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'plugins', 'preinstall-manifest.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'build', 'web-profile.tar.gz');
const ELECTRON_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'electron');
const DSH_BIN = path.join(REPO_ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');

function dshPlugin(dshHome, profile, args) {
  execFileSync(ELECTRON_BIN, [DSH_BIN, 'plugin', '--profile', profile, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: dshHome },
    stdio: 'inherit',
  });
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
    for (const p of manifest.packages) {
      const dir = path.join(profileDir, 'node_modules', ...p.name.split('/'));
      if (!fs.existsSync(dir)) throw new Error(`installed package missing: ${p.name}`);
    }

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.rmSync(OUTPUT_PATH, { force: true });
    // -C profiles 下打包 <profile>/ 顶层目录;bsdtar 保留符号链接,硬链接落地实体
    execFileSync('tar', ['-czf', OUTPUT_PATH, '-C', path.join(home, 'profiles'), manifest.profile], {
      stdio: 'inherit',
    });
    console.log(`[build-web-profile] wrote ${OUTPUT_PATH}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main();
