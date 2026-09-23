// 内嵌 dsh 的 Windows 子进程「闪终端」补丁:给 dsh-win32-process 的三处 CreateProcess
// 创建标志补上 CREATE_NO_WINDOW。
//
// 病灶:dsh 在 Windows 上默认走 Win32 Job 容器路径——每个 ctx.subprocess.spawn 先起
// 一个 runner(process.execPath,本壳下即 Electron 二进制),runner 再用 koffi 直调
// CreateProcessW 拉起真正的目标。上游创建标志只有 CREATE_SUSPENDED |
// CREATE_UNICODE_ENVIRONMENT,STARTUPINFO 也没设 SW_HIDE。Electron 主进程、dsh web
// 进程、runner 全是 GUI 子系统程序,整条链上没有控制台,于是每个控制台程序目标
// (git.exe / bash.exe / rg.exe …)都被 Windows 新开一个可见控制台窗口,目标退出即
// 关——就是用户看到的「运行时频繁闪终端」。上游用 Node 跑 dsh 时终端控制台被继承,
// 看不到这个现象,所以这是本壳运行时选择带来的表现。
//
// 补丁:三个创建点的 dwCreationFlags 按位或上 CREATE_NO_WINDOW(0x08000000)。目标仍
// 拿到一个控制台(隐藏),stdio 走 STARTF_USESTDHANDLES 的句柄不受影响。同一包里的
// 兜底路径(Job runner 不可用时的 Node spawn)上游已带 windowsHide,不在此列。
//
// 本模块只负责文本变换;目标定位与 CLI 在 scripts/patch-dsh-no-window.js,补丁落在
// 仓库依赖树,由 postinstall 打上、predist/dist:win 以 --check 把关,随 asar 一起分发。
// 上游给 CreateProcess 补上 CREATE_NO_WINDOW 后,本模块连同挂载点一起删除。

const fs = require('fs');

const CREATE_NO_WINDOW = 0x08000000;

// 幂等标记 = 补丁注释首段,只在本模块写入的文本里出现。
const MARKER = 'dsh-buddy patch: CREATE_NO_WINDOW';

// 三处创建点(tsdown 产物,逐字匹配是有意的:上游一改形状补丁立刻失败,由人判断是
// 已修复还是改锚点,而不是静默错过)。flags 为上游原始 dwCreationFlags。
const SITES = [
  {
    label: 'CreateProcessW(current-token Job,ordinary spawn)',
    flags: 1028,
    before: 'null, null, 1, ',
    after: ', environment, options.cwd, startupInfo, processInfo)',
  },
  {
    label: 'CreateProcessAsUserW(restricted-token Job,sandbox spawn)',
    flags: 4,
    before: 'createRestrictedProcess(api, options, commandLine, ',
    after: ', startupInfo, processInfo)',
  },
  {
    label: 'CreateProcessAsUserW(restricted-token piped probe)',
    flags: 0,
    before: 'createRestrictedProcess(api, options, buildCommandLine(options.command, options.args), ',
    after: ', startupInfo, processInfo)',
  },
];

const originalText = (site) => `${site.before}${site.flags}${site.after}`;
const patchedText = (site) =>
  `${site.before}${site.flags | CREATE_NO_WINDOW} /* ${MARKER}: ${site.flags} | 0x08000000 */${site.after}`;

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

// 幂等变换:已打过的创建点原样保留;未打的必须恰好命中一次锚点,否则抛错。
function patchSource(source) {
  let out = source;
  for (const site of SITES) {
    if (countOf(out, patchedText(site)) === 1) continue;
    const found = countOf(out, originalText(site));
    if (found !== 1) {
      throw new Error(
        `patch-dsh-no-window: 锚点「${site.label}」出现 ${found} 次(期望 1)。` +
          '上游产物形状已变:请复核是已修复(删补丁)还是需要改锚点'
      );
    }
    out = out.replace(originalText(site), patchedText(site));
  }
  return out;
}

function patchFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const patched = patchSource(original);
  if (patched !== original) {
    // 同目录临时文件 + rename:pnpm 硬链接的 store 条目被整体替换而不是原地改写。
    const tmp = `${filePath}.dsh-no-window-patch`;
    fs.writeFileSync(tmp, patched);
    fs.renameSync(tmp, filePath);
  }
  return patched !== original;
}

module.exports = { MARKER, CREATE_NO_WINDOW, patchSource, patchFile };
