import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { killProcessTree } = require('../lib/process-tree.js');

test('killProcessTree: 目标不存在按正常竞态吞掉,不上抛', () => {
  assert.doesNotThrow(() => killProcessTree(999999));
});

test('killProcessTree(win32): taskkill 以 windowsHide 派生,不弹控制台窗口', { skip: process.platform !== 'win32' }, () => {
  // 模块在加载时解构了 spawn,须先替换再重新加载才能拦到调用。
  const cp = require('node:child_process');
  const original = cp.spawn;
  const calls = [];
  cp.spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  };
  const modulePath = require.resolve('../lib/process-tree.js');
  delete require.cache[modulePath];
  try {
    const fresh = require(modulePath);
    fresh.killProcessTree(4242);
  } finally {
    cp.spawn = original;
    delete require.cache[modulePath];
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'taskkill');
  assert.deepEqual(calls[0].args, ['/pid', '4242', '/T', '/F']);
  assert.equal(calls[0].opts.windowsHide, true);
  assert.notEqual(calls[0].opts.detached, true);
});
