import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tar = require('tar');
const { applyPluginUpdate, PLUGIN_UPDATE_OUTCOME } = require('../lib/plugin-update.js');
const { CHANNEL_SCHEMA_V2 } = require('../lib/plugin-channel.js');
const { BOOKKEEPING_FILES } = require('../lib/profile-closure.js');

// v2 逐插件外科安装的端到端单测:小型假 profile + 真 tar(切片/簿记都按
// 发布侧产物形状构造)。覆盖:只换目标插件、删除集不误删共享依赖、簿记后落、
// 中途失败原 profile 不动、preserved 语义、聚合进度递增。

const OLD_LOCK = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@a/plugin-one': { specifier: 1.0.0, version: 1.0.0 }
      '@a/plugin-two': { specifier: 2.0.0, version: 2.0.0 }
packages:
  '@a/plugin-one@1.0.0': { resolution: {integrity: sha512-a} }
  '@a/plugin-two@2.0.0': { resolution: {integrity: sha512-b} }
  old-only@7.0.0: { resolution: {integrity: sha512-o} }
  shared@1.0.0: { resolution: {integrity: sha512-s} }
snapshots:
  '@a/plugin-one@1.0.0':
    dependencies:
      old-only: 7.0.0
      shared: 1.0.0
  '@a/plugin-two@2.0.0':
    dependencies:
      shared: 1.0.0
  old-only@7.0.0: {}
  shared@1.0.0: {}
`;

// 新簿记里的 lockfile:plugin-one 升 1.1.0 且不再依赖 old-only;plugin-two 不变。
// shared@1.0.0 仍被引用——删除集绝不能碰它。
const NEW_LOCK = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@a/plugin-one': { specifier: 1.1.0, version: 1.1.0 }
      '@a/plugin-two': { specifier: 2.0.0, version: 2.0.0 }
packages:
  '@a/plugin-one@1.1.0': { resolution: {integrity: sha512-a1} }
  '@a/plugin-two@2.0.0': { resolution: {integrity: sha512-b} }
  shared@1.0.0: { resolution: {integrity: sha512-s} }
snapshots:
  '@a/plugin-one@1.1.0':
    dependencies:
      shared: 1.0.0
  '@a/plugin-two@2.0.0':
    dependencies:
      shared: 1.0.0
  shared@1.0.0: {}
`;

function writePkg(root, rel, name, version, files = {}) {
  const dir = path.join(root, ...rel.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), content);
}

// 旧 profile:plugin-one@1.0.0(带将被新版删除的 removed.js)、plugin-two@2.0.0、
// shared@1.0.0、old-only@7.0.0 + 7 件簿记。extraDeps 用于 preserved 场景。
function makeOldProfile(profileDir, extraDeps = {}) {
  writePkg(profileDir, 'node_modules/@a/plugin-one', '@a/plugin-one', '1.0.0', {
    'index.js': 'old',
    'removed.js': 'stale',
  });
  writePkg(profileDir, 'node_modules/@a/plugin-two', '@a/plugin-two', '2.0.0', { 'index.js': 'two' });
  writePkg(profileDir, 'node_modules/shared', 'shared', '1.0.0');
  writePkg(profileDir, 'node_modules/old-only', 'old-only', '7.0.0');
  for (const f of BOOKKEEPING_FILES) {
    const abs = path.join(profileDir, ...f.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (f === 'package.json') {
      fs.writeFileSync(abs, JSON.stringify({
        dependencies: { '@a/plugin-one': '1.0.0', '@a/plugin-two': '2.0.0', ...extraDeps },
      }));
    } else if (f === 'pnpm-lock.yaml') {
      fs.writeFileSync(abs, OLD_LOCK);
    } else {
      fs.writeFileSync(abs, `# old ${f}`);
    }
  }
}

// 造一个 tar 并回传 { url, sha256, size } 引用;url 用假域名,fetchImpl 按 url 找文件。
function packRef(root, srcDir, entries, fileName) {
  const tarPath = path.join(root, fileName);
  tar.c({ file: tarPath, cwd: srcDir, gzip: true, sync: true }, entries);
  return {
    path: tarPath,
    url: `https://example.com/${fileName}`,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex'),
    size: fs.statSync(tarPath).size,
  };
}

// 搭整套舞台:旧 profile + plugin-one 1.1.0 切片 + 新簿记 tar。
// returns { dshHome, downloadDir, update, urlFiles }。
function scaffold(t, { extraDeps = {}, badSliceSha = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-update-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dshHome = path.join(root, 'dsh-home');
  const profileDir = path.join(dshHome, 'profiles', 'web');
  makeOldProfile(profileDir, extraDeps);

  // 切片源(发布侧视角的新版闭包目录):plugin-one@1.1.0 + shared(不变也带,幂等覆盖)
  const sliceSrc = path.join(root, 'slice-src');
  writePkg(sliceSrc, 'node_modules/@a/plugin-one', '@a/plugin-one', '1.1.0', { 'index.js': 'new' });
  writePkg(sliceSrc, 'node_modules/shared', 'shared', '1.0.0');
  const slice = packRef(root, sliceSrc, ['node_modules/@a/plugin-one', 'node_modules/shared'], 'plugin-one.tar.gz');
  if (badSliceSha) slice.sha256 = '0'.repeat(64);

  // 簿记 tar:7 件,package.json/pnpm-lock.yaml 为新版,其余换内容标记
  const bkSrc = path.join(root, 'bk-src');
  for (const f of BOOKKEEPING_FILES) {
    const abs = path.join(bkSrc, ...f.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (f === 'package.json') {
      fs.writeFileSync(abs, JSON.stringify({ dependencies: { '@a/plugin-one': '1.1.0', '@a/plugin-two': '2.0.0' } }));
    } else if (f === 'pnpm-lock.yaml') {
      fs.writeFileSync(abs, NEW_LOCK);
    } else {
      fs.writeFileSync(abs, `# new ${f}`);
    }
  }
  const bookkeeping = packRef(root, bkSrc, BOOKKEEPING_FILES, 'bookkeeping.tar.gz');

  const update = {
    schema: CHANNEL_SCHEMA_V2,
    packages: [
      { name: '@a/plugin-one', version: '1.1.0' },
      { name: '@a/plugin-two', version: '2.0.0' },
    ],
    updates: [
      { name: '@a/plugin-one', from: '1.0.0', to: '1.1.0', tarball: { url: slice.url, sha256: slice.sha256, size: slice.size } },
    ],
    bookkeeping: { url: bookkeeping.url, sha256: bookkeeping.sha256, size: bookkeeping.size },
    minDshVersion: '0.1.0-rc.7',
  };
  const urlFiles = new Map([[slice.url, slice.path], [bookkeeping.url, bookkeeping.path]]);
  const fetchImpl = async (url) => ({ ok: true, body: Readable.toWeb(fs.createReadStream(urlFiles.get(url))) });
  return { root, dshHome, profileDir, downloadDir: path.join(root, 'downloads'), update, fetchImpl, slice, bookkeeping };
}

test('v2 外科更新:只换目标插件,独占旧依赖删除,共享依赖不动,簿记后落', async (t) => {
  const { dshHome, profileDir, downloadDir, update, fetchImpl } = scaffold(t);
  let prepared = 0;
  const result = await applyPluginUpdate({
    update, dshHome, profileName: 'web', downloadDir, fetchImpl,
    prepareInstall: async () => { prepared += 1; },
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.upgraded);
  assert.match(result.backup, /^web\.backup-1\.0\.0$/);
  assert.equal(prepared, 1);

  // 目标插件换新(整体替换而非合并:旧文件 removed.js 不复存在)
  const one = path.join(profileDir, 'node_modules', '@a', 'plugin-one');
  assert.equal(JSON.parse(fs.readFileSync(path.join(one, 'package.json'), 'utf8')).version, '1.1.0');
  assert.equal(fs.readFileSync(path.join(one, 'index.js'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(path.join(one, 'removed.js')));
  // 独占旧依赖被 GC,共享依赖原样
  assert.ok(!fs.existsSync(path.join(profileDir, 'node_modules', 'old-only')));
  assert.ok(fs.existsSync(path.join(profileDir, 'node_modules', 'shared', 'package.json')));
  // 非目标插件分毫未动
  assert.equal(fs.readFileSync(path.join(profileDir, 'node_modules', '@a', 'plugin-two', 'index.js'), 'utf8'), 'two');
  // 簿记换新
  const deps = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).dependencies;
  assert.equal(deps['@a/plugin-one'], '1.1.0');
  assert.ok(fs.readFileSync(path.join(profileDir, 'pnpm-lock.yaml'), 'utf8').includes('1.1.0'));
  assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), '# new cordis.patch.yml');
  // 旧版备份可回滚
  assert.ok(fs.existsSync(path.join(dshHome, 'profiles', result.backup, 'node_modules', 'old-only')));
  // 下载产物即弃,不堆积
  assert.deepEqual(fs.readdirSync(downloadDir), []);
});

test('v2 切片 sha256 不符:整体失败,原 profile 分毫不动,半成品不留', async (t) => {
  const { dshHome, profileDir, downloadDir, update, fetchImpl } = scaffold(t, { badSliceSha: true });
  let prepared = 0;
  const result = await applyPluginUpdate({
    update, dshHome, profileName: 'web', downloadDir, fetchImpl,
    prepareInstall: async () => { prepared += 1; },
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.failed);
  assert.match(result.detail, /下载失败: sha256 不符/);
  assert.equal(prepared, 0); // 停 dsh 钩子绝不在下载失败后被调用
  // 原 profile 分毫不动
  const one = path.join(profileDir, 'node_modules', '@a', 'plugin-one');
  assert.equal(JSON.parse(fs.readFileSync(path.join(one, 'package.json'), 'utf8')).version, '1.0.0');
  assert.ok(fs.existsSync(path.join(one, 'removed.js')));
  assert.ok(fs.existsSync(path.join(profileDir, 'node_modules', 'old-only')));
  // 无 staging 残留、无备份误建、下载目录无半成品
  assert.deepEqual(fs.readdirSync(downloadDir), []);
  assert.deepEqual(fs.readdirSync(path.join(dshHome, 'profiles')), ['web']);
});

test('v2 清单外插件:preserved,连下载都不发起', async (t) => {
  const { dshHome, downloadDir, update } = scaffold(t, { extraDeps: { 'user-own-plugin': '9.9.9' } });
  const result = await applyPluginUpdate({
    update, dshHome, profileName: 'web', downloadDir,
    fetchImpl: async () => assert.fail('preserved 判定在下载前,不应发起 fetch'),
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.preserved);
  assert.deepEqual(result.extras, ['user-own-plugin']);
});

test('v2 聚合进度:transferred 单调递增,终值 = 各切片与簿记 size 之和', async (t) => {
  const { dshHome, downloadDir, update, fetchImpl, slice, bookkeeping } = scaffold(t);
  const events = [];
  const result = await applyPluginUpdate({
    update, dshHome, profileName: 'web', downloadDir, fetchImpl,
    onProgress: (p) => events.push(p),
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.upgraded);
  assert.ok(events.length > 0);
  const total = slice.size + bookkeeping.size;
  for (const e of events) assert.equal(e.total, total);
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i].transferred >= events[i - 1].transferred, 'transferred 单调不减');
  }
  // 簿记小文件可能单块完成,终值必须精确等于 total
  assert.equal(events[events.length - 1].transferred, total);
});

test('v2 profile 缺失:折叠为 failed,不构造半成品', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-update-v2-noprofile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { update, fetchImpl } = scaffold(t);
  const result = await applyPluginUpdate({
    update, dshHome: path.join(root, 'empty-home'), profileName: 'web',
    downloadDir: path.join(root, 'downloads'), fetchImpl,
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.failed);
  assert.match(result.detail, /profile 缺失或不可读/);
});
