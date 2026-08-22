// 全局快捷键转发:壳持有系统级 globalShortcut(浏览器插件无此能力),按下时
// 前置主窗并向页面派发 `dsh-buddy-hotkey` CustomEvent;页面插件自行决定响应
// (如 dispatch 插件弹出捕获面板)。这是通用机制,不含任何插件专属逻辑。
//
// 配置(环境变量,暂无设置面):
//   DSH_BUDDY_HOTKEY=<accelerator>  覆盖默认键
//   DSH_BUDDY_HOTKEY=off            关闭
// 注册失败不阻塞启动(与其他应用占用时同 dispatch 独立应用的容错策略一致)。
//
// 插件可见性:dsh 子进程经 env 感知注册结果(main.js 在 spawn env 注入,见
// hotkeyChildEnv),host 插件读 env 而非自探测。三态契约:
//   未尝试注册(DSH_BUDDY_HOTKEY=off/壳未挂载)→ 不注入,插件视为「状态未知」
//   尝试且失败 → DSH_BUDDY_HOTKEY_REGISTERED='0' + ACCELERATOR=尝试的键
//   成功       → DSH_BUDDY_HOTKEY_REGISTERED='1' + ACCELERATOR=已注册键

// electron 延迟 require:本模块的纯函数(配置解析/脚本构造/env 注入)需可在
// 无 electron 安装的环境单测;globalShortcut 仅 attach 时才真正触达。
let globalShortcut = null;

const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space';
const HOTKEY_EVENT = 'dsh-buddy-hotkey';

/** 解析环境变量配置;纯函数,便于单测 */
function resolveHotkeyConfig(env) {
  const raw = env.DSH_BUDDY_HOTKEY;
  if (raw === 'off') return { enabled: false, accelerator: null };
  const accelerator = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_ACCELERATOR;
  return { enabled: true, accelerator };
}

/** 页面注入脚本:派发具名 CustomEvent(accelerator 随行,页面可区分多键) */
function buildDispatchScript(accelerator) {
  const detail = JSON.stringify({ accelerator });
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(HOTKEY_EVENT)}, { detail: ${detail} }));`;
}

/**
 * 注册全局快捷键并接线到主窗。
 * @param {{ win: object, env: object }} parts win 须带 evalInContent(beginStartupLoading 挂载)。
 * @returns {{ registered: boolean, attempted: boolean, accelerator: string | null, dispose: () => void }}
 *   attempted 区分「未尝试注册」(off)与「尝试但失败」;accelerator 为尝试注册的键
 *   (失败时也不为 null,供 hotkeyChildEnv 透出),未尝试时为 null。
 */
function attachGlobalHotkey({ win, env }) {
  const { enabled, accelerator } = resolveHotkeyConfig(env);
  if (!enabled) {
    console.log('[dsh-buddy] global hotkey disabled by DSH_BUDDY_HOTKEY=off');
    return { registered: false, attempted: false, accelerator: null, dispose: () => {} };
  }
  globalShortcut ??= require('electron').globalShortcut;
  const fire = () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    Promise.resolve(win.evalInContent?.(buildDispatchScript(accelerator))).catch((err) => {
      console.warn(`[dsh-buddy] hotkey dispatch failed: ${err.message}`);
    });
  };
  const registered = globalShortcut.register(accelerator, fire);
  if (!registered) {
    console.warn(`[dsh-buddy] global hotkey ${accelerator} 注册失败,可能被其他应用占用`);
  } else {
    console.log(`[dsh-buddy] global hotkey ${accelerator} registered`);
  }
  return {
    registered,
    attempted: true,
    accelerator,
    dispose: () => globalShortcut.unregister(accelerator),
  };
}

/** 注入 dsh 子进程的快捷键 env(插件 host 的 app:hotkey-status 数据来源);三态见模块头注释 */
function hotkeyChildEnv(status) {
  if (!status.attempted) return {};
  if (!status.registered) {
    return { DSH_BUDDY_HOTKEY_REGISTERED: '0', DSH_BUDDY_HOTKEY_ACCELERATOR: status.accelerator };
  }
  return { DSH_BUDDY_HOTKEY_REGISTERED: '1', DSH_BUDDY_HOTKEY_ACCELERATOR: status.accelerator };
}

module.exports = { attachGlobalHotkey, hotkeyChildEnv, resolveHotkeyConfig, buildDispatchScript, HOTKEY_EVENT, DEFAULT_ACCELERATOR };
