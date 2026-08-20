import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { overlayViewModel, formatMB, OVERLAY_STAGE } = require('../lib/update-overlay.js');

test('formatMB:正常/边界/非法输入', () => {
  assert.equal(formatMB(0), '0.0');
  assert.equal(formatMB(246.2 * 1024 * 1024), '246.2');
  assert.equal(formatMB(-1), null);
  assert.equal(formatMB(NaN), null);
  assert.equal(formatMB(undefined), null);
});

test('downloading:百分比钳制在 0-100,标题带整数百分比', () => {
  const model = overlayViewModel({
    stage: OVERLAY_STAGE.downloading,
    progress: { percent: 45.6, transferred: 112 * 1024 * 1024, total: 246 * 1024 * 1024, bytesPerSecond: 1.3 * 1024 * 1024 },
  });
  assert.equal(model.title, '正在下载更新 46%');
  assert.equal(model.detail, '112.0 / 246.0 MB · 1.3 MB/s');
  assert.equal(model.percent, 45.6);
  assert.equal(model.canRetry, false);
});

test('downloading:percent 越界被钳制', () => {
  const over = overlayViewModel({ stage: OVERLAY_STAGE.downloading, progress: { percent: 140 } });
  assert.equal(over.percent, 100);
  const under = overlayViewModel({ stage: OVERLAY_STAGE.downloading, progress: { percent: -5 } });
  assert.equal(under.percent, 0);
});

test('downloading:progress 字段缺失时降级,不抛错', () => {
  const model = overlayViewModel({ stage: OVERLAY_STAGE.downloading, progress: null });
  assert.equal(model.percent, 0);
  assert.equal(model.detail, '');
  const partial = overlayViewModel({ stage: OVERLAY_STAGE.downloading, progress: { percent: 10 } });
  assert.equal(partial.detail, '');
});

test('error:可重试,超长错误文案被截断', () => {
  const long = 'x'.repeat(200);
  const model = overlayViewModel({ stage: OVERLAY_STAGE.error, errorMessage: long });
  assert.equal(model.canRetry, true);
  assert.equal(model.title, '更新下载失败');
  assert.ok(model.detail.length === 121); // 120 + 省略号
  assert.ok(model.detail.endsWith('…'));
});

test('error:无 message 时有兜底文案', () => {
  const model = overlayViewModel({ stage: OVERLAY_STAGE.error });
  assert.equal(model.detail, 'unknown error');
});

test('hidden:空模型,不重试', () => {
  const model = overlayViewModel({ stage: OVERLAY_STAGE.hidden });
  assert.equal(model.stage, 'hidden');
  assert.equal(model.title, '');
  assert.equal(model.canRetry, false);
});

test('locale:en 文案与未知 locale 回退 en', () => {
  const en = overlayViewModel({ stage: OVERLAY_STAGE.error, locale: 'en', errorMessage: 'boom' });
  assert.equal(en.title, 'Update download failed');
  assert.equal(en.retryLabel, 'Retry');
  const fr = overlayViewModel({ stage: OVERLAY_STAGE.error, locale: 'fr', errorMessage: 'boom' });
  assert.equal(fr.title, 'Update download failed');
});
