import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  formatVersionTag,
  resolveAboutInfo,
  resolveBuddyVersion,
  resolveDshVersion,
} from '../plugins/dsh-buddy-about/src/shared/version.js';
import {
  RELEASES_PAGE_URL,
  SIDEBAR_ROW_ATTRIBUTE,
  SIDEBAR_ROW_SELECTOR,
  BUDDY_CHECK_UPDATE_URL,
  BUDDY_CHECK_PLUGIN_UPDATE_URL,
  BUDDY_WIN_CLOSE_URL,
  BUDDY_WIN_MINIMIZE_URL,
  BUDDY_WIN_TOGGLE_MAXIMIZE_URL,
  BUDDY_INFO_EVENT,
  DRAG_STYLE_ATTRIBUTE,
  DRAG_STYLE_SELECTOR,
  WIN_CONTROLS_ATTRIBUTE,
  WIN_CONTROLS_SELECTOR,
} from '../plugins/dsh-buddy-about/src/shared/constants.js';
import {
  hasBuddyBridge,
  readBuddyMaximized,
  resolveUpdateTarget,
  UPDATE_KIND_APP,
  UPDATE_KIND_PLUGIN,
} from '../plugins/dsh-buddy-about/src/shared/shell-bridge.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BUDDY_ACTIONS, BUDDY_INFO_EVENT: SHELL_BUDDY_INFO_EVENT, parseBuddyAction } = require('../lib/buddy-scheme.js');

const BUILD_VERSION = '0.1.0';

test('resolveBuddyVersion:壳注入对象优先', () => {
  assert.equal(resolveBuddyVersion({ version: '0.3.0' }, BUILD_VERSION), '0.3.0');
});

test('resolveBuddyVersion:注入缺失或非法时降级到构建期常量', () => {
  assert.equal(resolveBuddyVersion(undefined, BUILD_VERSION), BUILD_VERSION);
  assert.equal(resolveBuddyVersion(null, BUILD_VERSION), BUILD_VERSION);
  assert.equal(resolveBuddyVersion({}, BUILD_VERSION), BUILD_VERSION);
  assert.equal(resolveBuddyVersion({ version: '' }, BUILD_VERSION), BUILD_VERSION);
  assert.equal(resolveBuddyVersion({ version: '   ' }, BUILD_VERSION), BUILD_VERSION);
  assert.equal(resolveBuddyVersion({ version: 42 }, BUILD_VERSION), BUILD_VERSION);
  assert.equal(resolveBuddyVersion('0.9.9', BUILD_VERSION), BUILD_VERSION);
});

test('resolveBuddyVersion:注入值去空白', () => {
  assert.equal(resolveBuddyVersion({ version: ' 0.3.0 ' }, BUILD_VERSION), '0.3.0');
});

test('resolveDshVersion:boot 图带 version 时取之', () => {
  assert.equal(resolveDshVersion({ version: '0.1.0-rc.8', rev: 'x', entries: [] }), '0.1.0-rc.8');
});

test('resolveDshVersion:rc.8 boot 图无 version 字段,返回 null', () => {
  assert.equal(resolveDshVersion({ rev: 'abc', entries: [] }), null);
  assert.equal(resolveDshVersion(undefined), null);
  assert.equal(resolveDshVersion(null), null);
  assert.equal(resolveDshVersion({ version: '' }), null);
});

test('formatVersionTag:补 v 前缀且不重复', () => {
  assert.equal(formatVersionTag('0.3.0'), 'v0.3.0');
  assert.equal(formatVersionTag('v0.3.0'), 'v0.3.0');
});

test('resolveAboutInfo:dsh 版本不可得时省略该行', () => {
  const info = resolveAboutInfo({ buddyHost: undefined, dshBoot: { rev: 'x', entries: [] } }, BUILD_VERSION);
  assert.equal(info.buddyVersion, BUILD_VERSION);
  assert.equal(info.dshVersion, null);
  assert.deepEqual(info.rows, [{ key: 'buddy', value: `v${BUILD_VERSION}` }]);
});

test('resolveAboutInfo:两个版本都可得时两行齐全', () => {
  const info = resolveAboutInfo(
    { buddyHost: { version: '0.3.0' }, dshBoot: { version: '0.1.0-rc.8' } },
    BUILD_VERSION,
  );
  assert.deepEqual(info.rows, [
    { key: 'buddy', value: 'v0.3.0' },
    { key: 'dsh', value: 'v0.1.0-rc.8' },
  ]);
});

test('幂等约定:属性名与选择器互相匹配', () => {
  assert.equal(SIDEBAR_ROW_SELECTOR, `[${SIDEBAR_ROW_ATTRIBUTE}]`);
});

test('契约:插件 RELEASES_PAGE_URL 与壳侧 lib/update-check.js 一致', () => {
  const shellSource = readFileSync(new URL('../lib/update-check.js', import.meta.url), 'utf8');
  assert.ok(
    shellSource.includes(`RELEASES_PAGE_URL = '${RELEASES_PAGE_URL}'`),
    '壳侧 RELEASES_PAGE_URL 已变更,插件常量需同步',
  );
});

test('契约:插件 scheme URL 都能被壳侧 parseBuddyAction 识别', () => {
  const pluginSchemeUrls = [BUDDY_CHECK_UPDATE_URL, BUDDY_CHECK_PLUGIN_UPDATE_URL];
  const recognized = pluginSchemeUrls.map((url) => parseBuddyAction(url));
  for (let i = 0; i < pluginSchemeUrls.length; i += 1) {
    assert.notEqual(recognized[i], null, `壳侧不识别插件 URL: ${pluginSchemeUrls[i]}`);
  }
  // 两个按钮必须落到不同动作,且都是壳动作表成员
  assert.notEqual(recognized[0], recognized[1]);
  for (const action of recognized) {
    assert.ok(BUDDY_ACTIONS.includes(action), `解析结果不在壳动作表内: ${action}`);
  }
});

test('契约:窗口控制按钮的 scheme URL 都在壳动作表内', () => {
  const winUrls = [BUDDY_WIN_MINIMIZE_URL, BUDDY_WIN_TOGGLE_MAXIMIZE_URL, BUDDY_WIN_CLOSE_URL];
  const actions = winUrls.map((url) => parseBuddyAction(url));
  for (let i = 0; i < winUrls.length; i += 1) {
    assert.notEqual(actions[i], null, `壳侧不识别窗口控制 URL: ${winUrls[i]}`);
    assert.ok(BUDDY_ACTIONS.includes(actions[i]), `不在 BUDDY_ACTIONS 内: ${actions[i]}`);
  }
  assert.equal(new Set(actions).size, 3, '三个窗口控制按钮必须落到不同动作');
});

test('readBuddyMaximized:桥存在时读 isMaximized,缺桥一律 false', () => {
  assert.equal(readBuddyMaximized({ version: '0.3.0', isMaximized: true }), true);
  assert.equal(readBuddyMaximized({ version: '0.3.0', isMaximized: false }), false);
  assert.equal(readBuddyMaximized({ version: '0.3.0' }), false);
  for (const absent of [undefined, null, 42, 'x']) {
    assert.equal(readBuddyMaximized(absent), false);
  }
});

test('幂等约定:窗口控制与拖拽样式的属性名与选择器互相匹配', () => {
  assert.equal(WIN_CONTROLS_SELECTOR, `[${WIN_CONTROLS_ATTRIBUTE}]`);
  assert.equal(DRAG_STYLE_SELECTOR, `style[${DRAG_STYLE_ATTRIBUTE}]`);
});

// 拖拽区:logoRow + 主面板 header 设 drag,交互后代 no-drag;关闭按钮
// hover 必须是 Windows 原生红。样式文本在 window-controls.js,源码级断言。
test('契约:拖拽区 CSS 覆盖 drag/no-drag 与关闭按钮红色 hover', () => {
  const source = readFileSync(
    new URL('../plugins/dsh-buddy-about/src/client/window-controls.js', import.meta.url),
    'utf8',
  );
  assert.ok(source.includes('-webkit-app-region: drag'), '缺 drag 区域');
  assert.ok(source.includes('-webkit-app-region: no-drag'), '交互元素缺 no-drag');
  assert.ok(source.includes('#e81123'), '关闭按钮 hover 缺 #e81123');
  assert.ok(
    source.includes('addEventListener(BUDDY_INFO_EVENT') &&
      source.includes('removeEventListener(BUDDY_INFO_EVENT'),
    '桥事件监听/disposer 缺失',
  );
});

test('resolveUpdateTarget:壳桥存在时走 dsh-buddy:// scheme', () => {
  const bridge = { version: '0.3.0', isMaximized: false };
  assert.equal(resolveUpdateTarget(bridge, UPDATE_KIND_APP), BUDDY_CHECK_UPDATE_URL);
  assert.equal(resolveUpdateTarget(bridge, UPDATE_KIND_PLUGIN), BUDDY_CHECK_PLUGIN_UPDATE_URL);
});

test('resolveUpdateTarget:无壳桥(纯浏览器)降级 releases 页', () => {
  for (const absent of [undefined, null, 42, 'x']) {
    assert.equal(resolveUpdateTarget(absent, UPDATE_KIND_APP), RELEASES_PAGE_URL);
    assert.equal(resolveUpdateTarget(absent, UPDATE_KIND_PLUGIN), RELEASES_PAGE_URL);
  }
});

test('hasBuddyBridge:空对象也算桥存在(版本字段另有降级链)', () => {
  assert.equal(hasBuddyBridge({}), true);
  assert.equal(hasBuddyBridge({ version: '0.3.0' }), true);
  assert.equal(hasBuddyBridge(null), false);
  assert.equal(hasBuddyBridge(undefined), false);
});

test('契约:插件 BUDDY_INFO_EVENT 与壳侧 lib/buddy-scheme.js 一致', () => {
  assert.equal(BUDDY_INFO_EVENT, SHELL_BUDDY_INFO_EVENT);
});

// 桥注入晚于插件 apply(did-finish-load 之后),侧栏小字必须靠事件刷新,
// 否则首屏一直显示构建期降级常量。
test('契约:侧栏版本号监听桥事件并在卸载时清理监听', () => {
  const source = readFileSync(
    new URL('../plugins/dsh-buddy-about/src/client/sidebar-version.js', import.meta.url),
    'utf8',
  );
  assert.ok(
    source.includes(`addEventListener(BUDDY_INFO_EVENT`),
    'sidebar-version.js 未监听 BUDDY_INFO_EVENT,注入后版本不会刷新',
  );
  assert.ok(
    source.includes(`removeEventListener(BUDDY_INFO_EVENT`),
    'sidebar-version.js 的 disposer 未移除桥事件监听',
  );
  // 刷新必须 live 重解析 __DSH_BUDDY__,而非复用 apply 时捕获的值
  assert.ok(
    source.includes('resolveBuddyVersion(window.__DSH_BUDDY__'),
    'sidebar-version.js 刷新时未 live 重解析 window.__DSH_BUDDY__',
  );
});

test('刷新语义:同一构建期降级值,注入后重解析得到真实壳版本', () => {
  // 模拟 apply 时桥未注入 → 降级常量;事件到达后 live 重解析 → 真实版本。
  assert.equal(resolveBuddyVersion(undefined, BUILD_VERSION), BUILD_VERSION);
  assert.equal(
    resolveBuddyVersion({ version: '0.3.0', isMaximized: true }, BUILD_VERSION),
    '0.3.0',
  );
});

// cordis host loader 会 import 包主入口(exports["."]):缺失会让整个 dsh boot
// 崩溃(ERR_PACKAGE_PATH_NOT_EXPORTED),2026-08-20 实机验证时真实踩过。
test('契约:包主入口存在且导出 cordis apply(host loader 强制)', () => {
  const pkgUrl = new URL('../plugins/dsh-buddy-about/package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
  assert.ok(pkg.main, 'package.json 缺 main');
  assert.equal(pkg.exports?.['.'], `./${pkg.main}`, 'exports["."] 必须指向 main');
  const hostSource = readFileSync(new URL(`../plugins/dsh-buddy-about/${pkg.main}`, import.meta.url), 'utf8');
  assert.match(hostSource, /export\s+(async\s+)?function\s+apply|export\s+const\s+apply/, '主入口须导出 cordis apply');
});
