const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { installBundledPresets, defaultDshHome } = require('./lib/bundled-presets');
const { installBundledProfile } = require('./lib/bundled-profile');
const { createFramelessWindow } = require('./lib/frameless-window');
const { attachDragStrip } = require('./lib/immersive-titlebar');
const { binEntryFrom } = require('./lib/dsh-entry');
const { probeHttp, waitForHttp } = require('./lib/http-probe');
const { killProcessTree } = require('./lib/process-tree');
const { createDshLogger } = require('./lib/dsh-log');
const { checkForUpdate, UPDATE_OUTCOME, RELEASES_PAGE_URL } = require('./lib/update-check');
const { checkPluginChannel, CHANNEL_OUTCOME } = require('./lib/plugin-channel');
const { applyPluginUpdate, PLUGIN_UPDATE_OUTCOME } = require('./lib/plugin-update');
const {
  AUTO_UPDATE_OUTCOME,
  isAutoUpdateSupported,
  scheduleAutoUpdate,
  checkForUpdateManually,
  quitAndInstall,
} = require('./lib/auto-update');
const preinstallManifest = require('./plugins/preinstall-manifest.json');

// ---- 配置区 ----
// 默认走「内嵌 dsh」:用 Electron 自带的 Node 运行时执行随包分发的 dsh,用户机器无需 Node。
// 参考 https://github.com/deepseek-ai/deepseek-harness#run
const DSH_PKG = '@deepseek-ai/dsh';
const DSH_VERSION = '0.1.0-rc.8'; // 与 package.json dependencies 保持一致(dsh 仍是 developer preview)
const DSH_URL = process.env.DSH_URL || 'http://127.0.0.1:3080';
// ----------------

let dshProc = null;
let dshLog = null; // dsh 子进程输出捕获器,仅在本壳拉起 dsh 时创建(复用外部服务时保持 null)
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
      // 内嵌 dsh 免下载,但要 require/import profile 里全部插件的依赖树(实测
      // 2万+文件);首次覆盖安装后这批文件对 Windows Defender 实时防护而言都是
      // "从未扫描过",逐文件扫描开销叠加起来实测能顶近 60s,原值把这一次性成本
      // 算作了故障。120s 与下面 npx 路径的冷启动宽容度对齐同一量级。
      timeoutMs: 120000,
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
    const summary = installBundledPresets({
      pluginsRoot: resolvePluginsRoot(),
      dshHome,
      version: app.getVersion(),
    });
    if (summary.installed.length > 0) {
      console.log(`[dsh-buddy] installed bundled presets: ${summary.installed.join(', ')}`);
    }
    if (summary.updated.length > 0) {
      console.log(`[dsh-buddy] updated bundled preset files: ${summary.updated.join(', ')}`);
    }
    if (summary.preserved.length > 0) {
      // 随包有更新但用户改过这些文件:保留用户版并告知如何手动接收更新。
      console.warn(`[dsh-buddy] bundled preset update held by local modifications: ${summary.preserved.join(', ')}`);
      dialog.showMessageBox({
        type: 'info',
        title: 'DSH Buddy',
        message: '内置 agent preset 有更新,但以下文件存在本地修改,已保留原样:',
        detail: `${summary.preserved.join('\n')}\n\n如需接收更新:备份改动后删除对应文件,重启应用即会写入新版。`,
        buttons: ['OK'],
        noLink: true,
      });
    }
    const profileResult = installBundledProfile({
      tarballPath: resolveProfileTarball(),
      dshHome,
      profileName: preinstallManifest.profile,
      manifestPackages: preinstallManifest.packages,
    });
    console.log(
      `[dsh-buddy] bundled profile: ${profileResult.status}` +
        (profileResult.backup ? ` (旧版备份于 profiles/${profileResult.backup})` : '')
    );
    if (profileResult.status === 'preserved') {
      // 存量 profile 含清单外插件(或 package.json 不可读):不覆盖,告知用户如何手动接收升级。
      const extras = profileResult.extras || [];
      console.warn(`[dsh-buddy] bundled profile upgrade held by extra packages: ${extras.join(', ')}`);
      dialog.showMessageBox({
        type: 'info',
        title: 'DSH Buddy',
        message: '内置插件包有更新,但你当前 profile 中存在清单外的插件,已保留原样未升级:',
        detail:
          (extras.length > 0 ? `${extras.join('\n')}\n\n` : '(无法读取 profile 的 package.json)\n\n') +
          '如需接收更新:备份后删除目录 ' +
          path.join(dshHome, 'profiles', preinstallManifest.profile) +
          ',重启应用即会安装新版(清单外插件需事后自行重装)。',
        buttons: ['OK'],
        noLink: true,
      });
    }
  } catch (err) {
    dialog.showErrorBox(
      'DSH Buddy',
      `内置资产安装失败:${err.message}\ndsh 仍将正常启动,可稍后重装应用修复。`
    );
  }
}

// 统一的 dsh 启动失败弹窗:标题一致,正文 = 具体原因 + 日志文件路径 + 最近输出,
// 让用户不必外部复现就能直接看到 dsh 到底报了什么(dshLog 仅在本壳拉起 dsh 时存在)。
function showDshFailure(reason) {
  const parts = [reason];
  if (dshLog) {
    parts.push(`\n详细日志:${dshLog.path}`);
    const tail = dshLog.tail();
    if (tail) parts.push(`最近输出:\n${tail}`);
  }
  dialog.showErrorBox('DSH Buddy', parts.join('\n'));
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
    // 捕获 stdout/stderr(由 dshLog 落盘 + 透传控制台),取代 'inherit':
    // 打包后的 GUI 应用无控制台,inherit 会丢弃 dsh 输出,启动失败时无从诊断。
    stdio: ['ignore', 'pipe', 'pipe'],
    env: launcher.env,
    // Windows 下 npx 是 .cmd,需经 shell;内嵌路径是可执行文件,无需 shell
    shell: process.platform === 'win32' && launcher.kind !== 'embedded',
    // 独立进程组:dsh 自身还会派生子进程,退出时须整组回收
    detached: process.platform !== 'win32',
  });
  dshLog = createDshLogger({ dir: path.join(app.getPath('userData'), 'logs') });
  dshLog.attach(dshProc);

  dshProc.on('error', (err) => {
    showDshFailure(
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
      showDshFailure(`dsh 进程意外退出(code ${code})。`);
      app.quit();
    }
  });

  const ready = await waitForServer(DSH_URL, launcher.timeoutMs);
  // 仅当仍在正常等待(未因 error/exit 触发退出)时才报超时,避免与上面两个 handler 的弹窗重复
  if (!ready && !quitting) {
    const seconds = Math.round(launcher.timeoutMs / 1000);
    showDshFailure(
      `dsh 已启动但未在 ${seconds} 秒内就绪(${DSH_URL})。\n` +
        '常见原因:profile 依赖不完整或运行环境异常(一般不是端口配置问题)。'
    );
  }
  return ready;
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

// Windows 自动更新通道的用户可见出口:新版本已后台下载完毕,询问是否立即重启安装。
async function notifyUpdateReady({ version }) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'DSH Buddy',
    message: `新版本 ${version} 已就绪`,
    detail: `当前版本 ${app.getVersion()}。重启应用完成安装?`,
    buttons: ['立即重启安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) quitAndInstall(); // 退出时 before-quit 的 dsh 进程树回收照常执行
}

// 手动检查(菜单「检查更新」)的信息弹窗:三态反馈共用一个入口。
function showCheckResult(message, detail) {
  dialog.showMessageBox({
    type: 'info',
    title: 'DSH Buddy',
    message,
    detail,
    buttons: ['OK'],
    noLink: true,
  });
}

// 菜单「检查更新」:显式用户意图,绕过 24h 节流立即查,并按平台分流——
// Windows 打包态走应用内自动更新(发现新版即后台下载,就绪后弹重启安装);
// 其余(macOS / 开发态)走提示式通道,有新版本时复用 notifyUpdate 引导下载。
async function checkUpdateManually() {
  if (isAutoUpdateSupported({ isPackaged: app.isPackaged })) {
    const { outcome, detail } = await checkForUpdateManually({ isPackaged: app.isPackaged });
    if (outcome === AUTO_UPDATE_OUTCOME.downloading) {
      showCheckResult(`发现新版本 ${detail}`, '正在后台下载,完成后将提示安装。');
    } else if (outcome === AUTO_UPDATE_OUTCOME.upToDate) {
      showCheckResult('已是最新版本', `当前版本 ${app.getVersion()}。`);
    } else if (outcome === AUTO_UPDATE_OUTCOME.failed) {
      showCheckResult('检查更新失败', `网络或服务不可用(${detail}),请稍后重试。`);
    }
    return;
  }
  try {
    const { outcome, detail } = await checkForUpdate({
      currentVersion: app.getVersion(),
      stateDir: app.getPath('userData'),
      notify: notifyUpdate,
      force: true,
    });
    if (outcome === UPDATE_OUTCOME.upToDate) {
      showCheckResult('已是最新版本', `当前版本 ${app.getVersion()}。`);
    } else if (outcome === UPDATE_OUTCOME.alreadyNotified) {
      // 启动时提示过但被忽略;显式点击就该再提示一次,直接复用提示弹窗
      await notifyUpdate({ version: detail, url: RELEASES_PAGE_URL });
    } else if (outcome !== UPDATE_OUTCOME.notified) {
      showCheckResult('检查更新失败', `网络或服务不可用(${detail || outcome}),请稍后重试。`);
    }
  } catch (err) {
    showCheckResult('检查更新失败', `${err.message},请稍后重试。`);
  }
}

// ---- 插件热更与 dsh 上游检测 ----

// dsh 上游(本体)发新版的信息提示:本体获取走应用整包更新通道,
// 这里只负责让用户知道「有新东西在路上」,每个版本只提示一次(由检测层记账)。
async function notifyDshUpstream({ version }) {
  await dialog.showMessageBox({
    type: 'info',
    title: 'DSH Buddy',
    message: `dsh 上游已发布新版本 ${version}`,
    detail:
      `当前内嵌 dsh ${DSH_VERSION}。\n` +
      'DSH Buddy 完成适配后会通过应用更新推送,届时按提示重启安装即可。',
    buttons: ['OK'],
    noLink: true,
  });
}

// 执行插件热更:壳托管的 dsh 先停后装再重启(运行中的 dsh 加载的是旧插件,
// 且 Windows 上运行中的文件锁会挡住替换);复用的外部 dsh 不在此列——
// 只安装,生效与否由用户自行重启那个进程决定。
// 安装成功后刷新窗口内容,让页面指向重启后的 dsh。
async function runPluginInstall({ update, dshHome }) {
  const restarting = dshProc !== null;
  if (restarting) {
    killDsh(); // killDsh 先把 dshProc 置空,exit 监听不会误报「意外退出」
    if (dshLog) {
      dshLog.close();
      dshLog = null;
    }
  }
  const result = await applyPluginUpdate({
    update,
    dshHome,
    profileName: preinstallManifest.profile,
    downloadDir: app.getPath('userData'),
  });
  const succeeded =
    result.outcome === PLUGIN_UPDATE_OUTCOME.installed ||
    result.outcome === PLUGIN_UPDATE_OUTCOME.upgraded;
  if (restarting && succeeded) {
    const ok = await ensureDsh();
    if (ok && win) {
      if (typeof win.reloadContent === 'function') win.reloadContent(); // 无边框窗口
      else win.loadURL(DSH_URL); // macOS BrowserWindow
    }
  }
  return result;
}

// 插件更新提示:列出变化;installable=false(channel 要求更高的内嵌 dsh)时
// 只提示不安装。确认后走 runPluginInstall,结果三态各自呈现。
async function notifyPluginUpdate({ update, dshHome }) {
  const lines = update.updates.map((u) => `${u.name}: ${u.from ?? '未安装'} → ${u.to}`);
  if (!update.installable) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'DSH Buddy',
      message: '内置插件有更新',
      detail:
        `${lines.join('\n')}\n\n` +
        `这批插件要求 dsh ${update.minDshVersion} 及以上,请先更新 DSH Buddy 应用本体后再接收插件更新。`,
      buttons: ['OK'],
      noLink: true,
    });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'DSH Buddy',
    message: `内置插件有 ${update.updates.length} 项更新`,
    detail: `${lines.join('\n')}\n\n现在更新?dsh 将短暂重启,无需重装应用。`,
    buttons: ['立即更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;
  const result = await runPluginInstall({ update, dshHome });
  console.log(
    `[dsh-buddy] plugin update: ${result.outcome}` +
      (result.detail ? ` (${result.detail})` : '') +
      (result.backup ? ` (旧版备份于 profiles/${result.backup})` : '')
  );
  if (result.outcome === PLUGIN_UPDATE_OUTCOME.failed) {
    dialog.showMessageBox({
      type: 'error',
      title: 'DSH Buddy',
      message: '插件更新失败',
      detail: `${result.detail}\n\n现有插件未受影响,可稍后重试。`,
      buttons: ['OK'],
      noLink: true,
    });
  } else if (result.outcome === PLUGIN_UPDATE_OUTCOME.preserved) {
    dialog.showMessageBox({
      type: 'info',
      title: 'DSH Buddy',
      message: '插件更新已跳过:当前 profile 存在清单外的插件,已保留原样未覆盖。',
      detail: (result.extras || []).join('\n'),
      buttons: ['OK'],
      noLink: true,
    });
  }
}

// 共用的 channel 调用参数(检测层不感知 electron,边界集中在这一处)。
function pluginChannelArgs() {
  const dshHome = defaultDshHome(process.env, os.homedir());
  return {
    profileDir: path.join(dshHome, 'profiles', preinstallManifest.profile),
    stateDir: app.getPath('userData'),
    currentDshVersion: DSH_VERSION,
    dshHome,
  };
}

// 启动后的插件 channel 检查:与 scheduleUpdateCheck 同一哲学——不进启动链,
// 离线/超时/节流都由检测层折叠为具名 outcome,这里只落一行日志。
// 确认更新后停 dsh→装→重启,与手动入口共用 notifyPluginUpdate 一条路径。
function schedulePluginChannelCheck() {
  const { dshHome, ...args } = pluginChannelArgs();
  checkPluginChannel({
    ...args,
    notify: ({ update }) => notifyPluginUpdate({ update, dshHome }),
  })
    .then(({ outcome, detail, dshCore }) => {
      console.log(`[dsh-buddy] plugin channel: ${outcome}${detail ? ` (${detail})` : ''}`);
      if (dshCore && dshCore.outcome === 'update-available' && !dshCore.alreadyNotified) {
        return notifyDshUpstream({ version: dshCore.latest });
      }
      return undefined;
    })
    .catch((err) => {
      console.log(`[dsh-buddy] plugin channel skipped: ${err.message}`);
    });
}

// 菜单「检查插件更新」:显式用户意图,绕过节流;已提示过的更新在用户
// 显式点击时再提示一次(与 checkUpdateManually 的 alreadyNotified 处理一致)。
async function checkPluginUpdateManually() {
  const { dshHome, ...args } = pluginChannelArgs();
  try {
    const { outcome, detail, update } = await checkPluginChannel({
      ...args,
      notify: ({ update: u }) => notifyPluginUpdate({ update: u, dshHome }),
      force: true,
    });
    if (outcome === CHANNEL_OUTCOME.upToDate) {
      showCheckResult('插件已是最新', '内置插件与发布通道一致。');
    } else if (outcome === CHANNEL_OUTCOME.alreadyNotified && update) {
      await notifyPluginUpdate({ update, dshHome });
    } else if (outcome !== CHANNEL_OUTCOME.notified) {
      showCheckResult('检查插件更新失败', `网络或服务不可用(${detail || outcome}),请稍后重试。`);
    }
  } catch (err) {
    showCheckResult('检查插件更新失败', `${err.message},请稍后重试。`);
  }
}

// 启动后的更新检查:刻意不 await,不进启动链,也不因失败影响任何既有流程。
// 平台分流:Windows 打包态走应用内自动更新(后台下载,就绪后提示重启安装);
// 其余走提示式通道——节流跳过、仓库还没发过 release、离线/超时/限流都是可预期状态,
// 由 checkForUpdate 折叠成具名 outcome,这里只落一行日志。
// 提示式路径末尾的 catch 是该链路唯一的错误边界:更新提示是纯增强项,
// 非预期错误(如 userData 不可写)也只记录,绝不弹窗、绝不影响 dsh 使用。
function scheduleUpdateCheck() {
  if (isAutoUpdateSupported({ isPackaged: app.isPackaged })) {
    const { outcome } = scheduleAutoUpdate({
      isPackaged: app.isPackaged,
      notifyReady: notifyUpdateReady,
    });
    console.log(`[dsh-buddy] update check: ${outcome}`);
    return;
  }
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
  if (!immersive) {
    // Windows/Linux:无边框 + 壳自绘标题栏视图(图标/前进后退/菜单/窗口控制),
    // 见 lib/frameless-window.js
    win = createFramelessWindow({
      dshUrl: DSH_URL,
      version: app.getVersion(),
      onCheckUpdate: checkUpdateManually,
      onCheckPluginUpdate: checkPluginUpdateManually,
    });
    win.on('closed', () => (win = null));
    return;
  }
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DSH Buddy',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  attachDragStrip(win, { version: app.getVersion() });

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
      // 失败详情已由 ensureDsh 通过 showDshFailure 呈现(含日志路径与最近输出)
      app.quit();
      return;
    }
    createWindow();
    scheduleUpdateCheck(); // 窗口出来之后再查,全程与启动链解耦
    schedulePluginChannelCheck(); // 插件热更检测,同样解耦
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
  if (dshLog) {
    dshLog.close();
    dshLog = null;
  }
});

app.on('window-all-closed', () => {
  app.quit(); // MVP 阶段:关窗即退出,macOS 常驻 Dock 二期再做
});
