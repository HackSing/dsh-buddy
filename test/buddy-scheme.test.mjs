import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  BUDDY_SCHEME,
  BUDDY_INFO_GLOBAL,
  BUDDY_INFO_EVENT,
  BUDDY_ACTIONS,
  parseBuddyAction,
  isBuddySchemeUrl,
} = require('../lib/buddy-scheme.js');

test('parseBuddyAction:动作表内每个 id 都能解析', () => {
  for (const action of BUDDY_ACTIONS) {
    assert.equal(parseBuddyAction(`${BUDDY_SCHEME}://${action}`), action);
  }
});

test('parseBuddyAction:允许结尾斜杠', () => {
  assert.equal(parseBuddyAction('dsh-buddy://check-update/'), 'check-update');
});

test('parseBuddyAction:非本 scheme 返回 null', () => {
  assert.equal(parseBuddyAction('https://check-update'), null);
  assert.equal(parseBuddyAction('https://github.com/HackSing/dsh-buddy/releases'), null);
  assert.equal(parseBuddyAction('dsh-buddy-plus://check-update'), null);
});

test('parseBuddyAction:未知动作返回 null', () => {
  assert.equal(parseBuddyAction('dsh-buddy://foo'), null);
  assert.equal(parseBuddyAction('dsh-buddy://check-update-v2'), null);
  // 动作 id 严格小写:非特殊 scheme 的 hostname 不被 URL 解析器小写化
  assert.equal(parseBuddyAction('dsh-buddy://CHECK-UPDATE'), null);
});

test('parseBuddyAction:冒号形式 win:minimize 无法解析(端口语法),返回 null', () => {
  assert.equal(parseBuddyAction('dsh-buddy://win:minimize'), null);
});

test('parseBuddyAction:空 host、带路径、无 // 形式均返回 null', () => {
  assert.equal(parseBuddyAction('dsh-buddy://'), null);
  assert.equal(parseBuddyAction('dsh-buddy://check-update/extra'), null);
  assert.equal(parseBuddyAction('dsh-buddy:check-update'), null);
});

test('parseBuddyAction:非法输入返回 null,不抛', () => {
  assert.equal(parseBuddyAction('not a url'), null);
  assert.equal(parseBuddyAction(''), null);
  assert.equal(parseBuddyAction(undefined), null);
  assert.equal(parseBuddyAction(null), null);
  assert.equal(parseBuddyAction(42), null);
});

test('isBuddySchemeUrl:区分本 scheme(含未知动作)与外部链接', () => {
  assert.equal(isBuddySchemeUrl('dsh-buddy://check-update'), true);
  assert.equal(isBuddySchemeUrl('dsh-buddy://unknown-action'), true);
  assert.equal(isBuddySchemeUrl('https://example.com'), false);
  assert.equal(isBuddySchemeUrl('dsh-buddy:check-update'), false);
  assert.equal(isBuddySchemeUrl(undefined), false);
});

test('动作表完整性:五个动作,无重复,全部小写连字符命名', () => {
  assert.deepEqual([...BUDDY_ACTIONS].sort(), [
    'check-plugin-update',
    'check-update',
    'win-close',
    'win-minimize',
    'win-toggle-maximize',
  ]);
  assert.equal(new Set(BUDDY_ACTIONS).size, BUDDY_ACTIONS.length, '动作 id 不得重复');
  for (const action of BUDDY_ACTIONS) {
    assert.match(action, /^[a-z][a-z-]*$/, `动作 id 必须小写连字符命名: ${action}`);
  }
});

test('契约:壳 dispatch 表覆盖全部 buddy 动作', () => {
  const source = require('node:fs').readFileSync(
    new URL('../lib/frameless-window.js', import.meta.url),
    'utf8',
  );
  for (const action of BUDDY_ACTIONS) {
    assert.ok(
      source.includes(`'${action}':`),
      `frameless-window.js 的 BUDDY_DISPATCH 缺少动作: ${action}`,
    );
  }
});

test('桥常量:注入全局名与事件名为稳定契约', () => {
  assert.equal(BUDDY_INFO_GLOBAL, '__DSH_BUDDY__');
  assert.equal(BUDDY_INFO_EVENT, 'dsh-buddy:info');
});
