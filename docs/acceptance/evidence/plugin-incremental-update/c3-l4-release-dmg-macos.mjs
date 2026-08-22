#!/usr/bin/env node
// 验收 c3(L4 打包安装态)的真实复现,macOS 版。
//
// 取代原 Windows 版记录 acc-20260820T133529-8ec011219f:该记录的证据
// build/pack-v030.log 与 build/l4-boot.log 都写在 .gitignore 覆盖的 build/ 下,
// 从未进 git,本地清理后彻底失效(assets-check 因此长期 FAIL)。本脚本连同
// 其日志一并提交进 docs/acceptance/evidence/,不再重蹈覆辙。
//
// 与原记录相比,验证对象从「本地 --dir 打包产物」升级为「GitHub Release 上
// 用户真正下载的 dmg」——L4 要证的就是打包安装态,拿发布产物验最有说服力。
//
// 覆盖:dmg 挂载 → 代码签名有效性 → 安装到隔离位置 → 隔离沙盒首次启动
// (独立 DSH_HOME + 独立 userData + 独立端口,与用户真实环境无交集)→
// 随包 profile 装齐 manifest 全部插件 → 内嵌 dsh HTTP 200 → 进程树回收干净。
// 增量热更链路本身由 c2 的 L3 真实运行时三场景覆盖,此处不重复。
//
// 用法: node c3-l4-release-dmg-macos.mjs <path-to.dmg> 2>&1 | tee c3-l4-release-dmg-macos.log

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..'); // evidence/<name>/ → acceptance → docs → repo

const { readProfileDeps } = require_(path.join(REPO_ROOT, 'lib/bundled-profile.js'));
const { waitForHttp } = require_(path.join(REPO_ROOT, 'lib/http-probe.js'));
const { killProcessTree } = require_(path.join(REPO_ROOT, 'lib/process-tree.js'));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'plugins/preinstall-manifest.json'), 'utf8'));
const EXPECTED_PACKAGES = MANIFEST.packages.map((p) => p.name);
const PROFILE = 'web';
const PORT = 3097; // 避开默认 3080 与用户可能自起的实例
const DSH_URL = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 120_000; // 首次启动含解包随包资产,给足余量

let failures = 0;
function assert(cond, label, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

// codesign 把详情写 stderr 且退出码随子命令而变,统一用 spawnSync 取两路输出。
function runCapture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status, text: `${r.stdout || ''}${r.stderr || ''}` };
}

// ---- IO:dmg 挂载 ----

function mountDmg(dmgPath) {
  const out = sh('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly']);
  const line = out.split('\n').find((l) => l.includes('/Volumes/'));
  if (!line) throw new Error(`hdiutil attach 未返回挂载点:\n${out}`);
  const mountPoint = line.slice(line.indexOf('/Volumes/')).trim();
  const app = fs.readdirSync(mountPoint).find((n) => n.endsWith('.app'));
  if (!app) throw new Error(`挂载卷内没有 .app: ${mountPoint}`);
  return { mountPoint, appPath: path.join(mountPoint, app) };
}

function detachDmg(mountPoint) {
  const first = spawnSync('hdiutil', ['detach', mountPoint, '-quiet']);
  if (first.status !== 0) {
    // 有句柄未释放时强制卸载;仍失败则抛出,避免留下挂载点污染后续运行
    const forced = spawnSync('hdiutil', ['detach', mountPoint, '-force', '-quiet'], { encoding: 'utf8' });
    if (forced.status !== 0) throw new Error(`dmg 卸载失败: ${forced.stderr || forced.stdout}`);
  }
}

// ---- 校验:代码签名 ----

// 本次修复的核心断言:v0.4.0 及更早在 --verify 处报
// "code has no resources but signature indicates they must be present"。
function verifySignature(appPath) {
  const detail = runCapture('codesign', ['-dv', '--verbose=2', appPath]).text;
  const identifier = /Identifier=(\S+)/.exec(detail)?.[1] ?? '(未知)';
  const flags = /flags=(\S+)/.exec(detail)?.[1] ?? '(未知)';
  const sealed = /Sealed Resources[^\n]*/.exec(detail)?.[0] ?? '(无资源封印)';
  console.log(`  Identifier=${identifier}`);
  console.log(`  flags=${flags}`);
  console.log(`  ${sealed}`);
  assert(identifier === 'com.dshbuddy.app', 'bundle 标识为 com.dshbuddy.app(非 Electron 出厂值)', identifier);
  assert(/runtime/.test(flags), 'hardenedRuntime 生效(签名 flags 含 runtime 位)', flags);
  assert(/Sealed Resources version=\d+/.test(sealed), '资源封印已生成', sealed);

  const verify = runCapture('codesign', ['--verify', '--deep', '--strict', appPath]);
  assert(verify.code === 0, 'codesign --verify --deep --strict 通过', verify.text.trim() || 'exit 0');

  // Apple 官方分发预检:ad-hoc 未公证必然不通过,但 Codesign Error 必须已消失
  const policy = runCapture('/usr/bin/syspolicy_check', ['distribution', appPath]);
  const hasCodesignError = /Codesign Error/.test(policy.text);
  assert(!hasCodesignError, 'syspolicy_check 无 Codesign Error(不再被判「已损坏」)');
  console.log(`  syspolicy_check 剩余项: ${(policy.text.match(/^\S.*$/gm) || []).filter((l) => /Severity|Adhoc|Notary/.test(l)).join(' | ') || '(无)'}`);
}

// ---- IO:隔离沙盒启动 ----

// detached:true 让子进程自成进程组——killProcessTree 在 POSIX 上走
// process.kill(-pid),没有这一项回收会直接失效。
function launchIsolated(appPath, sandbox) {
  const exe = path.join(appPath, 'Contents', 'MacOS', 'DSH Buddy');
  const child = spawn(exe, [`--user-data-dir=${path.join(sandbox, 'electron-data')}`], {
    env: { ...process.env, DSH_HOME: path.join(sandbox, 'dsh-home'), DSH_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', (b) => process.stdout.write(`  [app] ${b}`));
  child.stderr.on('data', (b) => process.stdout.write(`  [app!] ${b}`));
  return child;
}

function checkBundledProfile(sandbox) {
  const profileDir = path.join(sandbox, 'dsh-home', 'profiles', PROFILE);
  if (!assert(fs.existsSync(profileDir), `随包 profile 已安装到隔离 DSH_HOME(${PROFILE})`, profileDir)) return;
  const deps = readProfileDeps(profileDir);
  const names = Object.keys(deps ?? {});
  const missing = EXPECTED_PACKAGES.filter((n) => !names.includes(n));
  assert(
    missing.length === 0,
    `manifest 全部 ${EXPECTED_PACKAGES.length} 个插件依赖齐`,
    missing.length ? `缺失 ${missing.join(', ')}` : `实得 ${names.length} 项`
  );
}

function countLeftover(installedPath) {
  const r = spawnSync('bash', ['-c', `pgrep -f "${installedPath}" | wc -l`], { encoding: 'utf8' });
  return Number((r.stdout || '').trim()) || 0;
}

// 进程组收到 SIGTERM 后,dsh 子进程还要把写后日志落盘才退出(壳为此留了退出宽限),
// 所以「回收干净」要轮询到归零,不能在主进程 exit 的瞬间就断言。
async function waitForNoLeftover(installedPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let n = countLeftover(installedPath);
  while (n > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    n = countLeftover(installedPath);
  }
  return n;
}

// 主进程判定必须等 'exit' 事件而不是轮询 process.kill(pid, 0):进程被杀死后、
// 父进程 reap 之前处于僵尸态,此时 kill(pid,0) 仍返回成功,轮询会误判为未回收
// (且轮询若用同步 sleep 会阻塞事件循环,Node 永远没机会 reap)。
async function reclaim(child, installedPath) {
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  killProcessTree(child.pid); // 同步发信号
  const reaped = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  assert(reaped, '主进程已回收(收到 exit 事件)');
  const leftover = await waitForNoLeftover(installedPath, 15_000);
  assert(leftover === 0, '进程树回收干净(无残留子进程)', `pgrep 计数 ${leftover}`);
}

// ---- 编排 ----

async function main() {
  const dmgPath = process.argv[2];
  if (!dmgPath || !fs.existsSync(dmgPath)) {
    console.error('用法: node c3-l4-release-dmg-macos.mjs <path-to.dmg>');
    process.exit(2);
  }
  console.log('# c3 L4 打包安装态验收(macOS,GitHub Release 发布产物)');
  console.log(`dmg: ${path.basename(dmgPath)}`);
  console.log(`dmg sha256: ${sh('shasum', ['-a', '256', dmgPath]).split(' ')[0]}`);
  console.log(`时间: ${new Date().toISOString()}`);
  console.log(`系统: macOS ${sh('sw_vers', ['-productVersion']).trim()} (${os.arch()})`);

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-buddy-l4-'));
  console.log(`隔离沙盒: ${sandbox}`);
  let mounted = null;
  let child = null;
  let installed = null;
  try {
    console.log('\n## 1. 挂载 dmg 并安装到隔离位置');
    mounted = mountDmg(dmgPath);
    assert(true, 'dmg 挂载成功', mounted.mountPoint);
    installed = path.join(sandbox, path.basename(mounted.appPath));
    sh('cp', ['-R', mounted.appPath, installed]); // 等价于用户从 dmg 拖进「应用程序」
    assert(fs.existsSync(installed), '应用已安装到隔离位置(模拟拖入「应用程序」)');

    console.log('\n## 2. 代码签名有效性');
    verifySignature(installed);

    console.log('\n## 3. 隔离沙盒首次启动');
    child = launchIsolated(installed, sandbox);
    const exited = new Promise((r) => child.once('exit', (code) => r(`exited:${code}`)));
    const ready = waitForHttp(DSH_URL, { timeoutMs: BOOT_TIMEOUT_MS, accept: (s) => s === 200 }).then((s) =>
      s === null ? 'timeout' : `http:${s}`
    );
    const outcome = await Promise.race([ready, exited]);
    assert(outcome === 'http:200', `内嵌 dsh 在 ${BOOT_TIMEOUT_MS / 1000}s 内就绪(${DSH_URL} HTTP 200)`, outcome);

    console.log('\n## 4. 随包 profile 安装结果');
    checkBundledProfile(sandbox);

    console.log('\n## 5. 进程树回收');
    await reclaim(child, installed);
    child = null; // 已回收,finally 不再重复
  } finally {
    if (child && child.pid) killProcessTree(child.pid); // 异常路径兜底
    if (mounted) detachDmg(mounted.mountPoint);
    fs.rmSync(sandbox, { recursive: true, force: true });
    console.log(`\n沙盒已清理: ${sandbox}`);
  }

  console.log(`\n结论: ${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`脚本异常: ${err.stack || err.message}`);
  process.exit(1);
});
