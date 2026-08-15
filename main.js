const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');

// ---- 配置区:默认用 npx 启动 dsh Web UI(可用环境变量覆盖)----
// 参考 https://github.com/deepseek-ai/deepseek-harness#run
const DSH_CMD = process.env.DSH_CMD || 'npx';
const DSH_ARGS = (process.env.DSH_ARGS || '@deepseek-ai/dsh@0.1.0-rc.6 web').split(' ');
const DSH_URL = process.env.DSH_URL || 'http://127.0.0.1:3080';
// ---------------------------------------------------------------

let dshProc = null;
let win = null;
let quitting = false;

// 探测 dsh 服务是否已就绪
function isUp(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 轮询等待服务就绪
async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp(url)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// 若 dsh 未在运行,则作为子进程拉起并托管生命周期
async function ensureDsh(timeoutMs = 30000) {
  if (await isUp(DSH_URL)) return true; // 用户已手动启动,直接复用

  dshProc = spawn(DSH_CMD, DSH_ARGS, {
    stdio: 'inherit',
    shell: process.platform === 'win32', // Windows 下 npx 是 .cmd,需经 shell
    detached: process.platform !== 'win32', // 独立进程组:npx 会再拉起 dsh 孙子进程,退出时须整组回收
  });

  dshProc.on('error', (err) => {
    dialog.showErrorBox(
      'DSH Buddy',
      `无法启动 dsh(${DSH_CMD}):${err.message}\n` +
        '请确认 dsh 已安装并在 PATH 中,或通过 DSH_CMD 环境变量指定路径。'
    );
    app.quit();
  });

  dshProc.on('exit', (code) => {
    dshProc = null;
    if (!quitting) {
      dialog.showErrorBox('DSH Buddy', `dsh 进程意外退出(code ${code})。`);
      app.quit();
    }
  });

  return waitForServer(DSH_URL, timeoutMs);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DSH Buddy',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 外部链接交给系统浏览器,不在壳内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(DSH_URL);
  win.on('closed', () => (win = null));
}

// 单实例锁:重复启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // npx 首次运行需下载包,超时放宽到 120s
    const ok = await ensureDsh(120000);
    if (!ok) {
      dialog.showErrorBox(
        'DSH Buddy',
        `等待 dsh 服务超时(${DSH_URL})。\n请检查启动命令与端口配置。`
      );
      app.quit();
      return;
    }
    createWindow();
  });
}

// 退出时整组回收 dsh 进程树(npx → dsh),不留孤儿
function killDsh() {
  if (!dshProc) return;
  const pid = dshProc.pid;
  dshProc = null;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } else {
      process.kill(-pid, 'SIGTERM'); // 负 PID = 杀整个进程组
    }
  } catch (_) {
    /* 进程已退出 */
  }
}

app.on('before-quit', () => {
  quitting = true;
  killDsh();
});

app.on('window-all-closed', () => {
  app.quit(); // MVP 阶段:关窗即退出,macOS 常驻 Dock 二期再做
});
