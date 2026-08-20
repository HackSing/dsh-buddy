import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tar = require('tar');
const {
  slugForPackage,
  sliceProfile,
  buildChannelV2,
  BOOKKEEPING_TARBALL_NAME,
} = require('../scripts/build-plugin-channel.js');
const { BOOKKEEPING_FILES } = require('../lib/profile-closure.js');

// ---- 假 profile fixture(实体化平铺布局,小型,不依赖真构建)----
// plugin-one 依赖 shared;plugin-two 自带嵌套 dep-x@2.0.0(与顶层 dep-x@1.0.0 冲突);
// platform-opt 是声明了但磁盘未发货的平台 optional 依赖(切片须容忍)。
const LOCK_TEXT = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@a/plugin-one': { specifier: 1.0.0, version: 1.0.0 }
      '@a/plugin-two': { specifier: 2.0.0, version: 2.0.0 }
packages:
  '@a/plugin-one@1.0.0': { resolution: {integrity: sha512-a} }
  '@a/plugin-two@2.0.0': { resolution: {integrity: sha512-b} }
  dep-x@2.0.0: { resolution: {integrity: sha512-x2} }
  platform-opt@9.0.0:
    resolution: {integrity: sha512-p}
    os: [linux]
  shared@1.0.0: { resolution: {integrity: sha512-s} }
snapshots:
  '@a/plugin-one@1.0.0':
    dependencies:
      shared: 1.0.0
  '@a/plugin-two@2.0.0':
    dependencies:
      dep-x: 2.0.0
    optionalDependencies:
      platform-opt: 9.0.0
  dep-x@2.0.0: {}
  platform-opt@9.0.0: {}
  shared@1.0.0: {}
`;

const PACKAGES = [
  { name: '@a/plugin-one', version: '1.0.0' },
  { name: '@a/plugin-two', version: '2.0.0' },
];

function makeProfile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-slice-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profileDir = path.join(root, 'web');
  const writePkg = (rel, name, version, extra = '') => {
    const dir = path.join(profileDir, ...rel.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
    fs.writeFileSync(path.join(dir, 'index.js'), `// ${name}@${version}${extra}`);
  };
  writePkg('node_modules/@a/plugin-one', '@a/plugin-one', '1.0.0');
  writePkg('node_modules/@a/plugin-two', '@a/plugin-two', '2.0.0');
  writePkg('node_modules/@a/plugin-two/node_modules/dep-x', 'dep-x', '2.0.0');
  writePkg('node_modules/shared', 'shared', '1.0.0');
  fs.writeFileSync(path.join(profileDir, 'pnpm-lock.yaml'), LOCK_TEXT);
  for (const f of BOOKKEEPING_FILES) {
    if (f === 'pnpm-lock.yaml') continue;
    const abs = path.join(profileDir, ...f.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `# ${f}`);
  }
  return { root, profileDir };
}

// 列出 tar 条目名(目录条目带尾斜杠,node-tar 行为)。
function listTar(tarPath) {
  const entries = [];
  tar.t({ file: tarPath, sync: true, onentry: (e) => entries.push(e.path.replace(/\\/g, '/')) });
  return entries;
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('slugForPackage:scope 与斜杠转稳定 slug,资产名不带版本号', () => {
  assert.equal(slugForPackage('@linxin666/dsh-client-ui-git-graph'), 'linxin666__dsh-client-ui-git-graph');
  assert.equal(slugForPackage('dsh-better-sidebar'), 'dsh-better-sidebar');
  assert.equal(slugForPackage('@a/x__y'), 'a__x__y'); // 已与包名一一对应,冲突形态不掩饰
});

test('sliceProfile 逐插件切闭包 tar,条目为相对 profile 根的路径', (t) => {
  const { root, profileDir } = makeProfile(t);
  const outDir = path.join(root, 'out');
  const sliced = sliceProfile({ profileDir, packages: PACKAGES, outDir });

  assert.equal(sliced.packages.length, 2);
  const one = sliced.packages.find((p) => p.name === '@a/plugin-one');
  const two = sliced.packages.find((p) => p.name === '@a/plugin-two');
  assert.equal(one.tarball.fileName, 'plugin-a__plugin-one.tar.gz');
  assert.equal(two.tarball.fileName, 'plugin-a__plugin-two.tar.gz');

  // 闭包内容:plugin-one = 自身 + 顶层 shared;不含 plugin-two 任何东西
  const oneEntries = listTar(path.join(outDir, one.tarball.fileName));
  assert.ok(oneEntries.includes('node_modules/@a/plugin-one/package.json'));
  assert.ok(oneEntries.includes('node_modules/shared/package.json'));
  assert.ok(!oneEntries.some((e) => e.includes('plugin-two')));

  // plugin-two = 自身 + 嵌套 dep-x@2.0.0(闭包里的冲突版本跟着嵌套路径走);
  // platform-opt 磁盘未发货,静默跳过不报错
  const twoEntries = listTar(path.join(outDir, two.tarball.fileName));
  assert.ok(twoEntries.includes('node_modules/@a/plugin-two/package.json'));
  assert.ok(twoEntries.includes('node_modules/@a/plugin-two/node_modules/dep-x/package.json'));
  assert.ok(!twoEntries.some((e) => e.includes('platform-opt')));

  // sha256/size 与实际文件一致
  for (const p of sliced.packages) {
    const abs = path.join(outDir, p.tarball.fileName);
    assert.equal(p.tarball.sha256, sha256File(abs));
    assert.equal(p.tarball.size, fs.statSync(abs).size);
  }

  // 簿记 tar 恰好含全部簿记文件
  const bkEntries = listTar(path.join(outDir, BOOKKEEPING_TARBALL_NAME));
  assert.deepEqual(
    bkEntries.filter((e) => !e.endsWith('/')).sort(),
    [...BOOKKEEPING_FILES].sort()
  );
  assert.equal(sliced.bookkeeping.sha256, sha256File(path.join(outDir, BOOKKEEPING_TARBALL_NAME)));
});

test('sliceProfile 对闭包整体缺失的插件报错,不出半成品', (t) => {
  const { root, profileDir } = makeProfile(t);
  assert.throws(
    () => sliceProfile({ profileDir, packages: [{ name: '@a/ghost', version: '1.0.0' }], outDir: path.join(root, 'out') }),
    /importers 里找不到/
  );
});

test('buildChannelV2 组装 v2 JSON 并过客户端同款校验', (t) => {
  const { root, profileDir } = makeProfile(t);
  const outDir = path.join(root, 'out');
  const sliced = sliceProfile({ profileDir, packages: PACKAGES, outDir });
  const channel = buildChannelV2({ sliced, minDshVersion: '0.1.0-rc.8' });

  assert.equal(channel.schema_version, 'dsh-buddy/plugin-channel/v2');
  assert.equal(channel.packages.length, 2);
  assert.equal(channel.minDshVersion, '0.1.0-rc.8');
  for (const p of channel.packages) {
    assert.match(p.tarball.url, /^https:\/\/github\.com\/HackSing\/dsh-buddy\/releases\/download\/plugin-channel\/plugin-.+\.tar\.gz$/);
    assert.ok(p.tarball.url.endsWith(`plugin-${slugForPackage(p.name)}.tar.gz`)); // URL 末段即恒定资产名
    assert.match(p.tarball.sha256, /^[0-9a-f]{64}$/);
    assert.ok(p.tarball.size > 0);
  }
  assert.ok(channel.bookkeeping.url.endsWith(BOOKKEEPING_TARBALL_NAME));
});
