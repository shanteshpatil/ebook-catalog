'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings:          ()              => ipcRenderer.invoke('settings:get'),
  pickFolder:           ()              => ipcRenderer.invoke('settings:pick-folder'),
  setLibraryPath:       (p)            => ipcRenderer.invoke('settings:set-library-path', p),
  setExcludedFolders:       (arr)  => ipcRenderer.invoke('settings:set-excluded-folders', arr),
  setBackgroundImageUrl:    (url)  => ipcRenderer.invoke('settings:set-background-image-url', url),
  setBackgroundColor:       (color) => ipcRenderer.invoke('settings:set-background-color', color),
  setCardTextColor:         (color) => ipcRenderer.invoke('settings:set-card-text-color', color),

  // Data requests
  scanAll:       ()           => ipcRenderer.invoke('books:scan-all'),
  getBooks:      (opts)       => ipcRenderer.invoke('books:get-all', opts),
  searchBooks:   (query)      => ipcRenderer.invoke('books:search', query),
  getStats:      ()           => ipcRenderer.invoke('books:get-stats'),

  // Actions
  openFile:      (filePath)   => ipcRenderer.invoke('books:open-file', filePath),
  showInFolder:  (filePath)   => ipcRenderer.invoke('books:show-in-folder', filePath),
  rescanFile:    (filePath)   => ipcRenderer.invoke('books:rescan-file', filePath),
  setRating:      (id, rating)  => ipcRenderer.invoke('books:set-rating', { id, rating }),
  setNotes:       (id, notes)   => ipcRenderer.invoke('books:set-notes', { id, notes }),
  setStatus:      (id, status)  => ipcRenderer.invoke('books:set-status', { id, status }),
  setMetadata:    (id, fields)  => ipcRenderer.invoke('books:set-metadata', { id, fields }),
  getEpubContent: (filePath)   => ipcRenderer.invoke('books:get-epub-content', filePath),
  exportCsv:      ()           => ipcRenderer.invoke('books:export-csv'),
  exportJson:     ()           => ipcRenderer.invoke('books:export-json'),

  // Push events from main process
  onScanProgress: (cb) => ipcRenderer.on('scan:progress', (_, data) => cb(data)),
  onScanDone:     (cb) => ipcRenderer.on('scan:done',     (_, stats) => cb(stats)),
  onBookAdded:    (cb) => ipcRenderer.on('watch:added',   (_, book) => cb(book)),
  onBookRemoved:  (cb) => ipcRenderer.on('watch:removed', (_, id)   => cb(id)),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
