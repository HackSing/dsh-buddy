import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { profileUpgradeDecision } = require('../lib/bundled-profile.js');

const MANIFEST = [
  { name: '@a/plugin-one', version: '0.2.2' },
  { name: '@a/plugin-two', version: '0.1.20' },
];

// 方向性语义:profile 版本不低于清单即 up-to-date(热更领先不得被随包旧清单回滚),
// 落后/缺包/不可解析才 upgrade;清单外依赖与不可读 deps 维持 preserved。

test('deps identical to manifest → up-to-date', () => {
  const deps = { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.20' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), { status: 'up-to-date' });
});

test('profile ahead of manifest (runtime hot-update) → up-to-date, no rollback', () => {
  const deps = { '@a/plugin-one': '0.3.0', '@a/plugin-two': '0.2.0' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), { status: 'up-to-date' });
});

test('profile behind manifest → upgrade', () => {
  const deps = { '@a/plugin-one': '0.2.1', '@a/plugin-two': '0.1.20' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), { status: 'upgrade' });
});

test('mixed ahead/behind → upgrade (any stale package decides)', () => {
  const deps = { '@a/plugin-one': '0.9.9', '@a/plugin-two': '0.1.19' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), { status: 'upgrade' });
});

test('manifest package missing from profile → upgrade', () => {
  const deps = { '@a/plugin-one': '0.2.2' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), { status: 'upgrade' });
});

test('unparseable version on either side → conservative upgrade', () => {
  assert.equal(
    profileUpgradeDecision({ '@a/plugin-one': 'file:../local', '@a/plugin-two': '0.1.20' }, MANIFEST)
      .status,
    'upgrade'
  );
  assert.equal(
    profileUpgradeDecision({ '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.20' }, [
      { name: '@a/plugin-one', version: '0.2.2' },
      { name: '@a/plugin-two', version: 'latest' },
    ]).status,
    'upgrade'
  );
});

test('extra packages beyond manifest → preserved, extras listed', () => {
  const deps = { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.20', 'user-plugin': '1.0.0' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), {
    status: 'preserved',
    extras: ['user-plugin'],
  });
});

test('unreadable deps → preserved', () => {
  assert.deepEqual(profileUpgradeDecision(null, MANIFEST), { status: 'preserved', extras: [] });
});
