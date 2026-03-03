'use strict';

const path = require('path');
const { getScanRoot, SUPPORTED_EXT, normalizeExcluded } = require('./scanner');
const { getExcludedFolders } = require('./settings');
const { deleteBookByPath } = require('./database');

// Built-in folders to always exclude
const ALWAYS_EXCLUDED = new Set(['BookCatalog', '.claude']);

let activeWatcher = null;

function startWatcher(db, win) {
  const scanRoot = getScanRoot();
  if (!scanRoot) return { close: () => {} };

  let chokidar;
  try {
    chokidar = require('chokidar');
  } catch (e) {
    console.warn('chokidar not available, file watching disabled');
    return { close: () => {} };
  }

  // Build exclusion set from settings + always-excluded
  const userExcluded = normalizeExcluded(getExcludedFolders());
  const allExcluded = new Set([...ALWAYS_EXCLUDED, ...userExcluded]);

  const watcher = chokidar.watch(scanRoot, {
    ignored: [
      (filePath) => {
        const parts = filePath.replace(/\\/g, '/').split('/');
        for (const part of parts) {
          if (allExcluded.has(part)) return true;
          if (part.startsWith('.') && part.length > 1) return true;
        }
        return false;
      }
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
    depth: 10,
  });

  watcher.on('add', async (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    const ext = path.extname(normalized).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) return;
    try {
      const { scanSingleFile } = require('./scanner');
      const book = await scanSingleFile(normalized);
      if (book && win && !win.isDestroyed()) {
        win.webContents.send('watch:added', book);
      }
    } catch (e) {}
  });

  watcher.on('change', async (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    const ext = path.extname(normalized).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) return;
    try {
      const { scanSingleFile } = require('./scanner');
      const book = await scanSingleFile(normalized);
      if (book && win && !win.isDestroyed()) {
        win.webContents.send('watch:added', book);
      }
    } catch (e) {}
  });

  watcher.on('unlink', (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    try {
      const id = deleteBookByPath(normalized);
      if (id && win && !win.isDestroyed()) {
        win.webContents.send('watch:removed', id);
      }
    } catch (e) {}
  });

  watcher.on('error', (err) => {
    console.error('Watcher error:', err);
  });

  activeWatcher = watcher;
  return watcher;
}

function restartWatcher(db, win) {
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
  return startWatcher(db, win);
}

module.exports = { startWatcher, restartWatcher };
