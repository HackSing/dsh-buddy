// macOS 隐藏原生标题栏(hiddenInset)后,窗口失去可拖拽区域,且红绿灯会压在
// 页面侧栏顶部的内容上。注入三件套补齐沉浸式体验:
// 1. 全宽 12px 顶部透明拖拽带(保底,任何布局下都在);
// 2. 侧栏容器顶部让出 36px(内容下移,红绿灯落进空带);
// 3. 空带本身做成拖拽区,并展示壳版本号(壳唯一自有的界面地皮)。
//
// 侧栏容器不按类名找——dsh 的类名带构建哈希,皮肤插件还会在侧栏里渲染
// 自己的整套界面(实测 dsh-skins 的 logoRow 绝对定位在视口顶,父级 padding
// 对它无效)。改用几何探测:贴左缘、宽 150-500、高过半屏的可见容器,皮肤
// 无关。皮肤切换会整体重渲染,MutationObserver 发现空带失联即重探重挂。
const RESERVED_TOP_PX = 36;

function buildInjection(version) {
  return `(() => {
  const RESERVED = ${RESERVED_TOP_PX};
  const STRIP_ID = 'dsh-buddy-drag-strip';
  const BAND_ID = 'dsh-buddy-sidebar-band';

  if (!document.getElementById(STRIP_ID)) {
    const el = document.createElement('div');
    el.id = STRIP_ID;
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;height:12px;' +
      'z-index:2147483647;-webkit-app-region:drag;';
    document.documentElement.appendChild(el);
  }

  // 几何探测:视口左缘的纵向主容器,类名无关(兼容原生布局与任意皮肤)
  const findSidebar = () => {
    for (const el of document.querySelectorAll('div, aside, nav')) {
      const r = el.getBoundingClientRect();
      if (r.left < 10 && r.top < 10 && r.width > 150 && r.width < 500 &&
          r.height > window.innerHeight * 0.5) return el;
    }
    return null;
  };

  const mountBand = () => {
    const side = findSidebar();
    if (!side) return false;
    side.style.setProperty('padding-top', RESERVED + 'px', 'important');
    side.style.setProperty('box-sizing', 'border-box', 'important');
    if (getComputedStyle(side).position === 'static') side.style.position = 'relative';
    const band = document.createElement('div');
    band.id = BAND_ID;
    band.style.cssText =
      'position:absolute;top:0;left:0;right:0;height:' + RESERVED + 'px;' +
      '-webkit-app-region:drag;display:flex;align-items:center;' +
      'justify-content:flex-end;padding-right:10px;pointer-events:auto;';
    band.innerHTML = '<span style="font-size:10px;opacity:0.35;' +
      'font-family:-apple-system,sans-serif;user-select:none;">v${version}</span>';
    side.appendChild(band);
    return true;
  };

  if (!document.getElementById(BAND_ID)) mountBand();
  // 皮肤切换/布局重渲染会连根拔掉空带:失联即重挂,观察器常驻
  const mo = new MutationObserver(() => {
    const band = document.getElementById(BAND_ID);
    if (!band || !band.isConnected) mountBand();
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();`;
}

// 页面每次加载完成都重注入(整页刷新触发,元素查重保证幂等)。
// 注入失败只降级为"无拖拽带/内容不让位",不影响使用,记录控制台即可。
function attachDragStrip(win, { version }) {
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(buildInjection(version)).catch((err) => {
      console.error(`[dsh-buddy] titlebar injection failed: ${err.message}`);
    });
  });
}

module.exports = { attachDragStrip };
