const { spawn } = require('child_process');

// 整组即时回收子进程树:dsh 自身还会派生子进程,只杀直接子进程会留下孤儿。
// Windows 走 taskkill /T;POSIX 用负 PID 杀整个进程组(要求 spawn 时 detached: true)。
// 目标进程已自行退出时 process.kill 抛 ESRCH —— 那是「本来就没得杀」的正常竞态,
// 与调用方的意图(确保它没了)一致,故在此终结而不上抛。
//
// 只做即时强杀:退出宽限期由主进程(main.js 的 before-quit)自己 preventDefault 等满,
// 不再派生 detached 孤儿 cmd 来延时——detached 子进程在 Windows 会被强制分配控制台
// 窗口(windowsHide 对其无效),活在退出后的宽限期里就成了「退出时闪出终端」。
//
// taskkill 是控制台程序,而壳(Electron)是 GUI 进程、没有控制台:不带 windowsHide 时
// Windows 会为它新开一个可见控制台窗口,插件热更重启 dsh、退出强杀时各闪一下。
function killProcessTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (_) {
    /* 进程已退出 */
  }
}

module.exports = { killProcessTree };
