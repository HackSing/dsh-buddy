#!/usr/bin/env node
// 插件热更的发布侧入口(schema v2):预装插件上游发新版后,用本脚本重建
// 「每插件一个闭包切片 tar + 簿记 tar + plugin-channel.json(v2)」,上传 GitHub
// 滚动 release 即完成推送——客户端(lib/plugin-channel.js)下一个节流窗口就能
// 检测并只下载发生变化的插件,不再拖 129MB 整包。
//
// 全量构建链路不变:仍由 buildWebProfileTar 在临时 DSH_HOME 里安装出成品
// profile(唯一构建链路);构建完成后不直接发整包,而是把 tar 解回实体化
// 布局,用 lib/profile-closure.js 按 lockfile 闭包逐插件切片。
//
// 版本来源默认是 npm registry 上 plugins/preinstall-manifest.json 各包的 latest;
// 也可用 --packages <file> 显式指定版本集合(回滚推送、钉版灰度时用)。
//
// 用法:
//   node scripts/build-plugin-channel.js                       # registry latest,产物到 build/plugin-channel/
//   node scripts/build-plugin-channel.js --packages pins.json  # 显式版本集合
//   node scripts/build-plugin-channel.js --out <dir>           # 改产物目录
//
// 构建完成后按结尾提示用 gh CLI 上传(需要仓库写权限,脚本本身不碰远端)。
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');
const { buildWebProfileTar } = require('./build-web-profile');
const {
  CHANNEL_RELEASE_BASE,
  CHANNEL_SCHEMA_V2,
  parseChannelV2,
  compareRelease,
} = require('../lib/plugin-channel');
const {
  computeClosure,
  readLockfile,
  indexPackages,
  resolveKeysToDirs,
  BOOKKEEPING_FILES,
} = require('../lib/profile-closure');

const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'plugins', 'preinstall-manifest.json');
const REGISTRY_LATEST_TIMEOUT_MS = 10000;
const PROFILE_NAME = 'web';
const BOOKKEEPING_TARBALL_NAME = 'profile-bookkeeping.tar.gz';

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
// 版本时(peer 从 rc.8 抬到 0.1.1-rc.1),通道门槛必须跟着抬,否则等于向旧客户端
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

// ---- 切片(schema v2 产物)----

// 插件名 → 资产 slug:'@linxin666/dsh-client-ui-git-graph' →
// 'linxin666__dsh-client-ui-git-graph'。资产名恒定(不带版本号),滚动 release
// --clobber 覆盖,客户端 URL 永不变。
function slugForPackage(name) {
  return name.replace(/^@/, '').replace('/', '__');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// 把 profile 内的相对路径集合打成 tar.gz(条目即相对路径,POSIX 分隔符,
// 客户端解包直接覆盖进 profile 根)。返回 { fileName, sha256, size }。
function packTar(cwd, entries, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(outFile, { force: true });
  tar.c({ file: outFile, cwd, gzip: true, sync: true }, entries);
  return { fileName: path.basename(outFile), sha256: sha256File(outFile), size: fs.statSync(outFile).size };
}

// 逐插件切闭包 tar + 一个簿记 tar。profileDir 必须是实体化布局(平铺真实目录)。
// 闭包/索引只用 lib/profile-closure.js;闭包里磁盘缺失的键(平台 optional 分包
// 未发货,如 lightningcss 的非发布平台二进制)跳过并打日志,其余照常切片。
// 返回 { packages: [{name, version, tarball}], bookkeeping }。
function sliceProfile({ profileDir, packages, outDir }) {
  const lock = readLockfile(profileDir);
  const index = indexPackages(profileDir);
  const sliced = [];
  for (const p of packages) {
    const { dirs, missing } = resolveKeysToDirs(computeClosure(lock, p.name), index);
    for (const key of missing) {
      console.log(`[build-plugin-channel] slice ${p.name}: 磁盘缺失键跳过 ${key}`);
    }
    if (dirs.length === 0) throw new Error(`slice ${p.name}: 闭包在磁盘上为空,不出半成品`);
    const outFile = path.join(outDir, `plugin-${slugForPackage(p.name)}.tar.gz`);
    sliced.push({ name: p.name, version: p.version, tarball: packTar(profileDir, dirs, outFile) });
    console.log(`[build-plugin-channel] slice ${p.name}: ${dirs.length} 目录 -> ${path.basename(outFile)}`);
  }
  for (const f of BOOKKEEPING_FILES) {
    if (!fs.existsSync(path.join(profileDir, f))) throw new Error(`簿记文件缺失: ${f}`);
  }
  const bookkeeping = packTar(profileDir, BOOKKEEPING_FILES, path.join(outDir, BOOKKEEPING_TARBALL_NAME));
  return { packages: sliced, bookkeeping };
}

// 从整包 tar 得到实体化 profile 树:ubuntu CI 构建的 tar 保留 pnpm 符号链接,
// 必须 dereference 成实体化平铺布局再切(与客户端 Windows 安装产物同构);
// Windows 本机构建的 tar 已经是实体化(buildWebProfileTar 的 win32 分支),免拷。
function materializeProfile(tarballPath, workDir) {
  const extractDir = path.join(workDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  tar.x({ file: tarballPath, cwd: extractDir, sync: true });
  if (process.platform === 'win32') return path.join(extractDir, PROFILE_NAME);
  const materialized = path.join(workDir, 'materialized');
  fs.cpSync(path.join(extractDir, PROFILE_NAME), path.join(materialized, PROFILE_NAME), {
    recursive: true,
    dereference: true,
  });
  return path.join(materialized, PROFILE_NAME);
}

// 组装 v2 channel 并用客户端同款校验器自验——发错 schema 会被全体客户端判
// invalid-channel,发出前拦下。
function buildChannelV2({ sliced, minDshVersion }) {
  const ref = (t) => ({ url: `${CHANNEL_RELEASE_BASE}/${t.fileName}`, sha256: t.sha256, size: t.size });
  const channel = {
    schema_version: CHANNEL_SCHEMA_V2,
    packages: sliced.packages.map((p) => ({ name: p.name, version: p.version, tarball: ref(p.tarball) })),
    bookkeeping: ref(sliced.bookkeeping),
    minDshVersion,
  };
  if (!parseChannelV2(channel)) throw new Error('generated channel failed client-side validation');
  return channel;
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

  // 整包 tar 只是切片原料,不再是发布产物:落在临时目录,切完即弃。
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-buddy-channel-'));
  try {
    const tarballPath = path.join(workDir, 'web-profile-plugins.tar.gz');
    buildWebProfileTar({ profileName: PROFILE_NAME, packages, outputPath: tarballPath });
    const profileDir = materializeProfile(tarballPath, workDir);
    const sliced = sliceProfile({ profileDir, packages, outDir: args.out });
    const channel = buildChannelV2({ sliced, minDshVersion });

    const channelPath = path.join(args.out, 'plugin-channel.json');
    fs.writeFileSync(channelPath, `${JSON.stringify(channel, null, 2)}\n`, 'utf8');

    console.log(`[build-plugin-channel] wrote ${channelPath}`);
    console.log('[build-plugin-channel] 上传(需要 gh CLI 与仓库写权限):');
    console.log('  gh release create plugin-channel --title "Plugin Channel" --notes "滚动插件更新通道" --prerelease 2>/dev/null || true');
    console.log(`  gh release upload plugin-channel "${channelPath}" "${args.out}/${BOOKKEEPING_TARBALL_NAME}" "${args.out}"/plugin-*.tar.gz --clobber`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[build-plugin-channel] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { slugForPackage, sliceProfile, materializeProfile, buildChannelV2, BOOKKEEPING_TARBALL_NAME };
