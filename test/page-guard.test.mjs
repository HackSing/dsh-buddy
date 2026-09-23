import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { attachPageGuard, createReloadGovernor, extractBootRev } = require('../lib/page-guard.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 与线上 dsh 首页一致的 __DSH_BOOT__ 形状(rev 在前,entries 内含各插件自己的 rev)
const bootHtml = (rev) =>
  `<!doctype html><html><head><script>globalThis["__DSH_BOOT__"] = {"rev":"${rev}",` +
  `"entries":[{"id":"@deepseek-ai/dsh-typert-registry","url":"/plugins/x/client.js?rev=f41d56e0b747",` +
  `"rev":"f41d56e0b747","inject":[],"immediately":true}]};</script></head><body></body></html>`;

// 假 WebContents:EventEmitter + 守护消费的三个查询方法;loading 可由测试拨动
function fakeContents() {
  const c = new EventEmitter();
  c.loading = false;
  c.destroyed = false;
  c.isLoading = () => c.loading;
  c.isDestroyed = () => c.destroyed;
  return c;
}

// 通用装配:永放行 governor + 记录 refresh/log,单测不落盘、不依赖 electron
function harness({ rev = 'aaaa', probeImpl, governor } = {}) {
  const contents = fakeContents();
  const state = { rev, refreshes: 0, lines: [] };
  const guard = attachPageGuard({
    contents,
    refresh: () => {
      state.refreshes += 1;
    },
    url: 'http://127.0.0.1:9/',
    log: (line) => state.lines.push(line),
    probe: probeImpl ?? (async () => ({ status: 200, body: bootHtml(state.rev) })),
    intervalMs: 15,
    unresponsiveGraceMs: 25,
    governor: governor ?? { allow: () => true },
  });
  return { contents, state, guard };
}

// ---- extractBootRev ----

test('extractBootRev:从真实形状的首页提取顶层 rev,不误取 entries 里的插件 rev', () => {
  assert.equal(extractBootRev(bootHtml('6a7c7b7b96e6')), '6a7c7b7b96e6');
});

test('extractBootRev:无标记/形状不符/非字符串返回 null', () => {
  assert.equal(extractBootRev('<html>no boot here</html>'), null);
  assert.equal(extractBootRev('__DSH_BOOT__ but no assignment'), null);
  assert.equal(extractBootRev(null), null);
  assert.equal(extractBootRev(undefined), null);
});

// ---- createReloadGovernor ----

test('governor:最小间隔内拒绝,拒绝不消耗名额', () => {
  let t = 0;
  const g = createReloadGovernor({ minIntervalMs: 100, maxPerWindow: 10, windowMs: 10000, now: () => t });
  assert.equal(g.allow(), true);
  t = 50;
  assert.equal(g.allow(), false);
  t = 100;
  assert.equal(g.allow(), true); // 拒绝未记账,间隔相对上次放行(t=0)计算
});

test('governor:滑动窗口内超过 maxPerWindow 拒绝,窗口滑走后恢复', () => {
  let t = 0;
  const g = createReloadGovernor({ minIntervalMs: 0, maxPerWindow: 3, windowMs: 1000, now: () => t });
  assert.equal(g.allow(), true);
  t = 10;
  assert.equal(g.allow(), true);
  t = 20;
  assert.equal(g.allow(), true);
  t = 30;
  assert.equal(g.allow(), false);
  t = 1015; // 前三次全部滑出窗口
  assert.equal(g.allow(), true);
});

// ---- attachPageGuard:事件路径 ----

test('render-process-gone(crashed)触发恢复;clean-exit 不触发', async () => {
  const { contents, state, guard } = harness();
  contents.emit('render-process-gone', {}, { reason: 'clean-exit' });
  assert.equal(state.refreshes, 0);
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(state.refreshes, 1);
  assert.ok(state.lines.some((l) => l.includes('render process gone (crashed)')));
  guard.dispose();
});

test('did-fail-load:仅主帧且非 ERR_ABORTED 触发恢复', async () => {
  const { contents, state, guard } = harness();
  contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://x/', false); // 子帧
  contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'http://x/', true); // 主动取消
  assert.equal(state.refreshes, 0);
  contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://x/', true);
  assert.equal(state.refreshes, 1);
  guard.dispose();
});

test('unresponsive:宽限内 responsive 回来不恢复;超宽限恢复', async () => {
  const { contents, state, guard } = harness();
  contents.emit('unresponsive');
  contents.emit('responsive'); // 宽限内自愈
  await sleep(60);
  assert.equal(state.refreshes, 0);
  contents.emit('unresponsive');
  await sleep(60); // 超过 25ms 宽限
  assert.equal(state.refreshes, 1);
  assert.ok(state.lines.some((l) => l.includes('stayed unresponsive')));
  guard.dispose();
});

// ---- attachPageGuard:代际探测 ----

test('代际更替:did-finish-load 对齐基线,rev 变化触发一次恢复,再次加载后静默', async () => {
  const { contents, state, guard } = harness({ rev: 'aaaa' });
  contents.emit('did-finish-load');
  await sleep(40);
  assert.ok(state.lines.some((l) => l.includes('baseline rev aaaa')));
  assert.equal(state.refreshes, 0); // 基线对齐不是恢复

  state.rev = 'bbbb';
  // 让 refresh 表现为「开始加载」:tick 在 isLoading 期间必须停手
  const stopAt = state.refreshes;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (state.refreshes > stopAt) {
        contents.loading = true;
        clearInterval(iv);
        resolve();
      }
    }, 5);
  });
  assert.equal(state.refreshes, 1);
  assert.ok(state.lines.some((l) => l.includes('server generation changed (aaaa -> bbbb)')));

  await sleep(50); // 加载期间不得重复恢复
  assert.equal(state.refreshes, 1);

  contents.loading = false;
  contents.emit('did-finish-load'); // 新页面完成,基线对齐 bbbb
  await sleep(50);
  assert.equal(state.refreshes, 1); // 对齐后静默
  assert.ok(state.lines.some((l) => l.includes('baseline rev bbbb')));
  guard.dispose();
});

test('页面死亡后服务回来:即使 rev 未变也持续重试恢复,直到加载成功', async () => {
  const { contents, state, guard } = harness({ rev: 'aaaa' });
  contents.emit('did-finish-load');
  await sleep(40);
  contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://x/', true);
  assert.equal(state.refreshes, 1); // 失败即时恢复一次
  await sleep(40); // 探测发现服务可达且页面仍死 → 再试
  assert.ok(state.refreshes >= 2, `expected retries, got ${state.refreshes}`);
  assert.ok(state.lines.some((l) => l.includes('server reachable while page is broken')));
  const before = state.refreshes;
  contents.emit('did-finish-load'); // 恢复成功,死亡标记清除
  await sleep(50);
  assert.equal(state.refreshes, before);
  guard.dispose();
});

test('服务不可达:不触发恢复动作', async () => {
  const { contents, state, guard } = harness({ probeImpl: async () => null });
  contents.emit('did-finish-load');
  await sleep(50);
  assert.equal(state.refreshes, 0);
  guard.dispose();
});

// ---- 风暴抑制与卸载 ----

test('governor 拒绝时不恢复,抑制日志只记一次', async () => {
  const { contents, state, guard } = harness({ governor: { allow: () => false } });
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  contents.emit('render-process-gone', {}, { reason: 'oom' });
  assert.equal(state.refreshes, 0);
  assert.equal(state.lines.filter((l) => l.includes('suppressed')).length, 1);
  guard.dispose();
});

test('dispose 后事件与探测均不再动作;contents destroyed 自动 dispose', async () => {
  const { contents, state, guard } = harness({ rev: 'aaaa' });
  guard.dispose();
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  state.rev = 'bbbb';
  await sleep(50);
  assert.equal(state.refreshes, 0);

  const second = harness({ rev: 'cccc' });
  second.contents.emit('destroyed');
  second.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(second.state.refreshes, 0);
});
