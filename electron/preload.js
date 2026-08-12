const { contextBridge, ipcRenderer } = require('electron');

// Exposed as `window.electronAPI` in the renderer — the web app's WindowControls
// component uses `electronAPI?.isElectron` to know whether to render at all, so
// this must never exist when the same build is opened in a normal browser.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onMaximizedChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },
});
