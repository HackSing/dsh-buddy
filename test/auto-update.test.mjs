import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isPendingReleaseError } = require('../lib/auto-update.js');

test('发版窗口期:latest.yml 404 被识别', () => {
  // 真实错误文案(v0.2.2 实测弹窗)
  const real =
    'Cannot find latest.yml in the latest release artifacts (https://github.com/HackSing/dsh-buddy/releases/download/v0.3.0/latest.yml): HttpError: 404';
  assert.equal(isPendingReleaseError(real), true);
});

test('发版窗口期:大小写与表述变体', () => {
  assert.equal(isPendingReleaseError('HttpError: 404 ... latest.yml'), true);
  assert.equal(isPendingReleaseError('Cannot find LATEST.YML somewhere'), true);
});

test('非窗口期错误不误判', () => {
  assert.equal(isPendingReleaseError('net::ERR_CONNECTION_TIMED_OUT'), false);
  assert.equal(isPendingReleaseError('HttpError: 404 on some other asset'), false);
  assert.equal(isPendingReleaseError('sha512 mismatch'), false);
});

test('非字符串输入返回 false', () => {
  assert.equal(isPendingReleaseError(undefined), false);
  assert.equal(isPendingReleaseError(null), false);
  assert.equal(isPendingReleaseError(404), false);
});
