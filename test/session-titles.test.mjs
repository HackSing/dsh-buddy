import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { waitForTitlesSettled, untitledSessions, postSessionList } = require('../lib/session-titles.js');

test('untitledSessions: blank/running 不参与,title 非空字符串才算就绪', () => {
  const items = [
    { sessionId: 'titled', projections: { asOfSeq: 9, values: { title: '标题' } } },
    { sessionId: 'null-title', projections: { asOfSeq: 9, values: { title: null } } },
    { sessionId: 'no-proj' },
    { sessionId: 'empty-title', projections: { asOfSeq: 9, values: { title: '' } } },
    { sessionId: 'blank', blank: true },
    { sessionId: 'running', running: true },
  ];
  assert.deepEqual(
    untitledSessions(items).map((i) => i.sessionId),
    ['null-title', 'no-proj', 'empty-title']
  );
});

test('waitForTitlesSettled: 第三轮取数后所有标题就绪则提前返回', async () => {
  const responses = [
    [{ sessionId: 'a' }],
    [{ sessionId: 'a' }],
    [{ sessionId: 'a', projections: { asOfSeq: 3, values: { title: '修好' } } }],
  ];
  let calls = 0;
  const result = await waitForTitlesSettled('http://unused', {
    timeoutMs: 1000,
    intervalMs: 1,
    listFn: async () => responses[Math.min(calls++, responses.length - 1)],
  });
  assert.deepEqual(result, { settled: true, pending: 0 });
  assert.equal(calls, 3);
});

test('waitForTitlesSettled: 超时放行并带最近计数', async () => {
  const result = await waitForTitlesSettled('http://unused', {
    timeoutMs: 30,
    intervalMs: 5,
    listFn: async () => [{ sessionId: 'a' }, { sessionId: 'b' }],
  });
  assert.equal(result.settled, false);
  assert.equal(result.pending, 2);
});

test('waitForTitlesSettled: 请求持续失败也只在超时后放行,并附诊断', async () => {
  const result = await waitForTitlesSettled('http://unused', {
    timeoutMs: 30,
    intervalMs: 5,
    listFn: async () => {
      throw new Error('connection refused');
    },
  });
  assert.equal(result.settled, false);
  assert.equal(result.pending, null);
  assert.equal(result.error, 'connection refused');
});

// 真实 HTTP 回路:验证 unary 信封与 server-response 解析,防信封字段名漂移。
test('postSessionList 走真实 HTTP,信封与响应解析符合 host API 契约', async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/session.list');
    assert.match(String(req.headers['content-type']), /^application\/json/);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(envelope.type, 'client-request');
      assert.equal(envelope.method, 'session.list');
      assert.equal(typeof envelope.rpcId, 'string');
      assert.deepEqual(envelope.payload, {});
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: { items: [{ sessionId: 's1' }] } },
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const items = await postSessionList(`http://127.0.0.1:${server.address().port}`);
  assert.deepEqual(items, [{ sessionId: 's1' }]);
});

test('postSessionList: 业务错误(result.ok=false)抛错而非误当空列表', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'server-response', rpcId: 'x', result: { ok: false, error: { code: 'bad-request' } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  await assert.rejects(() => postSessionList(`http://127.0.0.1:${server.address().port}`), /session\.list rejected/);
});
