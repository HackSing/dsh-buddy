#!/usr/bin/env node
// c3 L4 打包安装态验证 runner(startup-loading-window):
// 与 plugin-incremental-update/c3-l4-nsis-windows.mjs 的沙盒策略不同,本脚本走
// 「覆盖升级既有安装」的真实用户路径——原始问题(点击无反应 99s)正是覆盖安装后
// 的首次启动;且升级后机器即处于用户 c4 实机确认所需的状态,无需二次安装。
// 因此不需要该脚本的 assertNoExistingInstall 安全阀(我们有意升级现存安装),
// 但完整复用其两条 Windows 异步经验(docs/knowledge/windows-async-pitfalls):
//   1. NSIS 安装完成判定不看主 exe 出现(半成品态),等「卸载器 + 注册表记录」
//      这两个最后阶段产物齐备;
//   2. 进程回收 taskkill 派发后必须等 exit,不得立即断言或删目录。
// 断言:
//   a. 覆盖安装完成(卸载器/注册表就绪,DisplayName 带版本);
//   b. 冷启动打包 exe:loading.html 页面目标出现耗时(目标 ≤2s,实测值入证据);
//   c. loading 期间二次启动 exe:第二实例自行退出,主实例存活;
//   d. dsh 就绪后原地切换到 http://127.0.0.1:3080,loading 目标退场;
//   e. 热启动(同文件二次冷杀后再启,Defender 已扫描):loading 可见耗时——
//      日常点击场景的真实数字,冷启动含 Defender 首扫属安装后一次性成本;
//   f. 失败路径:runner 预占端口并回 503(isDshServing 拒绝 5xx 之外还需
//      status<500,503 → 未就绪 → 壳 spawn dsh → EADDRINUSE 退出 → 错误对话框)。
//      首版曾用「DSH_URL 指向端口 9」构造失败,实测无效:Windows 与 POSIX 不同,
//      非管理员也能绑 1024 以下端口,dsh 在端口 9 正常起服,失败前提不成立。
//      原生错误对话框无法自动点击,断言止于「不切换内容 + 进程存活」,属已知边界。
// 用法:node docs/acceptance/evidence/startup-loading-window/c3-l4-install-launch-windows.mjs <Setup.exe>
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');

const INSTALL_DIR = 'D:\\Project\\dsh-buddy-verify-install\\DSH Buddy';
const EXE_NAME = 'DSH Buddy.exe';
const UNINSTALLER = 'Uninstall DSH Buddy.exe';
const DSH_URL = 'http://127.0.0.1:3080'; // 打包态默认端口,启动前断言未被占用
const CDP_PORT = 9224;
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const setupExe = path.resolve(process.argv[2] || '');
assert.ok(fs.existsSync(setupExe), `安装包不存在: ${setupExe}`);

const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const log = (msg) => console.log(`[${now().toFixed(1)}s] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures += 1;
};

function powershell(script) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  return { code: r.status, text: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

// HKCU 卸载记录:InstallLocation 恒为空(实证),判据只用 DisplayName/UninstallString
function registryEntry() {
  const r = powershell(
    "Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' -ErrorAction SilentlyContinue |" +
      ' ForEach-Object { $p = Get-ItemProperty $_.PSPath;' +
      " if ($p.DisplayName -like 'DSH Buddy*') { $p.DisplayName + '|' + $p.UninstallString } }"
  );
  return r.text;
}

async function cdpPageUrls() {
  try {
    const res = await fetch(`${CDP}/json`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).filter((t) => t.type === 'page').map((t) => t.url);
  } catch {
    return null;
  }
}

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status;
  } catch {
    return null;
  }
}

// 拉起一个打包实例并返回 {proc, exited(), exitPromise};stdio 全捐弃(GUI 应用)
function launchApp(args = [], env = {}) {
  const proc = spawn(path.join(INSTALL_DIR, EXE_NAME), args, {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: false,
  });
  let exited = false;
  const exitPromise = new Promise((r) => proc.on('exit', (code) => { exited = true; r(code); }));
  return { proc, exited: () => exited, exitPromise };
}

async function killTreeAndWait(proc, exitPromise) {
  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  await Promise.race([exitPromise, sleep(15000)]);
}

// ==== 阶段 1:覆盖安装 ====
log(`registry before: ${registryEntry() || '(none)'}`);
{
  const r = spawnSync(setupExe, ['/S', `/D=${INSTALL_DIR}`], { encoding: 'utf8' });
  assert.ok(!r.error, `安装器无法执行: ${r.error && r.error.message}`);
  // 安装完成判定:等最后阶段产物(卸载器 + 注册表记录),不以主 exe 出现为准
  const deadline = Date.now() + 180_000;
  let done = false;
  while (Date.now() < deadline) {
    if (fs.existsSync(path.join(INSTALL_DIR, UNINSTALLER)) && registryEntry().includes('DSH Buddy')) {
      done = true;
      break;
    }
    await sleep(500);
  }
  check('覆盖安装完成(卸载器+注册表就绪)', done, registryEntry());
  check('主程序落位', fs.existsSync(path.join(INSTALL_DIR, EXE_NAME)));
}

// ==== 阶段 2:冷启动计时 + 二次点击 + 原地切换 ====
{
  check('启动前 3080 未被占用', (await probe(DSH_URL)) === null);
  const tLaunch = now();
  const main = launchApp([`--remote-debugging-port=${CDP_PORT}`]);
  log(`packaged app spawned, pid=${main.proc.pid}`);

  let tLoading = null;
  while (now() - tLaunch < 30 && !main.exited()) {
    const urls = await cdpPageUrls();
    if (urls && urls.some((u) => u.includes('loading.html'))) {
      tLoading = now() - tLaunch;
      break;
    }
    await sleep(150);
  }
  check('冷启动 loading.html 可见(点击→窗口,含 Defender 首扫)', tLoading !== null, `t=${tLoading && tLoading.toFixed(2)}s`);

  const second = launchApp();
  const secondOutcome = await Promise.race([
    second.exitPromise.then((code) => ({ exited: true, code })),
    sleep(10000).then(() => ({ exited: false })),
  ]);
  if (!secondOutcome.exited) second.proc.kill();
  check('启动期二次点击:第二实例自行退出', secondOutcome.exited, `code=${secondOutcome.code}`);
  check('主实例存活', !main.exited());

  let tContent = null;
  while (now() - tLaunch < 240 && !main.exited()) {
    const urls = await cdpPageUrls();
    if (urls && urls.some((u) => u.startsWith(DSH_URL))) {
      tContent = now() - tLaunch;
      break;
    }
    await sleep(1000);
  }
  check('原地切换到 dsh 页面', tContent !== null, `t=${tContent && tContent.toFixed(1)}s`);
  if (tContent !== null) {
    const urls = await cdpPageUrls();
    check('切换后 loading 目标退场', !(urls || []).some((u) => u.includes('loading.html')), (urls || []).join(' | '));
  }
  await killTreeAndWait(main.proc, main.exitPromise);
  check('回收后主实例已退出', main.exited());
}

// ==== 阶段 2b:热启动计时(Defender 已扫描,日常点击场景) ====
{
  // 等上一实例的 dsh 树完全消亡(taskkill 派发即返回,进程树归零约 512ms,给足余量)
  await sleep(3000);
  const tLaunch = now();
  const warm = launchApp([`--remote-debugging-port=${CDP_PORT}`]);
  let tLoading = null;
  while (now() - tLaunch < 30 && !warm.exited()) {
    const urls = await cdpPageUrls();
    if (urls && urls.some((u) => u.includes('loading.html'))) {
      tLoading = now() - tLaunch;
      break;
    }
    await sleep(150);
  }
  check('热启动 loading.html 可见', tLoading !== null, `t=${tLoading && tLoading.toFixed(2)}s`);
  check('热启动点击→窗口 ≤2s', tLoading !== null && tLoading <= 2, `t=${tLoading && tLoading.toFixed(2)}s`);
  await killTreeAndWait(warm.proc, warm.exitPromise);
  check('热启动实例回收', warm.exited());
}

// ==== 阶段 3:失败路径(dsh 起不来:端口被 503 服务预占 → EADDRINUSE) ====
{
  await sleep(3000);
  const BAD_PORT = 3199;
  const blocker = http.createServer((_, res) => {
    res.statusCode = 503;
    res.end('blocked');
  });
  await new Promise((r) => blocker.listen(BAD_PORT, '127.0.0.1', r));
  const bad = launchApp([`--remote-debugging-port=${CDP_PORT}`], {
    DSH_URL: `http://127.0.0.1:${BAD_PORT}`,
  });
  let sawLoading = false;
  let switched = false;
  const tBad = now();
  while (now() - tBad < 45 && !bad.exited()) {
    const urls = await cdpPageUrls();
    if (urls && urls.some((u) => u.includes('loading.html'))) sawLoading = true;
    if (urls && urls.some((u) => u.startsWith(`http://127.0.0.1:${BAD_PORT}`))) {
      switched = true;
      break;
    }
    await sleep(1000);
  }
  check('失败路径仍先出加载窗口', sawLoading);
  check('失败路径不切换内容(503 预占端口,dsh EADDRINUSE)', !switched);
  check('失败路径进程存活(错误对话框挂起态)', !bad.exited());
  await killTreeAndWait(bad.proc, bad.exitPromise);
  check('强杀后无进程残留', bad.exited());
  blocker.close();
  const leftovers = powershell("Get-Process 'DSH Buddy' -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count").text;
  check('全部 DSH Buddy 进程归零', leftovers === '0', `count=${leftovers}`);
}

assert.equal(failures, 0, `L4 断言失败 ${failures} 项`);
console.log('L4 PASS');
