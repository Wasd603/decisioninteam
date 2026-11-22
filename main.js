const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, systemPreferences } = require('electron');
const path = require('path');
const { runPipeline } = require('./lib/pipeline');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('list-screens', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

ipcMain.handle('list-windows', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 }
  });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

ipcMain.handle('pick-document', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select reference documents',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents', extensions: ['txt', 'md', 'pdf', 'json', 'csv', 'html'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  const { readDocument } = require('./lib/documents');
  const docs = [];
  for (const filePath of result.filePaths) {
    try {
      docs.push({ name: path.basename(filePath), filePath, text: await readDocument(filePath) });
    } catch (err) {
      docs.push({ name: path.basename(filePath), filePath, error: String(err.message || err) });
    }
  }
  return docs;
});

ipcMain.handle('solve-question', async (_event, payload) => {
  try {
    return { ok: true, result: await runPipeline(payload) };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});
