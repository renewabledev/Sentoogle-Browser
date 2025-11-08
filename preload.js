const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createTab: async () => {
    console.log('Preload: Creating tab');
    return await ipcRenderer.invoke('create-tab');
  },
  switchTab: (id) => {
    console.log('Preload: Switching tab to', id);
    ipcRenderer.invoke('switch-tab', id);
  },
  closeTab: (id) => {
    console.log('Preload: Closing tab', id);
    ipcRenderer.invoke('close-tab', id);
  },
  reloadTab: () => {
    console.log('Preload: Reloading tab');
    ipcRenderer.invoke('reload-tab');
  },
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  navigateToUrl: (url) => ipcRenderer.invoke('navigate-to-url', url),
  executeCommand: async (command, tabId) => {
    console.log('Preload: Executing command', command, 'for tab', tabId);
    return await ipcRenderer.invoke('execute-command', command, tabId);
  },
  queryAI: async (query, tabId, action) => {
    console.log('Preload: Querying AI with', query, 'for', action);
    return await ipcRenderer.invoke('query-ai', query, tabId, action);
  },
  getAISettings: async () => {
    console.log('Preload: Getting AI settings');
    return await ipcRenderer.invoke('get-ai-settings');
  },
  saveAISetting: (data) => {
    console.log('Preload: Saving AI setting', data);
    return ipcRenderer.invoke('save-ai-setting', data);
  },
  onAddAndSwitchTab: (func) => {
    ipcRenderer.on('add-and-switch-tab', (event, ...args) => func(...args));
  },
  onUpdateTabTitle: (func) => {
    ipcRenderer.on('update-tab-title', (event, ...args) => func(...args));
  },
  onUpdateAddressBar: (func) => {
    ipcRenderer.on('update-address-bar', (event, ...args) => func(...args));
  },
  onContextMenuSummarize: (func) => {
    ipcRenderer.on('context-menu-summarize', (event, ...args) => func(...args));
  },
  onContextMenuExplain: (func) => {
    ipcRenderer.on('context-menu-explain', (event, ...args) => func(...args));
  },
});

console.log('Preload: API exposed');