/**
 * Pure version-resolution logic for the About surface. Everything here is
 * free of DOM/window access so the repo test suite (node:test, no browser)
 * can exercise it directly; the client entry passes the window globals in as
 * plain values.
 * @module dsh-buddy-about/shared/version
 */

/** Read a trimmed non-empty string field, or null when absent/invalid. */
function readVersionField(source) {
  if (source === null || typeof source !== 'object') return null;
  const value = source.version;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Resolve the DSH Buddy version to display. The shell (phase 2) injects
 * `window.__DSH_BUDDY__ = { version }`; until that lands, fall back to the
 * build-time constant stamped from this package's package.json version.
 * @param {unknown} buddyHost - value of window.__DSH_BUDDY__ (may be undefined).
 * @param {string} buildVersion - build-time fallback (package.json version).
 * @returns {string} the version to show.
 */
export function resolveBuddyVersion(buddyHost, buildVersion) {
  return readVersionField(buddyHost) ?? buildVersion;
}

/**
 * Resolve the dsh version from the boot graph (`window.__DSH_BOOT__`).
 * The rc.8 WebBootGraph wire carries only rev/entries and no version field,
 * so this normally returns null and the row is hidden; the reader stays in
 * place for the moment the host starts publishing one.
 * @param {unknown} dshBoot - value of window.__DSH_BOOT__ (may be undefined).
 * @returns {string|null} the dsh version, or null when unavailable.
 */
export function resolveDshVersion(dshBoot) {
  return readVersionField(dshBoot);
}

/**
 * Format a version for display with a single leading `v` (`0.3.0` -> `v0.3.0`,
 * `v0.3.0` stays `v0.3.0`).
 * @param {string} version - raw version string.
 * @returns {string} display tag.
 */
export function formatVersionTag(version) {
  return version.startsWith('v') ? version : `v${version}`;
}

/**
 * Build the About page view model: which rows exist and what they show.
 * The dsh row is omitted entirely when its version is unavailable.
 * @param {{ buddyHost?: unknown, dshBoot?: unknown }} env - window globals, passed in.
 * @param {string} buildVersion - build-time fallback buddy version.
 * @returns {{ buddyVersion: string, dshVersion: string|null, rows: Array<{ key: string, value: string }> }}
 */
export function resolveAboutInfo(env, buildVersion) {
  const buddyVersion = resolveBuddyVersion(env.buddyHost, buildVersion);
  const dshVersion = resolveDshVersion(env.dshBoot);
  const rows = [{ key: 'buddy', value: formatVersionTag(buddyVersion) }];
  if (dshVersion !== null) {
    rows.push({ key: 'dsh', value: formatVersionTag(dshVersion) });
  }
  return { buddyVersion, dshVersion, rows };
}
