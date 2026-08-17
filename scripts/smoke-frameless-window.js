// 无边框窗口的冒烟脚本(不进 CI,手动运行):
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/smoke-frameless-window.js
// 覆盖:标题栏渲染、原生菜单弹出(整屏截图)、菜单动作(zoom)、导航状态推送(back 按钮启用)。
// 产物:build/smoke-*.png 截图,控制台输出状态断言结果。
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { createFramelessWindow } = require('../lib/frameless-window');
const { resolveMenuLocale } = require('../lib/dsh-settings');

const OUT_DIR = path.join(__dirname, '..', 'build');
const PAGE_A = 'data:text/html,' + encodeURIComponent('<h1 style="margin:40px">Page A</h1>');
const PAGE_B = 'data:text/html,' + encodeURIComponent('<h1 style="margin:40px">Page B</h1>');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));

async function capture(view, name) {
  // 首帧 paint 前 capturePage 会返回空图,轮询重试
  let png = Buffer.alloc(0);
  for (let i = 0; i < 10 && png.length === 0; i += 1) {
    await delay(300);
    png = (await view.webContents.capturePage()).toPNG();
  }
  if (png.length === 0) throw new Error(`capture empty: ${name}`);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
}

// 原生 popup 菜单是独立 OS 窗口,capturePage 拍不到,整屏截图留证
function captureScreen(name) {
  const out = path.join(OUT_DIR, name);
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Drawing;Add-Type -AssemblyName System.Windows.Forms;` +
      `$b = New-Object System.Drawing.Bitmap([System.Windows.Forms.SystemInformation]::VirtualScreen.Width, [System.Windows.Forms.SystemInformation]::VirtualScreen.Height);` +
      `$g = [System.Drawing.Graphics]::FromImage($b);` +
      `$g.CopyFromScreen([System.Windows.Forms.SystemInformation]::VirtualScreen.Location, [System.Drawing.Point]::Empty, $b.Size);` +
      `$b.Save('${out.replace(/'/g, "''")}');`,
  ]);
}

app.whenReady().then(async () => {
  try {
    console.log('[smoke] resolved menu locale:', resolveMenuLocale(process.env, os.homedir()));

    const win = createFramelessWindow({ dshUrl: PAGE_A, version: '0.1.0-smoke' });
    const [titlebar, content] = win.contentView.children;
    await Promise.all([
      once(titlebar.webContents, 'did-finish-load'),
      once(content.webContents, 'did-finish-load'),
    ]);
    await delay(800); // 等首帧 paint,过早 capture 会拿到空图
    await capture(titlebar, 'smoke-titlebar.png');

    // 点击「视图」菜单(第 3 个),原生 popup 弹出后整屏截图,再 Esc 关闭
    await titlebar.webContents.executeJavaScript(
      `document.querySelectorAll('.menubtn')[2].click()`
    );
    await delay(400);
    captureScreen('smoke-menu-popup.png');
    titlebar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    titlebar.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await delay(200);

    // 菜单动作直达内容视图:zoom-in 后 zoomLevel 应为 0.5
    await titlebar.webContents.executeJavaScript(`window.dshTitlebar.action('view:zoom-in')`);
    console.log('[smoke] zoomLevel after view:zoom-in =', content.webContents.getZoomLevel());

    // 导航后 back 按钮应被状态推送启用
    await content.webContents.loadURL(PAGE_B);
    await delay(400);
    const backDisabled = await titlebar.webContents.executeJavaScript(
      `document.getElementById('back').disabled`
    );
    console.log('[smoke] back.disabled after navigate =', backDisabled, '(expect false)');
    await capture(content, 'smoke-content.png');

    console.log('[smoke] done');
    app.exit(0);
  } catch (err) {
    console.error('[smoke] failed:', err);
    app.exit(1);
  }
});

setTimeout(() => {
  console.error('[smoke] timeout');
  app.exit(2);
}, 30000);
