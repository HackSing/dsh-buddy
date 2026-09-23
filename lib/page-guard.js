// 壳层页面守护:「窗口内容活性」不变量的所有者层实现(docs/plans/shell-page-guard.md)。
// 背景:2026-08-23 白屏事故——dsh 页面运行中死亡,壳对此零感知。
// 三类确定性恢复触发:渲染进程死亡(render-process-gone)、主帧加载失败
// (did-fail-load)、持续无响应(unresponsive 超宽限);外加服务端代际更替探测
// (轮询首页 __DSH_BOOT__ 顶层 rev,变化即页面所依赖的模块图已过期)。
// 纯逻辑(extractBootRev / createReloadGovernor)与 electron 接线(attachPageGuard)
// 分离;probe / log / refresh / 时钟均可注入,单测不依赖 electron。
const path = require('path');
const fs = require('fs');
const { probeBody } = require('./http-probe');
const { openLogFile } = require('./dsh-log');

// ---- 业务默认值单一来源 ----
// 代际探测周期:restart-web.sh 类外部重启的检出上限;30s 对本地回环无感。
const GENERATION_PROBE_INTERVAL_MS = 30_000;
// 风暴抑制:两次自动恢复最小间隔 / 滑动窗口内最多次数。恢复动作本身可能
// 因服务端未就绪再次失败,抑制参数决定重试节奏并防止 reload 循环。
const RELOAD_MIN_INTERVAL_MS = 30_000;
const RELOAD_MAX_PER_WINDOW = 3;
const RELOAD_WINDOW_MS = 300_000;
// 无响应宽限:unresponsive 常由重活的 JS 触发且多数自愈,等 responsive 回来。
const UNRESPONSIVE_GRACE_MS = 15_000;
// Chromium net error:主动取消(用户/程序发起的二次导航),非故障。
const ERR_ABORTED = -3;
const LOG_FILE_NAME = 'page-guard.log';

// 从 dsh 首页 HTML 提取 __DSH_BOOT__ 的顶层 rev(服务端模块图代际标识)。
// 形如 globalThis["__DSH_BOOT__"] = {"rev":"6a7c7b7b96e6",...};提取不到返回 null。
function extractBootRev(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/__DSH_BOOT__[^=]*=\s*\{[^{]*"rev":"([^"]+)"/);
  return m ? m[1] : null;
}

// 风暴抑制器:allow() 在窗口内次数未满且距上次放行超过最小间隔时放行并记账;
// 拒绝不消耗名额。时钟可注入以便单测。
function createReloadGovernor({
  minIntervalMs = RELOAD_MIN_INTERVAL_MS,
  maxPerWindow = RELOAD_MAX_PER_WINDOW,
  windowMs = RELOAD_WINDOW_MS,
  now = Date.now,
} = {}) {
  let granted = [];
  return {
    allow() {
      const t = now();
      granted = granted.filter((x) => t - x < windowMs);
      if (granted.length >= maxPerWindow) return false;
      if (granted.length > 0 && t - granted[granted.length - 1] < minIntervalMs) return false;
      granted.push(t);
      return true;
    },
  };
}

// 事件日志:落盘 userData/logs/page-guard.log(每次运行截断,与 dsh.log 同纪律)
// 并回显控制台。打不开/写失败只降级为无落盘,警告一次,不影响守护本体。
function createGuardLog(dir) {
  const filePath = path.join(dir, LOG_FILE_NAME);
  const opened = openLogFile(dir, filePath);
  let writeError = opened.error;
  if (writeError) {
    console.warn(`[dsh-buddy] page-guard log unavailable: ${writeError.message}`);
  }
  return (line) => {
    const stamped = `${new Date().toISOString()} ${line}\n`;
    console.log(`[dsh-buddy] page-guard: ${line}`);
    if (opened.fd !== null && !writeError) {
      try {
        fs.writeSync(opened.fd, stamped);
      } catch (err) {
        writeError = err;
        console.warn(`[dsh-buddy] page-guard log write failed: ${err.message}`);
      }
    }
  };
}

/**
 * 挂载页面守护。调用方约定:在内容页首次 loadContent(dsh 地址)之后调用。
 * 必填:
 *   contents — 内容视图的 WebContents(事件源)
 *   refresh  — () => void,恢复动作(reload 或重新 loadContent,由调用方决定)
 *   url      — dsh 服务地址(代际探测目标)
 *   logDir   — 事件日志目录(通常 userData/logs);传入 log 时忽略
 * 可注入(测试缝,生产用默认值):log、probe、intervalMs、unresponsiveGraceMs、governor
 * 返回 { dispose };contents 销毁时自动 dispose。
 */
function attachPageGuard({
  contents,
  refresh,
  url,
  logDir,
  log,
  probe = probeBody,
  intervalMs = GENERATION_PROBE_INTERVAL_MS,
  unresponsiveGraceMs = UNRESPONSIVE_GRACE_MS,
  governor = createReloadGovernor(),
}) {
  const emit = log ?? createGuardLog(logDir);
  let disposed = false;
  let baselineRev = null; // 当前页面所对应的服务端代际;由成功加载与首次探测维护
  let pageBroken = false; // 页面已知死亡(加载失败/进程死):探测循环据此持续重试恢复
  let unresponsiveTimer = null;
  let suppressedLogged = false; // 抑制期只记一次,避免刷屏

  const recover = (reason) => {
    if (disposed) return;
    if (!governor.allow()) {
      if (!suppressedLogged) {
        emit(`recover suppressed (storm guard): ${reason}`);
        suppressedLogged = true;
      }
      return;
    }
    suppressedLogged = false;
    emit(`recover: ${reason}`);
    refresh();
  };

  // 成功加载是「页面与服务端代际对齐」的唯一时点:在此重置基线与死亡标记。
  // 插件热更流程自己触发的 reload 也走到这里,基线随之对齐,不会引发误恢复。
  const onFinishLoad = async () => {
    pageBroken = false;
    const res = await probe(url);
    const rev = res ? extractBootRev(res.body) : null;
    if (rev !== null && rev !== baselineRev) {
      baselineRev = rev;
      emit(`baseline rev ${rev}`);
    }
  };

  const onGone = (_event, details) => {
    if (details.reason === 'clean-exit') return; // 正常退出路径,非故障
    pageBroken = true;
    recover(`render process gone (${details.reason})`);
  };

  const onFailLoad = (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return;
    pageBroken = true;
    recover(`main frame load failed (${errorCode} ${errorDescription})`);
  };

  const onUnresponsive = () => {
    if (unresponsiveTimer) return;
    emit('renderer unresponsive, grace started');
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      recover('renderer stayed unresponsive past grace');
    }, unresponsiveGraceMs);
  };

  const onResponsive = () => {
    if (!unresponsiveTimer) return;
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
    emit('renderer responsive again within grace');
  };

  // 代际探测:加载中不探(恢复/热更的过渡态,等 did-finish-load 对齐基线);
  // 服务不可达不动作(刷新只会得到错误页,等它回来);页面已死则每周期重试
  // 恢复(节奏由 governor 决定),覆盖「加载失败后服务才恢复」的窗口。
  const tick = async () => {
    if (disposed || contents.isDestroyed() || contents.isLoading()) return;
    const res = await probe(url);
    if (!res) return;
    if (pageBroken) {
      recover('server reachable while page is broken');
      return;
    }
    const rev = extractBootRev(res.body);
    if (rev === null) return;
    if (baselineRev === null) {
      baselineRev = rev;
      emit(`baseline rev ${rev}`);
      return;
    }
    if (rev !== baselineRev) {
      recover(`server generation changed (${baselineRev} -> ${rev})`);
    }
  };
  const timer = setInterval(tick, intervalMs);

  contents.on('did-finish-load', onFinishLoad);
  contents.on('render-process-gone', onGone);
  contents.on('did-fail-load', onFailLoad);
  contents.on('unresponsive', onUnresponsive);
  contents.on('responsive', onResponsive);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    contents.removeListener('did-finish-load', onFinishLoad);
    contents.removeListener('render-process-gone', onGone);
    contents.removeListener('did-fail-load', onFailLoad);
    contents.removeListener('unresponsive', onUnresponsive);
    contents.removeListener('responsive', onResponsive);
  };
  contents.on('destroyed', dispose);

  return { dispose };
}

module.exports = { attachPageGuard, createReloadGovernor, extractBootRev };
