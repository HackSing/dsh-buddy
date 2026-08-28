import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { killProcessTree } = require('../lib/process-tree.js');

test('killProcessTree: 目标不存在按正常竞态吞掉,不上抛', () => {
  assert.doesNotThrow(() => killProcessTree(999999));
});
