import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  checkPluginChannel,
  CHANNEL_OUTCOME,
  CHANNEL_SCHEMA,
  STATE_FILE_NAME,
  splitPrerelease,
  compareRelease,
  isNewerRelease,
  parseChannel,
  diffChannelVersions,
} = require('../lib/plugin-channel.js');

const VALID_CHANNEL = {
  schema_version: CHANNEL_SCHEMA,
  packages: [
    { name: '@a/plugin-one', version: '0.3.0' },
    { name: '@a/plugin-two', version: '0.2.0' },
  ],
  tarball: { url: 'https://example.com/web-profile-plugins.tar.gz', sha256: 'a'.repeat(64) },
  minDshVersion: '0.1.0-rc.7',
};

// 搭一个临时 profile(package.json 带 dependencies)与 stateDir;returns { profileDir, stateDir }。
function scaffold(t, deps) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-channel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  if (deps !== null) {
    fs.writeFileSync(
      path.join(profileDir, 'package.json'),
      JSON.stringify({ dependencies: deps })
    );
  }
  return { profileDir, stateDir: path.join(root, 'state') };
}

// 假 fetch:按 URL 路由到 channel / dist-tags 响应。
function fakeFetch({ channel = VALID_CHANNEL, channelError = null, distTags = { latest: '0.1.0-rc.7' } }) {
  return async (url) => {
    if (url.includes('registry.npmjs.org')) {
      return { ok: true, json: async () => distTags };
    }
    if (channelError) throw channelError;
    return { ok: true, json: async () => channel };
  };
}

test('splitPrerelease / compareRelease handle rc versions', () => {
  assert.deepEqual(splitPrerelease('0.1.0-rc.7'), { core: '0.1.0', pre: 'rc.7' });
  assert.deepEqual(splitPrerelease('v1.2.3'), { core: '1.2.3', pre: null });
  assert.equal(splitPrerelease('garbage'), null);
  assert.equal(compareRelease('0.1.0-rc.8', '0.1.0-rc.7'), 1);
  assert.equal(compareRelease('0.1.0-rc.7', '0.1.0-rc.7'), 0);
  assert.equal(compareRelease('0.1.0', '0.1.0-rc.9'), 1);
  assert.equal(compareRelease('0.2.0-rc.1', '0.1.0'), 1);
  assert.equal(compareRelease('garbage', '0.1.0'), null);
  assert.ok(isNewerRelease('0.1.0-rc.8', '0.1.0-rc.7'));
  assert.ok(!isNewerRelease('0.1.0-rc.7', '0.1.0-rc.7'));
});

test('parseChannel accepts a valid channel and rejects malformed ones', () => {
  const parsed = parseChannel(VALID_CHANNEL);
  assert.equal(parsed.fingerprint, '@a/plugin-one@0.3.0\n@a/plugin-two@0.2.0');
  assert.equal(parseChannel({ ...VALID_CHANNEL, schema_version: 'wrong' }), null);
  assert.equal(parseChannel({ ...VALID_CHANNEL, packages: [] }), null);
  assert.equal(
    parseChannel({ ...VALID_CHANNEL, packages: [{ name: 'x', version: 'latest' }] }),
    null
  );
  assert.equal(
    parseChannel({ ...VALID_CHANNEL, tarball: { url: 'http://insecure', sha256: 'a'.repeat(64) } }),
    null
  );
  assert.equal(
    parseChannel({ ...VALID_CHANNEL, tarball: { url: 'https://x', sha256: 'not-hex' } }),
    null
  );
  assert.equal(parseChannel({ ...VALID_CHANNEL, minDshVersion: 'garbage' }), null);
});

test('diffChannelVersions lists only strictly newer channel packages', () => {
  const local = { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.2.0' };
  assert.deepEqual(diffChannelVersions(VALID_CHANNEL.packages, local), [
    { name: '@a/plugin-one', from: '0.2.2', to: '0.3.0' },
  ]);
  // 本地领先或持平 → 无更新;缺失/不可解析 → 需要更新
  assert.deepEqual(
    diffChannelVersions(VALID_CHANNEL.packages, {
      '@a/plugin-one': '0.3.0',
      '@a/plugin-two': '0.9.9',
    }),
    []
  );
  assert.deepEqual(diffChannelVersions(VALID_CHANNEL.packages, {}), [
    { name: '@a/plugin-one', from: null, to: '0.3.0' },
    { name: '@a/plugin-two', from: null, to: '0.2.0' },
  ]);
  assert.deepEqual(
    diffChannelVersions(VALID_CHANNEL.packages, {
      '@a/plugin-one': 'file:../local',
      '@a/plugin-two': '0.2.0',
    }),
    [{ name: '@a/plugin-one', from: 'file:../local', to: '0.3.0' }]
  );
});

test('checkPluginChannel: newer channel → notified once, second run already-notified', async (t) => {
  const { profileDir, stateDir } = scaffold(t, {
    '@a/plugin-one': '0.2.2',
    '@a/plugin-two': '0.2.0',
  });
  const notifications = [];
  const args = {
    profileDir,
    stateDir,
    currentDshVersion: '0.1.0-rc.7',
    notify: async ({ update }) => notifications.push(update),
    fetchImpl: fakeFetch({}),
  };
  const first = await checkPluginChannel(args);
  assert.equal(first.outcome, CHANNEL_OUTCOME.notified);
  assert.equal(first.update.installable, true);
  assert.deepEqual(first.update.updates, [{ name: '@a/plugin-one', from: '0.2.2', to: '0.3.0' }]);
  assert.equal(notifications.length, 1);

  const second = await checkPluginChannel({ ...args, force: true });
  assert.equal(second.outcome, CHANNEL_OUTCOME.alreadyNotified);
  assert.equal(notifications.length, 1);
});

test('checkPluginChannel: minDshVersion above embedded dsh → notified but not installable', async (t) => {
  const { profileDir, stateDir } = scaffold(t, { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.2.0' });
  const result = await checkPluginChannel({
    profileDir,
    stateDir,
    currentDshVersion: '0.1.0-rc.7',
    notify: async () => {},
    fetchImpl: fakeFetch({ channel: { ...VALID_CHANNEL, minDshVersion: '0.1.0-rc.9' } }),
  });
  assert.equal(result.outcome, CHANNEL_OUTCOME.notified);
  assert.equal(result.update.installable, false);
});

test('checkPluginChannel: local up to date → up-to-date, no notification', async (t) => {
  const { profileDir, stateDir } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  const result = await checkPluginChannel({
    profileDir,
    stateDir,
    currentDshVersion: '0.1.0-rc.7',
    notify: async () => assert.fail('must not notify'),
    fetchImpl: fakeFetch({}),
  });
  assert.equal(result.outcome, CHANNEL_OUTCOME.upToDate);
});

test('checkPluginChannel: throttled within 24h, force bypasses', async (t) => {
  const { profileDir, stateDir } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  const args = {
    profileDir,
    stateDir,
    currentDshVersion: '0.1.0-rc.7',
    notify: async () => {},
    fetchImpl: fakeFetch({}),
  };
  const t0 = Date.now();
  const first = await checkPluginChannel({ ...args, now: t0 });
  assert.equal(first.outcome, CHANNEL_OUTCOME.upToDate);
  const throttled = await checkPluginChannel({ ...args, now: t0 + 1000 });
  assert.equal(throttled.outcome, CHANNEL_OUTCOME.throttled);
  const forced = await checkPluginChannel({ ...args, now: t0 + 1000, force: true });
  assert.equal(forced.outcome, CHANNEL_OUTCOME.upToDate);
});

test('checkPluginChannel: network/parse/profile failures fold into named outcomes', async (t) => {
  const { profileDir, stateDir } = scaffold(t, {
    '@a/plugin-one': '0.2.2',
    '@a/plugin-two': '0.2.0',
  });
  const base = {
    profileDir,
    stateDir,
    currentDshVersion: '0.1.0-rc.7',
    notify: async () => assert.fail('must not notify'),
  };
  const offline = await checkPluginChannel({
    ...base,
    fetchImpl: fakeFetch({ channelError: new Error('ENOTFOUND') }),
  });
  assert.equal(offline.outcome, CHANNEL_OUTCOME.unreachable);

  const invalid = await checkPluginChannel({
    ...base,
    force: true, // 与上一调用共用 stateDir,绕过 24h 节流
    fetchImpl: fakeFetch({ channel: { nope: true } }),
  });
  assert.equal(invalid.outcome, CHANNEL_OUTCOME.invalidChannel);

  const noProfile = scaffold(t, null);
  const unreadable = await checkPluginChannel({
    ...base,
    profileDir: noProfile.profileDir,
    stateDir: noProfile.stateDir,
    fetchImpl: fakeFetch({}),
  });
  assert.equal(unreadable.outcome, CHANNEL_OUTCOME.profileUnreadable);
});

test('checkPluginChannel: dsh core update surfaces once via dshCore', async (t) => {
  const { profileDir, stateDir } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  const args = {
    profileDir,
    stateDir,
    currentDshVersion: '0.1.0-rc.7',
    notify: async () => {},
    fetchImpl: fakeFetch({ distTags: { latest: '0.1.0-rc.7', next: '0.1.0-rc.8' } }),
  };
  const first = await checkPluginChannel(args);
  assert.equal(first.dshCore.outcome, 'update-available');
  assert.equal(first.dshCore.latest, '0.1.0-rc.8');
  assert.equal(first.dshCore.alreadyNotified, false);
  const second = await checkPluginChannel({ ...args, force: true });
  assert.equal(second.dshCore.alreadyNotified, true);
});

test('state file round-trips and survives a fresh read', async (t) => {
  const { profileDir, stateDir } = scaffold(t, {
    '@a/plugin-one': '0.3.0',
    '@a/plugin-two': '0.2.0',
  });
  await checkPluginChannel({
    profileDir,
    stateDir,
    currentDshVersion: '0.1.0-rc.7',
    notify: async () => {},
    fetchImpl: fakeFetch({}),
  });
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, STATE_FILE_NAME), 'utf8'));
  assert.ok(Number.isFinite(state.lastCheckedAt));
  assert.equal(state.lastNotifiedFingerprint, null);
});
