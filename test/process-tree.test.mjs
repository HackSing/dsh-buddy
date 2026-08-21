import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { killProcessTree, killProcessTreeAfterGrace, delayedKillCommand } = require('../lib/process-tree.js');

test('delayedKillCommand: 宽限向上取整到秒,pid 强制为数字', () => {
  const { cmd, args } = delayedKillCommand('1234', 800);
  assert.equal(cmd, 'cmd');
  const line = args.join(' ');
  assert.match(line, /timeout \/t 1 \/nobreak/);
  assert.match(line, /taskkill \/pid 1234 \/T \/F/);
});

test('delayedKillCommand: 不足 1s 的宽限也至少等 1s', () => {
  assert.match(delayedKillCommand(42, 1).args.join(' '), /timeout \/t 1/);
  assert.match(delayedKillCommand(42, 2500).args.join(' '), /timeout \/t 3/);
});

test('killProcessTree: 目标不存在按正常竞态吞掉,不上抛', () => {
  assert.doesNotThrow(() => killProcessTree(999999));
});

test('killProcessTreeAfterGrace: 派生路径不抛错即视为接管成功', () => {
  // Windows 会真的派生一个 1s 后自杀的 detached cmd;POSIX 走 SIGTERM 到负 PID(ESRCH 被吞)。
  assert.doesNotThrow(() => killProcessTreeAfterGrace(999999, 1));
});
