// macOS 隐藏原生标题栏(hiddenInset)后,窗口失去可拖拽区域,且红绿灯会压在
// dsh 侧栏 logo 上。注入三件套补齐沉浸式体验:
// 1. 全宽 12px 顶部透明拖拽带(保底,任何布局下都在);
// 2. 侧栏顶部让出 36px(logo 下移,红绿灯落进空带);
// 3. 让出的空带本身做成拖拽区(跟随侧栏宽度,含折叠态)。
// dsh 的类名带构建哈希(如 pI_x6G_sidebarCol),用 [class*="sidebarCol"] 模糊
// 匹配语义段;侧栏由 SPA 异步渲染,用 MutationObserver 等它出现。
const SIDEBAR_SELECTOR = '[class*="sidebarCol"]';
const RESERVED_TOP_PX = 36;

const DRAG_STRIP_JS = `(() => {
  const STRIP_ID = 'dsh-buddy-drag-strip';
  if (!document.getElementById(STRIP_ID)) {
    const el = document.createElement('div');
    el.id = STRIP_ID;
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;height:12px;' +
      'z-index:2147483647;-webkit-app-region:drag;';
    document.documentElement.appendChild(el);
  }

  const STYLE_ID = 'dsh-buddy-titlebar-style';
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '${SIDEBAR_SELECTOR}{padding-top:${RESERVED_TOP_PX}px !important;position:relative;}';
    document.head.appendChild(st);
  }

  const BAND_ID = 'dsh-buddy-sidebar-drag';
  const mountBand = () => {
    const side = document.querySelector('${SIDEBAR_SELECTOR}');
    if (!side || document.getElementById(BAND_ID)) return Boolean(side);
    const band = document.createElement('div');
    band.id = BAND_ID;
    band.style.cssText =
      'position:absolute;top:0;left:0;right:0;height:${RESERVED_TOP_PX}px;' +
      '-webkit-app-region:drag;';
    side.appendChild(band);
    return true;
  };
  if (!mountBand()) {
    const mo = new MutationObserver(() => {
      if (mountBand()) mo.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
})();`;

// 页面每次加载完成都重注入(整页刷新触发,元素查重保证幂等)。
// 注入失败只降级为"无拖拽带/logo 不让位",不影响使用,记录控制台即可。
function attachDragStrip(win) {
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(DRAG_STRIP_JS).catch((err) => {
      console.error(`[dsh-buddy] titlebar injection failed: ${err.message}`);
    });
  });
}

module.exports = { attachDragStrip };
