// 窗口模式开关(纯函数,不依赖 Electron,可直接单测)。
// 默认 borderless(完全无框,窗口控制/拖拽由 dsh 页面插件提供);
// 环境变量 DSH_BUDDY_TITLEBAR=legacy 回退到带 38px 自绘标题栏的旧窗口。

// ---- 业务默认值单一来源 ----
const WINDOW_MODE_ENV = 'DSH_BUDDY_TITLEBAR';
const WINDOW_MODE_LEGACY_VALUE = 'legacy';

/**
 * 解析窗口模式。大小写敏感,只有精确 'legacy' 回退;其他取值(含缺省)
 * 一律 borderless。
 * @param {Record<string, string|undefined>|undefined} env 通常传 process.env。
 * @returns {'borderless'|'legacy'}
 */
function resolveWindowMode(env) {
  return (env || {})[WINDOW_MODE_ENV] === WINDOW_MODE_LEGACY_VALUE ? 'legacy' : 'borderless';
}

module.exports = { WINDOW_MODE_ENV, resolveWindowMode };
