const { spawn } = require('child_process');

// 整组回收子进程树:dsh 自身还会派生子进程,只杀直接子进程会留下孤儿。
// Windows 走 taskkill /T;POSIX 用负 PID 杀整个进程组(要求 spawn 时 detached: true)。
// 目标进程已自行退出时 process.kill 抛 ESRCH —— 那是「本来就没得杀」的正常竞态,
// 与调用方的意图(确保它没了)一致,故在此终结而不上抛。
function killProcessTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (_) {
    /* 进程已退出 */
  }
}

module.exports = { killProcessTree };
