// 自绘标题栏(lib/frameless-titlebar.html)的 preload。
// 暴露面刻意收窄:一次性 init 拉取菜单文案与初始状态,action 上报点击,
// onState 订阅主进程推送的导航/最大化状态,onTheme 订阅皮肤配色
// (主进程从 dsh 内容视图读出后转发)。渲染侧拿不到 ipcRenderer 本体。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshTitlebar', {
  init: () => ipcRenderer.invoke('titlebar:init'),
  action: (id) => ipcRenderer.send('titlebar:action', id),
  popupMenu: (id, x, y) => ipcRenderer.send('titlebar:popup-menu', id, x, y),
  onState: (callback) => {
    ipcRenderer.on('titlebar:state', (_event, state) => callback(state));
  },
  onTheme: (callback) => {
    ipcRenderer.on('titlebar:theme', (_event, theme) => callback(theme));
  },
});
