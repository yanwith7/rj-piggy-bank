const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piggyBank', {
  getState: () => ipcRenderer.invoke('data:get-state'),
  chooseDirectory: () => ipcRenderer.invoke('data:choose-directory'),
  savePlatform: (payload) => ipcRenderer.invoke('data:save-platform', payload),
  archivePlatform: (id, archived) => ipcRenderer.invoke('data:archive-platform', id, archived),
  saveProduct: (payload) => ipcRenderer.invoke('data:save-product', payload),
  archiveProduct: (id, archived) => ipcRenderer.invoke('data:archive-product', id, archived),
  saveType: (payload) => ipcRenderer.invoke('data:save-type', payload),
  archiveType: (id, archived) => ipcRenderer.invoke('data:archive-type', id, archived),
  deleteType: (id) => ipcRenderer.invoke('data:delete-type', id),
  move: (collection, id, direction) => ipcRenderer.invoke('data:move', collection, id, direction),
  saveSnapshot: (payload) => ipcRenderer.invoke('data:save-snapshot', payload),
  deleteSnapshot: (id) => ipcRenderer.invoke('data:delete-snapshot', id),
  exportJson: () => ipcRenderer.invoke('data:export-json'),
  exportCsv: () => ipcRenderer.invoke('data:export-csv'),
  exportPdf: () => ipcRenderer.invoke('data:export-pdf'),
  previewImport: () => ipcRenderer.invoke('data:preview-import'),
  commitImport: (token) => ipcRenderer.invoke('data:commit-import', token),
  clearAll: (phrase) => ipcRenderer.invoke('data:clear-all', phrase)
});
