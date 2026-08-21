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

test('resolveWindowMode:缺省/空值/其他取值一律 borderless', () => {
  assert.equal(resolveWindowMode(undefined), 'borderless');
  assert.equal(resolveWindowMode({}), 'borderless');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: '' }), 'borderless');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'borderless' }), 'borderless');
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: '1' }), 'borderless');
  // 大小写敏感:只有精确 'legacy' 回退
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'LEGACY' }), 'borderless');
});

test('resolveWindowMode:精确 legacy 回退旧窗口', () => {
  assert.equal(resolveWindowMode({ [WINDOW_MODE_ENV]: 'legacy' }), 'legacy');
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

// ---- 两条窗口路径的一致性(源码级契约) ----

test('契约:两条创建路径都走共享 helper(拦截/注入/浮层)', () => {
  const source = readFileSync(new URL('../lib/frameless-window.js', import.meta.url), 'utf8');
  for (const fn of ['createBorderlessWindow', 'createFramelessWindow']) {
    const body = source.slice(source.indexOf(`function ${fn}`));
    for (const helper of ['attachWindowOpenHandler', 'attachBuddyInfo', 'attachContentExtras']) {
      assert.ok(body.includes(`${helper}(`), `${fn} 未调用 ${helper}`);
    }
  }
  // 共享 helper 只定义一次,且两条路径各调用一次(无复制实现)
  assert.equal(source.match(/function attachWindowOpenHandler/g).length, 1);
  assert.equal(
    source.match(/attachWindowOpenHandler\(content, ctx\);/g).length,
    2,
    '两条路径应各调用一次 attachWindowOpenHandler',
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

test('契约:main.js 按 resolveWindowMode 分流两条路径', () => {
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.ok(source.includes('resolveWindowMode(process.env)'), 'main.js 未接窗口模式开关');
  assert.ok(source.includes('createBorderlessWindow'), 'main.js 未引用 createBorderlessWindow');
  assert.ok(source.includes('createFramelessWindow'), 'main.js 未保留 legacy 路径');
});

// menusForLocale(legacy 路径)行为不变:结构/动作 id 与 MENU_MODEL 一致
test('menusForLocale:legacy 菜单数据保持原样', () => {
  const menus = menusForLocale('zh');
  assert.deepEqual(menus.map((m) => m.id), MENU_MODEL.map((m) => m.id));
  const actions = menus.flatMap((m) => m.items.filter((i) => i.action).map((i) => i.action));
  assert.deepEqual(actions, MENU_MODEL.flatMap((m) => m.items.filter((i) => i.action).map((i) => i.action)));
});
