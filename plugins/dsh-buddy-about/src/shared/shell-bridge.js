/**
 * Out-of-shell routing for the update buttons — pure logic, no window access,
 * so the repo test suite can exercise it directly. The button handlers pass
 * the live value of window.__DSH_BUDDY__ at click time (the shell injects it
 * after did-finish-load, which may postdate plugin apply).
 * @module dsh-buddy-about/shared/shell-bridge
 */

import {
  BUDDY_CHECK_PLUGIN_UPDATE_URL,
  BUDDY_CHECK_UPDATE_URL,
  RELEASES_PAGE_URL,
} from './constants.js';

/** The two update-check kinds surfaced on the About page. */
export const UPDATE_KIND_APP = 'app';
export const UPDATE_KIND_PLUGIN = 'plugin';

/** The shell bridge is present when __DSH_BUDDY__ was injected as an object. */
export function hasBuddyBridge(buddyHost) {
  return typeof buddyHost === 'object' && buddyHost !== null;
}

/**
 * Read the maximized flag from the bridge; false whenever the bridge is
 * absent (plain browser — the maximize/restore icon then never renders).
 * @param {unknown} buddyHost - live value of window.__DSH_BUDDY__.
 * @returns {boolean}
 */
export function readBuddyMaximized(buddyHost) {
  return hasBuddyBridge(buddyHost) && buddyHost.isMaximized === true;
}

/**
 * Resolve where an update-check click should go.
 * Inside the shell (bridge injected): the dsh-buddy:// scheme URL, which the
 * shell's setWindowOpenHandler intercepts and dispatches to the real check.
 * In a plain browser (no bridge): the GitHub releases page, as in batch 1.
 * @param {unknown} buddyHost - live value of window.__DSH_BUDDY__.
 * @param {string} kind - UPDATE_KIND_APP or UPDATE_KIND_PLUGIN.
 * @returns {string} URL to hand to window.open().
 */
export function resolveUpdateTarget(buddyHost, kind) {
  if (!hasBuddyBridge(buddyHost)) return RELEASES_PAGE_URL;
  return kind === UPDATE_KIND_PLUGIN ? BUDDY_CHECK_PLUGIN_UPDATE_URL : BUDDY_CHECK_UPDATE_URL;
}
