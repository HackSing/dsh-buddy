// 非 macOS 平台的无边框窗口:BaseWindow + 双 WebContentsView。
// 顶部 38px 是壳自有的标题栏视图(frameless-titlebar.html,本地文件),
// 下方是 dsh 内容视图——标题栏不注入 dsh 页面,皮肤/布局重渲染都不会影响它。
// frame:false + thickFrame(默认 true)在 Windows 上保留原生缩放边框、阴影与
// Aero Snap,只去掉了标题栏与菜单栏。
const os = require('os');
const path = require('path');
const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, shell } = require('electron');
const { resolveMenuLocale } = require('./dsh-settings');

// ---- 业务默认值单一来源 ----
const TITLEBAR_HEIGHT = 38;

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
      { action: 'help:about', label: { zh: '关于', en: 'About' } },
    ],
  },
];

const ZOOM_STEP = 0.5;

function menusForLocale(locale) {
  const pick = (labels) => labels[locale] || labels.en;
  return MENU_MODEL.map((menu) => ({
    id: menu.id,
    label: pick(menu.label),
    items: menu.items.map((item) =>
      item.separator ? { separator: true } : { action: item.action, label: pick(item.label) }
    ),
  }));
}

// ctx = { win, content, version, onCheckUpdate };动作表数据化,新增菜单项只需在此处加一行。
const ACTIONS = {
  'win:minimize': (ctx) => ctx.win.minimize(),
  'win:toggle-maximize': (ctx) =>
    ctx.win.isMaximized() ? ctx.win.unmaximize() : ctx.win.maximize(),
  'win:close': (ctx) => ctx.win.close(),
  'file:close-window': (ctx) => ctx.win.close(),
  'file:quit': () => app.quit(),
  'nav:back': (ctx) => {
    const nav = ctx.content.webContents.navigationHistory;
    if (nav.canGoBack()) nav.goBack();
  },
  'nav:forward': (ctx) => {
    const nav = ctx.content.webContents.navigationHistory;
    if (nav.canGoForward()) nav.goForward();
  },
  'edit:undo': (ctx) => ctx.content.webContents.undo(),
  'edit:redo': (ctx) => ctx.content.webContents.redo(),
  'edit:cut': (ctx) => ctx.content.webContents.cut(),
  'edit:copy': (ctx) => ctx.content.webContents.copy(),
  'edit:paste': (ctx) => ctx.content.webContents.paste(),
  'edit:select-all': (ctx) => ctx.content.webContents.selectAll(),
  'view:reload': (ctx) => ctx.content.webContents.reload(),
  'view:zoom-in': (ctx) =>
    ctx.content.webContents.setZoomLevel(ctx.content.webContents.getZoomLevel() + ZOOM_STEP),
  'view:zoom-out': (ctx) =>
    ctx.content.webContents.setZoomLevel(ctx.content.webContents.getZoomLevel() - ZOOM_STEP),
  'view:zoom-reset': (ctx) => ctx.content.webContents.setZoomLevel(0),
  'view:fullscreen': (ctx) => ctx.win.setFullScreen(!ctx.win.isFullScreen()),
  'view:devtools': (ctx) => ctx.content.webContents.toggleDevTools(),
  // 菜单点击是显式用户意图:真实触发一次不受 24h 节流约束的检查,
  // 由调用方注入(main.js 按平台分流到自动更新或提示式通道)。
  'help:check-update': (ctx) => ctx.onCheckUpdate(),
  'help:about': (ctx) =>
    dialog.showMessageBox(ctx.win, {
      type: 'info',
      title: 'DSH Buddy',
      message: 'DSH Buddy',
      detail: `v${ctx.version}\nElectron ${process.versions.electron}`,
      buttons: ['OK'],
      noLink: true,
    }),
};

function createFramelessWindow({ dshUrl, version, onCheckUpdate }) {
  // frame:false 下原生菜单栏不再显示;同时摘掉应用菜单,
  // 避免默认菜单的隐藏快捷键(Ctrl+W 等)与自绘菜单语义不一致。仅非 macOS 走到这里。
  Menu.setApplicationMenu(null);

  const win = new BaseWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: '#f3f3f3',
    title: 'DSH Buddy',
  });

  const titlebar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'frameless-titlebar-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const content = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.contentView.addChildView(titlebar);
  win.contentView.addChildView(content);

  const layout = () => {
    const { width, height } = win.getContentBounds();
    titlebar.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
    content.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: height - TITLEBAR_HEIGHT });
  };
  layout();
  win.on('resize', layout);

  // 外部链接交给系统浏览器,不在壳内打开(与原 BrowserWindow 路径一致)
  content.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const ctx = { win, content, version, onCheckUpdate };
  const sendState = () => {
    if (titlebar.webContents.isDestroyed()) return;
    const nav = content.webContents.navigationHistory;
    titlebar.webContents.send('titlebar:state', {
      canBack: nav.canGoBack(),
      canForward: nav.canGoForward(),
    });
  };
  content.webContents.on('did-navigate', sendState);
  content.webContents.on('did-navigate-in-page', sendState);
  titlebar.webContents.on('did-finish-load', sendState);

  // 窗口单例(关窗即退出),IPC 注册一次即可;发送者校验挡住内容视图的伪造调用。
  ipcMain.handle('titlebar:init', (event) => {
    if (event.sender !== titlebar.webContents) return null;
    const nav = content.webContents.navigationHistory;
    return {
      menus: menusForLocale(resolveMenuLocale(process.env, os.homedir())),
      version,
      canBack: nav.canGoBack(),
      canForward: nav.canGoForward(),
    };
  });
  ipcMain.on('titlebar:action', (event, action) => {
    if (event.sender !== titlebar.webContents) return;
    const handler = ACTIONS[action];
    if (!handler) {
      console.error(`[dsh-buddy] unknown titlebar action: ${action}`);
      return;
    }
    handler(ctx);
  });
  // 菜单下拉用原生 popup:标题栏视图只有 38px 高,页内渲染会被裁剪;
  // 原生菜单顺带解决关闭时机、屏幕边缘定位与键盘交互。
  ipcMain.on('titlebar:popup-menu', (event, menuId, x, y) => {
    if (event.sender !== titlebar.webContents) return;
    const menu = menusForLocale(resolveMenuLocale(process.env, os.homedir())).find(
      (m) => m.id === menuId
    );
    if (!menu) {
      console.error(`[dsh-buddy] unknown titlebar menu: ${menuId}`);
      return;
    }
    const template = menu.items.map((item) =>
      item.separator
        ? { type: 'separator' }
        : { label: item.label, click: () => ACTIONS[item.action](ctx) }
    );
    Menu.buildFromTemplate(template).popup({ window: win, x, y });
  });

  titlebar.webContents.loadFile(path.join(__dirname, 'frameless-titlebar.html'));
  content.webContents.loadURL(dshUrl);
  return win;
}

module.exports = { createFramelessWindow, menusForLocale, TITLEBAR_HEIGHT };
