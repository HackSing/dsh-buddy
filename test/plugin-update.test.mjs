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

const PROFILE = 'web';
const CHANNEL_PACKAGES = [
  { name: '@a/plugin-one', version: '0.3.0' },
  { name: '@a/plugin-two', version: '0.2.0' },
];

// 造一个真 tar:顶层目录 = profile 名,内含 package.json 带指定 deps。
// returns { tarballPath, sha256 }。
function makeTarball(t, root, deps) {
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, PROFILE), { recursive: true });
  fs.writeFileSync(
    path.join(src, PROFILE, 'package.json'),
    JSON.stringify({ dependencies: deps })
  );
  const tarballPath = path.join(root, 'update.tar.gz');
  tar.c({ file: tarballPath, cwd: src, gzip: true, sync: true }, [PROFILE]);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tarballPath)).digest('hex');
  return { tarballPath, sha256 };
}

function scaffold(t, deps) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dshHome = path.join(root, 'dsh-home');
  const downloadDir = path.join(root, 'downloads');
  const { tarballPath, sha256 } = makeTarball(t, root, deps);
  // 假 fetch:以 web stream 送出 tar 文件
  const fetchImpl = async () => ({ ok: true, body: Readable.toWeb(fs.createReadStream(tarballPath)) });
  const update = { packages: CHANNEL_PACKAGES, tarball: { url: 'https://example.com/t.tar.gz', sha256 } };
  return { root, dshHome, downloadDir, update, fetchImpl };
}

function writeProfile(dshHome, deps) {
  const dir = path.join(dshHome, 'profiles', PROFILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: deps }));
  return dir;
}

function readDeps(dshHome) {
  return JSON.parse(
    fs.readFileSync(path.join(dshHome, 'profiles', PROFILE, 'package.json'), 'utf8')
  ).dependencies;
}

test('fresh install lays down the channel profile', async (t) => {
  const { dshHome, downloadDir, update, fetchImpl } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  const result = await applyPluginUpdate({ update, dshHome, profileName: PROFILE, downloadDir, fetchImpl });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.installed);
  assert.deepEqual(readDeps(dshHome), { '@a/plugin-one': '0.3.0', '@a/plugin-two': '0.2.0' });
  // 下载的更新包安装后即弃,不在 downloadDir 堆积
  assert.equal(fs.readdirSync(downloadDir).length, 0);
});

test('upgrade over an older profile replaces it and keeps a backup', async (t) => {
  const { dshHome, downloadDir, update, fetchImpl } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  writeProfile(dshHome, { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.2.0' });
  const result = await applyPluginUpdate({ update, dshHome, profileName: PROFILE, downloadDir, fetchImpl });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.upgraded);
  assert.ok(result.backup);
  assert.deepEqual(readDeps(dshHome), { '@a/plugin-one': '0.3.0', '@a/plugin-two': '0.2.0' });
  // 旧版备份仍在,可人工回滚
  const backupDeps = JSON.parse(
    fs.readFileSync(path.join(dshHome, 'profiles', result.backup, 'package.json'), 'utf8')
  ).dependencies;
  assert.equal(backupDeps['@a/plugin-one'], '0.2.2');
});

test('sha256 mismatch fails without touching the existing profile', async (t) => {
  const { dshHome, downloadDir, update, fetchImpl } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  const existing = writeProfile(dshHome, { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.2.0' });
  const badUpdate = { ...update, tarball: { ...update.tarball, sha256: 'b'.repeat(64) } };
  const result = await applyPluginUpdate({ update: badUpdate, dshHome, profileName: PROFILE, downloadDir, fetchImpl });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.failed);
  assert.match(result.detail, /sha256/);
  assert.deepEqual(readDeps(dshHome), { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.2.0' });
  assert.equal(fs.existsSync(path.join(existing, 'package.json')), true);
  // staging 文件也被清理
  assert.ok(!fs.existsSync(downloadDir) || fs.readdirSync(downloadDir).length === 0);
});

test('download failure folds into failed outcome', async (t) => {
  const { dshHome, downloadDir, update } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  const failingFetch = async () => ({ ok: false, status: 404 });
  const result = await applyPluginUpdate({ update, dshHome, profileName: PROFILE, downloadDir, fetchImpl: failingFetch });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.failed);
  assert.match(result.detail, /404/);
  assert.equal(fs.existsSync(path.join(dshHome, 'profiles', PROFILE)), false);
});

test('profile with extra packages is preserved, not overwritten', async (t) => {
  const { dshHome, downloadDir, update, fetchImpl } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  writeProfile(dshHome, {
    '@a/plugin-one': '0.2.2',
    '@a/plugin-two': '0.2.0',
    'user-plugin': '1.0.0',
  });
  const result = await applyPluginUpdate({ update, dshHome, profileName: PROFILE, downloadDir, fetchImpl });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.preserved);
  assert.deepEqual(result.extras, ['user-plugin']);
  assert.equal(readDeps(dshHome)['@a/plugin-one'], '0.2.2');
});

test('onProgress 逐块累计上报,total 取 content-length', async (t) => {
  const { dshHome, downloadDir, update, fetchImpl } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  // 包一层假 fetch,补上 content-length 头
  const withHeaders = async () => {
    const res = await fetchImpl();
    return { ...res, headers: new Map([['content-length', '1048576']]) };
  };
  const events = [];
  const result = await applyPluginUpdate({
    update,
    dshHome,
    profileName: PROFILE,
    downloadDir,
    fetchImpl: withHeaders,
    onProgress: (p) => events.push(p),
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.installed);
  assert.ok(events.length > 0);
  // 累计递增且最后一个等于文件实际大小;total 恒定
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].transferred >= events[i - 1].transferred);
  }
  assert.equal(events.at(-1).total, 1048576);
  assert.ok(events.at(-1).transferred > 0);
});

test('prepareInstall 在下载完成后、安装前调用', async (t) => {
  const { dshHome, downloadDir, update, fetchImpl } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  writeProfile(dshHome, { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.2.0' });
  const order = [];
  const result = await applyPluginUpdate({
    update,
    dshHome,
    profileName: PROFILE,
    downloadDir,
    fetchImpl,
    onProgress: () => order.push('download'),
    prepareInstall: () => {
      // 此刻 profile 必须还是旧版(安装尚未开始)
      order.push('prepareInstall');
      assert.equal(readDeps(dshHome)['@a/plugin-one'], '0.2.2');
    },
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.upgraded);
  assert.equal(order.at(-1), 'prepareInstall'); // 下载事件全部先于 prepareInstall
  assert.ok(order.includes('download'));
});

test('下载失败时 prepareInstall 不被调用', async (t) => {
  const { dshHome, downloadDir, update } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  let called = false;
  const failingFetch = async () => ({ ok: false, status: 502 });
  const result = await applyPluginUpdate({
    update,
    dshHome,
    profileName: PROFILE,
    downloadDir,
    fetchImpl: failingFetch,
    prepareInstall: () => {
      called = true;
    },
  });
  assert.equal(result.outcome, PLUGIN_UPDATE_OUTCOME.failed);
  assert.equal(called, false);
});
