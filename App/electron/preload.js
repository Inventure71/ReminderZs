const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blocksApi', {
  list: async () => {
    try {
      return await ipcRenderer.invoke('blocks:list');
    } catch (err) {
      console.error('blocks:list failed', err);
      return [];
    }
  },
  create: (block) => {
    try {
      ipcRenderer.send('blocks:create', block);
    } catch (err) {
      console.error('blocks:create failed', err);
    }
  },
  onCreated: (callback) => {
    const listener = (_event, block) => callback(block);
    ipcRenderer.on('blocks:created', listener);
    return () => ipcRenderer.removeListener('blocks:created', listener);
  }
});


