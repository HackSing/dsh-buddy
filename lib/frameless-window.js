// 非 macOS 平台的窗口(Windows/Linux),两种模式:
// - borderless(默认,createBorderlessWindow):BaseWindow + 单个全高内容视图,
//   窗口控制与拖拽由 dsh 页面插件(dsh-buddy-about,经 buddy scheme)提供;
//   菜单动作以应用菜单 accelerator/role 形式存活(见 lib/app-menu.js)。
// - legacy(DSH_BUDDY_TITLEBAR=legacy,createFramelessWindow):额外叠 38px 自绘
//   标题栏视图(frameless-titlebar.html),菜单/窗口控制由标题栏承担。
// 两种模式共用:scheme 拦截 + setWindowOpenHandler、__DSH_BUDDY__ 注入、
// updateOverlay、reloadContent(本文件私有 helper)。
// frame:false + thickFrame(默认 true)在 Windows 上保留原生缩放边框、阴影与
// Aero Snap,只去掉了标题栏与菜单栏。
const os = require('os');
const path = require('path');
const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, shell } = require('electron');
const { resolveMenuLocale } = require('./dsh-settings');
const { createUpdateOverlay } = require('./update-overlay');
const { menusForLocale, buildAppMenuTemplate } = require('./app-menu');
const {
  BUDDY_INFO_GLOBAL,
  BUDDY_INFO_EVENT,
  parseBuddyAction,
  isBuddySchemeUrl,
} = require('./buddy-scheme');

// ---- 业务默认值单一来源 ----
const TITLEBAR_HEIGHT = 38;

const ZOOM_STEP = 0.5;

// ctx = { win, content, version, onCheckUpdate, onCheckPluginUpdate };动作表数据化,新增菜单项只需在此处加一行。
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
  // 插件热更的显式入口,同样由 main.js 注入;未注入(旧调用方)时静默跳过。
  'help:check-plugin-update': (ctx) => ctx.onCheckPluginUpdate && ctx.onCheckPluginUpdate(),
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

// buddy scheme 动作(dsh-buddy://<action>,插件出壳桥)到既有窗口动作的映射;
// 动作 id 单一来源在 buddy-scheme.js 的 BUDDY_ACTIONS,完整性由测试断言。
const BUDDY_DISPATCH = {
  'check-update': 'help:check-update',
  'check-plugin-update': 'help:check-plugin-update',
  'win-minimize': 'win:minimize',
  'win-toggle-maximize': 'win:toggle-maximize',
  'win-close': 'win:close',
};

// 注入脚本由纯函数拼装,字符串经 JSON.stringify 转义,避免版本号里的
// 引号/反斜杠破坏注入代码。
function buildBuddyInfoScript(version, isMaximized) {
  return (
    `window.${BUDDY_INFO_GLOBAL} = { version: ${JSON.stringify(version)}, ` +
    `isMaximized: ${JSON.stringify(Boolean(isMaximized))} };` +
    `window.dispatchEvent(new Event(${JSON.stringify(BUDDY_INFO_EVENT)}));`
  );
}

function buildBuddyMaximizedScript(isMaximized) {
  return (
    `if (window.${BUDDY_INFO_GLOBAL}) {` +
    `window.${BUDDY_INFO_GLOBAL}.isMaximized = ${JSON.stringify(Boolean(isMaximized))};` +
    `window.dispatchEvent(new Event(${JSON.stringify(BUDDY_INFO_EVENT)}));}`
  );
}

// __DSH_BUDDY__ 注入:整页加载完成(含整页刷新/跳转,会重建 window 对象)时全量注入;
// 最大化/还原时只更新 isMaximized 并再发同名事件,页面插件据此切换图标。
// did-navigate-in-page 是 SPA 内跳转,window 对象存活,无需重注。
// 注入失败(页面已销毁/CSP 等)只降级为插件读不到桥信息,不崩壳。
function attachBuddyInfo(win, content, version) {
  const run = (script, label) => {
    content.webContents.executeJavaScript(script).catch((err) => {
      console.warn(`[dsh-buddy] ${label} failed: ${err.message}`);
    });
  };
  content.webContents.on('did-finish-load', () => {
    run(buildBuddyInfoScript(version, win.isMaximized()), 'buddy info injection');
  });
  const syncMaximized = () => {
    run(buildBuddyMaximizedScript(win.isMaximized()), 'buddy maximized sync');
  };
  win.on('maximize', syncMaximized);
  win.on('unmaximize', syncMaximized);
}

// ---- 两种窗口模式共用的私有 helper(复用而非复制) ----

// 窗口基础参数(尺寸/标题/背景)单一来源。
function createShellWindow() {
  return new BaseWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: '#f3f3f3',
    title: 'DSH Buddy',
  });
}

// 出壳桥:dsh 页面插件 window.open('dsh-buddy://<action>') 在此拦截 dispatch;
// 本 scheme 的未知动作报错并 deny,其余链接维持现状交给系统浏览器。
function attachWindowOpenHandler(content, ctx) {
  content.webContents.setWindowOpenHandler(({ url }) => {
    const action = parseBuddyAction(url);
    if (action !== null) {
      ACTIONS[BUDDY_DISPATCH[action]](ctx);
      return { action: 'deny' };
    }
    if (isBuddySchemeUrl(url)) {
      console.error(`[dsh-buddy] unknown buddy action: ${url}`);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// 内容视图附属能力:reloadContent(插件热更重启 dsh 后由 main.js 调用,
// 刷新内容视图指向新服务)+ 更新下载进度浮层(叠在内容左下角,
// 生命周期=下载生命周期;相对窗口左下定位,与是否有标题栏无关)。
function attachContentExtras(win, content, locale) {
  win.reloadContent = () => content.webContents.reload();
  win.updateOverlay = createUpdateOverlay({ win, locale });
}

/**
 * 完全无框(默认模式):无自绘标题栏视图,内容视图占满全窗。
 * 窗口控制按钮与拖拽区由 dsh 页面插件提供(bridge 注入后自动挂载);
 * 菜单栏 UI 不存在,动作以应用菜单 accelerator/role 形式保留。
 */
function createBorderlessWindow({ dshUrl, version, onCheckUpdate, onCheckPluginUpdate }) {
  const locale = resolveMenuLocale(process.env, os.homedir());
  const win = createShellWindow();
  const content = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.contentView.addChildView(content);

  const layout = () => {
    const { width, height } = win.getContentBounds();
    content.setBounds({ x: 0, y: 0, width, height });
  };
  layout();
  win.on('resize', layout);

  const ctx = { win, content, version, onCheckUpdate, onCheckPluginUpdate };
  attachWindowOpenHandler(content, ctx);
  attachBuddyInfo(win, content, version);
  attachContentExtras(win, content, locale);

  // 无框后没有菜单栏 UI;挂应用菜单让动作经 accelerator/role 存活。
  // 编辑类在模板里已转 role(原生行为),其余 click 落到 ACTIONS。
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildAppMenuTemplate(locale, (action) => ACTIONS[action](ctx)))
  );

  content.webContents.loadURL(dshUrl);
  return win;
}

function createFramelessWindow({ dshUrl, version, onCheckUpdate, onCheckPluginUpdate }) {
  // frame:false 下原生菜单栏不再显示;同时摘掉应用菜单,
  // 避免默认菜单的隐藏快捷键(Ctrl+W 等)与自绘菜单语义不一致。仅非 macOS 走到这里。
  Menu.setApplicationMenu(null);

  const win = createShellWindow();

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

  const ctx = { win, content, version, onCheckUpdate, onCheckPluginUpdate };

  attachWindowOpenHandler(content, ctx);
  attachBuddyInfo(win, content, version);
  attachContentExtras(win, content, resolveMenuLocale(process.env, os.homedir()));
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

module.exports = { createFramelessWindow, createBorderlessWindow, menusForLocale, TITLEBAR_HEIGHT };
