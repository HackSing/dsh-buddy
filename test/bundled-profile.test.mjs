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
// 落后/缺包/不可解析才 upgrade;清单外依赖拆两态——清单内全满足 preserved-current
// (不弹窗),存在真实待升级才 preserved;不可读 deps 维持 preserved。
// 决策 B:profile 侧 file: spec 视为开发者本地覆盖,判满足。
// 决策 C:retired 清单内的退休包不计 extras,且出现即强制 upgrade(整目录替换清退)。

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

test('unparseable versions: file: spec 判满足,其余不可解析保守 upgrade', () => {
  // 决策 B:profile 侧 file: spec 视为开发者本地覆盖,判满足(不回滚开发安装)
  assert.deepEqual(
    profileUpgradeDecision({ '@a/plugin-one': 'file:../local', '@a/plugin-two': '0.1.20' }, MANIFEST),
    { status: 'up-to-date' }
  );
  // profile 侧乱码维持保守 upgrade
  assert.equal(
    profileUpgradeDecision({ '@a/plugin-one': 'not-a-version', '@a/plugin-two': '0.1.20' }, MANIFEST)
      .status,
    'upgrade'
  );
  // 清单侧不可解析(latest)维持保守 upgrade
  assert.equal(
    profileUpgradeDecision({ '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.20' }, [
      { name: '@a/plugin-one', version: '0.2.2' },
      { name: '@a/plugin-two', version: 'latest' },
    ]).status,
    'upgrade'
  );
});

test('extra packages + manifest fully satisfied → preserved-current, extras listed', () => {
  const deps = { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.20', 'user-plugin': '1.0.0' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), {
    status: 'preserved-current',
    extras: ['user-plugin'],
  });
});

test('extra packages + stale manifest package → preserved (真实更新被挡)', () => {
  const deps = { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.19', 'user-plugin': '1.0.0' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST), {
    status: 'preserved',
    extras: ['user-plugin'],
  });
});

const RETIRED = ['@a/retired-plugin'];

test('retired: deps 含退休包、清单内全满足、无 extras → upgrade(强制清退)', () => {
  const deps = { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.20', '@a/retired-plugin': '0.2.2' };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST, RETIRED), { status: 'upgrade' });
});

test('retired: 退休包不计入 extras(deps = 清单全集 + 退休包)', () => {
  const deps = { '@a/plugin-one': '0.2.2', '@a/plugin-two': '0.1.20', '@a/retired-plugin': '0.2.2' };
  const d = profileUpgradeDecision(deps, MANIFEST, RETIRED);
  // 若退休包被误算 extras 会走 preserved 分支;upgrade 且无 extras 字段证明只走 stale 通道
  assert.equal(d.status, 'upgrade');
  assert.ok(!('extras' in d));
});

test('retired: extras 与退休包并存 → preserved,extras 只列真外挂', () => {
  const deps = {
    '@a/plugin-one': '0.2.2',
    '@a/plugin-two': '0.1.20',
    '@a/retired-plugin': '0.2.2',
    'user-plugin': '1.0.0',
  };
  assert.deepEqual(profileUpgradeDecision(deps, MANIFEST, RETIRED), {
    status: 'preserved',
    extras: ['user-plugin'],
  });
});

test('unreadable deps → preserved', () => {
  assert.deepEqual(profileUpgradeDecision(null, MANIFEST), { status: 'preserved', extras: [] });
});
