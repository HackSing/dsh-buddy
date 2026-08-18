#!/usr/bin/env node
// 内嵌 dsh 的 Win32 目录选择器补丁。
//
// 病灶:上游 @deepseek-ai/dsh-host-directory-picker-native 的 worker 用
// koffi.view() 读 IFileOpenDialog 返回的路径,而 view 建在 external ArrayBuffer
// 上——Electron 运行时禁用该能力(koffi doc/pointers.md:"Some runtimes (such as
// Electron) forbid the use of external buffers"),调用即 napi fatal,worker 进程
// 当场死;driver 只看到子进程退出,前端得到 "win32 folder dialog worker exited
// before reporting a result"。
//
// 为什么只有本壳踩中:main.js 的 resolveLauncher 用 Electron 二进制 +
// ELECTRON_RUN_AS_NODE 跑内嵌 dsh,worker 由 process.execPath 派生,继承同一运行时。
// 官方用真 Node 跑 dsh 不受影响,所以这是本壳的运行时选择带来的兼容问题,不是上游 bug
// 在其目标环境里的表现。
//
// 补丁:把 readUtf16 换成 lstrlenW 量出精确长度 + koffi.decode 复制读——不建视图,
// 也不会越界读。上游改用非 external 读法后,本脚本连同 package.json 里的挂载点一起删除。
//
// 用法:
//   node scripts/patch-dsh-picker.js               打补丁(幂等);win32 上顺带真跑一次验证
//   node scripts/patch-dsh-picker.js --check        只报状态不写盘(CI/收尾校验)
//   node scripts/patch-dsh-picker.js --target <f>   改另一棵依赖树里的同一文件,
//                                                   用于热修已安装的应用(见 resolveTarget)
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
// 补丁目标在包内的固定位置;仓库依赖树与已安装应用的 app.asar.unpacked 下同名同路径。
const TARGET_IN_TREE = path.join(
  'node_modules',
  '@deepseek-ai',
  'dsh-host-directory-picker-native',
  'lib',
  'worker.cjs'
);
const DEFAULT_TARGET = path.join(REPO_ROOT, TARGET_IN_TREE);

// --target 指向另一棵依赖树里的同一个文件——用于就地热修已安装的应用
// (…\resources\app.asar.unpacked\<TARGET_IN_TREE>),worker 每次 pick 都新起进程读盘,
// 改完不必重装也不必重启壳。
function resolveTarget(argv) {
  const at = argv.indexOf('--target');
  if (at < 0) return DEFAULT_TARGET;
  const value = argv[at + 1];
  if (!value) {
    console.error('[patch-dsh-picker] --target 缺少取值');
    process.exit(1);
  }
  return value;
}

// 上游原文(tsdown 产物:tab 缩进 + LF)。逐字匹配是有意的:上游一旦改动这段实现,
// 补丁立刻失败而不是静默错过,由人判断是已修复(删补丁)还是形状变了(改锚点)。
const ORIGINAL = [
  'function readUtf16(koffi, address) {',
  '\tconst bytes = Buffer.from(koffi.view(address, 32768));',
  '\tlet end = 0;',
  '\twhile (end + 1 < bytes.length && bytes[end] !== 0) end += 2;',
  '\treturn bytes.toString("utf16le", 0, end);',
  '}',
].join('\n');

// 验证用的已知文件夹(桌面):要的只是一个必然存在、且由 CoTaskMemAlloc 交还路径的调用。
const FOLDERID_DESKTOP = 'b4bfcc3a-db2c-424c-b029-7fe99a87c641';

// 幂等标记 = 补丁注释首行,只在本脚本写入的文本里出现。
const MARKER = 'dsh-buddy patch: koffi.view()';

const REPLACEMENT = [
  '/* ' + MARKER + ' 建在 external ArrayBuffer 上,Electron 运行时禁用该能力,',
  ' * 调用即 napi fatal 崩掉整个 worker(上方 JSDoc 描述的是被换掉的原实现)。改为',
  ' * lstrlenW 量出精确长度后 koffi.decode 复制读取:不建视图、不越界读。补丁由',
  ' * scripts/patch-dsh-picker.js 维护,重装 node_modules 后由 postinstall 自动重打。 */',
  'function readUtf16(koffi, address) {',
  '\tconst lstrlenW = koffi.load("kernel32.dll").func("__stdcall", "lstrlenW", "int", ["void *"]);',
  '\tconst length = lstrlenW(address);',
  '\treturn length > 0 ? koffi.decode(address, "char16", length) : "";',
  '}',
].join('\n');

/**
 * 纯替换层:判定源码当前处于哪种状态,并给出打完补丁的源码。
 * 不做 IO,便于单独推理三种状态(已打/可打/形状不符)。
 */
function patchSource(source) {
  if (source.includes(MARKER)) return { status: 'already', source };
  const occurrences = source.split(ORIGINAL).length - 1;
  if (occurrences !== 1) return { status: 'mismatch', source, occurrences };
  return { status: 'applied', source: source.replace(ORIGINAL, REPLACEMENT) };
}

// 形状不符时的统一出口:补丁失效意味着打出来的包会在用户选完目录时崩,
// 所以这里必须硬失败,并把降级路径写在错误里(改用 dsh 的 browse 目录选择后端)。
function failMismatch(occurrences, target) {
  console.error(
    `[patch-dsh-picker] 上游 readUtf16 形状不符(匹配 ${occurrences} 处,期望 1 处):${target}\n` +
      '  → 先确认上游是否已改掉 koffi.view():已修复则删除本脚本与 package.json 里的挂载点;\n' +
      '  → 仍未修复但代码形状变了,改本脚本的 ORIGINAL 锚点;\n' +
      '  → 需要立刻出包时走降级路径:node scripts/use-browse-picker.js(改用 dsh 自带的\n' +
      '    browse 目录选择后端,网页内选目录,不依赖原生对话框)。'
  );
  process.exit(1);
}

/** 从产物里取出某个顶层函数的当前源码,供验证子进程执行(本脚本不复制一份实现)。 */
function extractFunction(source, name, target) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error(`cannot locate ${name} in ${target}`);
  return source.slice(start, end + 2);
}

/** Electron 二进制路径;devDependency 未装(如 npm ci --omit=dev)时返回 null。 */
function electronBinary() {
  try {
    const bin = require('electron');
    return typeof bin === 'string' && fs.existsSync(bin) ? bin : null;
  } catch (_) {
    return null;
  }
}

// 验证子进程的源码:被读对象取 SHGetKnownFolderPath 的出参——它与对话框
// GetDisplayName(SIGDN_FILESYSPATH) 同源(同为 CoTaskMemAlloc 分配的 NUL 结尾
// UTF-16,同为 `_Out_ void **` 出参),差别只剩「谁来点那一下」,所以不必有人值守
// 也能覆盖真实内存形态。readUtf16 与 guidBytes 都从产物里取。
function verifyScript(source, target) {
  return [
    "const fs = require('fs');",
    `const koffi = require(${JSON.stringify(require.resolve('koffi'))});`,
    extractFunction(source, 'readUtf16', target),
    extractFunction(source, 'guidBytes', target),
    "const SHGetKnownFolderPath = koffi.load('shell32.dll').func('__stdcall', 'SHGetKnownFolderPath', 'int32', ['void *', 'uint32', 'void *', '_Out_ void **']);",
    "const CoTaskMemFree = koffi.load('ole32.dll').func('__stdcall', 'CoTaskMemFree', 'void', ['void *']);",
    'const out = [null];',
    `const hr = SHGetKnownFolderPath(guidBytes(${JSON.stringify(FOLDERID_DESKTOP)}), 0, null, out);`,
    "if (hr !== 0) { console.error('SHGetKnownFolderPath hr=' + hr); process.exit(2); }",
    'const got = readUtf16(koffi, out[0]);',
    'CoTaskMemFree(out[0]);',
    "if (typeof got !== 'string' || !fs.existsSync(got)) { console.error('bad read-back: ' + JSON.stringify(got)); process.exit(3); }",
    'process.stdout.write(got);',
  ].join('\n');
}

// 真跑验证:在 Electron 的 Node 模式(与内嵌 dsh 及其 worker 完全同一运行时)里
// 执行产物中的 readUtf16。补丁前的实现跑到这一步就会 napi fatal,所以它既证补丁
// 有效,也钉住「本壳的运行时禁用 external buffer」这个前提没变。
function verifyOnElectron(source, target) {
  if (process.platform !== 'win32') return `skipped (platform=${process.platform})`;
  const electron = electronBinary();
  if (!electron) return 'skipped (electron devDependency not installed)';

  const script = path.join(os.tmpdir(), `dsh-picker-verify-${process.pid}.cjs`);
  fs.writeFileSync(script, verifyScript(source, target));
  try {
    const out = execFileSync(electron, [script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    });
    if (!fs.existsSync(out)) throw new Error(`unexpected read-back: ${JSON.stringify(out)}`);
    return `ok (read ${JSON.stringify(out)} on electron)`;
  } finally {
    fs.rmSync(script, { force: true });
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  // 降级路径已接管:本次构建把目录选择钉在 browse 上(build-web-profile.js 写 patch 层),
  // 原生对话框不再被走到,补丁打不打都不影响产物,这里让开而不是拦住构建。
  if (process.env.DSH_PICKER_BROWSE === '1') {
    console.log('[patch-dsh-picker] skipped: DSH_PICKER_BROWSE=1(本次走 browse 降级路径)');
    return;
  }
  const target = resolveTarget(process.argv);
  if (!fs.existsSync(target)) {
    console.error(`[patch-dsh-picker] 目标不存在(依赖未安装?):${target}`);
    process.exit(1);
  }
  const result = patchSource(fs.readFileSync(target, 'utf8'));

  if (result.status === 'mismatch') failMismatch(result.occurrences, target);
  if (checkOnly) {
    if (result.status === 'applied') {
      console.error(`[patch-dsh-picker] 未打补丁:${target}(运行 node scripts/patch-dsh-picker.js)`);
      process.exit(1);
    }
    console.log('[patch-dsh-picker] check: patched');
    return;
  }

  if (result.status === 'applied') fs.writeFileSync(target, result.source);
  console.log(`[patch-dsh-picker] ${result.status}: ${target}`);
  console.log(`[patch-dsh-picker] verify: ${verifyOnElectron(result.source, target)}`);
}

main();
