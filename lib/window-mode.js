// 窗口模式开关(纯函数,不依赖 Electron,可直接单测)。
// 默认 legacy(38px 自绘标题栏,配色跟随 dsh 皮肤,见 lib/frameless-window.js
// 的皮肤同步);环境变量 DSH_BUDDY_TITLEBAR=native 切原生标题栏(菜单栏
// autoHideMenuBar 藏起、Alt 呼出),=borderless 切完全无框(窗口控制/拖拽
// 由 dsh 页面插件提供)。

// ---- 业务默认值单一来源 ----
const WINDOW_MODE_ENV = 'DSH_BUDDY_TITLEBAR';
const WINDOW_MODE_NATIVE_VALUE = 'native';
const WINDOW_MODE_BORDERLESS_VALUE = 'borderless';

/**
 * 解析窗口模式。大小写敏感,只有精确 'native'/'borderless' 切换;
 * 其他取值(含缺省)一律 legacy。
 * @param {Record<string, string|undefined>|undefined} env 通常传 process.env。
 * @returns {'native'|'borderless'|'legacy'}
 */
function resolveWindowMode(env) {
  const value = (env || {})[WINDOW_MODE_ENV];
  if (value === WINDOW_MODE_NATIVE_VALUE) return 'native';
  if (value === WINDOW_MODE_BORDERLESS_VALUE) return 'borderless';
  return 'legacy';
}

module.exports = { WINDOW_MODE_ENV, resolveWindowMode };
