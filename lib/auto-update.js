// Windows 应用内自动更新:仅 win32 + 打包态生效,其余平台与开发态一律 skipped,
// 由 lib/update-check.js 的提示式通道接管(macOS 自动更新硬依赖代码签名,未签名是天花板)。
// 与 update-check 同一错误哲学:自动更新是纯增强项,一切失败折叠为一行日志,
// 绝不抛进启动链;唯一会打扰用户的时刻是「新版本已下载完毕,是否重启安装」。
//
// 本模块刻意不在顶层 require electron-updater(它依赖 electron 运行时):
// 延迟到确认通道启用后再加载,于是纯 node 冒烟脚本也能直接驱动判定逻辑。

// ---- 业务默认值单一来源 ----
const AUTO_UPDATE_OUTCOME = {
  skipped: 'skipped', // 非 win32 或非打包态,通道不启用
  checking: 'checking', // 已发起后台检查(自动流程的即时返回)
  downloading: 'downloading', // 发现新版本,后台下载中
  readyToInstall: 'ready-to-install', // 下载完毕,已提示用户重启安装
  upToDate: 'up-to-date', // 远端不比当前新
  failed: 'failed', // 查询/下载失败,detail 保留原因
};

// ---- 纯逻辑 ----

// 通道启用的唯一判定来源:NSIS 安装包才支持应用内换装。
function isAutoUpdateSupported({ platform = process.platform, isPackaged }) {
  return platform === 'win32' && isPackaged === true;
}

// 发版窗口期识别:Release 已建但 latest.yml 未传完(或发布失败留下残缺
// Release)时,electron-updater 报 "Cannot find latest.yml … HttpError: 404"。
// 这不是用户的网络问题——没有 latest.yml 的版本本来就装不了,折叠为
// 「已是最新」比错误弹窗更符合事实。正式发布链已改为草稿先行消除该窗口
// (见 release.yml publish job),本判定兜底残缺 release 与旧版流水线产物。
function isPendingReleaseError(message) {
  if (typeof message !== 'string') return false;
  return /latest\.yml/i.test(message) && (/404/.test(message) || /cannot find/i.test(message));
}

// ---- IO:electron-updater 编排 ----

// 确认通道启用后才加载 electron-updater。
// logger=null:它自带的 logger 会把完整错误堆栈(含响应头)打到控制台,
// 本模块的 error 监听已负责落一行具名日志,不需要第二份噪音。
function loadAutoUpdater() {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = null;
  return autoUpdater;
}

// 启动后的自动检查:后台查询→后台下载→就绪后由 notifyReady 提示重启安装。
// notifyReady({ version }) 由调用方注入(唯一的用户可见出口之一);
// onAvailable/onProgress/onError 同为注入回调,驱动下载进度浮层
// (见 lib/update-overlay.js):下载失败不再只是一行不可见的日志。
// 返回即时 outcome,后续进展只进日志,调用方照原样打一行即可。
function scheduleAutoUpdate({ isPackaged, notifyReady, onAvailable, onProgress, onError, log = console.log }) {
  if (!isAutoUpdateSupported({ isPackaged })) {
    return { outcome: AUTO_UPDATE_OUTCOME.skipped };
  }
  const autoUpdater = loadAutoUpdater();
  autoUpdater.on('update-available', (info) => {
    log(`[dsh-buddy] auto update: ${AUTO_UPDATE_OUTCOME.downloading} (${info.version})`);
    if (onAvailable) onAvailable({ version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    if (onProgress) onProgress(progress);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log(`[dsh-buddy] auto update: ${AUTO_UPDATE_OUTCOME.readyToInstall} (${info.version})`);
    notifyReady({ version: info.version });
  });
  autoUpdater.on('error', (err) => {
    log(`[dsh-buddy] auto update: ${AUTO_UPDATE_OUTCOME.failed} (${err.message})`);
    if (onError) onError(err.message);
  });
  // electron-updater 的失败同时走 'error' 事件与 promise reject 两个通道,
  // 日志只由 error 监听落一处;这里的 catch 只负责把 reject 兑现掉,避免未处理拒绝。
  autoUpdater.checkForUpdates().catch(() => {});
  return { outcome: AUTO_UPDATE_OUTCOME.checking };
}

// 菜单「检查更新」的手动检查:与自动流程共用下载与就绪提示,
// 但把查询结果作为 Promise 返回,让调用方能给用户三态反馈
// (downloading / upToDate / failed)。一次性监听,不污染自动流程的长期监听。
function checkForUpdateManually({ isPackaged, log = console.log }) {
  if (!isAutoUpdateSupported({ isPackaged })) {
    return Promise.resolve({ outcome: AUTO_UPDATE_OUTCOME.skipped });
  }
  const autoUpdater = loadAutoUpdater();
  return new Promise((resolve) => {
    let settled = false; // 'error' 事件与 promise reject 同源双发,只结算一次
    const done = (outcome, detail) => {
      if (settled) return;
      settled = true;
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
      resolve(detail === undefined ? { outcome } : { outcome, detail });
    };
    const onAvailable = (info) => done(AUTO_UPDATE_OUTCOME.downloading, info.version);
    const onNotAvailable = () => done(AUTO_UPDATE_OUTCOME.upToDate);
    const onError = (err) => {
      // 发版窗口期:折叠为"已是最新",用户不该为 CI 构建中的几分钟看到报错
      if (isPendingReleaseError(err.message)) {
        log(`[dsh-buddy] auto update: pending release window, treated as up-to-date`);
        done(AUTO_UPDATE_OUTCOME.upToDate);
        return;
      }
      log(`[dsh-buddy] auto update: ${AUTO_UPDATE_OUTCOME.failed} (${err.message})`);
      done(AUTO_UPDATE_OUTCOME.failed, err.message);
    };
    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
    autoUpdater.checkForUpdates().catch((err) => {
      if (settled) return; // error 监听已记录并结算
      log(`[dsh-buddy] auto update: ${AUTO_UPDATE_OUTCOME.failed} (${err.message})`);
      done(AUTO_UPDATE_OUTCOME.failed, err.message);
    });
  });
}

// 重启并安装已下载的更新。只在 notifyReady 获用户确认后调用;
// 触发 app 退出,before-quit 的 dsh 进程树回收照常执行。
function quitAndInstall() {
  loadAutoUpdater().quitAndInstall();
}

module.exports = {
  AUTO_UPDATE_OUTCOME,
  isAutoUpdateSupported,
  isPendingReleaseError,
  scheduleAutoUpdate,
  checkForUpdateManually,
  quitAndInstall,
};
