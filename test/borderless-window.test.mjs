import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MENU_MODEL,
  NAV_MENU_MODEL,
  MENU_ACCELERATORS,
  MENU_ROLES,
  menusForLocale,
  buildAppMenuTemplate,
} = require('../lib/app-menu.js');
const { WINDOW_MODE_ENV, resolveWindowMode } = require('../lib/window-mode.js');
const { BUDDY_ACTIONS } = require('../lib/buddy-scheme.js');

// ---- resolveWindowMode ----

test('resolveWindowMode:缺省/空值/其他取值一律 legacy(自绘标题栏)', () => {
  assert.equal(resolveWindowMode(undefined), 'legacy');
  assert.equal(resolveWindowMode({}), 'legacy');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: '' }), 'legacy');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'legacy' }), 'legacy');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: '1' }), 'legacy');
  // 大小写敏感:只有精确小写取值才切换
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'NATIVE' }), 'legacy');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'Borderless' }), 'legacy');
});

test('resolveWindowMode:精确 native/borderless 切对应模式', () => {
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'native' }), 'native');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'borderless' }), 'borderless');
});

// ---- buildAppMenuTemplate ----

const flatten = (template) =>
  template.flatMap((menu) => menu.submenu.map((item) => ({ menu: menu.label, ...item })));

test('buildAppMenuTemplate:结构 = MENU_MODEL 插入导航菜单(视图后、帮助前)', () => {
  const template = buildAppMenuTemplate('zh', () => {});
  assert.deepEqual(template.map((m) => m.label), ['文件', '编辑', '视图', '导航', '帮助']);
  const nav = template[3];
  assert.deepEqual(
    nav.submenu.map((i) => i.label),
    NAV_MENU_MODEL.items.map((i) => i.label.zh),
  );
});

test('buildAppMenuTemplate:编辑类转 role,无 click/accelerator 覆盖', () => {
  const items = flatten(buildAppMenuTemplate('zh', () => {}));
  for (const [action, role] of Object.entries(MENU_ROLES)) {
    const label = MENU_MODEL.flatMap((m) => m.items).find((i) => i.action === action).label.zh;
    const item = items.find((i) => i.label === label && i.role === role);
    assert.ok(item, `缺 role 项: ${action}`);
    assert.equal(item.click, undefined, `role 项不得有 click: ${action}`);
  }
});

test('buildAppMenuTemplate:accelerator 表逐项落到对应动作', () => {
  const dispatched = [];
  const template = buildAppMenuTemplate('en', (action) => dispatched.push(action));
  const items = flatten(template);
  for (const [action, accelerator] of Object.entries(MENU_ACCELERATORS)) {
    const item = items.find((i) => i.accelerator === accelerator);
    assert.ok(item, `缺 accelerator 项: ${action} (${accelerator})`);
    assert.equal(typeof item.click, 'function');
    item.click();
    assert.deepEqual(dispatched.at(-1), action, `accelerator ${accelerator} 的 click 映射错`);
  }
});

test('buildAppMenuTemplate:帮助类无快捷键,click 映射正确', () => {
  const dispatched = [];
  const items = flatten(buildAppMenuTemplate('zh', (a) => dispatched.push(a)));
  const help = items.filter((i) => i.menu === '帮助' && !i.type);
  assert.deepEqual(
    help.map((i) => i.accelerator),
    [undefined, undefined, undefined],
    '帮助类不得有快捷键',
  );
  help.forEach((i) => i.click());
  assert.deepEqual(dispatched, ['help:check-update', 'help:check-plugin-update', 'help:about']);
});

test('buildAppMenuTemplate:separator 转 { type: "separator" },locale 回退 en', () => {
  const zh = flatten(buildAppMenuTemplate('zh', () => {}));
  assert.ok(zh.filter((i) => i.type === 'separator').length >= 3);
  const fallback = buildAppMenuTemplate('fr', () => {});
  assert.deepEqual(fallback.map((m) => m.label), ['File', 'Edit', 'View', 'Navigate', 'Help']);
});

// ---- 三条窗口路径的一致性(源码级契约) ----

test('契约:三条创建路径都走共享 helper(拦截/注入/浮层)', () => {
  const source = readFileSync(new URL('../lib/frameless-window.js', import.meta.url), 'utf8');
  for (const fn of ['createNativeWindow', 'createBorderlessWindow', 'createFramelessWindow']) {
    const body = source.slice(source.indexOf(`function ${fn}`));
    for (const helper of ['attachWindowOpenHandler', 'attachBuddyInfo', 'attachContentExtras']) {
      assert.ok(body.includes(`${helper}(`), `${fn} 未调用 ${helper}`);
    }
  }
  // 共享 helper 只定义一次,且三条路径各调用一次(无复制实现)
  assert.equal(source.match(/function attachWindowOpenHandler/g).length, 1);
  assert.equal(
    source.match(/attachWindowOpenHandler\((?:win|content), ctx\);/g).length,
    3,
    '三条路径应各调用一次 attachWindowOpenHandler',
  );
});

test('契约:native 路径用原生标题栏 + autoHideMenuBar,桥按模式标记 windowControls', () => {
  const source = readFileSync(new URL('../lib/frameless-window.js', import.meta.url), 'utf8');
  const nativeBody = source.slice(
    source.indexOf('function createNativeWindow'),
    source.indexOf('function createBorderlessWindow'),
  );
  assert.ok(nativeBody.includes('new BrowserWindow('), 'native 路径未用 BrowserWindow');
  assert.ok(nativeBody.includes('autoHideMenuBar: true'), 'native 路径未藏菜单栏');
  assert.ok(
    nativeBody.includes('attachBuddyInfo(win, win, version, false)'),
    'native 桥应注入 windowControls:false',
  );
  assert.ok(
    source.includes('attachBuddyInfo(win, content, version, true)'),
    'borderless 桥应注入 windowControls:true',
  );
  // legacy 有自绘标题栏,同样不得让插件挂窗口控制
  assert.ok(
    source.includes('attachBuddyInfo(win, content, version, false)'),
    'legacy 桥应注入 windowControls:false',
  );
});

test('契约:菜单动作 id 都有 ACTIONS 实现(buddy 动作复用窗口动作)', () => {
  const source = readFileSync(new URL('../lib/frameless-window.js', import.meta.url), 'utf8');
  const actionIds = [
    ...MENU_MODEL.flatMap((m) => m.items.filter((i) => i.action).map((i) => i.action)),
    ...NAV_MENU_MODEL.items.map((i) => i.action),
  ];
  for (const id of actionIds) {
    assert.ok(source.includes(`'${id}':`), `ACTIONS 缺实现: ${id}`);
  }
  for (const action of BUDDY_ACTIONS) {
    assert.ok(source.includes(`'${action}':`), `BUDDY_DISPATCH 缺动作: ${action}`);
  }
});

test('契约:main.js 按 resolveWindowMode 分流三条路径', () => {
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.ok(source.includes('resolveWindowMode(process.env)'), 'main.js 未接窗口模式开关');
  assert.ok(source.includes('createNativeWindow'), 'main.js 未引用 createNativeWindow');
  assert.ok(source.includes('createBorderlessWindow'), 'main.js 未引用 createBorderlessWindow');
  assert.ok(source.includes('createFramelessWindow'), 'main.js 未保留 legacy 路径');
});

// ---- 方案 C:自绘标题栏跟随 dsh 皮肤(源码级契约) ----

test('契约:legacy 路径接皮肤同步(探针/轮询/推送到标题栏)', () => {
  const source = readFileSync(new URL('../lib/frameless-window.js', import.meta.url), 'utf8');
  assert.ok(source.includes('attachThemeSync(win, content, titlebar);'), 'legacy 未接 attachThemeSync');
  assert.ok(source.includes("'titlebar:theme'"), '缺 titlebar:theme 推送通道');
  assert.ok(source.includes('THEME_POLL_MS'), '缺轮询兜底间隔常量');
  // 探针回退链:body → html → 侧栏列
  const probe = source.slice(source.indexOf('THEME_PROBE_SCRIPT'));
  for (const anchor of ['document.body', 'document.documentElement', '[data-pane="sidebar"]']) {
    assert.ok(probe.includes(anchor), `探针缺回退锚点: ${anchor}`);
  }
  // 窗口关闭必须清定时器,否则轮询持有已销毁窗口
  assert.ok(/win\.on\('closed', \(\) => clearInterval\(timer\)\)/.test(source), 'closed 未清轮询定时器');
});

test('契约:标题栏 preload 暴露 onTheme,页面按 CSS 变量应用皮肤', () => {
  const preload = readFileSync(new URL('../lib/frameless-titlebar-preload.js', import.meta.url), 'utf8');
  assert.ok(preload.includes("ipcRenderer.on('titlebar:theme'"), 'preload 未转发 titlebar:theme');
  const html = readFileSync(new URL('../lib/frameless-titlebar.html', import.meta.url), 'utf8');
  for (const needle of ['--tb-bg', '--tb-fg', '--tb-hover', '--tb-border', 'onTheme(applyTheme)']) {
    assert.ok(html.includes(needle), `标题栏页面缺: ${needle}`);
  }
  // 关闭按钮红色 hover 不随皮肤改变(Windows 语义)
  assert.ok(html.includes('#e81123'), '关闭按钮 hover 缺 #e81123');
});

// menusForLocale(legacy 路径)行为不变:结构/动作 id 与 MENU_MODEL 一致
test('menusForLocale:legacy 菜单数据保持原样', () => {
  const menus = menusForLocale('zh');
  assert.deepEqual(menus.map((m) => m.id), MENU_MODEL.map((m) => m.id));
  const actions = menus.flatMap((m) => m.items.filter((i) => i.action).map((i) => i.action));
  assert.deepEqual(actions, MENU_MODEL.flatMap((m) => m.items.filter((i) => i.action).map((i) => i.action)));
});
