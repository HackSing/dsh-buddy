#!/usr/bin/env node
// 解包器冒烟：installBundledProfile（lib/bundled-profile.js）两遍纯 Node 解包行为断言。
// fixture 用手写 ustar 条目构造（不依赖本机创建符号链接的权限），gzip 后喂给解包器。
// 覆盖：实体文件/目录、相对 symlink（含多层链接链）、hardlink、绝对链接拒绝、
// 越界链接拒绝、条目路径穿越（tar 库 sanitize）、未知条目类型、返回契约、staging 清理、
// 已存在 profile 的四态升级判定（up-to-date/upgraded/preserved/升级失败回滚）。
// 平台自适应：win32 上 POSIX 分支（fs.symlinkSync）无符号链接特权恒 EPERM（实证），
// 该分支断言仅在 POSIX 平台执行；CI（ubuntu）复跑可补全两分支覆盖。
// 用法：node scripts/verify-bundled-profile.js <repo-root>
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const REPO = path.resolve(process.argv[2]);
const { installBundledProfile, profileUpgradeDecision } = require(path.join(REPO, 'lib', 'bundled-profile'));

// 与 fixture 配套的预装清单：只用于已存在 profile 的升级判定
const MANIFEST = [
  { name: '@linxin666/dsh-skins', version: '0.2.2' },
  { name: '@aiwaretop/dsh-docs-harness', version: '0.1.3' },
];

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`ok   ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    console.log(`FAIL ${name}`);
    failures += 1;
  }
}

// ---- ustar 条目构造 ----
function ustar({ name, type, size = 0, linkname = '', mode = '0000644' }) {
  const buf = Buffer.alloc(512);
  Buffer.from(name, 'utf8').copy(buf, 0, 0, 100);
  buf.write(mode.padStart(7, '0') + '\0', 100, 8, 'ascii');
  buf.write('0000000\0', 108, 8, 'ascii'); // uid
  buf.write('0000000\0', 116, 8, 'ascii'); // gid
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  buf.write('00000000000\0', 136, 12, 'ascii'); // mtime
  buf.fill(0x20, 148, 156); // chksum 占位
  buf.write(type, 156, 1, 'ascii');
  Buffer.from(linkname, 'utf8').copy(buf, 157, 0, 100);
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return buf;
}

function tarGz(entries) {
  const chunks = [];
  for (const e of entries) {
    const content = e.content ? Buffer.from(e.content, 'utf8') : null;
    const size = content ? content.length : e.size || 0;
    chunks.push(ustar({ ...e, size }));
    if (content) {
      chunks.push(content, Buffer.alloc((512 - (content.length % 512)) % 512));
    }
  }
  chunks.push(Buffer.alloc(1024)); // 结尾两零块
  return zlib.gzipSync(Buffer.concat(chunks));
}

// ---- 场景 fixture ----
// 正常布局：实体 + symlink（含多层链 a→b→dep）+ hardlink + 未知类型 + 条目穿越
const GOOD_ENTRIES = [
  { name: 'web/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/dep/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/dep/index.js', type: '0', content: 'dep-file' },
  { name: 'web/node_modules/pkg/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/pkg/index.js', type: '0', content: 'pkg-file' },
  { name: 'web/node_modules/pkg/lib/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/pkg/lib/link.js', type: '0', content: 'link-file' },
  { name: 'web/node_modules/pkg/lib/alias.js', type: '1', linkname: 'web/node_modules/pkg/lib/link.js' },
  { name: 'web/node_modules/pkg/node_modules/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/pkg/node_modules/dep', type: '2', linkname: '../../dep' },
  { name: 'web/node_modules/pkg/node_modules/b', type: '2', linkname: '../../dep' },
  { name: 'web/node_modules/pkg/node_modules/a', type: '2', linkname: './b' },
  { name: 'web/node_modules/pkg/device', type: '3', size: 0 },
  { name: '../evil.txt', type: '0', content: 'evil' },
];

// 拒绝场景：绝对链接（Windows 盘符 / POSIX 绝对 / 越界相对）
const REJECT_ENTRIES = [
  { name: 'web/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/dep/', type: '5', mode: '0000755' },
  { name: 'web/node_modules/dep/index.js', type: '0', content: 'dep-file' },
  { name: 'web/abs-win', type: '2', linkname: 'C:\\Windows\\system32' },
  { name: 'web/abs-posix', type: '2', linkname: '/etc/passwd' },
  { name: 'web/escape', type: '2', linkname: '../../../outside' },
];

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-smoke-'));
const goodTar = path.join(base, 'good.tar.gz');
const rejectTar = path.join(base, 'reject.tar.gz');
fs.writeFileSync(goodTar, tarGz(GOOD_ENTRIES));
fs.writeFileSync(rejectTar, tarGz(REJECT_ENTRIES));

function freshHome(tag) {
  const home = path.join(base, `home-${tag}`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  return home;
}

// 解包器已改 tar promise 模式（异步），场景统一在 async IIFE 中执行；
// 断言与场景结构不变，仅调用处加 await。
(async () => {

// ---- 场景1：win32 正常安装（实体化 + 契约） ----
{
  const home = freshHome('win');
  const r = await installBundledProfile({ tarballPath: goodTar, dshHome: home, profileName: 'web', manifestPackages: MANIFEST });
  check('win32 installed 返回契约', r.status === 'installed', `got ${JSON.stringify(r)}`);
  const pkgIndex = path.join(home, 'profiles', 'web', 'node_modules', 'pkg', 'index.js');
  check('win32 实体文件内容', fs.readFileSync(pkgIndex, 'utf8') === 'pkg-file');
  const depDir = path.join(home, 'profiles', 'web', 'node_modules', 'pkg', 'node_modules', 'dep');
  const st = fs.lstatSync(depDir);
  check('win32 symlink 实体化为目录', st.isDirectory() && !st.isSymbolicLink());
  check(
    'win32 实体化内容正确',
    fs.readFileSync(path.join(depDir, 'index.js'), 'utf8') === 'dep-file'
  );
  const chain = path.join(home, 'profiles', 'web', 'node_modules', 'pkg', 'node_modules', 'a');
  check(
    'win32 多层链接链实体化',
    fs.readFileSync(path.join(chain, 'index.js'), 'utf8') === 'dep-file'
  );
  const alias = path.join(home, 'profiles', 'web', 'node_modules', 'pkg', 'lib', 'alias.js');
  const linkFile = path.join(home, 'profiles', 'web', 'node_modules', 'pkg', 'lib', 'link.js');
  check('win32 hardlink 内容一致', fs.readFileSync(alias, 'utf8') === fs.readFileSync(linkFile, 'utf8'));
  check('win32 条目路径穿越未越界', !fs.existsSync(path.join(base, 'evil.txt')));
  check('win32 无 staging 残留', !fs.existsSync(path.join(home, 'profiles', '.web.installing')));
  // 已存在但无 package.json(无法判定) → preserved,不覆盖
  const r2 = await installBundledProfile({ tarballPath: goodTar, dshHome: home, profileName: 'web', manifestPackages: MANIFEST });
  check('win32 无 package.json 重复安装 preserved', r2.status === 'preserved' && r2.extras.length === 0, `got ${JSON.stringify(r2)}`);
}

// ---- 场景5：升级判定四分支（隔离 DSH_HOME） ----
function writeProfileDeps(home, deps) {
  const dir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'web', dependencies: deps }));
  fs.writeFileSync(path.join(dir, 'marker.txt'), 'old-profile');
}
const CURRENT_DEPS = { '@linxin666/dsh-skins': '0.2.2', '@aiwaretop/dsh-docs-harness': '0.1.3' };

// 判定函数纯函数单测
{
  const d1 = profileUpgradeDecision(CURRENT_DEPS, MANIFEST);
  check('decision 版本一致 up-to-date', d1.status === 'up-to-date', `got ${JSON.stringify(d1)}`);
  const d2 = profileUpgradeDecision({ '@linxin666/dsh-skins': '0.1.16', '@aiwaretop/dsh-docs-harness': '0.1.1' }, MANIFEST);
  check('decision 版本落后 upgrade', d2.status === 'upgrade', `got ${JSON.stringify(d2)}`);
  const d3 = profileUpgradeDecision({ ...CURRENT_DEPS, 'dsh-my-own': '1.0.0' }, MANIFEST);
  check('decision 清单外依赖 preserved 并报名', d3.status === 'preserved' && d3.extras.join(',') === 'dsh-my-own', `got ${JSON.stringify(d3)}`);
  const d4 = profileUpgradeDecision(null, MANIFEST);
  check('decision 不可读 preserved', d4.status === 'preserved' && d4.extras.length === 0, `got ${JSON.stringify(d4)}`);
  const d5 = profileUpgradeDecision({ '@linxin666/dsh-skins': '0.2.2' }, MANIFEST);
  check('decision 缺包 upgrade', d5.status === 'upgrade', `got ${JSON.stringify(d5)}`);
}

// 5a：版本一致 → up-to-date,不动磁盘
{
  const home = freshHome('uptodate');
  writeProfileDeps(home, CURRENT_DEPS);
  const pkgFile = path.join(home, 'profiles', 'web', 'package.json');
  const before = fs.statSync(pkgFile).mtimeMs;
  const r = await installBundledProfile({ tarballPath: goodTar, dshHome: home, profileName: 'web', manifestPackages: MANIFEST });
  check('up-to-date 返回契约', r.status === 'up-to-date', `got ${JSON.stringify(r)}`);
  check('up-to-date 不动磁盘', fs.statSync(pkgFile).mtimeMs === before);
  check('up-to-date 无备份目录', fs.readdirSync(path.join(home, 'profiles')).length === 1);
}

// 5b：版本落后无额外包 → upgraded,备份存在、新版落位
{
  const home = freshHome('upgrade');
  writeProfileDeps(home, { '@linxin666/dsh-skins': '0.1.16', '@aiwaretop/dsh-docs-harness': '0.1.1' });
  const r = await installBundledProfile({ tarballPath: goodTar, dshHome: home, profileName: 'web', manifestPackages: MANIFEST });
  check('upgraded 返回契约', r.status === 'upgraded' && r.backup === 'web.backup-0.1.16', `got ${JSON.stringify(r)}`);
  const backupPkg = path.join(home, 'profiles', 'web.backup-0.1.16', 'package.json');
  check('upgraded 旧 profile 已备份', fs.existsSync(backupPkg) && JSON.parse(fs.readFileSync(backupPkg, 'utf8')).dependencies['@linxin666/dsh-skins'] === '0.1.16');
  const newPkgIndex = path.join(home, 'profiles', 'web', 'node_modules', 'pkg', 'index.js');
  check('upgraded 新版落位', fs.readFileSync(newPkgIndex, 'utf8') === 'pkg-file');
  check('upgraded 无 staging 残留', !fs.existsSync(path.join(home, 'profiles', '.web.installing')));
}

// 5c：含清单外依赖 → preserved,原 profile 逐字节不变
{
  const home = freshHome('preserved');
  writeProfileDeps(home, { ...CURRENT_DEPS, 'dsh-my-own': '1.0.0' });
  const pkgFile = path.join(home, 'profiles', 'web', 'package.json');
  const before = fs.readFileSync(pkgFile, 'utf8');
  const r = await installBundledProfile({ tarballPath: goodTar, dshHome: home, profileName: 'web', manifestPackages: MANIFEST });
  check('preserved 返回契约含包名', r.status === 'preserved' && r.extras.join(',') === 'dsh-my-own', `got ${JSON.stringify(r)}`);
  check('preserved 原 profile 不变', fs.readFileSync(pkgFile, 'utf8') === before && fs.readFileSync(path.join(home, 'profiles', 'web', 'marker.txt'), 'utf8') === 'old-profile');
  check('preserved 无备份无 staging', fs.readdirSync(path.join(home, 'profiles')).length === 1);
}

// 5d：升级时解包失败 → 旧 profile 不变,不留半成品
{
  const home = freshHome('upgrade-fail');
  writeProfileDeps(home, { '@linxin666/dsh-skins': '0.1.16', '@aiwaretop/dsh-docs-harness': '0.1.1' });
  let thrown = null;
  try {
    await installBundledProfile({ tarballPath: rejectTar, dshHome: home, profileName: 'web', manifestPackages: MANIFEST });
  } catch (err) {
    thrown = err;
  }
  check('升级解包失败抛错', thrown instanceof Error && /escapes staging root/.test(thrown.message), thrown && thrown.message);
  check('升级失败旧 profile 不变', fs.readFileSync(path.join(home, 'profiles', 'web', 'marker.txt'), 'utf8') === 'old-profile');
  const entries = fs.readdirSync(path.join(home, 'profiles'));
  check('升级失败不留 staging/备份/半成品', entries.length === 1 && entries[0] === 'web', entries.join(','));
}

// ---- 场景2：拒绝绝对/越界链接（win32） ----
{
  const home = freshHome('reject');
  let thrown = null;
  try {
    await installBundledProfile({ tarballPath: rejectTar, dshHome: home, profileName: 'web' });
  } catch (err) {
    thrown = err;
  }
  check('win32 绝对/越界链接拒绝', thrown instanceof Error && /escapes staging root/.test(thrown.message), thrown && thrown.message);
  check('win32 拒绝后 staging 清理', !fs.existsSync(path.join(home, 'profiles', '.web.installing')));
}

// ---- 场景3：no-tarball 契约 ----
{
  const home = freshHome('notar');
  const r = await installBundledProfile({ tarballPath: path.join(base, 'missing.tar.gz'), dshHome: home, profileName: 'web' });
  check('no-tarball 静默返回', r.status === 'no-tarball', `got ${JSON.stringify(r)}`);
}

// ---- 场景4：POSIX 分支（symlink 保持链接语义，仅 POSIX 平台执行） ----
{
  const home = freshHome('posix');
  if (process.platform === 'win32') {
    // Windows 无 SeCreateSymbolicLinkPrivilege，fs.symlinkSync 恒 EPERM（实证），
    // 无法在本机构造 symlink 断言；win32 实体化行为已由场景1覆盖。
    console.log('skip posix symlink 断言（Windows 无符号链接特权，fs.symlinkSync EPERM 实证）');
  } else {
    const r = await installBundledProfile({ tarballPath: goodTar, dshHome: home, profileName: 'web', manifestPackages: MANIFEST });
    check('posix installed 返回契约', r.status === 'installed', `got ${JSON.stringify(r)}`);
    const depDir = path.join(home, 'profiles', 'web', 'node_modules', 'pkg', 'node_modules', 'dep');
    const st = fs.lstatSync(depDir);
    check('posix symlink 保持链接', st.isSymbolicLink(), `isLink=${st.isSymbolicLink()}`);
    check('posix symlink 内容可解析', fs.readFileSync(path.join(depDir, 'index.js'), 'utf8') === 'dep-file');
  }
}

fs.rmSync(base, { recursive: true, force: true });
console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

})().catch((err) => {
  console.log(`SMOKE FAIL (uncaught: ${err.message})`);
  process.exit(1);
});
