/**
 * dsh-buddy-about browser half: registers a first-level "About" settings
 * section (DSH Buddy version, dsh version when the host publishes one, and
 * update buttons that go through the dsh-buddy:// shell bridge when present,
 * falling back to the GitHub releases page in a plain browser) and injects a
 * small version row at the bottom of the sidebar.
 * @module dsh-buddy-about/client
 */

import {
  LOCALE_NS,
  SETTINGS_SECTION_ID,
  SETTINGS_SECTION_ORDER,
} from '../shared/constants.js';
import { resolveAboutInfo } from '../shared/version.js';
import { createAboutSection } from './about-section.js';
import { en, zh } from './locales.js';
import { mountSidebarVersion } from './sidebar-version.js';
import { mountWindowControls } from './window-controls.js';

/** Services required by this plugin (locale is baseline, slots registers the section). */
export const inject = ['slots', 'locale'];

/**
 * Client plugin body: register dictionaries, seat the About section as a
 * first-level settings page, and mount the sidebar version badge.
 * @param {object} ctx - client root context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'about: dictionaries');

  // Read the window globals once at apply time. __DSH_BUDDY__ is the shell's
  // phase-2 bridge (absent today -> build-time fallback, stamped from
  // package.json by the bundler); __DSH_BOOT__ is the loader's boot graph.
  const info = resolveAboutInfo(
    { buddyHost: window.__DSH_BUDDY__, dshBoot: window.__DSH_BOOT__ },
    __DSH_BUDDY_ABOUT_VERSION__,
  );
  const t = ctx.locale.bind(LOCALE_NS);

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SETTINGS_SECTION_ID,
    order: SETTINGS_SECTION_ORDER,
    label: () => t('settings.title'),
    locale: LOCALE_NS,
  }, createAboutSection({ t, rows: info.rows })));

  ctx.effect(() => mountSidebarVersion({ version: info.buddyVersion }), 'about: sidebar version');
  // 窗口控制按钮 + 拖拽区(桥存在才挂载,内部监听 dsh-buddy:info 等桥到达)。
  ctx.effect(() => mountWindowControls({ t }), 'about: window controls');
}
