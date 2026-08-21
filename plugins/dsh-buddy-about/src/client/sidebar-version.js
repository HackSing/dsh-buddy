/**
 * Sidebar version badge: a small plain-DOM row injected at the bottom of the
 * dsh sidebar, next to the shell's settings row. Follows the three injection
 * disciplines from the plugin guide §5.2 (task-board precedent):
 * 1. fuzzy attribute/substring selectors only (shell class names carry build
 *    hashes) — see shared/constants.js for the anchor selectors;
 * 2. a plain DOM element, never a React root, so it cannot disturb the
 *    shell's reconciliation;
 * 3. double MutationObserver self-heal: a body-level watcher notices
 *    whole-tree rebuilds (skin switch), a column-level observer re-inserts
 *    the row in the same frame when a React re-render displaces it.
 * Idempotency: the row carries data-dsh-buddy-version and is looked up before
 * every mount.
 * @module dsh-buddy-about/client/sidebar-version
 */

import {
  BUDDY_INFO_EVENT,
  SIDEBAR_COLUMN_SELECTOR,
  SIDEBAR_FOOT_SELECTOR,
  SIDEBAR_ROW_ATTRIBUTE,
  SIDEBAR_ROW_SELECTOR,
} from '../shared/constants.js';
import { formatVersionTag, resolveBuddyVersion } from '../shared/version.js';

/**
 * Find the sidebar foot area (the bottom block owning the settings row), or
 * undefined while the shell has not rendered the sidebar yet.
 * @returns {HTMLElement|undefined}
 */
function sidebarFoot() {
  const column = document.querySelector(SIDEBAR_COLUMN_SELECTOR);
  if (column === null) return undefined;
  const foot = column.querySelector(SIDEBAR_FOOT_SELECTOR);
  return foot === null ? undefined : foot;
}

/**
 * Write the row text. Kept separate from creation so the bridge-event refresh
 * can re-render in place — the self-heal observers always re-insert the same
 * node, so one textContent write covers every (re)mounted position.
 * @param {HTMLElement} row - the version row.
 * @param {string} version - raw buddy version.
 */
function renderRowText(row, version) {
  row.textContent = `DSH Buddy ${formatVersionTag(version)}`;
}

/**
 * Build the detached version row. Colors come from dsh CSS variables so the
 * badge follows the active skin.
 * @param {string} version - raw buddy version.
 * @returns {HTMLDivElement}
 */
function createRow(version) {
  const row = document.createElement('div');
  row.setAttribute(SIDEBAR_ROW_ATTRIBUTE, '');
  renderRowText(row, version);
  row.style.cssText =
    'padding:2px 4px 6px;font-size:11px;line-height:1.4;user-select:none;' +
    'color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-primary, currentColor));' +
    'opacity:0.55;';
  return row;
}

/**
 * Mount the version row at the sidebar bottom and keep it alive across shell
 * re-renders.
 *
 * Version freshness: the shell injects window.__DSH_BUDDY__ after
 * did-finish-load — later than plugin apply — so the version passed in may be
 * the build-time fallback. Every (re)placement and every BUDDY_INFO_EVENT
 * (also fired on maximize/unmaximize) re-resolves live and re-renders the
 * row text, so the badge settles on the real shell version once the bridge
 * lands, and a React-dropped row re-mounts with the latest value.
 * @param {{ version: string }} options - buddy version resolved at apply time.
 * @returns {() => void} disposer removing the row, both observers and the
 *   bridge-event listener.
 */
export function mountSidebarVersion({ version }) {
  // Live re-resolve + in-place text update; also serves as the event handler.
  const refresh = () => {
    const row = document.querySelector(SIDEBAR_ROW_SELECTOR);
    if (row !== null) renderRowText(row, resolveBuddyVersion(window.__DSH_BUDDY__, version));
  };
  window.addEventListener(BUDDY_INFO_EVENT, refresh);
  const dispose = () => window.removeEventListener(BUDDY_INFO_EVENT, refresh);

  // DOM-level idempotency: a row mounted by an earlier apply (duplicated
  // injection, stale module) keeps working; never mount a second one. The
  // listener above still takes over its text refresh.
  if (document.querySelector(SIDEBAR_ROW_SELECTOR) !== null) {
    return dispose;
  }
  const row = createRow(version);
  let foot;

  const tryPlace = () => {
    if (foot !== undefined && !foot.isConnected) {
      // Whole-tree teardown (e.g. skin switch): the column observer died with
      // the old tree; re-query from scratch. The body watcher notices the new
      // sidebar mounting.
      footObserver.disconnect();
      foot = undefined;
    }
    foot ??= sidebarFoot();
    if (foot === undefined) return;
    if (!foot.contains(row)) {
      // Appended after the settings area inside the foot block.
      foot.appendChild(row);
    }
    footObserver.observe(foot, { childList: true, subtree: true });
    // The bridge event may have fired while the row was detached; re-render
    // now that it is connected so the text is current.
    refresh();
  };

  // Body-level watcher: the only channel that notices a whole-sidebar
  // rebuild; short-circuits cheaply while the row is in place.
  const bodyObserver = new MutationObserver(() => {
    if (row.isConnected) return;
    tryPlace();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  // Column-level self-heal: re-insert in the same frame (microtask before
  // paint, no flicker) when a React re-render drops the row.
  const footObserver = new MutationObserver(() => {
    if (foot === undefined || !foot.isConnected) {
      tryPlace();
      return;
    }
    if (!foot.contains(row)) foot.appendChild(row);
  });

  tryPlace();

  return () => {
    dispose();
    bodyObserver.disconnect();
    footObserver.disconnect();
    row.remove();
  };
}
