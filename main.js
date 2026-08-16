const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { installBundledPresets, defaultDshHome } = require('./lib/bundled-presets');
const { installBundledProfile } = require('./lib/bundled-profile');
const { attachDragStrip } = require('./lib/immersive-titlebar');
const { binEntryFrom } = require('./lib/dsh-entry');
const { probeHttp, waitForHttp } = require('./lib/http-probe');
const { killProcessTree } = require('./lib/process-tree');
const { checkForUpdate } = require('./lib/update-check');
const preinstallManifest = require('./plugins/preinstall-manifest.json');

// ---- 配置区 ----
// 默认走「内嵌 dsh」:用 Electron 自带的 Node 运行时执行随包分发的 dsh,用户机器无需 Node。
// 参考 https://github.com/deepseek-ai/deepseek-harness#run
const DSH_PKG = '@deepseek-ai/dsh';
const DSH_VERSION = '0.1.0-rc.6'; // 与 package.json dependencies 保持一致(dsh 仍是 developer preview)
const DSH_URL = process.env.DSH_URL || 'http://127.0.0.1:3080';
// ----------------

let dshProc = null;
let win = null;
let quitting = false;

// 从 DSH_URL 反推监听地址,让 DSH_URL 单个变量同时决定「探测哪里」和「拉起在哪里」
function parseTarget(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname || '127.0.0.1', port: u.port || '3080' };
  } catch (_) {
    return { host: '127.0.0.1', port: '3080' };
  }
}
const TARGET = parseTarget(DSH_URL);

// 解析内嵌 dsh 的入口脚本;打包态必须落在 app.asar.unpacked(子进程读不了 asar 里的 ESM)
function resolveEmbeddedEntry() {
  const segments = DSH_PKG.split('/');
  const candidates = [];

  if (app.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', ...segments));
    candidates.push(path.join(process.resourcesPath, 'app', 'node_modules', ...segments));
  }
  try {
    candidates.push(path.dirname(require.resolve(`${DSH_PKG}/package.json`)));
  } catch (_) {
    /* 开发态未安装依赖 */
  }
  candidates.push(path.join(app.getAppPath(), 'node_modules', ...segments));

  for (const dir of candidates) {
    const entry = binEntryFrom(dir);
    if (entry) return entry;
  }
  return null;
}

// 启动器解析:环境变量覆盖 → 内嵌 dsh(默认)→ npx 回退
// (「复用已存活服务」在 ensureDsh 里先于任何 spawn 短路,见下)
function resolveLauncher() {
  if (process.env.DSH_CMD || process.env.DSH_ARGS) {
    // 逃生通道:完全按开发者给定的命令行执行,行为与旧版一致(不注入 --port)
    return {
      kind: 'env',
      cmd: process.env.DSH_CMD || 'npx',
      args: (process.env.DSH_ARGS || `${DSH_PKG}@${DSH_VERSION} web`).split(' ').filter(Boolean),
      env: process.env,
      timeoutMs: 300000, // 可能是 npx,留足冷启动下载时间
    };
  }

  const entry = resolveEmbeddedEntry();
  if (entry) {
    return {
      kind: 'embedded',
      cmd: process.execPath, // Electron 二进制 + ELECTRON_RUN_AS_NODE = 纯 Node 进程
      args: [entry, 'web', '--host', TARGET.host, '--port', TARGET.port],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: 60000,
      detail: entry,
    };
  }

  return {
    kind: 'npx',
    cmd: 'npx',
    args: [`${DSH_PKG}@${DSH_VERSION}`, 'web', '--host', TARGET.host, '--port', TARGET.port],
    env: process.env,
    // npx 冷启动要下载 @deepseek-ai/dsh 的整棵依赖树(500+ 包),实测超过 120s
    timeoutMs: 300000,
  };
}

// 「dsh 已在监听」的判定单一来源:5xx 说明进程活着只是内部出错,
// 仍算就绪(壳的职责是把 UI 指过去,不替 dsh 判断业务错误)。
const isDshServing = (status) => status < 500;

// 探测 dsh 服务是否已就绪
async function isUp(url) {
  const status = await probeHttp(url);
  return status !== null && isDshServing(status);
}

// 轮询等待服务就绪
async function waitForServer(url, timeoutMs) {
  return (await waitForHttp(url, { timeoutMs, accept: isDshServing })) !== null;
}

// 随包 plugins 目录:打包态在 asar 之外(asarUnpack),开发态即仓库目录
function resolvePluginsRoot() {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'plugins');
  }
  return path.join(app.getAppPath(), 'plugins');
}

// 随包 web profile tar:打包态在 Resources 根(extraResources),开发态为构建产物
function resolveProfileTarball() {
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'web-profile.tar.gz');
  }
  return path.join(app.getAppPath(), 'build', 'web-profile.tar.gz');
}

// 把随包 agent preset 和预装 profile 装进 DSH_HOME。两者都是增强项:
// 安装失败要让用户看见,但不阻断 dsh 本体启动。
function ensureBundledAssets() {
  const dshHome = defaultDshHome(process.env, os.homedir());
  try {
    const summary = installBundledPresets({ pluginsRoot: resolvePluginsRoot(), dshHome });
    if (summary.installed.length > 0) {
      console.log(`[dsh-buddy] installed bundled presets: ${summary.installed.join(', ')}`);
    }
    const profileResult = installBundledProfile({
      tarballPath: resolveProfileTarball(),
      dshHome,
      profileName: preinstallManifest.profile,
    });
    console.log(`[dsh-buddy] bundled profile: ${profileResult}`);
  } catch (err) {
    dialog.showErrorBox(
      'DSH Buddy',
      `内置资产安装失败:${err.message}\ndsh 仍将正常启动,可稍后重装应用修复。`
    );
  }
}

// 若 dsh 未在运行,则作为子进程拉起并托管生命周期
async function ensureDsh() {
  if (await isUp(DSH_URL)) {
    console.log(`[dsh-buddy] reusing live dsh at ${DSH_URL}`);
    return true; // 用户已手动启动,直接复用:不拉起、退出也不回收
  }

  const launcher = resolveLauncher();
  console.log(
    `[dsh-buddy] launcher=${launcher.kind}` +
      (launcher.detail ? ` entry=${launcher.detail}` : '') +
      ` cmd=${launcher.cmd} args=${JSON.stringify(launcher.args)}`
  );

  dshProc = spawn(launcher.cmd, launcher.args, {
    stdio: 'inherit',
    env: launcher.env,
    // Windows 下 npx 是 .cmd,需经 shell;内嵌路径是可执行文件,无需 shell
    shell: process.platform === 'win32' && launcher.kind !== 'embedded',
    // 独立进程组:dsh 自身还会派生子进程,退出时须整组回收
    detached: process.platform !== 'win32',
  });

  dshProc.on('error', (err) => {
    dialog.showErrorBox(
      'DSH Buddy',
      `无法启动 dsh(${launcher.cmd}):${err.message}\n` +
        (launcher.kind === 'embedded'
          ? '内嵌 dsh 执行失败,请重新安装应用。'
          : '请确认 dsh 已安装并在 PATH 中,或通过 DSH_CMD 环境变量指定路径。')
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

  return waitForServer(DSH_URL, launcher.timeoutMs);
}

// 提示层:只负责把「有新版本」这件事呈现给用户。
// 要不要提示、提示哪个版本已由 lib/update-check 判定完毕,这里不做任何判断。
async function notifyUpdate({ version, url }) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'DSH Buddy',
    message: `发现新版本 ${version}`,
    detail: `当前版本 ${app.getVersion()}。前往 GitHub Release 页下载?`,
    buttons: ['去下载', '忽略'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) await shell.openExternal(url); // 只开下载页,不自动下载安装
}

// 启动后的更新检查:刻意不 await,不进启动链,也不因失败影响任何既有流程。
// 节流跳过、仓库还没发过 release、离线/超时/限流都是可预期状态,
// 由 checkForUpdate 折叠成具名 outcome,这里只落一行日志。
// 末尾的 catch 是这条链路唯一的错误边界:更新提示是纯增强项,
// 非预期错误(如 userData 不可写)也只记录,绝不弹窗、绝不影响 dsh 使用。
function scheduleUpdateCheck() {
  checkForUpdate({
    currentVersion: app.getVersion(),
    stateDir: app.getPath('userData'),
    notify: notifyUpdate,
  })
    .then(({ outcome, detail }) => {
      console.log(`[dsh-buddy] update check: ${outcome}${detail ? ` (${detail})` : ''}`);
    })
    .catch((err) => {
      console.log(`[dsh-buddy] update check skipped: ${err.message}`);
    });
}

function createWindow() {
  // macOS 走沉浸式:隐藏原生标题栏,红绿灯悬浮,dsh 界面直通窗口顶端;
  // 拖拽能力由注入的顶部拖拽带补回(见 lib/immersive-titlebar.js)。
  const immersive = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DSH Buddy',
    ...(immersive ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (immersive) attachDragStrip(win, { version: app.getVersion() });

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
    ensureBundledAssets();
    const ok = await ensureDsh();
    if (!ok) {
      dialog.showErrorBox(
        'DSH Buddy',
        `等待 dsh 服务超时(${DSH_URL})。\n请检查启动命令与端口配置。`
      );
      app.quit();
      return;
    }
    createWindow();
    scheduleUpdateCheck(); // 窗口出来之后再查,全程与启动链解耦
  });
}

// 退出时整组回收 dsh 进程树,不留孤儿(复用的外部服务不在此列:dshProc 为空)
function killDsh() {
  if (!dshProc) return;
  const pid = dshProc.pid;
  dshProc = null;
  killProcessTree(pid);
}

app.on('before-quit', () => {
  quitting = true;
  killDsh();
});

app.on('window-all-closed', () => {
  app.quit(); // MVP 阶段:关窗即退出,macOS 常驻 Dock 二期再做
});
