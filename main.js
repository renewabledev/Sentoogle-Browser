const { app, BrowserWindow, BrowserView, ipcMain, Menu } = require('electron');
const path = require('path');
const { fireworks } = require('@ai-sdk/fireworks');
const { generateText } = require('ai');
const { default: Store } = require('electron-store');
const fetch = require('electron-fetch').default;

app.disableHardwareAcceleration();

// Enter your API keys here.
const XERO_API_KEY = 'your_xero_api_key_here';
const FW_API_KEY = 'your_fireworks_api_key_here';

const MODEL_70B = 'accounts/sentientfoundation/models/dobby-unhinged-llama-3-3-70b-new';
const MODEL_8B = 'accounts/sentientfoundation-serverless/models/dobby-mini-unhinged-plus-llama-3-1-8b';
const model70b = fireworks(MODEL_70B, { apiKey: FW_API_KEY });
const model8b = fireworks(MODEL_8B, { apiKey: FW_API_KEY });

const store = new Store();

let mainWindow;
let activeTabId = 'home';
let tabs = {};
let aiSettings = store.get('aiSettings', { chat: 'dobby70b', summarize: 'dobby70b', explain: 'dobby70b', command: 'dobby70b', chatMessages: [] });

ipcMain.handle('get-ai-settings', () => {
  return aiSettings;
});

ipcMain.handle('save-ai-setting', async (event, data) => {
  aiSettings[data.action] = data.model;
  store.set('aiSettings', aiSettings);
});

ipcMain.handle('query-ai', async (event, query, tabId, action) => {
  const model = aiSettings[action] || aiSettings['chat'];
  return await queryAI(query, model, tabId);
});

async function queryAI(query, modelName, tabId) {
  try {
    let response;
    if (modelName === 'dobby70b') {
      const result = await generateText({ model: model70b, prompt: query, maxTokens: 500 });
      response = result.text;
    } else if (modelName === 'dobby8b') {
      const result = await generateText({ model: model8b, prompt: query, maxTokens: 500 });
      response = result.text;
    } else if (modelName === 'roma') {
      if (!XERO_API_KEY || XERO_API_KEY === 'your_xero_api_key_here') {
        response = 'Please set the XERO_API_KEY environment variable to use ROMA (Xero AI).';
        return response;
      }
      const proxyUrl = 'https://api-sentient-roma-rex.ddnsfree.com/proxy/research';
      const systemPrompt = 'You are Xero, a general-purpose AI agent powered by ROMA and built by Rex. You are helpful, knowledgeable, and conversational. Keep your responses clear and concise. Attached here is a conversation flow between 2 roles, you (Xero) and the user who wants response to his query (user)';
      const messages = [{ role: 'SYSTEM', content: systemPrompt }, { role: 'USER', content: query }];
      const tab = tabs[tabId];
      if (tab && tab.contextHistory) {
        messages.splice(1, 0, ...tab.contextHistory.messages);
      }
      const topic = messages.map(msg => `[${msg.role.toUpperCase()}]: ${msg.content}`).join('\n\n');
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${XERO_API_KEY}`
        },
        body: JSON.stringify({ topic })
      });
      if (!res.ok) {
        if (res.status === 403) {
          response = '403 Forbidden: Invalid XERO_API_KEY or insufficient permissions for ROMA API. Check your Xero API key and access rights.';
        } else {
          response = `API Error: ${res.status} - ${res.statusText}`;
        }
        return response;
      }
      const data = await res.json();
      response = data.final_output || 'No response';
      if (tab) {
        if (!tab.contextHistory) tab.contextHistory = { messages: [] };
        tab.contextHistory.messages.push({ role: 'USER', content: query });
        tab.contextHistory.messages.push({ role: 'XERO', content: response });
        if (tab.contextHistory.messages.length > 8) tab.contextHistory.messages.splice(0, 4);
      }
    } else {
      response = 'Unknown model';
    }
    return response;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

function extractJson(text) {
  try {
    let startIndex = text.indexOf('{');
    if (startIndex === -1) startIndex = text.indexOf('[');
    const jsonString = text.substring(startIndex);
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`JSON extraction failed: ${error.message}. Raw text: ${text}`);
  }
}

function getDomainFromUrl(url) {
  try {
    if (typeof url === 'string' && url.startsWith('http')) {
      return new URL(url).hostname;
    }
    return url;
  } catch (e) {
    return 'New Tab';
  }
}

function hideAllViewsExcept(exceptId) {
  const bounds = mainWindow.getBounds();
  const yStart = 82;
  const viewBounds = { x: 0, y: yStart, width: bounds.width, height: bounds.height - yStart };
  mainWindow.getBrowserViews().forEach(v => {
    mainWindow.removeBrowserView(v);
  });
  if (exceptId !== null && tabs[exceptId] && tabs[exceptId].view && !tabs[exceptId].isHome && !tabs[exceptId].isNew && !tabs[exceptId].isAIChat && !tabs[exceptId].isSettings) {
    mainWindow.addBrowserView(tabs[exceptId].view);
    tabs[exceptId].view.setBounds(viewBounds);
    tabs[exceptId].view.webContents.setZoomFactor(1.0);
    tabs[exceptId].view.webContents.executeJavaScript(`document.body.style.zoom = '100%'; document.body.style.transform = '';`);
  }
}

async function createAndSwitchToNewTab(event, title = 'New Tab') {
  const tabId = Date.now().toString();
  const finalTitle = getDomainFromUrl(title);
  const view = new BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true } });
  view.setBackgroundColor('transparent');
  tabs[tabId] = { isHome: false, view, isNew: true, isAIChat: false, isSettings: false };
  activeTabId = tabId;
  updateFrontendTab(event, tabId, finalTitle);
  if (title && (title.startsWith('http') || title.startsWith('about:'))) {
    await view.webContents.loadURL(title);
  } else {
    view.webContents.loadURL('about:blank');
  }
  view.webContents.on('context-menu', (event, params) => {
    if (params.selectionText.trim()) {
      const menu = Menu.buildFromTemplate([
        {
          label: 'Summarize',
          click: () => {
            mainWindow.webContents.send('context-menu-summarize', params.selectionText);
          }
        },
        {
          label: 'Tell me more',
          click: () => {
            mainWindow.webContents.send('context-menu-explain', params.selectionText);
          }
        }
      ]);
      menu.popup();
    }
  });
  view.webContents.on('did-navigate', async () => {
    const url = view.webContents.getURL();
    const urlStr = typeof url === 'string' ? url : '';
    if (!urlStr.startsWith('about:blank')) {
      tabs[tabId].isNew = false;
      const domainTitle = getDomainFromUrl(urlStr);
      let faviconUrl = '';
      try {
        const result = await view.webContents.executeJavaScript(`Array.from(document.querySelectorAll('link[rel~="icon"]')).map(link => link.href).find(href => href) || document.querySelector('link[rel~"shortcut icon"]').href`);
        faviconUrl = result || `${new URL(urlStr).origin}/favicon.ico`;
      } catch (e) {
      }
      mainWindow.webContents.send('update-tab-title', tabId, domainTitle, faviconUrl);
      hideAllViewsExcept(tabId);
    }
  });
  return tabId;
}

function updateFrontendTab(event, tabId, title) {
  event.sender.send('add-and-switch-tab', tabId, title);
}

ipcMain.handle('create-tab', async (event) => {
  await createAndSwitchToNewTab(event);
});

ipcMain.handle('switch-tab', (event, tabId) => {
  if (tabId === 'home') {
    activeTabId = 'home';
    mainWindow.webContents.send('update-address-bar', '');
    hideAllViewsExcept(activeTabId);
  } else if (tabs[tabId]) {
    activeTabId = tabId;
    if (tabs[tabId].view) {
      const url = tabs[tabId].view.webContents.getURL();
      const urlStr = url ? url : '';
      mainWindow.webContents.send('update-address-bar', urlStr);
    }
    hideAllViewsExcept(activeTabId);
  } else if (tabId === null) {
    activeTabId = null;
    hideAllViewsExcept(null);
  }
});

ipcMain.handle('close-tab', (event, tabId) => {
  if (tabs[tabId]) {
    delete tabs[tabId];
  }
});

ipcMain.handle('reload-tab', () => {
  const tab = tabs[activeTabId];
  if (tab && tab.view) {
    tab.view.webContents.reload();
  }
});

ipcMain.handle('go-back', () => {
  const tab = tabs[activeTabId];
  if (tab && tab.view && !tab.isHome && !tab.isNew) {
    tab.view.webContents.goBack();
  }
});

ipcMain.handle('go-forward', () => {
  const tab = tabs[activeTabId];
  if (tab && tab.view && !tab.isHome && !tab.isNew) {
    tab.view.webContents.goForward();
  }
});

ipcMain.handle('navigate-to-url', async (event, userInput) => {
  const isUrl = /^(https?:\/\/|www\.|\.)/i.test(userInput) || /\.(com|org|net|ru|xyz)$/i.test(userInput);
  const url = isUrl && !userInput.startsWith('http') ? `https://${userInput}` : isUrl ? userInput : `https://www.google.com/search?q=${encodeURIComponent(userInput)}`;
  const currentTab = tabs[activeTabId];
  if (currentTab && currentTab.view) {
    await currentTab.view.webContents.loadURL(url);
    tabs[activeTabId].isNew = false;
    const domainTitle = getDomainFromUrl(url);
    mainWindow.webContents.send('update-tab-title', activeTabId, domainTitle);
    hideAllViewsExcept(activeTabId);
  } else {
    await createAndSwitchToNewTab(event, url);
  }
});

ipcMain.handle('execute-command', async (event, userInput) => {
  const model = aiSettings['command'];
  const prompt = `You are a browser agent. Generate JSON with actions: {"actions": [{"type": "navigate", "url": "https://..."}, {"type": "click", "selector": "#id"}, {"type": "type", "selector": "input", "text": "text"}]}. Respond only with valid JSON, no additional text or explanations. Query: ${userInput}`;
  let actionsText;
  try {
    actionsText = await queryAI(prompt, model);
  } catch (error) {
    return { success: false, message: `Error generating actions: ${error.message}` };
  }
  try {
    const actions = extractJson(actionsText);

    if (!actions || !Array.isArray(actions.actions)) throw new Error('Invalid actions format');

    const navigateAction = actions.actions.find(a => a.type === 'navigate');
    if (navigateAction) {
      await createAndSwitchToNewTab(event, navigateAction.url);
    } else {
      if (!tabs[activeTabId] || tabs[activeTabId].isHome || tabs[activeTabId].isNew || tabs[activeTabId].isSettings) {
        throw new Error('No web tab active for actions.');
      }
    }

    const activeTab = tabs[activeTabId];
    const webContents = activeTab.view.webContents;
    let allSucceeded = true;
    let messages = [];
    for (const action of actions.actions) {
      try {
        if (action.type === 'click' || action.type === 'type') {
          const exists = await webContents.executeJavaScript(`document.querySelector("${action.selector}") !== null;`);
          if (!exists) {
            allSucceeded = false;
            messages.push(`Action ${action.type} (${action.selector}): Element not found`);
            continue;
          }
        }

        if (action.type === 'navigate') {
          activeTab.isNew = false;
          const navUrl = action.url;
          await webContents.loadURL(navUrl);
          const navUrlStr = typeof navUrl === 'string' ? navUrl : '';
          mainWindow.webContents.send('update-tab-title', activeTabId, getDomainFromUrl(navUrl));
          mainWindow.webContents.send('update-address-bar', navUrlStr);
          hideAllViewsExcept(activeTabId);
          messages.push(`Action ${action.type} (${action.url}): Success`);
        } else if (action.type === 'click') {
          await webContents.executeJavaScript(`document.querySelector("${action.selector}").click();`);
          messages.push(`Action ${action.type} (${action.selector}): Success`);
        } else if (action.type === 'type') {
          await webContents.executeJavaScript(`document.querySelector("${action.selector}").value = "${action.text}";`);
          messages.push(`Action ${action.type} (${action.selector}): Success`);
        }
      } catch (actionError) {
        allSucceeded = false;
        messages.push(`Action ${action.type} (${action.selector}): ${actionError.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const message = messages.join('; ');
    return { success: allSucceeded, message };
  } catch (error) {
    return { success: false, message: `Error: ${error.message}` };
  }
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  mainWindow.setTitle('Sentoogle');

  await mainWindow.loadFile('index.html');
  tabs['home'] = { isHome: true, view: null };

  mainWindow.on('resize', () => {
    hideAllViewsExcept(activeTabId);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});