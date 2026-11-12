const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('djApp', {
  isApp: true,
  platform: process.platform,
  openYouTube: (url) => ipcRenderer.send('yt-open', url),
  closeYouTube: () => ipcRenderer.send('yt-close'),
  onAudio: (cb) => ipcRenderer.on('yt-audio', (e, d) => cb(d)),
  onYtClosed: (cb) => ipcRenderer.on('yt-closed', () => cb()),
  store: { get: (n) => ipcRenderer.invoke('store-get', n), set: (n, v) => ipcRenderer.invoke('store-set', n, v) },
  lib: { load: () => ipcRenderer.invoke('lib-load'), add: (recs) => ipcRenderer.invoke('lib-add', recs), clear: () => ipcRenderer.invoke('lib-clear') },
  dataDir: () => ipcRenderer.invoke('data-dir'),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  separate: (L, R) => ipcRenderer.invoke('separate', L, R),
  _testOpen: process.env.DJ_TEST_YT ? (url) => ipcRenderer.send('yt-open-test', url) : undefined
});
