import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repairAll } from '../plugins/dsh-buddy-title-repair/index.js';

// 假 ctx:ctx.get 按名取服务,ctx.sessions.get 模拟活跃会话表。
// metas 形如 [{ id, cwd, title, live, coldError }] —— title 为 undefined
// 表示缓存里没有该会话的标题行,null 表示行在但标题为 null。
function fakeCtx(metas, { onCold } = {}) {
  const live = new Set(metas.filter((m) => m.live).map((m) => m.id));
  const services = {
    sessionProjectionCache: {
      cachedSnapshot(meta) {
        const row = metas.find((m) => m.id === meta.id);
        if (row.title === undefined) return undefined;
        return { asOfSeq: 10, values: { title: row.title } };
      },
      async coldSnapshot(id) {
        const row = metas.find((m) => m.id === id);
        if (row.coldError) throw new Error(row.coldError);
        onCold?.(id);
        return { asOfSeq: 20, values: { title: row.title ?? null } };
      },
    },
    sessionPersistence: {
      async list() {
        return metas.map((m) => ({ id: m.id, ...(m.cwd === undefined ? {} : { cwd: m.cwd }) }));
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
  const ctx = fakeCtx([
    { id: 'bad', cwd: '/a', coldError: 'corrupt log' },
    { id: 'good', cwd: '/a' },
  ]);
  const summary = await repairAll(ctx, () => false);
  assert.equal(summary.repaired, 1); // good 仍被修复
});

test('disposal mid-pass stops the iteration', async () => {
  const ctx = fakeCtx([{ id: 'a', cwd: '/x' }, { id: 'b', cwd: '/x' }]);
  const summary = await repairAll(ctx, () => true);
  assert.equal(summary, null);
});
