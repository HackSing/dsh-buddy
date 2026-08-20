// 更新下载浮层(lib/update-overlay.html)的 preload。
// 暴露面与标题栏同款收窄:一次性 init 拉当前视图模型,onState 订阅主进程
// 推送,retry 上报重试点击。渲染侧拿不到 ipcRenderer 本体。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshUpdateOverlay', {
  init: () => ipcRenderer.invoke('update-overlay:init'),
  retry: () => ipcRenderer.send('update-overlay:retry'),
  onState: (callback) => {
    ipcRenderer.on('update-overlay:state', (_event, model) => callback(model));
  },
});
