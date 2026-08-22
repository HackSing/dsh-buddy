#!/usr/bin/env node
// c2 L3 开发态运行时验证 runner(startup-loading-window):
// 1. 隔离 DSH_HOME(临时目录,触发完整 profile 解压)+ DSH_URL=127.0.0.1:3180,
//    spawn electron . --remote-debugging-port=9223;
// 2. 轮询 CDP /json:记录 loading.html 页面目标首次出现时刻(t_loading)——
//    即「窗口内容可见」的客观信号,应远早于 dsh 就绪;
// 3. loading 期间 spawn 第二个实例:断言其自行退出(单实例锁),主实例存活
//    (second-instance 聚焦已有窗口的路径被真实触发);
// 4. 继续轮询直至页面目标 URL 切换为 DSH_URL(t_content):断言原地切换发生;
// 5. 全程时间戳落 stdout;结束后 taskkill /T 整树回收并等 exit 事件
//    (win.kill-is-dispatch:派发杀≠杀干净,见 docs/knowledge/windows-async-pitfalls),
//    再重试清理临时 HOME。
// 用法:node docs/acceptance/evidence/startup-loading-window/c2-l3-dev-runtime-windows.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const require_ = createRequire(import.meta.url);
const electronBin = require_(path.join(REPO_ROOT, 'node_modules', 'electron'));

const DSH_URL = 'http://127.0.0.1:3180';
const CDP = 'http://127.0.0.1:9223';
const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets() {
  try {
    const res = await fetch(`${CDP}/json`, { signal: AbortSignal.timeout(1500) });
    return await res.json();
  } catch {
    return null; // 调试端口未起/瞬时不可达:轮询下一轮
  }
}
const pageUrls = (targets) => (targets || []).filter((t) => t.type === 'page').map((t) => t.url);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-buddy-l3-'));
log(`fresh DSH_HOME: ${home}`);

const main = spawn(electronBin, ['.', '--remote-debugging-port=9223'], {
  cwd: REPO_ROOT,
  env: { ...process.env, DSH_HOME: home, DSH_URL },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let mainExited = false;
const mainExit = new Promise((r) => main.on('exit', (code) => { mainExited = true; r(code); }));
main.stdout.on('data', (d) => process.stdout.write(`  [app] ${d}`));
main.stderr.on('data', (d) => process.stdout.write(`  [app:err] ${d}`));
log(`main instance spawned, pid=${main.pid}`);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures += 1;
};

try {
  // ---- 断言1:加载页在 dsh 就绪前早早可见 ----
  let tLoading = null;
  while (Date.now() - t0 < 30000) {
    const urls = pageUrls(await cdpTargets());
    if (urls.some((u) => u.includes('loading.html'))) {
      tLoading = (Date.now() - t0) / 1000;
      break;
    }
    await sleep(200);
  }
  check('loading.html 页面目标出现(窗口内容可见)', tLoading !== null, `t=${tLoading}s`);

  // ---- 断言2:启动期第二实例被单实例锁挡下,主实例存活 ----
  const second = spawn(electronBin, ['.'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DSH_HOME: home, DSH_URL },
    stdio: 'ignore',
  });
  const secondExit = await Promise.race([
    new Promise((r) => second.on('exit', (code) => r({ exited: true, code }))),
    sleep(10000).then(() => ({ exited: false })),
  ]);
  if (!secondExit.exited) second.kill();
  check('第二实例自行退出(单实例锁)', secondExit.exited, `code=${secondExit.code}`);
  check('主实例在二次点击后存活', !mainExited);

  // ---- 断言3:dsh 就绪后加载页原地切换为 dsh 页面 ----
  let tContent = null;
  while (Date.now() - t0 < 240000 && !mainExited) {
    const urls = pageUrls(await cdpTargets());
    if (urls.some((u) => u.startsWith(DSH_URL))) {
      tContent = (Date.now() - t0) / 1000;
      break;
    }
    await sleep(1000);
  }
  check('内容切换到 dsh 页面', tContent !== null, `t=${tContent}s`);
  if (tLoading !== null && tContent !== null) {
    check('加载页先于 dsh 就绪呈现', tLoading < tContent, `${tLoading}s < ${tContent}s`);
    const urls = pageUrls(await cdpTargets());
    check('切换后 loading.html 目标已退场(原地导航而非双窗)', !urls.some((u) => u.includes('loading.html')), urls.join(' | '));
  }
} finally {
  // 整树回收:taskkill 派发后必须等 exit 事件,再清理临时 HOME(重试容忍句柄尾延)
  spawn('taskkill', ['/pid', String(main.pid), '/T', '/F'], { stdio: 'ignore' });
  await Promise.race([mainExit, sleep(15000)]);
  log(`main exited=${mainExited}`);
  for (let i = 0; i < 10; i += 1) {
    try {
      fs.rmSync(home, { recursive: true, force: true });
      break;
    } catch {
      await sleep(500);
    }
  }
  log(`temp home removed=${!fs.existsSync(home)}`);
}

assert.equal(failures, 0, `L3 断言失败 ${failures} 项`);
console.log('L3 PASS');
