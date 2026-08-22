const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('treefrogInstaller', {
  devices: () => ipcRenderer.invoke('devices:list'),
  chooseCard: () => ipcRenderer.invoke('card:choose'),
  inspectCard: (card) => ipcRenderer.invoke('card:inspect', card),
  latestRelease: () => ipcRenderer.invoke('release:latest'),
  start: (input) => ipcRenderer.invoke('install:start', input),
  cancel: () => ipcRenderer.invoke('install:cancel'),
  openStock: (id) => ipcRenderer.invoke('stock:open', id),
  onProgress: (listener) => { const handler = (_event, value) => listener(value); ipcRenderer.on('install:progress', handler); return () => ipcRenderer.removeListener('install:progress', handler); }
});
