import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planProbeInstall } = require('../scripts/verify-dsh-compat.js');

// 形状与仓库 dependencies 一致:dsh 本体 + 同版本家族钉版 + 非家族 cordis 钉版 + 第三方
const DEPENDENCIES = {
  '@deepseek-ai/cordis-plugin-group': '1.0.1',
  '@deepseek-ai/dsh': '0.1.5-rc.1',
  '@deepseek-ai/dsh-app-boot': '0.1.5-rc.1',
  '@deepseek-ai/dsh-settings': '0.1.5-rc.1',
  tar: '7.5.22',
};

test('候选即当前钉住版本:走 lockfile,与发布物同源', () => {
  const plan = planProbeInstall({ candidate: '0.1.5-rc.1', pinned: '0.1.5-rc.1', dependencies: DEPENDENCIES });
  assert.deepEqual(plan, { mode: 'lockfile' });
});

test('新候选:家族钉版整组抬到候选版本,不再与旧版本混装', () => {
  const plan = planProbeInstall({ candidate: '0.1.5-rc.3', pinned: '0.1.5-rc.1', dependencies: DEPENDENCIES });
  assert.equal(plan.mode, 'fresh');
  assert.deepEqual(plan.specs, [
    '@deepseek-ai/dsh@0.1.5-rc.3',
    '@deepseek-ai/cordis-plugin-group',
    '@deepseek-ai/dsh-app-boot@0.1.5-rc.3',
    '@deepseek-ai/dsh-settings@0.1.5-rc.3',
  ]);
});

test('新候选:非家族 @deepseek-ai 钉版不带版本号,第三方依赖不进探针', () => {
  const { specs } = planProbeInstall({ candidate: '0.1.6', pinned: '0.1.5-rc.1', dependencies: DEPENDENCIES });
  assert.ok(specs.includes('@deepseek-ai/cordis-plugin-group'));
  assert.ok(!specs.some((s) => s.startsWith('@deepseek-ai/cordis-plugin-group@')));
  assert.ok(!specs.some((s) => s.startsWith('tar')));
  assert.ok(!specs.some((s) => s.endsWith('@0.1.5-rc.1')));
});
