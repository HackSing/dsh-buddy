// dsh-buddy:// 出壳桥:dsh 页面插件唯一的出壳通道是 window.open(url),
// 壳的 setWindowOpenHandler 先判本 scheme,命中即 dispatch 并 deny 打开。
// 本模块只含纯解析与常量,不含任何 Electron/窗口依赖,Windows 与 macOS
// 两条窗口路径将来都可复用(本批只接 Windows,见 lib/frameless-window.js)。

// ---- 常量单一来源:插件侧 plugins/dsh-buddy-about/src/shared/constants.js
// 与测试都以此为契约,改名必须三处同步 ----
const BUDDY_SCHEME = 'dsh-buddy';

// 页面内注入的全局桥对象与变更事件名(壳 did-finish-load 后注入)。
const BUDDY_INFO_GLOBAL = '__DSH_BUDDY__';
const BUDDY_INFO_EVENT = 'dsh-buddy:info';

// 动作 id 扁平命名,不用 win:minimize 这类带冒号的形式:
// URL 语法里 hostname 后的冒号被当作端口分隔符,new URL() 直接抛 Invalid URL
// (已实测),所以窗口动作一律用连字符。动作 id 全部小写——非特殊 scheme 的
// hostname 不会被 URL 解析器小写化,解析时严格匹配,不做大小写归一。
const BUDDY_ACTIONS = Object.freeze([
  'check-update',
  'check-plugin-update',
  'win-minimize',
  'win-toggle-maximize',
  'win-close',
]);

const BUDDY_ACTION_SET = new Set(BUDDY_ACTIONS);

/**
 * 解析 buddy scheme URL。
 * @param {unknown} url 待解析的 URL 字符串。
 * @returns {string|null} 合法动作 id;非本 scheme、未知动作、带路径或
 *   无法解析时一律返回 null。
 */
function parseBuddyAction(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${BUDDY_SCHEME}:`) return null;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null;
  const action = parsed.hostname;
  return BUDDY_ACTION_SET.has(action) ? action : null;
}

/**
 * 判断是否本 scheme 的 URL(无论动作是否已知)。用于 dispatch 层区分
 * "未知动作,报错并 deny" 与 "非本 scheme,交给外部浏览器"。
 * @param {unknown} url 待判断的 URL 字符串。
 * @returns {boolean}
 */
function isBuddySchemeUrl(url) {
  return typeof url === 'string' && url.startsWith(`${BUDDY_SCHEME}://`);
}

module.exports = {
  BUDDY_SCHEME,
  BUDDY_INFO_GLOBAL,
  BUDDY_INFO_EVENT,
  BUDDY_ACTIONS,
  parseBuddyAction,
  isBuddySchemeUrl,
};
