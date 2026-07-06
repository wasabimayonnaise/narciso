const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__electron', {
  platform: process.platform,
  getNetworkInterfaces: () => ipcRenderer.invoke('pv:get-network-interfaces'),
  readSettings:  ()     => ipcRenderer.invoke('pv:read-settings'),
  writeSettings: (data) => ipcRenderer.invoke('pv:write-settings', data),
  saveFile:      (buf, name) => ipcRenderer.invoke('pv:save-file', buf, name),
  quit:          ()     => ipcRenderer.send('pv:quit'),
})
