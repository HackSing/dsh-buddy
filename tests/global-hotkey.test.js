const test = require('node:test');
const assert = require('node:assert');
const { resolveHotkeyConfig, buildDispatchScript, hotkeyChildEnv, HOTKEY_EVENT, DEFAULT_ACCELERATOR } = require('../lib/global-hotkey');

test('resolveHotkeyConfig:默认键 / 覆盖 / 关闭', () => {
  assert.deepEqual(resolveHotkeyConfig({}), { enabled: true, accelerator: DEFAULT_ACCELERATOR });
  assert.deepEqual(resolveHotkeyConfig({ DSH_BUDDY_HOTKEY: 'Alt+Space' }), { enabled: true, accelerator: 'Alt+Space' });
  assert.deepEqual(resolveHotkeyConfig({ DSH_BUDDY_HOTKEY: '  Alt+Space  ' }), { enabled: true, accelerator: 'Alt+Space' });
  assert.deepEqual(resolveHotkeyConfig({ DSH_BUDDY_HOTKEY: 'off' }), { enabled: false, accelerator: null });
});

test('buildDispatchScript:派发具名事件且 accelerator 随行', () => {
  const script = buildDispatchScript('Cmd+Shift+Space');
  assert.ok(script.includes(`"${HOTKEY_EVENT}"`));
  assert.ok(script.includes('"accelerator":"Cmd+Shift+Space"'));
  // 含引号的 accelerator 必须经 JSON 编码,不能裸拼进脚本
  const weird = buildDispatchScript('" ; alert(1);');
  assert.ok(!weird.includes('alert(1); "'));
});

test('hotkeyChildEnv:三态 — 成功注 1,尝试失败注 0,未尝试注空', () => {
  assert.deepEqual(hotkeyChildEnv({ registered: true, attempted: true, accelerator: 'Cmd+Space' }), {
    DSH_BUDDY_HOTKEY_REGISTERED: '1',
    DSH_BUDDY_HOTKEY_ACCELERATOR: 'Cmd+Space',
  });
  // 尝试注册但失败:显式注入 '0' 并透出尝试的键,插件据此显示补救横幅
  assert.deepEqual(hotkeyChildEnv({ registered: false, attempted: true, accelerator: 'Cmd+Space' }), {
    DSH_BUDDY_HOTKEY_REGISTERED: '0',
    DSH_BUDDY_HOTKEY_ACCELERATOR: 'Cmd+Space',
  });
  // 未尝试注册(DSH_BUDDY_HOTKEY=off/壳未挂载):不注入,插件视为「状态未知」
  assert.deepEqual(hotkeyChildEnv({ registered: false, attempted: false, accelerator: null }), {});
});
