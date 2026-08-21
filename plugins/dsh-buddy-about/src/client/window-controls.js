/**
 * Window controls + drag region for the frameless shell (batch 2, preparing
 * the removal of the shell's own 38px titlebar view).
 *
 * Three buttons (minimize / maximize|restore / close) are appended into the
 * dsh top-right toggleCluster — a right-anchored absolute flex overlay, so
 * appended buttons stay rightmost without covering dsh's own toggles. Clicks
 * are real user activations, so window.open('dsh-buddy://win-*') reaches the
 * shell's setWindowOpenHandler (batch-1 verified path).
 *
 * Bridge gate: the controls are meaningless in a plain browser and duplicate
 * the titlebar buttons under the native/legacy shells, so they mount only
 * once window.__DSH_BUDDY__ exists AND the shell opted in via
 * windowControls: true (borderless mode). The shell injects the bridge after
 * did-finish-load, which postdates plugin apply — we listen for
 * BUDDY_INFO_EVENT and mount when the bridge lands. The same event fires on
 * maximize/unmaximize and drives the maximize/restore icon switch.
 *
 * Self-heal mirrors sidebar-version.js: body-level MutationObserver for
 * whole-tree rebuilds, anchor-level observer for same-frame re-insert,
 * data-attribute idempotency. The drag <style> lives in document.head and is
 * re-checked by the same body observer.
 * @module dsh-buddy-about/client/window-controls
 */

import {
  BUDDY_INFO_EVENT,
  BUDDY_WIN_CLOSE_URL,
  BUDDY_WIN_MINIMIZE_URL,
  BUDDY_WIN_TOGGLE_MAXIMIZE_URL,
  DRAG_STYLE_ATTRIBUTE,
  DRAG_STYLE_SELECTOR,
  LOGO_ROW_SELECTOR,
  MAIN_HEADER_SELECTOR,
  TOGGLE_CLUSTER_SELECTOR,
  WIN_CONTROLS_ATTRIBUTE,
  WIN_CONTROLS_SELECTOR,
} from '../shared/constants.js';
import { readBuddyMaximized, readBuddyWindowControls } from '../shared/shell-bridge.js';

/** Per-button control key used for lookup and the maximize-icon swap. */
const CONTROL_KEY_ATTRIBUTE = 'data-dsh-buddy-control';

// Line icons, 16px, currentColor — matching the neighbouring toggleButton
// visuals (28x28 round button, 16px svg, tertiary label color).
const ICONS = {
  minimize:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
    '<path d="M3.5 8h9" stroke="currentColor" stroke-width="1.2"/></svg>',
  maximize:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
    '<rect x="3.5" y="3.5" width="9" height="9" stroke="currentColor" stroke-width="1.2"/></svg>',
  restore:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
    '<path d="M5.5 5.5v-2h7v7h-2" stroke="currentColor" stroke-width="1.2"/>' +
    '<rect x="3.5" y="5.5" width="7" height="7" stroke="currentColor" stroke-width="1.2"/></svg>',
  close:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
    '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2"/></svg>',
};

// Drag region: sidebar brand row + main-pane page header become the window
// drag surface; every interactive descendant stays clickable via no-drag.
// (Electron-only CSS, ignored by plain browsers. The home page main pane has
// no header element — its top strip is bare scrollBody and stays non-drag;
// the drag surface there is the sidebar logoRow.)
// 中间层容器(titleRow/titleCluster)默认 region:none 会盖住 header 的 drag,
// 使可拖区只剩 header 自身的 padding(实测仅剩顶部约 6px)。把它们一并设 drag,
// 交互后代(button 等)仍由 no-drag 规则兜底,空白空隙即可拖。
const DRAG_CSS =
  `${LOGO_ROW_SELECTOR}, ${MAIN_HEADER_SELECTOR},\n` +
  `${MAIN_HEADER_SELECTOR} [class*="titleRow"], ${MAIN_HEADER_SELECTOR} [class*="titleCluster"] {\n` +
  '  -webkit-app-region: drag;\n' +
  '}\n' +
  `${LOGO_ROW_SELECTOR} :is(button, a, input, select, textarea, [role="button"], [draggable="true"]),\n` +
  `${MAIN_HEADER_SELECTOR} :is(button, a, input, select, textarea, [role="button"], [draggable="true"]) {\n` +
  '  -webkit-app-region: no-drag;\n' +
  '}\n' +
  `${WIN_CONTROLS_SELECTOR} { display: flex; gap: 4px; align-items: center; }\n` +
  `${WIN_CONTROLS_SELECTOR} button {\n` +
  '  width: 28px; height: 28px; padding: 0; border: none; border-radius: 50%;\n' +
  '  background: transparent; cursor: pointer;\n' +
  '  color: var(--dsw-alias-label-tertiary, #61666b);\n' +
  '  display: flex; align-items: center; justify-content: center;\n' +
  '}\n' +
  `${WIN_CONTROLS_SELECTOR} button:hover {\n` +
  '  background: var(--dsw-alias-fill-secondary, rgba(127, 127, 127, 0.14));\n' +
  '  color: var(--dsw-alias-label-primary, currentColor);\n' +
  '}\n' +
  // Windows-native close hover (#e81123 white-on-red).
  `${WIN_CONTROLS_SELECTOR} button[${CONTROL_KEY_ATTRIBUTE}="close"]:hover {\n` +
  '  background: #e81123; color: #fff;\n' +
  '}\n';

const BUTTON_DEFS = [
  { key: 'minimize', url: BUDDY_WIN_MINIMIZE_URL },
  { key: 'maximize', url: BUDDY_WIN_TOGGLE_MAXIMIZE_URL },
  { key: 'close', url: BUDDY_WIN_CLOSE_URL },
];

/** Inject the drag/controls stylesheet once (looked up by data attribute). */
function ensureDragStyle() {
  if (document.querySelector(DRAG_STYLE_SELECTOR) !== null) return;
  const style = document.createElement('style');
  style.setAttribute(DRAG_STYLE_ATTRIBUTE, '');
  style.textContent = DRAG_CSS;
  document.head.appendChild(style);
}

/**
 * Build the detached controls cluster. Clicks open the buddy scheme URLs;
 * deny semantics mean window.open returns null — arrival is observed
 * shell-side, not via the return value.
 * @param {{ t: (key: string) => string }} options - bound locale translator.
 * @returns {HTMLDivElement}
 */
function createControls({ t }) {
  const box = document.createElement('div');
  box.setAttribute(WIN_CONTROLS_ATTRIBUTE, '');
  for (const def of BUTTON_DEFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(CONTROL_KEY_ATTRIBUTE, def.key);
    btn.setAttribute('aria-label', t(`controls.${def.key}`));
    btn.title = t(`controls.${def.key}`);
    btn.innerHTML = ICONS[def.key];
    btn.addEventListener('click', () => window.open(def.url));
    box.appendChild(btn);
  }
  return box;
}

/**
 * Swap the maximize/restore icon and label from the live bridge state.
 * @param {HTMLElement} box - the controls cluster.
 * @param {{ t: (key: string) => string }} options - bound locale translator.
 */
function syncMaximizeIcon(box, { t }) {
  const btn = box.querySelector(`[${CONTROL_KEY_ATTRIBUTE}="maximize"]`);
  if (btn === null) return;
  const maximized = readBuddyMaximized(window.__DSH_BUDDY__);
  btn.innerHTML = maximized ? ICONS.restore : ICONS.maximize;
  const label = t(maximized ? 'controls.restore' : 'controls.maximize');
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

/**
 * Mount the window controls (bridge-gated) and keep them + the drag style
 * alive across shell re-renders.
 * @param {{ t: (key: string) => string }} options - bound locale translator.
 * @returns {() => void} disposer removing the listener, observers, cluster
 *   and stylesheet.
 */
export function mountWindowControls({ t }) {
  // Adopt a surviving cluster from an earlier injection; never mount twice.
  let box = document.querySelector(WIN_CONTROLS_SELECTOR);
  let anchor;

  const anchorObserver = new MutationObserver(() => {
    if (anchor === undefined || !anchor.isConnected) {
      tryPlace();
      return;
    }
    if (box !== null && !anchor.contains(box)) anchor.appendChild(box);
  });

  const tryPlace = () => {
    // Bridge gate: only a borderless shell injects windowControls: true;
    // plain browser / native / legacy shells -> nothing to mount.
    if (!readBuddyWindowControls(window.__DSH_BUDDY__)) return;
    ensureDragStyle();
    if (anchor !== undefined && !anchor.isConnected) {
      anchorObserver.disconnect();
      anchor = undefined;
    }
    anchor ??= document.querySelector(TOGGLE_CLUSTER_SELECTOR) ?? undefined;
    if (anchor === undefined) return;
    box ??= document.querySelector(WIN_CONTROLS_SELECTOR);
    box ??= createControls({ t });
    if (!anchor.contains(box)) anchor.appendChild(box);
    syncMaximizeIcon(box, { t });
    anchorObserver.observe(anchor, { childList: true, subtree: true });
  };

  const bodyObserver = new MutationObserver(() => {
    const styleMissing = document.querySelector(DRAG_STYLE_SELECTOR) === null;
    if (box !== null && box.isConnected && !styleMissing) return;
    tryPlace();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  // Bridge arrival (injection postdates apply) + maximize/unmaximize events.
  const onBuddyInfo = () => {
    if (box === null || !box.isConnected) {
      tryPlace();
    } else {
      syncMaximizeIcon(box, { t });
    }
  };
  window.addEventListener(BUDDY_INFO_EVENT, onBuddyInfo);

  tryPlace();

  return () => {
    window.removeEventListener(BUDDY_INFO_EVENT, onBuddyInfo);
    bodyObserver.disconnect();
    anchorObserver.disconnect();
    box?.remove();
    document.querySelector(DRAG_STYLE_SELECTOR)?.remove();
  };
}
