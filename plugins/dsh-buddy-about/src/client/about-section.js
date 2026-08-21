/**
 * About settings section: a static React component (no settingsScope, no
 * staged form — the page is display-only per the plugin guide §4). Rendered
 * with plain createElement so the source stays JS-only; react is external
 * and resolved by the dsh module loader at runtime (peer dependency).
 * @module dsh-buddy-about/client/about-section
 */

import { createElement as h } from 'react';
import { resolveUpdateTarget, UPDATE_KIND_APP, UPDATE_KIND_PLUGIN } from '../shared/shell-bridge.js';

const styles = {
  page: {
    padding: '24px 28px',
    maxWidth: 520,
    color: 'var(--dsw-alias-label-primary, inherit)',
    fontSize: 14,
    lineHeight: 1.6,
  },
  heading: { margin: '0 0 16px', fontSize: 18, fontWeight: 600 },
  row: { display: 'flex', gap: 8, margin: '4px 0' },
  rowLabel: { color: 'var(--dsw-alias-label-tertiary, currentColor)', opacity: 0.75 },
  actions: { display: 'flex', gap: 12, marginTop: 20 },
  button: {
    cursor: 'pointer',
    padding: '6px 14px',
    fontSize: 13,
    color: 'var(--dsw-alias-label-primary, currentColor)',
    background: 'var(--dsw-alias-button-floating-fill, transparent)',
    border: '1px solid var(--dsw-alias-border-l2, currentColor)',
    borderRadius: 6,
  },
};

/**
 * Update check click: read window.__DSH_BUDDY__ live (the shell injects it
 * after did-finish-load, which may postdate plugin apply) and open the target
 * the pure resolver picked — the dsh-buddy:// bridge URL inside the shell
 * (intercepted by the shell's window-open handler), or the releases page in
 * a plain browser.
 */
function openUpdateTarget(kind) {
  window.open(resolveUpdateTarget(window.__DSH_BUDDY__, kind), '_blank', 'noopener');
}

/**
 * Build the About section component.
 * @param {{ t: (key: string) => string, rows: Array<{ key: string, value: string }> }} options
 *   t: bound locale translator; rows: pre-resolved version rows (dsh row absent when unknown).
 * @returns {() => import('react').ReactElement} slot-registered component.
 */
export function createAboutSection({ t, rows }) {
  return function AboutSection() {
    return h('div', { style: styles.page, 'data-dsh-buddy-about': '' },
      h('h2', { style: styles.heading }, t('section.heading')),
      rows.map((row) => h('div', { key: row.key, style: styles.row },
        h('span', { style: styles.rowLabel }, t(`row.${row.key}`)),
        h('span', null, row.value),
      )),
      h('div', { style: styles.actions },
        h('button', { type: 'button', style: styles.button, onClick: () => openUpdateTarget(UPDATE_KIND_APP) },
          t('button.checkUpdate')),
        h('button', { type: 'button', style: styles.button, onClick: () => openUpdateTarget(UPDATE_KIND_PLUGIN) },
          t('button.checkPluginUpdate')),
      ),
    );
  };
}
