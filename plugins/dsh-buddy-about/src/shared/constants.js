/**
 * Business constants for dsh-buddy-about — the single source for every
 * default this plugin uses. The build script reads the version from
 * package.json; everything else lives here.
 * @module dsh-buddy-about/shared/constants
 */

/**
 * GitHub releases page of the DSH Buddy shell. Mirrors the shell-side
 * RELEASES_PAGE_URL in lib/update-check.js; the test suite asserts the two
 * stay identical. Phase-1 update buttons degrade to window.open() of this
 * page (the shell's setWindowOpenHandler forwards it to the system browser).
 */
export const RELEASES_PAGE_URL = 'https://github.com/HackSing/dsh-buddy/releases';

/**
 * Shell bridge scheme URLs (batch-2 out-of-shell channel). window.open() of
 * these is intercepted by the shell's setWindowOpenHandler and dispatched to
 * the shell-side update checks — see lib/buddy-scheme.js in the shell repo.
 * The action ids must stay byte-identical with BUDDY_ACTIONS there; the repo
 * test suite asserts every URL below is recognized by parseBuddyAction.
 * Note: flat ids with hyphens — a colon after the hostname (e.g.
 * dsh-buddy://win:minimize) is parsed as a port separator and new URL() throws.
 */
export const BUDDY_CHECK_UPDATE_URL = 'dsh-buddy://check-update';
export const BUDDY_CHECK_PLUGIN_UPDATE_URL = 'dsh-buddy://check-plugin-update';

/** Window-control action URLs — same contract discipline as the update URLs. */
export const BUDDY_WIN_MINIMIZE_URL = 'dsh-buddy://win-minimize';
export const BUDDY_WIN_TOGGLE_MAXIMIZE_URL = 'dsh-buddy://win-toggle-maximize';
export const BUDDY_WIN_CLOSE_URL = 'dsh-buddy://win-close';

/**
 * Event the shell dispatches on window after injecting/updating
 * window.__DSH_BUDDY__ (mirrors BUDDY_INFO_EVENT in the shell's
 * lib/buddy-scheme.js; the repo test suite asserts the two stay identical).
 * Listened to by the sidebar badge to refresh the version text once the
 * bridge lands (did-finish-load injection postdates plugin apply).
 */
export const BUDDY_INFO_EVENT = 'dsh-buddy:info';

/** Slot registration identity for the first-level settings section. */
export const SETTINGS_SECTION_ID = 'dsh-buddy-about';
/** Left-nav ordering of the section (larger sorts later; pet uses 130). */
export const SETTINGS_SECTION_ORDER = 900;

/** Locale dictionary namespace owned by this plugin. */
export const LOCALE_NS = 'dsh-buddy-about';

/**
 * Idempotency attribute of the injected sidebar version row. The row is
 * located by this attribute before every mount, so a duplicated apply or a
 * surviving row from an earlier injection never produces a second row.
 */
export const SIDEBAR_ROW_ATTRIBUTE = 'data-dsh-buddy-version';
/** Selector matching the injected sidebar version row. */
export const SIDEBAR_ROW_SELECTOR = '[data-dsh-buddy-version]';

/**
 * Fuzzy anchor selectors (shell DOM class names carry build hashes, so only
 * attribute/substring selectors are stable — see docs/dsh-web-ui-plugin-guide.md
 * §5.2). The column is the layout sidebar column; the foot area is the
 * sidebar bottom block holding the settings row.
 */
export const SIDEBAR_COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]';
export const SIDEBAR_FOOT_SELECTOR = '[class*="footArea"]';

/**
 * Idempotency attribute of the injected window-controls cluster and the
 * drag-region <style> element (same lookup-before-mount discipline as the
 * sidebar row).
 */
export const WIN_CONTROLS_ATTRIBUTE = 'data-dsh-buddy-wincontrols';
export const WIN_CONTROLS_SELECTOR = '[data-dsh-buddy-wincontrols]';
export const DRAG_STYLE_ATTRIBUTE = 'data-dsh-buddy-drag';
export const DRAG_STYLE_SELECTOR = `style[${DRAG_STYLE_ATTRIBUTE}]`;

/**
 * Fuzzy anchors probed from the live DOM via CDP (2026-08-20, dsh rc build):
 * - toggleCluster: the shell UI's own top-right overlay button pair
 *   (position:absolute; right:10px; top:3px; flex, gap:4px, 28px round
 *   buttons). It is right-anchored, so appending our controls grows it
 *   leftward and keeps ours rightmost.
 * - logoRow: sidebar top brand row (contains the brand button).
 * - scrollBody > header: main-pane page header (76px tall, session pages;
 *   absent on the home page, where the main-pane top is bare scrollBody).
 */
export const TOGGLE_CLUSTER_SELECTOR = '[class*="toggleCluster"]';
export const LOGO_ROW_SELECTOR = '[class*="logoRow"]';
// header 是 wSkVaW_root 的后代而非 scrollBody 的直接子元素(CDP 实测),
// 用 tag + 类名后缀模糊匹配。
export const MAIN_HEADER_SELECTOR = 'header[class*="header"]';
