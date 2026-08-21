// 应用菜单模型与模板构建(纯数据/纯函数,不依赖 Electron,可直接单测)。
// 两条窗口路径共用:legacy 自绘标题栏用 menusForLocale 渲染菜单文案;
// 无框默认模式用 buildAppMenuTemplate 挂应用菜单,动作以 accelerator/role 存活。

// 菜单结构单一来源:动作 id 不变,文案按 zh/en 各一份。
// 语言由 dsh 的 locale.preference 决定(见 lib/dsh-settings.js),不写死。
const MENU_MODEL = [
  {
    id: 'file',
    label: { zh: '文件', en: 'File' },
    items: [
      { action: 'file:close-window', label: { zh: '关闭窗口', en: 'Close Window' } },
      { separator: true },
      { action: 'file:quit', label: { zh: '退出', en: 'Quit' } },
    ],
  },
  {
    id: 'edit',
    label: { zh: '编辑', en: 'Edit' },
    items: [
      { action: 'edit:undo', label: { zh: '撤销', en: 'Undo' } },
      { action: 'edit:redo', label: { zh: '重做', en: 'Redo' } },
      { separator: true },
      { action: 'edit:cut', label: { zh: '剪切', en: 'Cut' } },
      { action: 'edit:copy', label: { zh: '复制', en: 'Copy' } },
      { action: 'edit:paste', label: { zh: '粘贴', en: 'Paste' } },
      { separator: true },
      { action: 'edit:select-all', label: { zh: '全选', en: 'Select All' } },
    ],
  },
  {
    id: 'view',
    label: { zh: '视图', en: 'View' },
    items: [
      { action: 'view:reload', label: { zh: '重新加载', en: 'Reload' } },
      { separator: true },
      { action: 'view:zoom-in', label: { zh: '放大', en: 'Zoom In' } },
      { action: 'view:zoom-out', label: { zh: '缩小', en: 'Zoom Out' } },
      { action: 'view:zoom-reset', label: { zh: '重置缩放', en: 'Reset Zoom' } },
      { separator: true },
      { action: 'view:fullscreen', label: { zh: '切换全屏', en: 'Toggle Full Screen' } },
      { action: 'view:devtools', label: { zh: '开发者工具', en: 'Developer Tools' } },
    ],
  },
  {
    id: 'help',
    label: { zh: '帮助', en: 'Help' },
    items: [
      { action: 'help:check-update', label: { zh: '检查更新', en: 'Check for Updates' } },
      { action: 'help:check-plugin-update', label: { zh: '检查插件更新', en: 'Check Plugin Updates' } },
      { action: 'help:about', label: { zh: '关于', en: 'About' } },
    ],
  },
];

// 无框模式新增的导航菜单:legacy 标题栏有前进/后退按钮而菜单栏没有;
// 无框后按钮随标题栏一起消失,导航动作以快捷键形式补回。
const NAV_MENU_MODEL = {
  id: 'nav',
  label: { zh: '导航', en: 'Navigate' },
  items: [
    { action: 'nav:back', label: { zh: '后退', en: 'Back' } },
    { action: 'nav:forward', label: { zh: '前进', en: 'Forward' } },
  ],
};

// 无框应用菜单的 accelerator 表:动作 id → 快捷键,单一来源。
// 帮助类无快捷键(纯登记,UI 入口在关于页插件)。
const MENU_ACCELERATORS = {
  'file:close-window': 'CmdOrCtrl+W',
  'file:quit': 'CmdOrCtrl+Q',
  'nav:back': 'Alt+Left',
  'nav:forward': 'Alt+Right',
  'view:reload': 'CmdOrCtrl+R',
  'view:zoom-in': 'CmdOrCtrl+=',
  'view:zoom-out': 'CmdOrCtrl+-',
  'view:zoom-reset': 'CmdOrCtrl+0',
  'view:fullscreen': 'F11',
  'view:devtools': 'CmdOrCtrl+Shift+I',
};

// 编辑类在无框菜单里走 Electron role:原生行为与平台标准快捷键,
// 不再经由 ACTIONS 的 webContents 方法(legacy 路径的 ACTIONS 不受影响)。
const MENU_ROLES = {
  'edit:undo': 'undo',
  'edit:redo': 'redo',
  'edit:cut': 'cut',
  'edit:copy': 'copy',
  'edit:paste': 'paste',
  'edit:select-all': 'selectAll',
};

function pickLabel(labels, locale) {
  return labels[locale] || labels.en;
}

// legacy 自绘标题栏的菜单数据(动作 id + 本地化文案)。
function menusForLocale(locale) {
  return MENU_MODEL.map((menu) => ({
    id: menu.id,
    label: pickLabel(menu.label, locale),
    items: menu.items.map((item) =>
      item.separator ? { separator: true } : { action: item.action, label: pickLabel(item.label, locale) }
    ),
  }));
}

/**
 * 无框模式的应用菜单模板(Electron Menu.buildFromTemplate 输入)。
 * 结构 = MENU_MODEL 插入导航菜单(视图之后、帮助之前);编辑类转 role,
 * 其余项 click 经注入的 dispatch 落到窗口动作。
 * @param {string} locale 'zh'|'en'。
 * @param {(action: string) => void} dispatch 窗口动作分发(测试注入记录器)。
 * @returns {Array<object>} Electron 菜单模板。
 */
function buildAppMenuTemplate(locale, dispatch) {
  const model = [...MENU_MODEL.slice(0, 3), NAV_MENU_MODEL, MENU_MODEL[3]];
  const toItem = (item) => {
    if (item.separator) return { type: 'separator' };
    const role = MENU_ROLES[item.action];
    if (role) return { role, label: pickLabel(item.label, locale) };
    return {
      label: pickLabel(item.label, locale),
      accelerator: MENU_ACCELERATORS[item.action],
      click: () => dispatch(item.action),
    };
  };
  return model.map((menu) => ({
    label: pickLabel(menu.label, locale),
    submenu: menu.items.map(toItem),
  }));
}

module.exports = {
  MENU_MODEL,
  NAV_MENU_MODEL,
  MENU_ACCELERATORS,
  MENU_ROLES,
  menusForLocale,
  buildAppMenuTemplate,
};
