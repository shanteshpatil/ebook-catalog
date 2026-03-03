'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, shell, dialog } = require('electron');
const { scanAll, scanSingleFile } = require('./scanner');
const { getAllBooks, searchBooks, getStats, setRating, setNotes, setStatus, setMetadata, getBookById } = require('./database');
const { toCSV, toJSON } = require('./exporter');
const { getLibraryPath, setLibraryPath, getExcludedFolders, setExcludedFolders, getAll: getSettings } = require('./settings');

function serializeBook(book) {
  return book || null;
}

function serializeBooks(books) {
  return books.map(serializeBook);
}

// ── EPUB content extractor for in-app reader ──────────────────────────────
async function extractEpubContent(filePath) {
  try {
    const AdmZip = require('adm-zip');
    const { parseStringPromise } = require('xml2js');

    const normalizedPath = filePath.replace(/\\/g, '/');
    const zip = new AdmZip(normalizedPath);

    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) throw new Error('No container.xml');
    const containerXml = containerEntry.getData().toString('utf8');
    const containerObj = await parseStringPromise(containerXml, { explicitArray: false });
    const opfPath = containerObj?.container?.rootfiles?.rootfile?.['$']?.['full-path'];
    if (!opfPath) throw new Error('No OPF path');

    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) throw new Error('No OPF file');
    const opfXml = opfEntry.getData().toString('utf8');
    const opfObj = await parseStringPromise(opfXml, { explicitArray: true });

    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    const pkg = opfObj?.package;

    const manifestItems = pkg?.manifest?.[0]?.item || [];
    const manifest = {};
    for (const item of manifestItems) {
      const id = item['$']?.id;
      const href = item['$']?.href;
      const mediaType = item['$']?.['media-type'] || '';
      if (id && href) manifest[id] = { href, mediaType };
    }

    const spineItems = pkg?.spine?.[0]?.itemref || [];
    const spineIdrefs = spineItems.map(s => s['$']?.idref).filter(Boolean);

    const chapters = [];
    for (const idref of spineIdrefs) {
      const item = manifest[idref];
      if (!item) continue;

      const itemPath = opfDir + item.href;
      const decodedPath = decodeURIComponent(itemPath);
      const entry = zip.getEntry(decodedPath) || zip.getEntry(itemPath);
      if (!entry) continue;

      let html = entry.getData().toString('utf8');

      const itemDir = decodedPath.includes('/') ? decodedPath.substring(0, decodedPath.lastIndexOf('/') + 1) : '';
      html = html.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (match, pre, src, post) => {
        if (src.startsWith('data:') || src.startsWith('http')) return match;
        try {
          const imgPath = src.startsWith('/') ? src.slice(1) : (itemDir + src).replace(/[^/]+\/\.\.\//g, '');
          const decodedImgPath = decodeURIComponent(imgPath);
          const imgEntry = zip.getEntry(decodedImgPath) || zip.getEntry(imgPath);
          if (!imgEntry) return match;
          const imgData = imgEntry.getData();
          const ext = (decodedImgPath.split('.').pop() || 'jpg').toLowerCase();
          const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
          const mime = mimeMap[ext] || 'image/jpeg';
          return `${pre}data:${mime};base64,${imgData.toString('base64')}${post}`;
        } catch { return match; }
      });

      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      chapters.push(bodyMatch ? bodyMatch[1] : html);
    }

    const fontsDir = path.join(__dirname, '../../renderer/fonts');
    function loadFont(weight) {
      try {
        const buf = fs.readFileSync(path.join(fontsDir, `mulish-latin-${weight}-normal.woff2`));
        return buf.toString('base64');
      } catch { return null; }
    }
    const f400 = loadFont(400);
    const f500 = loadFont(500);
    const f600 = loadFont(600);
    const f700 = loadFont(700);

    const fontFaces = [
      f400 ? `@font-face { font-family: 'Mulish'; src: url('data:font/woff2;base64,${f400}') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }` : '',
      f500 ? `@font-face { font-family: 'Mulish'; src: url('data:font/woff2;base64,${f500}') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }` : '',
      f600 ? `@font-face { font-family: 'Mulish'; src: url('data:font/woff2;base64,${f600}') format('woff2'); font-weight: 600; font-style: normal; font-display: swap; }` : '',
      f700 ? `@font-face { font-family: 'Mulish'; src: url('data:font/woff2;base64,${f700}') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }` : '',
    ].filter(Boolean).join('\n');

    const readerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  ${fontFaces}
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    font-family: 'Mulish', 'Segoe UI', system-ui, sans-serif;
    font-size: 17px;
    line-height: 1.8;
    color: #1a1a1a;
    background: #faf9f7;
    margin: 0;
    padding: 0;
    -webkit-font-smoothing: antialiased;
  }
  .reader-content {
    max-width: 680px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: 'Mulish', 'Segoe UI', system-ui, sans-serif;
    font-weight: 700;
    line-height: 1.3;
    margin: 1.6em 0 0.6em;
    color: #111;
  }
  h1 { font-size: 1.8em; }
  h2 { font-size: 1.4em; }
  h3 { font-size: 1.15em; }
  p { margin: 0 0 1em; }
  img { max-width: 100%; height: auto; display: block; margin: 1.5em auto; border-radius: 4px; }
  a { color: #2c5f2e; }
  blockquote { border-left: 3px solid #ccc; margin: 1.5em 0; padding: 0.5em 1em; color: #555; font-style: italic; }
  pre, code { font-family: monospace; background: #f3f3f3; border-radius: 3px; padding: 0.2em 0.4em; font-size: 0.9em; }
  pre { padding: 1em; overflow-x: auto; }
  .chapter-divider { border: none; border-top: 1px solid #e0ddd8; margin: 3em auto; width: 60%; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  td, th { border: 1px solid #ddd; padding: 6px 10px; }
</style>
</head>
<body>
<div class="reader-content">
${chapters.map((ch, i) => (i > 0 ? '<hr class="chapter-divider">' : '') + ch).join('\n')}
</div>
</body>
</html>`;

    return { success: true, html: readerHtml };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function registerHandlers(db, getWin, onLibraryPathChanged) {
  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => {
    return getSettings();
  });

  ipcMain.handle('settings:pick-folder', async () => {
    const win = getWin();
    const result = await dialog.showOpenDialog(win, {
      title: 'Select your books folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0].replace(/\\/g, '/');
  });

  ipcMain.handle('settings:set-library-path', (event, folderPath) => {
    setLibraryPath(folderPath);
    if (onLibraryPathChanged) onLibraryPathChanged();
    return getSettings();
  });

  ipcMain.handle('settings:set-excluded-folders', (event, folders) => {
    setExcludedFolders(folders);
    return getSettings();
  });

  // ── Books ─────────────────────────────────────────────────────────────────
  ipcMain.handle('books:scan-all', async () => {
    const win = getWin();
    if (!win) return;
    const stats = await scanAll(win);
    win.webContents.send('scan:done', stats);
    return stats;
  });

  ipcMain.handle('books:get-all', (event, opts) => {
    return serializeBooks(getAllBooks(opts));
  });

  ipcMain.handle('books:search', (event, query) => {
    return serializeBooks(searchBooks(query));
  });

  ipcMain.handle('books:get-stats', () => {
    return getStats();
  });

  ipcMain.handle('books:open-file', async (event, filePath) => {
    return shell.openPath(filePath);
  });

  ipcMain.handle('books:show-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('books:set-rating', (event, { id, rating }) => {
    setRating(id, rating);
  });

  ipcMain.handle('books:set-notes', (event, { id, notes }) => {
    setNotes(id, notes);
  });

  ipcMain.handle('books:set-status', (event, { id, status }) => {
    setStatus(id, status);
  });

  ipcMain.handle('books:set-metadata', (event, { id, fields }) => {
    return serializeBook(setMetadata(id, fields));
  });

  ipcMain.handle('books:rescan-file', async (event, filePath) => {
    const book = await scanSingleFile(filePath);
    return serializeBook(book);
  });

  ipcMain.handle('books:get-epub-content', async (event, filePath) => {
    return extractEpubContent(filePath);
  });

  ipcMain.handle('books:export-csv', async () => {
    const win = getWin();
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Catalog as CSV',
      defaultPath: 'book-catalog.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (!result.canceled && result.filePath) {
      toCSV(result.filePath);
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  ipcMain.handle('books:export-json', async () => {
    const win = getWin();
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Catalog as JSON',
      defaultPath: 'book-catalog.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePath) {
      toJSON(result.filePath);
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });
}

module.exports = { registerHandlers };
