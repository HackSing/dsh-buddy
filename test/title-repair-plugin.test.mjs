import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repairAll } from '../plugins/dsh-buddy-title-repair/index.js';

// 假 ctx:ctx.get 按名取服务,ctx.sessions.get 模拟活跃会话表。
// metas 形如 [{ id, cwd, title, live, coldError }] —— title 为 undefined
// 表示缓存里没有该会话的标题行,null 表示行在但标题为 null。
//
// 各桩按 dsh 0.1.5-rc.1 的真实形状搭,并对参数形状下断言——上一轮升级正是
// 因为桩停留在旧形状(list() 给裸 meta、coldSnapshot 收 id)而让插件在真机上
// 静默空转:list() 返回 { header, revision },cachedSnapshot 收
// (header, inheritedEventCount),coldSnapshot 收 (header, inheritedEventCount, events)
// 且自己不读持久层,整份日志由调用方经 persistence.open/read 取。
function fakeCtx(metas, { onCold } = {}) {
  const live = new Set(metas.filter((m) => m.live).map((m) => m.id));
  const rowOf = (id) => metas.find((m) => m.id === id);
  const services = {
    sessionProjectionCache: {
      cachedSnapshot(header, inheritedEventCount) {
        assert.equal(typeof header, 'object', 'cachedSnapshot 第一参必须是 header 对象而非 id');
        assert.equal(inheritedEventCount, 0, 'cachedSnapshot 必须带继承前缀长度');
        const row = rowOf(header.id);
        if (row.title === undefined) return undefined;
        return { asOfSeq: 10, values: { title: row.title } };
      },
      coldSnapshot(header, inheritedEventCount, events) {
        assert.equal(typeof header, 'object', 'coldSnapshot 第一参必须是 header 对象而非 id');
        assert.equal(inheritedEventCount, 0);
        assert.ok(Array.isArray(events), 'coldSnapshot 必须由调用方把整份日志交进来');
        const row = rowOf(header.id);
        onCold?.(header.id);
        return { asOfSeq: 20, values: { title: row.title ?? null } };
      },
    },
    sessionPersistence: {
      async list() {
        return metas.map((m) => ({
          header: { id: m.id, version: 1, createdAt: 0, isSeeded: false, ...(m.cwd === undefined ? {} : { cwd: m.cwd }) },
          revision: 1,
        }));
      },
      async open(id) {
        const row = rowOf(id);
        return {
          header: { id, version: 1, createdAt: 0, isSeeded: false, ...(row.cwd === undefined ? {} : { cwd: row.cwd }) },
          inheritedEventCount: 0,
          // coldError 落在读日志上(而不是开句柄上):这条才是 readColdSessionLog
          // 真正会炸的地方,也才走到插件的 warn-and-continue 分支。
          async read() {
            if (row.coldError) throw new Error(row.coldError);
            return { events: [], eventState: {} };
          },
          async close() {},
        };
      },
    },
  };
  return {
    sessions: { get: (id) => (live.has(id) ? { id } : undefined) },
    logger: { warn() {}, info() {} },
    get(name) {
      return services[name];
    },
  };
}

test('repairs only cold sessions with a missing or null title', async () => {
  const repaired = [];
  const ctx = fakeCtx(
    [
      { id: 'titled', cwd: '/a', title: '已有标题' },
      { id: 'null-title', cwd: '/a', title: null },
      { id: 'no-row', cwd: '/a' },
      { id: 'live', cwd: '/a', live: true },
      { id: 'no-cwd' },
    ],
    { onCold: (id) => repaired.push(id) }
  );
  const summary = await repairAll(ctx, () => false);
  assert.deepEqual(repaired.sort(), ['no-row', 'null-title']);
  assert.equal(summary.scanned, 5);
  assert.equal(summary.repaired, 2);
});

test('a failing cold read is contained and reported, not fatal', async () => {
  const warned = [];
  const ctx = fakeCtx([
    { id: 'bad', cwd: '/a', coldError: 'corrupt log' },
    { id: 'good', cwd: '/a' },
  ]);
  ctx.logger.warn = (message) => warned.push(message);
  const summary = await repairAll(ctx, () => false);
  assert.equal(summary.repaired, 1); // good 仍被修复
  assert.equal(warned.length, 1);
  assert.match(warned[0], /cold read failed for "bad": .*corrupt log/);
});

test('disposal mid-pass stops the iteration', async () => {
  const ctx = fakeCtx([{ id: 'a', cwd: '/x' }, { id: 'b', cwd: '/x' }]);
  const summary = await repairAll(ctx, () => true);
  assert.equal(summary, null);
});
