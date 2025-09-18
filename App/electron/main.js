const electron = require('electron');
console.log('[main] process.type =', process.type);
try {
  console.log('[main] require.resolve("electron") =', require.resolve('electron'))
} catch (e) {
  console.log('[main] require.resolve("electron") failed', e && e.message)
}
console.log('[main] electron keys =', Object.keys(electron));
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const path = require('path');

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC scaffolding for future Python backend integration
ipcMain.handle('blocks:list', async () => {
  return [];
});

ipcMain.on('blocks:create', (event, block) => {
  event.sender.send('blocks:created', block);
});


