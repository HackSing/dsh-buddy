#!/usr/bin/env node
// dsh 追新兼容验证:给定一个候选 @deepseek-ai/dsh 版本,在系统临时目录建干净工作区,
// 依次验证四件事——① 装包并按 bin 字段解析入口;② 随包 preset 的单测在新环境仍通过;
// ③ 装上随包 preset 后新版 dsh 的 web 能起来且没有 preset 装载错误;
// ④ 按 preinstall-manifest 装全部预装插件后 web 仍能起来。
//
// 四步各自独立 try:一步失败继续跑后面的,把全部结论汇总成 markdown 报告;
// 只要有一步失败就非零退出。本脚本只报告,绝不改动仓库里钉住的版本。
//
// 用法: node scripts/verify-dsh-compat.js <dsh 版本号> [--report <md>] [--summary <txt>]
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { binEntryFrom } = require('../lib/dsh-entry');
const { waitForHttp } = require('../lib/http-probe');
const { killProcessTree } = require('../lib/process-tree');
const { installBundledPresets } = require('../lib/bundled-presets');

// ---- 常量单一来源 ----
const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'plugins', 'preinstall-manifest.json');
const PLUGINS_ROOT = path.join(REPO_ROOT, 'plugins');
const PRESET_PKG_DIR = path.join(PLUGINS_ROOT, 'dsh-anchored-standard');
const DSH_PKG = '@deepseek-ai/dsh';
const WEB_READY_TIMEOUT_MS = 180000; // CI 冷启动留足时间
const LOG_TAIL_LINES = 40; // 报告里每个失败项贴多少行日志尾部
// preset 装载错误的匹配保守到「同一行里同时出现 preset 与错误词」,避免把
// 正常日志里出现的 error 字样(如 error handler 之类)误判成失败。
const PRESET_ERROR_PATTERNS = [
  /preset[^\n]*\b(broken|invalid|failed|error)\b/i,
  /\b(broken|invalid|failed to load)\b[^\n]*preset/i,
];

// 步骤失败:把原因与日志一起带上,由汇总层写进报告(此处既不打印也不吞掉)
function stepError(message, log) {
  const err = new Error(message);
  err.log = log || '';
  return err;
}

// 同步执行外部命令,合并 stdout/stderr 作为日志;非零退出即抛带日志的步骤错误
function run(cmd, args, options) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  const log = `$ ${cmd} ${args.join(' ')}\n${r.stdout || ''}${r.stderr || ''}`;
  if (r.error) throw stepError(`${cmd} 无法执行: ${r.error.message}`, log);
  if (r.status !== 0) throw stepError(`${cmd} 退出码 ${r.status}`, log);
  return log;
}

// 向内核要一个空闲端口:listen(0) 拿到后立即释放,再交给 dsh 复用
function reservePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// 用候选版本的入口拉起 web,轮询到 HTTP 200 后回收进程树,返回状态码与全部日志
async function bootWeb(entry, dshHome, cwd) {
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}/`;
  const child = spawn(process.execPath, [entry, 'web', '--host', '127.0.0.1', '--port', String(port)], {
    cwd,
    env: { ...process.env, DSH_HOME: dshHome },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // 独立进程组,便于整组回收
  });

  const chunks = [];
  child.stdout.on('data', (d) => chunks.push(d));
  child.stderr.on('data', (d) => chunks.push(d));
  let exitCode = null;
  child.on('exit', (code) => {
    exitCode = code;
  });

  try {
    const status = await waitForHttp(url, {
      timeoutMs: WEB_READY_TIMEOUT_MS,
      accept: (s) => s === 200,
    });
    const log = `$ node <dsh> web --port ${port}\n${Buffer.concat(chunks).toString('utf8')}`;
    if (status === null) {
      const why =
        exitCode !== null ? `web 进程提前退出(code ${exitCode})` : `等待 ${url} 返回 200 超时`;
      throw stepError(why, log);
    }
    return { status, log, port };
  } finally {
    killProcessTree(child.pid);
  }
}

function findPresetErrors(log) {
  return log
    .split('\n')
    .filter((line) => PRESET_ERROR_PATTERNS.some((p) => p.test(line)))
    .slice(0, 5);
}

function requireEntry(ctx) {
  if (!ctx.entry) throw stepError('前置步骤未解析出 dsh 入口,本项无法执行', '');
}

function freshHome(ctx, tag) {
  const home = path.join(ctx.root, `dsh-home-${tag}`);
  fs.mkdirSync(home, { recursive: true });
  return home;
}

// ---- 四个验证步骤 ----

function stepInstall(ctx) {
  fs.writeFileSync(
    path.join(ctx.workspace, 'package.json'),
    `${JSON.stringify({ name: 'dsh-compat-probe', version: '0.0.0', private: true }, null, 2)}\n`
  );
  const log = run('npm', ['install', '--no-audit', '--no-fund', `${DSH_PKG}@${ctx.version}`], {
    cwd: ctx.workspace,
  });
  const pkgDir = path.join(ctx.workspace, 'node_modules', ...DSH_PKG.split('/'));
  const entry = binEntryFrom(pkgDir);
  if (!entry) throw stepError(`装包成功但无法从 ${pkgDir} 的 bin 字段解析出入口文件`, log);
  ctx.entry = entry;
  return { detail: `入口 ${path.relative(ctx.workspace, entry)}`, log };
}

function stepPresetTest() {
  const log = run('npm', ['test'], { cwd: PRESET_PKG_DIR });
  return { detail: 'plugins/dsh-anchored-standard 的 node --test 全绿', log };
}

async function stepPresetBoot(ctx) {
  requireEntry(ctx);
  const home = freshHome(ctx, 'presets');
  const summary = installBundledPresets({ pluginsRoot: PLUGINS_ROOT, dshHome: home });
  const boot = await bootWeb(ctx.entry, home, ctx.workspace);
  const problems = findPresetErrors(boot.log);
  if (problems.length > 0) {
    throw stepError(`日志出现 preset 装载错误: ${problems[0].trim()}`, boot.log);
  }
  return {
    detail: `装入 ${summary.installed.length} 个 preset(${summary.installed.join(', ')}),web 返回 HTTP ${boot.status}`,
    log: boot.log,
  };
}

async function stepPluginInstall(ctx) {
  requireEntry(ctx);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const specs = manifest.packages.map((p) => `${p.name}@${p.version}`);
  const home = freshHome(ctx, 'plugins');
  const installLog = run(
    process.execPath,
    [ctx.entry, 'plugin', '--profile', manifest.profile, 'add', ...specs],
    { cwd: ctx.workspace, env: { ...process.env, DSH_HOME: home } }
  );

  const profileModules = path.join(home, 'profiles', manifest.profile, 'node_modules');
  for (const p of manifest.packages) {
    if (!fs.existsSync(path.join(profileModules, ...p.name.split('/')))) {
      throw stepError(`插件未落地: ${p.name}`, installLog);
    }
  }

  const boot = await bootWeb(ctx.entry, home, ctx.workspace);
  return {
    detail: `${specs.length} 个插件安装到位,web 返回 HTTP ${boot.status}`,
    log: `${installLog}\n${boot.log}`,
  };
}

const STEPS = [
  { id: 'install', title: '① npm install 与 bin 入口解析', run: stepInstall },
  { id: 'preset-test', title: '② 随包 preset 单元测试', run: stepPresetTest },
  { id: 'preset-boot', title: '③ 随包 preset 装载后 web 启动', run: stepPresetBoot },
  { id: 'plugin-install', title: '④ manifest 预装插件安装后 web 启动', run: stepPluginInstall },
];

async function runSteps(ctx) {
  const results = [];
  for (const step of STEPS) {
    try {
      const outcome = await step.run(ctx);
      results.push({ ...step, ok: true, detail: outcome.detail });
    } catch (err) {
      results.push({ ...step, ok: false, detail: err.message, log: err.log || '' });
    }
  }
  return results;
}

// ---- 报告 ----

function tail(text, lines) {
  const all = text.split('\n');
  return all.slice(Math.max(0, all.length - lines)).join('\n');
}

function renderReport(ctx, results) {
  const passed = results.filter((r) => r.ok).length;
  const lines = [
    `# dsh ${ctx.version} 兼容性验证`,
    '',
    `- 候选版本: \`${ctx.version}\``,
    `- 当前钉住: \`${ctx.pinned}\``,
    `- 结论: **${passed}/${results.length}** 项通过`,
    `- 环境: ${process.platform}-${process.arch} / node ${process.version}`,
    `- 时间: ${new Date().toISOString()}`,
    '',
    '| 项 | 结果 | 说明 |',
    '| --- | --- | --- |',
    ...results.map((r) => `| ${r.title} | ${r.ok ? '✅' : '❌'} | ${r.detail.replace(/\|/g, '\\|')} |`),
  ];

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    lines.push('', '## 失败详情');
    for (const f of failures) {
      lines.push('', `### ${f.title}`, '', `原因: ${f.detail}`, '', '```', tail(f.log, LOG_TAIL_LINES), '```');
    }
  }
  lines.push('', '> 本工作流只报告,不会自动修改 package.json 里钉住的 dsh 版本。', '');
  return { markdown: lines.join('\n'), summary: `${passed}/${results.length} ${passed === results.length ? '✅' : '❌'}` };
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report' || arg === '--summary') {
      i += 1;
      if (!argv[i]) throw new Error(`${arg} 需要一个路径参数`);
      options[arg.slice(2)] = argv[i];
    } else if (arg.startsWith('--')) {
      throw new Error(`未知参数: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    throw new Error('用法: node scripts/verify-dsh-compat.js <dsh 版本号> [--report <md>] [--summary <txt>]');
  }
  return { version: positional[0], ...options };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pinned = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    .dependencies[DSH_PKG];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compat-'));
  const ctx = { version: args.version, pinned, root, workspace: path.join(root, 'workspace') };
  fs.mkdirSync(ctx.workspace, { recursive: true });

  let results;
  try {
    results = await runSteps(ctx);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const { markdown, summary } = renderReport(ctx, results);
  const reportPath = args.report || path.join(os.tmpdir(), `dsh-compat-${args.version}.md`);
  fs.writeFileSync(reportPath, markdown, 'utf8');
  if (args.summary) fs.writeFileSync(args.summary, `${summary}\n`, 'utf8');

  process.stdout.write(`${markdown}\n[verify-dsh-compat] report=${reportPath} summary=${summary}\n`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main();
