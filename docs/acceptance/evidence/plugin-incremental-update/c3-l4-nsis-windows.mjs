#!/usr/bin/env node
// 验收 c3(L4 打包安装态)的 Windows 版复现,对应 macOS 版 c3-l4-release-dmg-macos.mjs。
//
// 为什么需要它:c2/c3 的原 Windows 记录把证据写在 .gitignore 覆盖的 build/ 下,
// 从未进 git 且已失效;两层的补记录都在 macOS 上做,于是 Windows 特有的路径
// ——NSIS 安装器、pnpm junction 布局下的 profile 解包、taskkill 进程树回收——
// 目前没有任何有证据支撑的验收覆盖。而这些恰恰是 release.yml 开头整段注释
// 警告过的高风险区(bsdtar 打包 junction 后链接失真、解包需符号链接特权)。
//
// 本脚本原在 macOS 上编写,2026-08-22 首次 Windows 实机运行,暴露并修正两处
// (修正后的脚本本身就是证据的一部分):
//   1. 缺安装前安全阀,首跑把开发机上原有的 DSH Buddy 安装连同 userData 一并
//      卸掉了——见 assertNoExistingInstall 的注释;
//   2. 把 NSIS 静默卸载当同步调用,导致「卸载后主程序已移除」误判 FAIL 且
//      随后 rmSync 抛 EPERM——见 uninstall 的注释。
// 两处根因同类:把异步操作当同步用,与 c2 Windows 版踩到的 taskkill 竞态同族。
//
// 前置:Windows x64、Node 24、已 clone 本仓库(脚本靠自身位置推导仓库根,
// 不要求特定盘符或目录名)。安装包用 GitHub Release 的 exe:
//   gh release download v0.4.1 --pattern "*.exe"
//
// 用法(PowerShell):
//   node docs\acceptance\evidence\plugin-incremental-update\c3-l4-nsis-windows.mjs `
//     .\DSH-Buddy-Setup-0.4.1.exe 2>&1 | Tee-Object c3-l4-nsis-windows.log
// 日志请存到本目录下(与脚本同级),不要写进 build/——那正是当初丢证据的原因。

import { spawn, spawnSync } from 'node:child_process';
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
const BOOT_TIMEOUT_MS = 180_000; // Windows 上解包随包资产明显慢于 macOS,给足余量
const EXE_NAME = 'DSH Buddy.exe';
const UNINSTALLER = 'Uninstall DSH Buddy.exe';
const SANDBOX_PREFIX = 'dsh-buddy-l4-'; // 沙盒目录名前缀,安全阀据此放行自家残留

let failures = 0;
function assert(cond, label, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

function powershell(script) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  return { code: r.status, text: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

// ---- IO:NSIS 安装 / 卸载 ----

// electron-builder 的 NSIS(perMachine:false)静默安装:/S 静默,/D 指定目录。
// /D 必须是最后一个参数、不能加引号、必须是绝对路径——这是 NSIS 的硬性约定,
// 违反任何一条都会静默装到默认位置而不是报错,所以此处单独断言目录真的建出来了。
function installNsis(setupExe, targetDir) {
  const r = spawnSync(setupExe, ['/S', `/D=${targetDir}`], { encoding: 'utf8' });
  if (r.error) throw new Error(`安装器无法执行: ${r.error.message}`);
  // 安装器可能在后台继续写文件,轮询等 exe 出现
  const exe = path.join(targetDir, EXE_NAME);
  const deadline = Date.now() + 120_000;
  while (!fs.existsSync(exe) && Date.now() < deadline) {
    spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']);
  }
  return exe;
}

// NSIS 静默卸载默认把卸载器复制到 %TEMP% 再从那里运行(这样它才能删掉自己所在
// 的目录),原进程随即退出——于是 spawnSync 返回时卸载仍在后台进行,调用方看到的
// 是「还没删完」的中间态。首跑实测:断言「卸载后主程序已移除」FAIL、紧接的
// rmSync(sandbox) 抛 EPERM,而 app 目录最终确实变空,证明卸载只是晚于检查完成。
// _?=<dir> 是 NSIS 的约定:指定卸载器工作目录并阻止其自我复制,卸载因此同步执行,
// spawnSync 才真的等到结束。代价:该模式下卸载器不自删,需调用方收走。
function uninstall(targetDir) {
  const un = path.join(targetDir, UNINSTALLER);
  if (!fs.existsSync(un)) return; // 安装失败时无卸载器,交由目录清理兜底
  spawnSync(un, ['/S', `_?=${targetDir}`], { encoding: 'utf8' });
  fs.rmSync(un, { force: true }); // _?= 模式下卸载器留在原地,手动收走
}

// ---- 安全阀:本机已有 DSH Buddy 安装时拒绝运行 ----

// 为什么必须有:electron-builder 的 NSIS 是 perMachine:false,按 appId 在 HKCU
// 注册全局安装记录,同一用户只能有一份。装到临时沙盒只隔离了文件系统,没隔离
// 「安装身份」——沙盒安装会接管那条记录,卸载时便按记录把机器上原有的那份
// DSH Buddy(程序目录 + %APPDATA% 下的 userData)一并清掉。首跑实测确实如此:
// 开发机上原有的安装被卸载、userData 被删(~/.dsh 里的用户数据不受影响)。
// macOS 版没有这个问题:dmg 挂载点天然隔离,不存在全局安装记录。
// 例外:上一轮本脚本自己留下的沙盒安装(路径含 SANDBOX_PREFIX)不算,否则脚本
// 中途崩溃后就再也跑不起来了。判据取 UninstallString 而不是看起来更贴切的
// InstallLocation:实测 electron-builder 的 NSIS 压根不写后者(值为空字符串),
// 拿它当判据,例外逻辑会静默失效——首次修复时就踩了这一下,靠 reportRegistryEntry
// 把注册记录打进日志才发现。
function findExistingInstalls() {
  const r = powershell(
    "Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' -ErrorAction SilentlyContinue |" +
      ' ForEach-Object { $p = Get-ItemProperty $_.PSPath;' +
      " if ($p.DisplayName -like 'DSH Buddy*') { $p.DisplayName + '|' + $p.UninstallString } }"
  );
  return r.text.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean);
}

function assertNoExistingInstall() {
  const found = findExistingInstalls().filter((line) => !line.includes(SANDBOX_PREFIX));
  if (found.length === 0) return;
  console.error('拒绝运行:本机已存在 DSH Buddy 安装,继续会把它卸掉(NSIS 按 appId 全局注册,沙盒隔离不了安装身份)。');
  for (const line of found) console.error(`  已装: ${line}`);
  console.error('请先手动卸载该安装(或换一台没装过的机器)再跑本脚本;跑完可用同一安装包装回去。');
  process.exit(2);
}

// 安装后把注册记录打进日志:既是 L4 的安装态证据,也让上面的匹配规则有据可查。
function reportRegistryEntry() {
  const lines = findExistingInstalls();
  console.log(`  注册记录: ${lines.length ? lines.join(' ; ') : '(未查到,匹配规则可能需要调整)'}`);
}

// ---- 校验:签名现状(记录事实,不作为通过条件)----

// Windows 产物当前未做代码签名,SmartScreen 必然提示;这里只把事实记进日志,
// 不断言通过与否——L4 要证的是能装能起,签名是另一条独立的待办。
function reportSignature(exePath) {
  const r = powershell(
    `(Get-AuthenticodeSignature -LiteralPath '${exePath.replace(/'/g, "''")}').Status`
  );
  console.log(`  Authenticode 状态: ${r.text || '(查询失败)'}(未签名属已知现状,不计入断言)`);
}

// ---- IO:隔离沙盒启动 ----

function launchIsolated(exePath, sandbox) {
  const child = spawn(exePath, [`--user-data-dir=${path.join(sandbox, 'electron-data')}`], {
    env: { ...process.env, DSH_HOME: path.join(sandbox, 'dsh-home'), DSH_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
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
  // Windows 特有风险点:profile 里的链接若在打包/解包环节失真,依赖目录会是
  // 空壳或断链。逐个 require.resolve 太重,这里抽查依赖目录非空即可暴露断链。
  const nodeModules = path.join(profileDir, 'node_modules');
  const broken = EXPECTED_PACKAGES.filter((n) => {
    const dir = path.join(nodeModules, ...n.split('/'));
    try {
      return !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
    } catch {
      return true;
    }
  });
  assert(broken.length === 0, '插件目录均已实体化(无断链/空壳)', broken.length ? `异常 ${broken.join(', ')}` : '全部非空');
}

// ---- 进程回收 ----

function countLeftover(installDir) {
  const r = powershell(
    `@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${installDir.replace(/'/g, "''")}*' }).Count`
  );
  return Number(r.text) || 0;
}

// taskkill /T 是异步派发的,且 dsh 子进程要落盘后才退,故轮询到归零而非立即断言。
async function waitForNoLeftover(installDir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let n = countLeftover(installDir);
  while (n > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    n = countLeftover(installDir);
  }
  return n;
}

async function reclaim(child, installDir) {
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  killProcessTree(child.pid); // win32 走 taskkill /pid /T /F
  const reaped = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  assert(reaped, '主进程已回收(收到 exit 事件)');
  const leftover = await waitForNoLeftover(installDir, 20_000);
  assert(leftover === 0, '进程树回收干净(无残留子进程)', `残留计数 ${leftover}`);
}

// ---- 编排 ----

async function main() {
  const setupExe = process.argv[2] && path.resolve(process.argv[2]);
  if (process.platform !== 'win32') {
    console.error('本脚本只能在 Windows 上运行;macOS 请用 c3-l4-release-dmg-macos.mjs');
    process.exit(2);
  }
  if (!setupExe || !fs.existsSync(setupExe)) {
    console.error('用法: node c3-l4-nsis-windows.mjs <path-to-Setup.exe>');
    process.exit(2);
  }
  assertNoExistingInstall(); // 必须在动任何东西之前:装上去就来不及了
  console.log('# c3 L4 打包安装态验收(Windows,GitHub Release 发布产物)');
  console.log(`installer: ${path.basename(setupExe)}`);
  console.log(`sha256: ${powershell(`(Get-FileHash -Algorithm SHA256 -LiteralPath '${setupExe.replace(/'/g, "''")}').Hash`).text}`);
  console.log(`时间: ${new Date().toISOString()}`);
  console.log(`系统: ${powershell('(Get-CimInstance Win32_OperatingSystem).Caption').text} (${os.arch()})`);

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
  const installDir = path.join(sandbox, 'app');
  console.log(`隔离沙盒: ${sandbox}`);
  let child = null;
  try {
    console.log('\n## 1. NSIS 静默安装到隔离位置');
    const exe = installNsis(setupExe, installDir);
    assert(fs.existsSync(exe), '安装器把应用装进了指定目录', installDir);
    reportRegistryEntry();

    console.log('\n## 2. 签名现状(仅记录)');
    reportSignature(exe);

    console.log('\n## 3. 隔离沙盒首次启动');
    child = launchIsolated(exe, sandbox);
    const exited = new Promise((r) => child.once('exit', (code) => r(`exited:${code}`)));
    const ready = waitForHttp(DSH_URL, { timeoutMs: BOOT_TIMEOUT_MS, accept: (s) => s === 200 }).then((s) =>
      s === null ? 'timeout' : `http:${s}`
    );
    const outcome = await Promise.race([ready, exited]);
    assert(outcome === 'http:200', `内嵌 dsh 在 ${BOOT_TIMEOUT_MS / 1000}s 内就绪(${DSH_URL} HTTP 200)`, outcome);

    console.log('\n## 4. 随包 profile 安装结果');
    checkBundledProfile(sandbox);

    console.log('\n## 5. 进程树回收');
    await reclaim(child, installDir);
    child = null;

    console.log('\n## 6. 卸载');
    uninstall(installDir);
    const leftFiles = fs.existsSync(exe);
    assert(!leftFiles, '卸载后主程序已移除');
  } finally {
    if (child && child.pid) killProcessTree(child.pid);
    try {
      uninstall(installDir); // 异常路径兜底,已卸载时无卸载器直接返回
    } catch (err) {
      console.log(`  卸载兜底失败(不改变验收结论): ${err.message}`);
    }
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
