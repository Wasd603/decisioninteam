const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listScreens: () => ipcRenderer.invoke('list-screens'),
  listWindows: () => ipcRenderer.invoke('list-windows'),
  pickDocument: () => ipcRenderer.invoke('pick-document'),
  solveQuestion: (payload) => ipcRenderer.invoke('solve-question', payload),
  analyzeDocuments: (payload) => ipcRenderer.invoke('analyze-documents', payload)
});
