import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AUTH_COOKIE_PREFIX,
  launchTokenFrom,
  authenticatedUrl,
  waitForLaunchToken,
  exchangeAuthCookie,
} = require('../lib/dsh-browser-auth.js');

// 启动行的真实形状取自 dsh 0.1.5-rc.1:同前缀还有一行非 URL 的提示语,
// 开 LAN 时 URL 后面还跟 ` (LAN: <url>)`,解析不能靠行序或行尾假设。
test('launchTokenFrom: 从启动行取 token,非 URL 的同前缀行不干扰', () => {
  const log = [
    'dsh web: opening the default browser; pass --no-open to disable',
    'dsh web: http://127.0.0.1:51271/?token=O0VeQGE1cl8l9KD7jwt',
  ].join('\n');
  assert.equal(launchTokenFrom(log), 'O0VeQGE1cl8l9KD7jwt');
});

test('launchTokenFrom: LAN 变体取本机那一个 token', () => {
  const log = 'dsh web: http://127.0.0.1:51271/?token=local (LAN: http://192.168.1.9:51271/?token=lan)';
  assert.equal(launchTokenFrom(log), 'local');
});

test('launchTokenFrom: 没有 token 返回 null', () => {
  assert.equal(launchTokenFrom('dsh web: http://127.0.0.1:51271/'), null);
  assert.equal(launchTokenFrom(''), null);
});

test('authenticatedUrl: 无 token 原样返回,有 token 挂到 query', () => {
  assert.equal(authenticatedUrl('http://127.0.0.1:3080', null), 'http://127.0.0.1:3080');
  assert.equal(authenticatedUrl('http://127.0.0.1:3080', ''), 'http://127.0.0.1:3080');
  assert.equal(authenticatedUrl('http://127.0.0.1:3080', 'T0k'), 'http://127.0.0.1:3080/?token=T0k');
});

test('waitForLaunchToken: 子进程打印启动行后拿到 token', async () => {
  const child = spawn(process.execPath, [
    '-e',
    "console.log('boot noise');console.log('dsh web: http://127.0.0.1:1/?token=FROMCHILD');setTimeout(()=>{},300)",
  ]);
  child.stdout.on('data', () => {}); // 另有消费者时也不能互相抢数据(壳里 dshLog 同时在听)
  assert.equal(await waitForLaunchToken(child, { timeoutMs: 5000 }), 'FROMCHILD');
  child.kill();
});

test('waitForLaunchToken: 进程没打印就退出则返回 null', async () => {
  const child = spawn(process.execPath, ['-e', "process.exit(1)"]);
  assert.equal(await waitForLaunchToken(child, { timeoutMs: 5000 }), null);
});

test('waitForLaunchToken: 超时返回 null 而不是挂住', async () => {
  const child = spawn(process.execPath, ['-e', "setTimeout(()=>{},3000)"]);
  assert.equal(await waitForLaunchToken(child, { timeoutMs: 120 }), null);
  child.kill();
});

// 授权门的真实回路:303 + set-cookie 才算换成功,返回值要能直接当 Cookie 头用
// (属性段不能带进去)。
test('exchangeAuthCookie: 303 带 set-cookie 时返回 name=value', async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/?token=T0k');
    res.writeHead(303, {
      location: '/',
      'set-cookie': `${AUTH_COOKIE_PREFIX}abc=v1.signed; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`,
    });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const cookie = await exchangeAuthCookie(`http://127.0.0.1:${server.address().port}`, 'T0k');
  assert.equal(cookie, `${AUTH_COOKIE_PREFIX}abc=v1.signed`);
});

test('exchangeAuthCookie: token 不对(401)抛错,不静默返回空', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(401);
    res.end('unauthorized');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  await assert.rejects(
    () => exchangeAuthCookie(`http://127.0.0.1:${server.address().port}`, 'bad'),
    /HTTP 401/
  );
});

test('exchangeAuthCookie: 连不上时抛错', async () => {
  await assert.rejects(() => exchangeAuthCookie('http://127.0.0.1:1', 'T0k'));
});
