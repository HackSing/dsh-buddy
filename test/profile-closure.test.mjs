import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const {
  computeClosure,
  referencedKeys,
  planKeySets,
  resolveKeysToDirs,
  parseLockfile,
  readLockfile,
  indexPackages,
} = require('../lib/profile-closure.js');

// ---- 手写最小 lockfile fixture ----
// 覆盖:传递闭包、共享依赖(shared 被两个插件共用)、peer 后缀含 '@' 的键
// ('@a/plugin-b@2.0.0(zod@4.0.0)')、版本冲突(dep-x 1.0.0/2.0.0 共存)。
const LOCK_TEXT = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@a/plugin-a':
        specifier: 1.0.0
        version: 1.0.0
      '@a/plugin-b':
        specifier: 2.0.0
        version: 2.0.0(zod@4.0.0)
packages:
  '@a/plugin-a@1.0.0':
    resolution: {integrity: sha512-a}
  '@a/plugin-b@2.0.0':
    resolution: {integrity: sha512-b}
    peerDependencies:
      zod: ^4.0.0
  dep-x@1.0.0:
    resolution: {integrity: sha512-x1}
  dep-x@2.0.0:
    resolution: {integrity: sha512-x2}
  leaf@3.0.0:
    resolution: {integrity: sha512-l}
  shared@1.0.0:
    resolution: {integrity: sha512-s}
  zod@4.0.0:
    resolution: {integrity: sha512-z}
snapshots:
  '@a/plugin-a@1.0.0':
    dependencies:
      dep-x: 1.0.0
      shared: 1.0.0
  '@a/plugin-b@2.0.0(zod@4.0.0)':
    dependencies:
      dep-x: 2.0.0
      shared: 1.0.0
      zod: 4.0.0
  dep-x@1.0.0:
    dependencies:
      leaf: 3.0.0
  dep-x@2.0.0: {}
  leaf@3.0.0: {}
  shared@1.0.0: {}
  zod@4.0.0: {}
`;

const LOCK = parseLockfile(LOCK_TEXT);

test('parseLockfile 解析合法文本,拒绝非对象与坏 YAML', () => {
  assert.equal(LOCK.lockfileVersion, '9.0');
  assert.throws(() => parseLockfile('just a string'), /不是对象/);
  assert.throws(() => parseLockfile('\tbad: [yaml'), /解析失败/);
});

test('computeClosure 沿 snapshots 传递,精确到版本', () => {
  const keys = computeClosure(LOCK, '@a/plugin-a');
  assert.deepEqual(
    [...keys].sort(),
    ['@a/plugin-a@1.0.0', 'dep-x@1.0.0', 'leaf@3.0.0', 'shared@1.0.0']
  );
  // 不带进冲突的另一版本
  assert.ok(!keys.has('dep-x@2.0.0'));
});

test('computeClosure 支持 peer 后缀含 @ 的键,空 snapshot 不报错', () => {
  const keys = computeClosure(LOCK, '@a/plugin-b');
  assert.deepEqual(
    [...keys].sort(),
    ['@a/plugin-b@2.0.0(zod@4.0.0)', 'dep-x@2.0.0', 'shared@1.0.0', 'zod@4.0.0']
  );
});

test('computeClosure 对未知插件名报错', () => {
  assert.throws(() => computeClosure(LOCK, '@a/ghost'), /importers 里找不到/);
});

test('referencedKeys 覆盖 packages + snapshots + importers', () => {
  const keys = referencedKeys(LOCK);
  assert.ok(keys.has('@a/plugin-b@2.0.0')); // packages 键
  assert.ok(keys.has('@a/plugin-b@2.0.0(zod@4.0.0)')); // snapshots 键
  assert.ok(keys.has('@a/plugin-a@1.0.0')); // importers 键
});

test('planKeySets 删除集不删共享依赖,只删独占旧条目', () => {
  // 旧 lockfile:plugin-a 1.0.0(闭包 a + dep-x@1 + leaf + shared),另有 plugin-c 也引用 leaf
  const oldLock = parseLockfile(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@a/plugin-a': { specifier: 0.9.0, version: 0.9.0 }
      '@a/plugin-c': { specifier: 5.0.0, version: 5.0.0 }
packages:
  '@a/plugin-a@0.9.0': { resolution: {integrity: sha512-a9} }
  '@a/plugin-c@5.0.0': { resolution: {integrity: sha512-c5} }
  leaf@3.0.0: { resolution: {integrity: sha512-l} }
  old-only@7.0.0: { resolution: {integrity: sha512-o} }
snapshots:
  '@a/plugin-a@0.9.0':
    dependencies:
      leaf: 3.0.0
      old-only: 7.0.0
  '@a/plugin-c@5.0.0':
    dependencies:
      leaf: 3.0.0
  leaf@3.0.0: {}
  old-only@7.0.0: {}
`);
  // 新 lockfile:plugin-a 升到 1.0.0(不再依赖 leaf/old-only),plugin-c 不变
  const newLock = parseLockfile(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@a/plugin-a': { specifier: 1.0.0, version: 1.0.0 }
      '@a/plugin-c': { specifier: 5.0.0, version: 5.0.0 }
packages:
  '@a/plugin-a@1.0.0': { resolution: {integrity: sha512-a1} }
  '@a/plugin-c@5.0.0': { resolution: {integrity: sha512-c5} }
  leaf@3.0.0: { resolution: {integrity: sha512-l} }
  shared@1.0.0: { resolution: {integrity: sha512-s} }
snapshots:
  '@a/plugin-a@1.0.0':
    dependencies:
      shared: 1.0.0
  '@a/plugin-c@5.0.0':
    dependencies:
      leaf: 3.0.0
  leaf@3.0.0: {}
  shared@1.0.0: {}
`);
  const { addKeys, removeKeys } = planKeySets(oldLock, newLock, '@a/plugin-a');
  assert.deepEqual([...addKeys].sort(), ['@a/plugin-a@1.0.0', 'shared@1.0.0']);
  // 只删旧插件本体与独占的 old-only;leaf 仍被 plugin-c 引用,不能删
  assert.deepEqual([...removeKeys].sort(), ['@a/plugin-a@0.9.0', 'old-only@7.0.0']);
});

// ---- 磁盘索引与键翻译 ----

// 造一个实体化平铺布局:顶层 + scope + 嵌套版本冲突 + .bin/.pnpm 噪声目录。
function makeFakeProfile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-closure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writePkg = (rel, name, version) => {
    const dir = path.join(root, ...rel.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  };
  writePkg('node_modules/@a/plugin-a', '@a/plugin-a', '1.0.0');
  writePkg('node_modules/dep-x', 'dep-x', '1.0.0');
  writePkg('node_modules/shared', 'shared', '1.0.0');
  // 嵌套冲突版本:plugin-b 自带 dep-x@2.0.0
  writePkg('node_modules/@a/plugin-b', '@a/plugin-b', '2.0.0');
  writePkg('node_modules/@a/plugin-b/node_modules/dep-x', 'dep-x', '2.0.0');
  // 同名同版本的两处实体(实体化复制的重复),索引须两处都收
  writePkg('node_modules/shared/node_modules/leaf', 'leaf', '3.0.0');
  writePkg('node_modules/@a/plugin-a/node_modules/leaf', 'leaf', '3.0.0');
  fs.mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/.pnpm'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), LOCK_TEXT);
  return root;
}

test('indexPackages 覆盖顶层、scope、嵌套冲突,跳过 .bin/.pnpm', (t) => {
  const root = makeFakeProfile(t);
  const index = indexPackages(root);
  assert.deepEqual(index.get('@a/plugin-a@1.0.0'), ['node_modules/@a/plugin-a']);
  assert.deepEqual(index.get('dep-x@1.0.0'), ['node_modules/dep-x']);
  assert.deepEqual(index.get('dep-x@2.0.0'), ['node_modules/@a/plugin-b/node_modules/dep-x']);
  assert.equal(index.size, 6); // plugin-a, plugin-b, dep-x@1, dep-x@2, shared, leaf
  // 同名同版本两处实体都登记
  assert.deepEqual(
    index.get('leaf@3.0.0').sort(),
    ['node_modules/@a/plugin-a/node_modules/leaf', 'node_modules/shared/node_modules/leaf']
  );
});

test('readLockfile 读盘解析,文件缺失直接抛', (t) => {
  const root = makeFakeProfile(t);
  const lock = readLockfile(root);
  assert.equal(lock.lockfileVersion, '9.0');
  assert.throws(() => readLockfile(path.join(root, 'nowhere')));
});

test('resolveKeysToDirs 剥 peer 后缀映射目录,缺失键收进 missing 不报错', (t) => {
  const root = makeFakeProfile(t);
  const index = indexPackages(root);
  const keys = new Set([
    '@a/plugin-b@2.0.0(zod@4.0.0)', // peer 后缀 -> node_modules/@a/plugin-b
    'dep-x@2.0.0', // 嵌套冲突版本
    'zod@4.0.0', // 磁盘不存在(平台 optional 未发货场景)
  ]);
  const { dirs, missing } = resolveKeysToDirs(keys, index);
  assert.deepEqual(
    dirs.sort(),
    ['node_modules/@a/plugin-b', 'node_modules/@a/plugin-b/node_modules/dep-x'].sort()
  );
  assert.deepEqual(missing, ['zod@4.0.0']);
});

// ---- 集成 fixture:spike 残留的真实 lockfile(存在才跑,CI 无 build 产物时跳过)----

test('集成:真实 profile lockfile 的闭包形态与 spike 结论一致', (t) => {
  const realLock = path.join(TEST_DIR, '..', 'build', 'spike-run', 'new', 'web', 'pnpm-lock.yaml');
  if (!fs.existsSync(realLock)) {
    t.skip('build/spike-run 不存在(无 spike 产物),跳过集成断言');
    return;
  }
  const lock = readLockfile(path.dirname(realLock));
  // git-graph 0.2.5 闭包只有自身(spike 实证:snapshot 为空、仅 react peer)
  assert.deepEqual([...computeClosure(lock, '@linxin666/dsh-client-ui-git-graph')], [
    '@linxin666/dsh-client-ui-git-graph@0.2.5',
  ]);
  // docs-harness 是 peer 后缀键的回归用例:闭包 = 自身 + zod
  assert.deepEqual(
    [...computeClosure(lock, '@aiwaretop/dsh-docs-harness')].sort(),
    ['@aiwaretop/dsh-docs-harness@0.1.3(zod@4.4.3)', 'zod@4.4.3']
  );
  // better-sidebar 大闭包(spike 实测 165 条目)
  assert.equal(computeClosure(lock, 'dsh-better-sidebar').size, 165);
});
