// 启动加载页的路径与注入脚本(纯数据模块,不依赖 electron,可直接单测)。
// 加载页是本地静态文件,阶段文案由主进程经 executeJavaScript 单向推送,
// 页内 window.__setStage 是唯一接口;注入脚本经 JSON.stringify 转义,
// 与 frameless-window.js 的 buildBuddyInfoScript 同一模式。

const path = require('path');

const LOADING_PAGE_PATH = path.join(__dirname, 'loading.html');

// 阶段文案注入脚本:页面尚未定义 __setStage(加载极早期)时静默跳过,
// 阶段推进是单调的,后续注入会带上最新文案,丢一帧只影响文案不影响流程。
function buildStageScript(text) {
  return (
    `if (typeof window.__setStage === 'function') ` +
    `window.__setStage(${JSON.stringify(String(text))});`
  );
}

module.exports = { LOADING_PAGE_PATH, buildStageScript };
