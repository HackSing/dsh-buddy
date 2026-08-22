import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LOADING_PAGE_PATH, buildStageScript } = require('../lib/loading-page.js');

// ---- LOADING_PAGE_PATH ----

test('LOADING_PAGE_PATH:指向 lib/loading.html 且文件存在', () => {
  assert.ok(LOADING_PAGE_PATH.endsWith('loading.html'));
  assert.ok(existsSync(LOADING_PAGE_PATH), `加载页缺失: ${LOADING_PAGE_PATH}`);
});

test('loading.html:暴露 __setStage 且阶段元素带无障碍标注', () => {
  const html = readFileSync(LOADING_PAGE_PATH, 'utf8');
  assert.match(html, /window\.__setStage/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
});

// ---- buildStageScript ----

// 在受控上下文里真实执行注入脚本,验证转义与调用语义(而非只看字符串形状)。
const runScript = (script, windowObj) => new Function('window', script)(windowObj);

test('buildStageScript:文案原样送达 __setStage,特殊字符不破坏注入代码', () => {
  const cases = [
    '正在准备内置资产…',
    '带"双引号"与\\反斜杠',
    "带'单引号'与\n换行",
    '</script><b>html 不解析</b>',
  ];
  for (const text of cases) {
    let received = null;
    runScript(buildStageScript(text), { __setStage: (t) => (received = t) });
    assert.equal(received, text);
  }
});

test('buildStageScript:非字符串输入被规范化为字符串', () => {
  let received = null;
  runScript(buildStageScript(42), { __setStage: (t) => (received = t) });
  assert.equal(received, '42');
});

test('buildStageScript:页面尚未定义 __setStage 时静默跳过不抛错', () => {
  assert.doesNotThrow(() => runScript(buildStageScript('x'), {}));
});
