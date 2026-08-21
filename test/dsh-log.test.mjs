import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createDshLogger } = require('../lib/dsh-log.js');

function fakeChild() {
  return { stdout: new EventEmitter(), stderr: new EventEmitter() };
}

function tmpLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-log-test-'));
}

test('崩溃路径回归:输出到达后立即已落盘,不依赖事件循环 flush', () => {
  // 真实崩溃路径是 data → exit → showErrorBox(阻塞事件循环)→ app.quit(进程终止),
  // 事件循环在 data 之后再无机会运转。emit 返回后立刻读文件即模拟该时序:
  // 异步写流在此断言下是 0 字节,同步写必须已有全部内容。
  const logger = createDshLogger({ dir: tmpLogDir() });
  const child = fakeChild();
  logger.attach(child);
  child.stdout.emit('data', Buffer.from('boot line\n'));
  child.stderr.emit('data', Buffer.from('crash: fatal\n'));
  assert.equal(fs.readFileSync(logger.path, 'utf8'), 'boot line\ncrash: fatal\n');
  logger.close();
});

test('tail 与落盘同源:弹窗展示的尾部行都能在文件中找到', () => {
  const logger = createDshLogger({ dir: tmpLogDir() });
  const child = fakeChild();
  logger.attach(child);
  child.stdout.emit('data', Buffer.from('line-1\nline-2\n'));
  child.stderr.emit('data', Buffer.from('line-3\n'));
  const onDisk = fs.readFileSync(logger.path, 'utf8');
  const tail = logger.tail(2);
  assert.equal(tail, 'line-2\nline-3');
  for (const line of tail.split('\n')) {
    assert.ok(onDisk.includes(line), `tail 行 ${line} 应已落盘`);
  }
  logger.close();
});

test('目录不可用时不抛,tail 附注写入失败原因', () => {
  // 用文件占住目录路径,使 mkdirSync 失败:日志是诊断增强项,不能反过来搞崩 dsh 启动
  const blocker = path.join(tmpLogDir(), 'not-a-dir');
  fs.writeFileSync(blocker, '');
  let logger;
  assert.doesNotThrow(() => {
    logger = createDshLogger({ dir: blocker });
  });
  const child = fakeChild();
  logger.attach(child);
  assert.doesNotThrow(() => child.stderr.emit('data', Buffer.from('crash: fatal\n')));
  assert.match(logger.tail(), /crash: fatal/);
  assert.match(logger.tail(), /日志文件写入不可用/);
  assert.doesNotThrow(() => logger.close());
});

test('close 幂等,close 后再来输出不抛、内存尾部仍可用', () => {
  const logger = createDshLogger({ dir: tmpLogDir() });
  const child = fakeChild();
  logger.attach(child);
  child.stdout.emit('data', Buffer.from('before close\n'));
  logger.close();
  assert.doesNotThrow(() => logger.close());
  assert.doesNotThrow(() => child.stdout.emit('data', Buffer.from('after close\n')));
  assert.match(logger.tail(), /after close/);
  assert.equal(fs.readFileSync(logger.path, 'utf8'), 'before close\n');
});
