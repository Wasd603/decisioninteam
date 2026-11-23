const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, systemPreferences } = require('electron');
const path = require('path');
const { runPipeline } = require('./lib/pipeline');
const { analyzeDocuments } = require('./lib/openrouter');

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
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write');
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write';
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function toSourceInfo(s) {
  let thumb = null;
  try {
    const t = s.thumbnail.resize({ width: 320 });
    thumb = t.toDataURL();
  } catch (e) {}
  return { id: s.id, name: s.name, thumb };
}

ipcMain.handle('list-screens', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 640, height: 360 }
  });
  return sources.map(toSourceInfo);
});

ipcMain.handle('list-windows', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 640, height: 360 }
  });
  return sources.map(toSourceInfo);
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

ipcMain.handle('analyze-documents', async (_event, payload) => {
  try {
    if (!payload.documents || payload.documents.length === 0) {
      return { ok: false, error: 'No documents selected.' };
    }
    const digest = await analyzeDocuments({
      apiKey: payload.apiKey,
      model: payload.answerModel,
      documents: payload.documents
    });
    return { ok: true, digest };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});
