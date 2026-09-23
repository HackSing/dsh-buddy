import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MARKER, CREATE_NO_WINDOW, patchSource } = require('../lib/patch-dsh-no-window.js');

// 上游 tsdown 产物里三处创建点的原文(去掉无关前后文),形状与 0.1.5-rc.1 一致。
const FIXTURE = [
  'if (createRestrictedProcess(api, options, buildCommandLine(options.command, options.args), 0, startupInfo, processInfo) === 0) throwWin32(api, "CreateProcessAsUserW");',
  'return spawnJobProcess(api, options, () => inheritedStandardHandles(api), "CreateProcessAsUserW", (startupInfo, processInfo) => createRestrictedProcess(api, options, commandLine, 4, startupInfo, processInfo));',
  'return spawnJobProcess(api, options, () => targetCarrierHandles(api, options.stdio), "CreateProcessW", (startupInfo, processInfo) => api.createProcessW(options.applicationName, commandLine, null, null, 1, 1028, environment, options.cwd, startupInfo, processInfo));',
].join('\n');

test('patchSource: 三处创建标志都按位或上 CREATE_NO_WINDOW', () => {
  const out = patchSource(FIXTURE);
  assert.equal(CREATE_NO_WINDOW, 0x08000000);
  assert.ok(out.includes(`null, null, 1, ${1028 | CREATE_NO_WINDOW} /* ${MARKER}`));
  assert.ok(out.includes(`commandLine, ${4 | CREATE_NO_WINDOW} /* ${MARKER}`));
  assert.ok(out.includes(`options.args), ${0 | CREATE_NO_WINDOW} /* ${MARKER}`));
  assert.equal(out.split(MARKER).length - 1, 3);
  // 原始标志字面量不再残留
  assert.ok(!out.includes(', 1028, environment'));
  assert.ok(!out.includes('commandLine, 4, startupInfo'));
  assert.ok(!out.includes('options.args), 0, startupInfo'));
});

test('patchSource: 幂等,二次变换不改动', () => {
  const once = patchSource(FIXTURE);
  assert.equal(patchSource(once), once);
});

test('patchSource: 锚点缺失即抛错,不静默错过', () => {
  const drifted = FIXTURE.replace(', 1028, environment', ', 1029, environment');
  assert.throws(() => patchSource(drifted), /current-token Job/);
});

test('patchSource: 对已安装的 dsh-win32-process 产物可打或已打', () => {
  const target = path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-win32-process', 'lib', 'index.js');
  if (!fs.existsSync(target)) return; // 依赖未安装时跳过,不伪造通过
  const source = fs.readFileSync(target, 'utf8');
  const out = patchSource(source);
  assert.equal(out.split(MARKER).length - 1, 3);
});
