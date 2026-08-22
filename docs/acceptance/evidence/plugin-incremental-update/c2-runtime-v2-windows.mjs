#!/usr/bin/env node
// 插件按包增量更新验收 c2(L3 运行时)的 Windows 版复现,对应 macOS 版
// c2-runtime-v2-macos.mjs。三场景断言与执行路径逐字保持一致,这样两平台日志
// 可以直接逐行对照。与 macOS 版的差异只有三处,且都是 Windows 平台事实所迫:
//   1. REPO_ROOT —— 从脚本自身位置推导,不硬编码 macOS 绝对路径;
//   2. WORK      —— 取盘符根下短目录,避开 MAX_PATH(见下方常量注释);
//   3. killAndWaitExit —— 杀进程后等 exit 再删目录(见下方函数注释)。
//
// 为什么需要它:原 Windows 记录写在 .gitignore 覆盖的 build/ 下,从未进 git
// 且已失效;补记录是在 macOS 上做的。于是 Windows 特有的 npm 布局(junction
// 而非 symlink)、路径长度限制、进程回收在 L3 这层没有证据支撑的覆盖。
//
// 三场景全部走生产代码路径:buildWebProfileTar(真实 dsh plugin add,
// 真实 npm registry)→ sliceProfile(真实 lockfile 闭包切片)→
// checkPluginChannel + applyPluginUpdate(fetchImpl 注入本地文件,
// 其余逻辑与生产完全一致)→ 真实拉起 dsh 验 HTTP 200。
//
// 前置:Windows x64、Node 24、已 clone 本仓库并 npm install(脚本靠自身位置
// 推导仓库根,不要求特定盘符或目录名)。
//
// 用法(PowerShell):
//   node docs\acceptance\evidence\plugin-incremental-update\c2-runtime-v2-windows.mjs `
//     2>&1 | Tee-Object c2-runtime-v2-windows.log
// 日志请存到本目录下(与脚本同级),不要写进 build/——那正是当初丢证据的原因。

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ESM 脚本里按需拉 CJS 模块(项目其余源码全是 CJS)。
const require_ = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..'); // evidence/<name>/ → acceptance → docs → repo

// Windows 的 MAX_PATH(260)对 node_modules 嵌套是硬约束,而本脚本要在 WORK 下
// 真实 npm install 出完整 profile 再切片。%TEMP% 本身已深达数层(C:\Users\<用户>\
// AppData\Local\Temp),叠加 home-s1-xxxxxx/profiles/web/node_modules/@scope/pkg/...
// 极易越界,且越界表现为 ENOENT 之类的误导性错误。故取仓库所在盘符根下的短目录
// (如 D:\dsh-acc-v2),跟随仓库盘符而不硬编码,脚本收尾会整体删除。
const WORK = path.join(path.parse(REPO_ROOT).root, 'dsh-acc-v2');

const { buildWebProfileTar } = require_(path.join(REPO_ROOT, 'scripts/build-web-profile.js'));
const { materializeProfile, sliceProfile, buildChannelV2 } = require_(
  path.join(REPO_ROOT, 'scripts/build-plugin-channel.js')
);
const { installBundledProfile, readProfileDeps } = require_(path.join(REPO_ROOT, 'lib/bundled-profile.js'));
const { applyPluginUpdate } = require_(path.join(REPO_ROOT, 'lib/plugin-update.js'));
const { checkPluginChannel, CHANNEL_SCHEMA_V2 } = require_(path.join(REPO_ROOT, 'lib/plugin-channel.js'));
const { binEntryFrom } = require_(path.join(REPO_ROOT, 'lib/dsh-entry.js'));
const { waitForHttp } = require_(path.join(REPO_ROOT, 'lib/http-probe.js'));
const { killProcessTree } = require_(path.join(REPO_ROOT, 'lib/process-tree.js'));

const PROFILE = 'web';
const DSH_PKG_DIR = path.join(REPO_ROOT, 'node_modules', '@deepseek-ai', 'dsh');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'plugins/preinstall-manifest.json'), 'utf8'));
const BASE_PACKAGES = MANIFEST.packages.map((p) => ({ name: p.name, version: p.version }));
const GIT_GRAPH = '@linxin666/dsh-client-ui-git-graph';
const TASK_BOARD = '@linxin666/dsh-client-ui-task-board';
const NEW_VERSION = '0.2.5';

let failures = 0;
function assert(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures += 1;
}

function withVersion(packages, name, version) {
  return packages.map((p) => (p.name === name ? { ...p, version } : { ...p }));
}

function pkgVersionOnDisk(profileDir, name) {
  const p = path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).version;
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// killProcessTree 的契约是「派发杀」而非「杀干净」:Windows 上它 spawn 的
// taskkill /T /F 是异步的,函数返回时进程未必已退、文件句柄未必已释放。而
// Windows 不允许删除仍被打开的文件,调用方紧接着 rmSync(home) 就会 ENOTEMPTY
// ——实测残留的正是 dsh 尚未松手的 task-board 目录。macOS 的 unlink 语义没有
// 这条约束,所以 macOS 版脚本从不暴露此路径,其 fire-and-forget 写法在那边是对的。
// 这里把「已停」这一不变量补回:杀完等 exit 事件,拿到才算真停了。
// (对照实验:立即删 → ENOTEMPTY 残留 task-board;等 exit(335ms)后删 → 成功。)
// 超时上限只防脚本卡死,正常路径远快于它。
async function killAndWaitExit(child) {
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  killProcessTree(child.pid);
  return Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 15_000))]);
}

// dsh 存活探测:真实拉起内嵌 dsh(process.execPath 当运行时),等 HTTP 200,取到即杀。
async function bootAndProbe(dshHome, port, label) {
  const entry = binEntryFrom(DSH_PKG_DIR);
  if (!entry) throw new Error('cannot resolve dsh bin entry');
  const child = spawn(
    process.execPath,
    [entry, PROFILE, '--host', '127.0.0.1', '--port', String(port), '--no-open'],
    { env: { ...process.env, DSH_HOME: dshHome }, stdio: 'ignore' }
  );
  try {
    const status = await waitForHttp(`http://127.0.0.1:${port}`, {
      timeoutMs: 60000,
      accept: (s) => s === 200,
    });
    assert(status === 200, `${label}: dsh 启动后 HTTP 200(实得 ${status})`);
  } finally {
    if (child.pid) await killAndWaitExit(child); // 等真退,否则调用方 rmSync 撞 ENOTEMPTY
  }
}

// 本地文件注入的 fetchImpl:channel.json 与切片 tar 从本地目录读,
// dsh 本体 dist-tags 走真实 npm registry(与生产一致,纯只读)。
function makeLocalFetch(releaseDir, channelJson) {
  return async function fetchImpl(url, opts) {
    if (url === 'local://channel.json') {
      return {
        ok: true,
        status: 200,
        json: async () => channelJson,
      };
    }
    if (url.startsWith('https://github.com/HackSing/dsh-buddy/releases/download/plugin-channel/')) {
      const fileName = url.split('/').pop();
      const filePath = path.join(releaseDir, fileName);
      if (!fs.existsSync(filePath)) return { ok: false, status: 404 };
      const buf = fs.readFileSync(filePath);
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(buf.length) : null) },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(buf);
            controller.close();
          },
        }),
      };
    }
    return fetch(url, opts); // dist-tags 等真实网络请求原样放行
  };
}

// 真实生产语义:channel.packages 必须覆盖清单全集(profileUpgradeDecision 靠它
// 判定"清单外插件"要不要 preserved),因此每个包都要有真实 tarball——即使
// 版本没变也要切片。"增量"只体现在下载阶段:diffChannelVersions 对比本地版本后
// 只把真正变化的包放进 update.updates,downloadSlices 也只下载这些,未变化包
// 的切片虽然存在于 release 目录,但从不会被请求。
async function buildChannelFixture({ name, bumpedPackages, outDir }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const tmpTar = path.join(outDir, 'source.tar.gz');
  console.log(`\n[build] ${name}: buildWebProfileTar(${bumpedPackages.map((p) => `${p.name}@${p.version}`).join(', ')}) ...`);
  buildWebProfileTar({ profileName: PROFILE, packages: bumpedPackages, outputPath: tmpTar });
  const materialized = materializeProfile(tmpTar, outDir);
  const sliced = sliceProfile({
    profileDir: materialized,
    packages: bumpedPackages,
    outDir: path.join(outDir, 'release'),
  });
  const channel = buildChannelV2({ sliced, minDshVersion: MANIFEST_MIN_DSH() });
  console.log(`[build] ${name}: channel v2 built, packages=${channel.packages.map((p) => p.name).join(',')}`);
  return { releaseDir: path.join(outDir, 'release'), channel, materialized };
}

function MANIFEST_MIN_DSH() {
  return require_(path.join(REPO_ROOT, 'package.json')).dependencies['@deepseek-ai/dsh'];
}

async function freshOldProfileHome(oldTar, label) {
  const home = fs.mkdtempSync(path.join(WORK, `home-${label}-`));
  const result = await installBundledProfile({
    tarballPath: oldTar,
    dshHome: home,
    profileName: PROFILE,
    manifestPackages: BASE_PACKAGES,
  });
  assert(result.status === 'installed', `${label}: 旧 profile(0.2.2 系列)首次安装 = installed(实得 ${result.status})`);
  return home;
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  console.log(`WORK=${WORK}`);
  console.log(`8 个基线插件: ${BASE_PACKAGES.map((p) => `${p.name}@${p.version}`).join(', ')}`);

  // ---- 0. 构建旧 profile(0.2.2 系列)源 tar,供三个场景各自安装独立副本 ----
  const oldTar = path.join(WORK, 'old-profile.tar.gz');
  console.log('\n[build] old profile (0.2.2 baseline) ...');
  buildWebProfileTar({ profileName: PROFILE, packages: BASE_PACKAGES, outputPath: oldTar });

  // ---- 1. 单插件(git-graph)通道:只有 git-graph 升到 0.2.5 ----
  const single = await buildChannelFixture({
    name: 'single(git-graph only)',
    bumpedPackages: withVersion(BASE_PACKAGES, GIT_GRAPH, NEW_VERSION),
    outDir: path.join(WORK, 'channel-single'),
  });

  // ---- 2. 双插件(git-graph + task-board)通道 ----
  const doubleBumped = withVersion(withVersion(BASE_PACKAGES, GIT_GRAPH, NEW_VERSION), TASK_BOARD, NEW_VERSION);
  const double = await buildChannelFixture({
    name: 'double(git-graph + task-board)',
    bumpedPackages: doubleBumped,
    outDir: path.join(WORK, 'channel-double'),
  });

  // ==================== 场景 1:单插件外科更新 ====================
  console.log('\n========== 场景 1: git-graph 单插件外科更新 ==========');
  {
    const home = await freshOldProfileHome(oldTar, 's1');
    const profileDir = path.join(home, 'profiles', PROFILE);
    const downloadDir = path.join(home, 'downloads');
    const fetchImpl = makeLocalFetch(single.releaseDir, single.channel);
    const deps = readProfileDeps(profileDir);
    const detect = await checkPluginChannel({
      profileDir,
      stateDir: home,
      currentDshVersion: MANIFEST_MIN_DSH(),
      notify: async () => {},
      force: true,
      channelUrl: 'local://channel.json',
      fetchImpl,
    });
    assert(detect.outcome === 'notified', `s1: checkPluginChannel outcome = notified(实得 ${detect.outcome})`);
    assert(
      detect.update && detect.update.schema === CHANNEL_SCHEMA_V2,
      's1: update.schema = v2'
    );
    assert(
      detect.update && detect.update.updates.length === 1 && detect.update.updates[0].name === GIT_GRAPH,
      `s1: updates 只含 git-graph(实得 ${JSON.stringify(detect.update?.updates?.map((u) => u.name))})`
    );

    const result = await applyPluginUpdate({ update: detect.update, dshHome: home, profileName: PROFILE, downloadDir, fetchImpl });
    assert(result.outcome === 'upgraded', `s1: applyPluginUpdate outcome = upgraded(实得 ${result.outcome}${result.detail ? ' detail=' + result.detail : ''})`);
    assert(!!result.backup, 's1: 返回 backup 目录名');
    const backupPath = path.join(home, 'profiles', result.backup || '');
    assert(result.backup && fs.existsSync(backupPath), `s1: 备份目录存在 ${result.backup}`);

    const ggVer = pkgVersionOnDisk(profileDir, GIT_GRAPH);
    assert(ggVer === NEW_VERSION, `s1: git-graph 磁盘版本 = ${NEW_VERSION}(实得 ${ggVer})`);
    const tbVer = pkgVersionOnDisk(profileDir, TASK_BOARD);
    assert(tbVer === '0.2.2', `s1: task-board 磁盘版本不变 = 0.2.2(实得 ${tbVer})`);
    let othersUnchanged = true;
    for (const p of BASE_PACKAGES) {
      if (p.name === GIT_GRAPH) continue;
      const v = pkgVersionOnDisk(profileDir, p.name);
      if (v !== p.version) {
        othersUnchanged = false;
        console.log(`  differs: ${p.name} expected ${p.version} got ${v}`);
      }
    }
    assert(othersUnchanged, 's1: 其余 7 插件版本全部不变');

    const newBundle = path.join(single.materialized, 'node_modules', ...GIT_GRAPH.split('/'), 'package.json');
    const installedBundle = path.join(profileDir, 'node_modules', ...GIT_GRAPH.split('/'), 'package.json');
    assert(
      fs.existsSync(newBundle) && sha256File(newBundle) === sha256File(installedBundle),
      's1: 安装后 git-graph package.json sha256 == 切片源 package.json sha256(内容确系新版切片,非半成品)'
    );

    const s1DownloadLeftovers = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
    assert(s1DownloadLeftovers.length === 0, `s1: 下载目录无残留,切片下载完成后即弃(实得 ${JSON.stringify(s1DownloadLeftovers)})`);

    await bootAndProbe(home, 30971, 's1');
    fs.rmSync(home, { recursive: true, force: true });
  }

  // ==================== 场景 2:双插件外科更新 ====================
  console.log('\n========== 场景 2: git-graph + task-board 双插件外科更新 ==========');
  {
    const home = await freshOldProfileHome(oldTar, 's2');
    const profileDir = path.join(home, 'profiles', PROFILE);
    const downloadDir = path.join(home, 'downloads');
    const fetchImpl = makeLocalFetch(double.releaseDir, double.channel);
    const detect = await checkPluginChannel({
      profileDir,
      stateDir: home,
      currentDshVersion: MANIFEST_MIN_DSH(),
      notify: async () => {},
      force: true,
      channelUrl: 'local://channel.json',
      fetchImpl,
    });
    assert(detect.outcome === 'notified', `s2: checkPluginChannel outcome = notified(实得 ${detect.outcome})`);
    assert(
      detect.update && detect.update.updates.length === 2,
      `s2: updates 含 2 个插件(实得 ${detect.update?.updates?.length})`
    );

    const result = await applyPluginUpdate({ update: detect.update, dshHome: home, profileName: PROFILE, downloadDir, fetchImpl });
    assert(result.outcome === 'upgraded', `s2: applyPluginUpdate outcome = upgraded(实得 ${result.outcome}${result.detail ? ' detail=' + result.detail : ''})`);

    const ggVer = pkgVersionOnDisk(profileDir, GIT_GRAPH);
    const tbVer = pkgVersionOnDisk(profileDir, TASK_BOARD);
    assert(ggVer === NEW_VERSION, `s2: git-graph 磁盘版本 = ${NEW_VERSION}(实得 ${ggVer})`);
    assert(tbVer === NEW_VERSION, `s2: task-board 磁盘版本 = ${NEW_VERSION}(实得 ${tbVer})`);

    const newGgBundle = path.join(double.materialized, 'node_modules', ...GIT_GRAPH.split('/'), 'package.json');
    const installedGgBundle = path.join(profileDir, 'node_modules', ...GIT_GRAPH.split('/'), 'package.json');
    const newTbBundle = path.join(double.materialized, 'node_modules', ...TASK_BOARD.split('/'), 'package.json');
    const installedTbBundle = path.join(profileDir, 'node_modules', ...TASK_BOARD.split('/'), 'package.json');
    assert(
      sha256File(newGgBundle) === sha256File(installedGgBundle) && sha256File(newTbBundle) === sha256File(installedTbBundle),
      's2: 两个插件安装后 package.json sha256 均等于切片源(内容确系新版)'
    );

    await bootAndProbe(home, 30972, 's2');
    fs.rmSync(home, { recursive: true, force: true });
  }

  // ==================== 场景 3:sha256 故意改错 → 整体回滚 ====================
  console.log('\n========== 场景 3: task-board sha256 故意改错 → 整体 failed,不留半成品 ==========');
  {
    const home = await freshOldProfileHome(oldTar, 's3');
    const profileDir = path.join(home, 'profiles', PROFILE);
    const downloadDir = path.join(home, 'downloads');
    const fetchImpl = makeLocalFetch(double.releaseDir, double.channel);
    const detect = await checkPluginChannel({
      profileDir,
      stateDir: home,
      currentDshVersion: MANIFEST_MIN_DSH(),
      notify: async () => {},
      force: true,
      channelUrl: 'local://channel.json',
      fetchImpl,
    });
    // 故意改错 task-board 切片的 sha256(保留 url/size,只坏校验和)。
    const corrupted = {
      ...detect.update,
      updates: detect.update.updates.map((u) =>
        u.name === TASK_BOARD ? { ...u, tarball: { ...u.tarball, sha256: '0'.repeat(64) } } : u
      ),
    };

    const result = await applyPluginUpdate({ update: corrupted, dshHome: home, profileName: PROFILE, downloadDir, fetchImpl });
    assert(result.outcome === 'failed', `s3: applyPluginUpdate outcome = failed(实得 ${result.outcome})`);
    assert(
      typeof result.detail === 'string' && result.detail.includes('sha256'),
      `s3: detail 指向 sha256 不符(实得 "${result.detail}")`
    );

    let allOld = true;
    for (const p of BASE_PACKAGES) {
      const v = pkgVersionOnDisk(profileDir, p.name);
      if (v !== p.version) {
        allOld = false;
        console.log(`  differs: ${p.name} expected ${p.version} got ${v}`);
      }
    }
    assert(allOld, 's3: 8 插件磁盘版本全部保持旧版(未被污染)');

    const profilesRoot = path.join(home, 'profiles');
    const leftovers = fs
      .readdirSync(profilesRoot)
      .filter((d) => d !== PROFILE && (d.startsWith(`.${PROFILE}.`) || d.startsWith(`${PROFILE}.backup`)));
    assert(leftovers.length === 0, `s3: profiles 下无 staging/备份残留(实得 ${JSON.stringify(leftovers)})`);

    const downloadLeftovers = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
    assert(downloadLeftovers.length === 0, `s3: 下载目录无半成品残留(实得 ${JSON.stringify(downloadLeftovers)})`);

    await bootAndProbe(home, 30973, 's3(原 profile 未受污染)');
    fs.rmSync(home, { recursive: true, force: true });
  }

  console.log(`\n==================== 总计: ${failures === 0 ? '全部通过' : `${failures} 项失败`} ====================`);
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
