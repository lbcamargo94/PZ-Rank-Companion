'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus:       ()        => ipcRenderer.invoke('get-status'),
  getConfig:       ()        => ipcRenderer.invoke('get-config'),
  lookupPlayer:    (nick)    => ipcRenderer.invoke('lookup-player', nick),
  saveSettings:    (s)       => ipcRenderer.invoke('save-settings', s),
  toggleAutostart: (enabled) => ipcRenderer.invoke('toggle-autostart', enabled),
  disconnect:      ()        => ipcRenderer.invoke('disconnect'),
  openExternal:    (url)     => ipcRenderer.invoke('open-external', url),
  openSite:        ()        => ipcRenderer.invoke('open-site'),
  pickFolder:      ()        => ipcRenderer.invoke('pick-folder'),
  onStatusUpdate:  (cb)      => ipcRenderer.on('status-update',  (_, data) => cb(data)),
  // Auto-update
  getAppVersion:    ()       => ipcRenderer.invoke('get-app-version'),
  getUpdateStatus:  ()       => ipcRenderer.invoke('get-update-status'),
  checkForUpdates:  ()       => ipcRenderer.invoke('check-for-updates'),
  installUpdate:    ()       => ipcRenderer.invoke('install-update'),
  onUpdateStatus:   (cb)     => ipcRenderer.on('update-status', (_, data) => cb(data)),
});
