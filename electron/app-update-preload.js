// This bridge belongs only to the packaged update view, never to official DSH Web.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, listener) {
  const wrapped = (_event, value) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('dshAppUpdate', Object.freeze({
  state: () => ipcRenderer.invoke('dsh-app-update:command', 'state'),
  check: () => ipcRenderer.invoke('dsh-app-update:command', 'check'),
  install: ({ version }) => ipcRenderer.invoke('dsh-app-update:command', 'install', { version }),
  layout: (value) => ipcRenderer.send('dsh-app-update:layout', value),
  subscribe: (listener) => subscribe('dsh-app-update:state', listener),
  onFocus: (listener) => subscribe('dsh-app-update:focus', listener),
  onDismiss: (listener) => subscribe('dsh-app-update:dismiss', listener),
}));
