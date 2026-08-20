// 更新下载进度浮层(参考 Claude 桌面端左下角的 "Downloading update…" 卡片):
// 无边框窗口的第三个 WebContentsView,壳自有 UI,与标题栏同一条设计线——
// 不注入 dsh 页面,皮肤/重渲染都不影响它。
//
// 生命周期 = 下载生命周期:发现新版本开始下载时出现,下载完成(弹重启安装)
// 或窗口关闭时消失。error 态带重试按钮:electron-updater 的下载失败原本只落
// 一行控制台日志(打包态不可见),用户面对的是"没弹窗也没动静"的盲区,
// 浮层把失败与重试入口显式化。
//
// 本模块刻意不在顶层 require electron(同 lib/auto-update.js 的哲学):
// 纯逻辑(视图模型/格式化)可被纯 node 测试直接驱动。
const path = require('path');

// ---- 业务默认值单一来源 ----
const OVERLAY_SIZE = { width: 264, height: 86 };
const OVERLAY_MARGIN = 16; // 与窗口左缘/底缘的距离
const ERROR_DETAIL_MAX = 120; // 错误文案截断长度,防止堆栈撑爆卡片

const OVERLAY_STAGE = {
  hidden: 'hidden', // 无下载活动,视图不可见
  downloading: 'downloading', // 下载中,进度条+速度
  error: 'error', // 下载失败,给重试按钮
};

const I18N = {
  zh: { downloading: '正在下载更新', error: '更新下载失败', retry: '重试' },
  en: { downloading: 'Downloading update', error: 'Update download failed', retry: 'Retry' },
};

// ---- 纯逻辑 ----

function formatMB(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  return (bytes / 1024 / 1024).toFixed(1);
}

// progress 为 electron-updater 的 download-progress 载荷:
// { percent, transferred, total, bytesPerSecond }。字段缺失时降级,不抛错。
function overlayViewModel({ stage, locale = 'zh', progress, errorMessage }) {
  const strings = I18N[locale] || I18N.en;
  if (stage === OVERLAY_STAGE.downloading) {
    const percent =
      progress && Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0;
    const parts = [];
    const transferred = progress && formatMB(progress.transferred);
    const total = progress && formatMB(progress.total);
    if (transferred !== null && total !== null) parts.push(`${transferred} / ${total} MB`);
    const speed = progress && formatMB(progress.bytesPerSecond);
    if (speed !== null) parts.push(`${speed} MB/s`);
    return {
      stage,
      title: `${strings.downloading} ${Math.round(percent)}%`,
      detail: parts.join(' · '),
      percent,
      canRetry: false,
      retryLabel: strings.retry,
    };
  }
  if (stage === OVERLAY_STAGE.error) {
    let detail = String(errorMessage || 'unknown error');
    if (detail.length > ERROR_DETAIL_MAX) detail = `${detail.slice(0, ERROR_DETAIL_MAX)}…`;
    return {
      stage,
      title: strings.error,
      detail,
      percent: null,
      canRetry: true,
      retryLabel: strings.retry,
    };
  }
  return { stage: OVERLAY_STAGE.hidden, title: '', detail: '', percent: null, canRetry: false, retryLabel: strings.retry };
}

// ---- IO:视图控制器 ----

// ctx = { win, locale, onRetry };返回控制器 { showDownloading, setProgress, reportError, hide }。
// reportError 在浮层不可见时静默略过:检查阶段的失败(404/离线)已有各自的
// 用户反馈(手动检查弹窗/自动检查日志),浮层只接管「下载已开始但失败」这段盲区。
function createUpdateOverlay({ win, locale = 'zh', onRetry }) {
  const { WebContentsView, ipcMain } = require('electron');

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'update-overlay-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(view); // 最后添加 = 叠在内容视图之上

  const layout = () => {
    const { height } = win.getContentBounds();
    view.setBounds({
      x: OVERLAY_MARGIN,
      y: height - OVERLAY_MARGIN - OVERLAY_SIZE.height,
      width: OVERLAY_SIZE.width,
      height: OVERLAY_SIZE.height,
    });
  };
  layout();
  win.on('resize', layout);

  let model = overlayViewModel({ stage: OVERLAY_STAGE.hidden, locale });
  const push = () => {
    if (!view.webContents.isDestroyed()) view.webContents.send('update-overlay:state', model);
  };
  const apply = (next) => {
    model = next;
    view.setVisible(next.stage !== OVERLAY_STAGE.hidden);
    push();
  };

  // 与标题栏同款:一次性 init 拉当前状态,retry 上报点击;发送者校验挡住伪造调用。
  ipcMain.handle('update-overlay:init', (event) => {
    if (event.sender !== view.webContents) return null;
    return model;
  });
  ipcMain.on('update-overlay:retry', (event) => {
    if (event.sender !== view.webContents) return;
    if (model.stage !== OVERLAY_STAGE.error) return; // 仅 error 态允许重试
    if (onRetry) onRetry();
  });

  view.setVisible(false);
  view.webContents.loadFile(path.join(__dirname, 'update-overlay.html'));

  return {
    showDownloading() {
      apply(overlayViewModel({ stage: OVERLAY_STAGE.downloading, locale, progress: null }));
    },
    setProgress(progress) {
      if (model.stage !== OVERLAY_STAGE.downloading) return; // 只在下载态推进度
      apply(overlayViewModel({ stage: OVERLAY_STAGE.downloading, locale, progress }));
    },
    reportError(message) {
      if (model.stage === OVERLAY_STAGE.hidden) return; // 检查阶段失败不归浮层
      apply(overlayViewModel({ stage: OVERLAY_STAGE.error, locale, errorMessage: message }));
    },
    hide() {
      apply(overlayViewModel({ stage: OVERLAY_STAGE.hidden, locale }));
    },
    isVisible() {
      return model.stage !== OVERLAY_STAGE.hidden;
    },
  };
}

module.exports = {
  OVERLAY_STAGE,
  OVERLAY_SIZE,
  OVERLAY_MARGIN,
  overlayViewModel,
  formatMB,
  createUpdateOverlay,
};
