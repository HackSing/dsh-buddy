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

// 延迟强杀的命令行(纯函数,便于测试):一个 detached cmd 先等 graceMs 再
// taskkill /F。壳在派生后立即退出,等不了也不该等——延迟由这个孤儿 cmd 承担。
function delayedKillCommand(pid, graceMs) {
  const seconds = Math.max(1, Math.ceil(graceMs / 1000));
  return {
    cmd: 'cmd',
    args: ['/d', '/s', '/c', `timeout /t ${seconds} /nobreak >nul & taskkill /pid ${Number(pid)} /T /F >nul 2>&1`],
  };
}

// 宽限强杀(仅 Windows 与立即杀有差别)。
//
// 为什么需要:taskkill /F 是硬杀,dsh 进程内没有任何退出钩子能跑;而 dsh 的
// 会话日志是写后落盘(200ms 批窗口,dsh-session-persistence 的
// writeBatchMaxDelayMs),硬杀前不到 200ms 产生的事件(典型:LLM 刚生成的
// 会话标题)会从未进日志,任何恢复机制都救不回。给一个宽松窗口让写后定时器
// 自然 drain,再补硬杀。
//
// POSIX 不需要:killProcessTree 发的是 SIGTERM,dsh 的 profile-boot 装了
// 有界优雅停机处理器(dispose 时 flush 全部 live 会话日志与投影缓存后退出),
// 本来就是优雅路径。
function killProcessTreeAfterGrace(pid, graceMs) {
  if (process.platform !== 'win32') {
    killProcessTree(pid);
    return;
  }
  try {
    const { cmd, args } = delayedKillCommand(pid, graceMs);
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (_) {
    // 派生失败(极端:cmd 不可用)退化为立即杀,保证进程树一定被回收。
    killProcessTree(pid);
  }
}

module.exports = { killProcessTree, killProcessTreeAfterGrace, delayedKillCommand };
