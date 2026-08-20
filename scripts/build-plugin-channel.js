#!/usr/bin/env node
// 插件热更的发布侧入口:预装插件上游发新版后,用本脚本重建「成品 profile tar +
// plugin-channel.json」,上传 GitHub 滚动 release 即完成推送——客户端
// (lib/plugin-channel.js)下一个节流窗口就能检测并热更,不需要发新安装包。
//
// 版本来源默认是 npm registry 上 plugins/preinstall-manifest.json 各包的 latest;
// 也可用 --packages <file> 显式指定版本集合(回滚推送、钉版灰度时用)。
// tar 构建复用 scripts/build-web-profile.js 的同一条链路,产物与随包 tar 同构。
//
// 用法:
//   node scripts/build-plugin-channel.js                       # registry latest,产物到 build/plugin-channel/
//   node scripts/build-plugin-channel.js --packages pins.json  # 显式版本集合
//   node scripts/build-plugin-channel.js --out <dir>           # 改产物目录
//
// 构建完成后按结尾提示用 gh CLI 上传(需要仓库写权限,脚本本身不碰远端)。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildWebProfileTar } = require('./build-web-profile');
const {
  CHANNEL_SCHEMA,
  CHANNEL_TARBALL_URL,
  parseChannel,
  compareRelease,
} = require('../lib/plugin-channel');

const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'plugins', 'preinstall-manifest.json');
const REGISTRY_LATEST_TIMEOUT_MS = 10000;

function parseArgs(argv) {
  const args = { out: path.join(REPO_ROOT, 'build', 'plugin-channel'), packages: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--packages') args.packages = path.resolve(argv[++i]);
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

// 查 registry 上某包的 latest 版本与 peer 声明;scoped 名按 registry 规则编码。
async function registryLatest(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, {
    signal: AbortSignal.timeout(REGISTRY_LATEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`registry latest ${name}: HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body.version !== 'string') {
    throw new Error(`registry latest ${name}: 响应缺少 version`);
  }
  return { version: body.version, peerDependencies: body.peerDependencies || {} };
}

// 待发布的版本集合:默认取 manifest 各包的 registry latest;--packages 覆盖整个集合
// (覆盖路径不查 registry,peer 信息缺失时 minDshVersion 回落到内嵌版本)。
async function resolvePackages(pinsFile) {
  if (pinsFile) {
    const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
    if (!Array.isArray(pins) || pins.length === 0) throw new Error('--packages 文件必须是 {name, version} 数组');
    return pins.map((p) => ({ ...p, peerDependencies: {} }));
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const packages = [];
  for (const p of manifest.packages) {
    const { version, peerDependencies } = await registryLatest(p.name);
    packages.push({ name: p.name, version, peerDependencies });
    console.log(`[build-plugin-channel] latest ${p.name}@${version}`);
  }
  return packages;
}

// minDshVersion 取「插件实际要求的 dsh 版本」与「本仓内嵌版本」的较大者:
// 扫各包 peerDependencies 里 @deepseek-ai/dsh-* 的 rc 版本声明——插件上游换 dsh
// 版本时(peer 从 rc.7 抬到 rc.8),通道门槛必须跟着抬,否则等于向旧客户端
// 担保一个它跑不动的插件集合;客户端内嵌 dsh 不够新时只提示不安装
// (installable=false,见 lib/plugin-channel.js)。
function computeMinDshVersion(packages, embeddedVersion) {
  let required = embeddedVersion;
  for (const p of packages) {
    for (const [dep, range] of Object.entries(p.peerDependencies || {})) {
      if (!dep.startsWith('@deepseek-ai/dsh-')) continue;
      const m = /(\d+\.\d+\.\d+-rc\.\d+)/.exec(String(range));
      if (m && compareRelease(m[1], required) === 1) required = m[1];
    }
  }
  return required;
}

async function main() {
  const args = parseArgs(process.argv);
  const resolved = await resolvePackages(args.packages);
  // minDshVersion 的语义是「这批插件能跑的最低内嵌 dsh」,取插件 peer 声明与
  // 本仓内嵌版本的较大者(换 dsh 版本时须重验 keyed slot 等门槛,
  // 见 preinstall-manifest.json comment)。
  const embeddedDsh = require('../package.json').dependencies['@deepseek-ai/dsh'];
  const minDshVersion = computeMinDshVersion(resolved, embeddedDsh);
  if (minDshVersion !== embeddedDsh) {
    console.log(`[build-plugin-channel] minDshVersion 抬到 ${minDshVersion}(插件 peer 声明,内嵌为 ${embeddedDsh})`);
    console.log('[build-plugin-channel] 客户端 dsh 低于该版本将只提示不安装(installable=false)');
  }
  const packages = resolved.map(({ name, version }) => ({ name, version }));

  const tarballPath = path.join(args.out, path.basename(CHANNEL_TARBALL_URL));
  buildWebProfileTar({ profileName: 'web', packages, outputPath: tarballPath });

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tarballPath)).digest('hex');
  const channel = {
    schema_version: CHANNEL_SCHEMA,
    packages,
    tarball: { url: CHANNEL_TARBALL_URL, sha256 },
    minDshVersion,
  };
  // 发出的 channel 必须能过客户端的边界校验,发错 schema 会被全体客户端判 invalid-channel
  if (!parseChannel(channel)) throw new Error('generated channel failed client-side validation');
  const channelPath = path.join(args.out, 'plugin-channel.json');
  fs.writeFileSync(channelPath, `${JSON.stringify(channel, null, 2)}\n`, 'utf8');

  console.log(`[build-plugin-channel] wrote ${channelPath}`);
  console.log('[build-plugin-channel] 上传(需要 gh CLI 与仓库写权限):');
  console.log('  gh release create plugin-channel --title "Plugin Channel" --notes "滚动插件更新通道" 2>/dev/null || true');
  console.log(`  gh release upload plugin-channel "${channelPath}" "${tarballPath}" --clobber`);
}

main().catch((err) => {
  console.error(`[build-plugin-channel] ${err.message}`);
  process.exit(1);
});
