'use strict';

const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');

// Pin userData to a fixed folder name so both `npm start` and the
// packaged exe always use the same data location.
app.setPath('userData', path.join(app.getPath('appData'), 'BookCatalog'));

const { initDatabase, purgeOutsideRoot, purgeExcludedFolders, purgeMissing, saveNow } = require('./database');
const { registerHandlers } = require('./ipc-handlers');
const { startWatcher, restartWatcher } = require('./watcher');
const { getLibraryPath, getExcludedFolders } = require('./settings');
const { normalizeExcluded } = require('./scanner');

let mainWindow;
let watcher;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f9f7f4',
    title: 'Book Catalog',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  initDatabase();

  // Clean up stale entries on startup
  const libPath = getLibraryPath();
  if (libPath) purgeOutsideRoot(libPath);

  // Purge entries from excluded folders
  const excluded = new Set([
    'BookCatalog', '.claude',
    ...normalizeExcluded(getExcludedFolders()),
  ]);
  purgeExcludedFolders(excluded);

  // Remove entries for files that no longer exist on disk
  purgeMissing();

  registerHandlers(null, () => mainWindow, () => {
    // Callback when library path changes: restart watcher
    if (watcher) watcher.close();
    watcher = startWatcher(null, mainWindow);
  });
  createWindow();

  mainWindow.webContents.once('did-finish-load', () => {
    watcher = startWatcher(null, mainWindow);
  });
});

app.on('before-quit', () => {
  saveNow();
});

app.on('window-all-closed', () => {
  if (watcher) watcher.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
