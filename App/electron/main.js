const electron = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
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

// Project save/load
ipcMain.handle('project:save', async (_event, projectData) => {
  const defaultPath = 'project.reminderzs.json';
  const { filePath, canceled } = await electron.dialog.showSaveDialog({
    title: 'Save Project',
    defaultPath,
    filters: [{ name: 'ReminderZs Project', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, JSON.stringify(projectData || {}, null, 2), 'utf-8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('project:load', async () => {
  const { filePaths, canceled } = await electron.dialog.showOpenDialog({
    title: 'Open Project',
    properties: ['openFile'],
    filters: [{ name: 'ReminderZs Project', extensions: ['json'] }]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false };
  try {
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    const data = JSON.parse(content);
    return { ok: true, path: filePaths[0], data };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

// Track the currently running backend Python process (for generate)
let activeBackendProc = null;
async function killActiveBackendProc() {
  return new Promise((resolve) => {
    if (!activeBackendProc || activeBackendProc.killed) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; activeBackendProc = null; resolve(); } };
    try {
      activeBackendProc.once('close', finish);
      activeBackendProc.kill('SIGTERM');
      setTimeout(() => {
        if (done) return;
        try { activeBackendProc.kill('SIGKILL'); } catch (_) {}
        setTimeout(finish, 300);
      }, 700);
    } catch (_) { finish(); }
  });
}

// Run Python backend main.py with blocks JSON as argument (Conda env: RemainderV0)
ipcMain.handle('backend:generate', async (_event, arg) => {
  await killActiveBackendProc();
  return new Promise((resolve) => {
    try {
      const script = path.join(__dirname, '..', 'main.py');
      const cwd = path.join(__dirname, '..');
      const blocks = Array.isArray(arg) ? arg : (arg && arg.blocks) || [];
      const debug = arg && !!arg.debug;
      const env = { ...process.env, PYTHONUNBUFFERED: '1' };
      if (debug) env.PY_DEBUG = '1';
      const payload = JSON.stringify(blocks || []);
      const condaExe = process.env.CONDA_EXE || 'conda';
      let py = spawn(condaExe, ['run', '-n', 'RemainderV0', 'python', script, payload], { cwd, env });
      activeBackendProc = py;
      let out = '';
      let err = '';
      py.stdout.on('data', (d) => { out += d.toString(); });
      py.stderr.on('data', (d) => { err += d.toString(); });
      const finish = (code) => {
        resolve({ code, stdout: out.trim(), stderr: err.trim() });
      };
      py.on('close', (code) => {
        if (activeBackendProc === py) activeBackendProc = null;
        // Fallback to system python if conda failed to exec
        if ((code !== 0 && (err.includes('CommandNotFoundError') || err.includes('CondaEnvironmentNotFoundError'))) || err.includes('conda: command not found')) {
          out = '';
          err = '';
          py = spawn('python3', [script, payload], { cwd, env });
          activeBackendProc = py;
          py.stdout.on('data', (d) => { out += d.toString(); });
          py.stderr.on('data', (d) => { err += d.toString(); });
          py.on('close', (c2) => { if (activeBackendProc === py) activeBackendProc = null; finish(c2); });
          py.on('error', (e2) => finish(-1));
          return;
        }
        finish(code);
      });
      py.on('error', (e) => {
        // Try fallback immediately
        out = '';
        err = String(e && e.message || e);
        const py2 = spawn('python3', [script, payload], { cwd, env });
        activeBackendProc = py2;
        py2.stdout.on('data', (d) => { out += d.toString(); });
        py2.stderr.on('data', (d) => { err += d.toString(); });
        py2.on('close', (c2) => { if (activeBackendProc === py2) activeBackendProc = null; finish(c2); });
        py2.on('error', (e2) => finish(-1));
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e && e.message || e) });
    }
  });
});

// Discover Python functions in App/modules (Conda env: RemainderV0)
ipcMain.handle('modules:listFunctions', async () => {
  return new Promise((resolve) => {
    const script = path.join(__dirname, '..', 'modules_discovery.py');
    const cwd = path.join(__dirname, '..');
    const condaExe = process.env.CONDA_EXE || 'conda';
    let py = spawn(condaExe, ['run', '-n', 'RemainderV0', 'python', script], { cwd });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d.toString(); });
    py.stderr.on('data', (d) => { err += d.toString(); });
    const finishParse = () => {
      try {
        const parsed = JSON.parse(out || '{}');
        if (parsed && parsed.functions && Array.isArray(parsed.functions)) {
          resolve(parsed.functions);
        } else {
          resolve([]);
        }
      } catch (e) {
        console.error('modules:listFunctions parse error', e, 'stderr=', err, 'stdout=', out);
        resolve([]);
      }
    };
    py.on('close', () => {
      if (err.includes('conda: command not found') || err.includes('CommandNotFoundError') || err.includes('CondaEnvironmentNotFoundError')) {
        // Fallback to system python
        out = '';
        err = '';
        py = spawn('python3', [script], { cwd });
        py.stdout.on('data', (d) => { out += d.toString(); });
        py.stderr.on('data', (d) => { err += d.toString(); });
        py.on('close', finishParse);
        py.on('error', () => resolve([]));
        return;
      }
      finishParse();
    });
    py.on('error', (e) => {
      console.error('modules:listFunctions error', e);
      // Fallback
      const py2 = spawn('python3', [script], { cwd });
      py2.stdout.on('data', (d) => { out += d.toString(); });
      py2.stderr.on('data', (d) => { err += d.toString(); });
      py2.on('close', finishParse);
      py2.on('error', () => resolve([]));
    });
  });
});


