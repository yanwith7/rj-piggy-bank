const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piggyBank', {
  getState: () => ipcRenderer.invoke('data:get-state'),
  chooseDirectory: () => ipcRenderer.invoke('data:choose-directory'),
  savePlatform: (payload) => ipcRenderer.invoke('data:save-platform', payload),
  deletePlatform: (id) => ipcRenderer.invoke('data:delete-platform', id),
  saveProduct: (payload) => ipcRenderer.invoke('data:save-product', payload),
  deleteProduct: (id) => ipcRenderer.invoke('data:delete-product', id),
  saveType: (payload) => ipcRenderer.invoke('data:save-type', payload),
  deleteType: (id) => ipcRenderer.invoke('data:delete-type', id),
  move: (collection, id, direction) => ipcRenderer.invoke('data:move', collection, id, direction),
  saveSnapshot: (payload) => ipcRenderer.invoke('data:save-snapshot', payload),
  deleteSnapshot: (id) => ipcRenderer.invoke('data:delete-snapshot', id),
  exportJson: () => ipcRenderer.invoke('data:export-json'),
  exportRecentYearCsv: () => ipcRenderer.invoke('data:export-recent-year-csv'),
  exportRecentYearPdf: () => ipcRenderer.invoke('data:export-recent-year-pdf'),
  previewImport: () => ipcRenderer.invoke('data:preview-import'),
  commitImport: (token) => ipcRenderer.invoke('data:commit-import', token),
  clearAll: (phrase) => ipcRenderer.invoke('data:clear-all', phrase)
});
