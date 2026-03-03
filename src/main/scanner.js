'use strict';

const fs = require('fs');
const path = require('path');
const { extractEpub } = require('./extractors/epub-extractor');
const { extractPdf } = require('./extractors/pdf-extractor');
const { extractMobi } = require('./extractors/mobi-extractor');
const { extractDocx } = require('./extractors/docx-extractor');
const { upsertBook, getBookByPath, purgeOutsideRoot, purgeExcludedFolders, purgeMissing } = require('./database');
const { getLibraryPath, getExcludedFolders } = require('./settings');

const SUPPORTED_EXT = new Set(['.epub', '.epub3', '.pdf', '.mobi', '.docx']);

// Built-in folders to always exclude (app infrastructure)
const ALWAYS_EXCLUDED = new Set(['BookCatalog', '.claude']);

function getScanRoot() {
  return getLibraryPath();
}

/**
 * Normalize user-provided excluded folder names:
 * strip leading/trailing slashes, backslashes, and whitespace.
 */
function normalizeExcluded(folders) {
  return folders
    .map(f => f.replace(/^[\\/\s]+|[\\/\s]+$/g, ''))
    .filter(Boolean);
}

function getEffectiveExclusions() {
  const user = normalizeExcluded(getExcludedFolders());
  return new Set([...ALWAYS_EXCLUDED, ...user]);
}

async function scanAll(win) {
  const scanRoot = getScanRoot();
  if (!scanRoot) return { total: 0, added: 0, skipped: 0 };

  const excluded = getEffectiveExclusions();
  const allFiles = collectFiles(scanRoot, excluded);
  const total = allFiles.length;
  let current = 0;
  let added = 0;
  let skipped = 0;

  for (const filePath of allFiles) {
    current++;
    if (current % 10 === 0 || current === total) {
      win.webContents.send('scan:progress', { current, total });
    }

    try {
      const stat = fs.statSync(filePath);
      const existing = getBookByPath(filePath);

      const ext = path.extname(filePath).toLowerCase();
      const isCoverFormat = ext === '.pdf' || ext === '.epub' || ext === '.epub3';
      const needsCover = isCoverFormat && existing && !existing.cover_data;
      if (existing && existing.modified_at >= Math.floor(stat.mtimeMs) && !needsCover) {
        skipped++;
        continue;
      }

      let metadata = {};
      try {
        if (ext === '.epub' || ext === '.epub3') {
          metadata = await extractEpub(filePath) || {};
        } else if (ext === '.pdf') {
          metadata = await extractPdf(filePath) || {};
        } else if (ext === '.mobi') {
          metadata = await extractMobi(filePath) || {};
        } else if (ext === '.docx') {
          metadata = await extractDocx(filePath) || {};
        }
      } catch (e) {
        // Extraction error — use filename fallback
      }

      if (!metadata.title || !metadata.author) {
        const fallback = parseFilename(path.basename(filePath, ext));
        if (!metadata.title) metadata.title = fallback.title;
        if (!metadata.author) {
          metadata.author = fallback.author;
          metadata.author_sort = fallback.author ? authorSort(fallback.author) : null;
        }
      }

      const folder = getImmediateFolder(filePath, scanRoot);

      upsertBook({
        file_path:      filePath,
        file_name:      path.basename(filePath),
        format:         ext.replace('.', ''),
        folder:         folder,
        file_size:      stat.size,
        modified_at:    Math.floor(stat.mtimeMs),
        scanned_at:     Date.now(),
        title:          metadata.title || path.basename(filePath, ext),
        author:         metadata.author || null,
        author_sort:    metadata.author_sort || null,
        series:         metadata.series || null,
        series_index:   metadata.series_index || null,
        publisher:      metadata.publisher || null,
        year:           metadata.year || null,
        description:    metadata.description || null,
        language:       metadata.language || null,
        genres:         null,
        cover_mime:     metadata.cover_mime || null,
        cover_data:     metadata.cover_data || null,
        metadata_found: metadata.metadata_found || 0,
      });
      added++;
    } catch (e) {
      // Skip problematic files
    }
  }

  // Remove stale entries
  let removed = purgeOutsideRoot(scanRoot);
  removed += purgeExcludedFolders(excluded);
  removed += purgeMissing();

  return { total, added, skipped, removed };
}

async function scanSingleFile(filePath) {
  try {
    const scanRoot = getScanRoot();
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let metadata = {};

    try {
      if (ext === '.epub' || ext === '.epub3') {
        metadata = await extractEpub(filePath) || {};
      } else if (ext === '.pdf') {
        metadata = await extractPdf(filePath) || {};
      } else if (ext === '.mobi') {
        metadata = await extractMobi(filePath) || {};
      } else if (ext === '.docx') {
        metadata = await extractDocx(filePath) || {};
      }
    } catch (e) {}

    if (!metadata.title || !metadata.author) {
      const fallback = parseFilename(path.basename(filePath, ext));
      if (!metadata.title) metadata.title = fallback.title;
      if (!metadata.author) {
        metadata.author = fallback.author;
        metadata.author_sort = fallback.author ? authorSort(fallback.author) : null;
      }
    }

    const folder = getImmediateFolder(filePath, scanRoot);

    return upsertBook({
      file_path:      filePath,
      file_name:      path.basename(filePath),
      format:         ext.replace('.', ''),
      folder:         folder,
      file_size:      stat.size,
      modified_at:    Math.floor(stat.mtimeMs),
      scanned_at:     Date.now(),
      title:          metadata.title || path.basename(filePath, ext),
      author:         metadata.author || null,
      author_sort:    metadata.author_sort || null,
      series:         metadata.series || null,
      series_index:   metadata.series_index || null,
      publisher:      metadata.publisher || null,
      year:           metadata.year || null,
      description:    metadata.description || null,
      language:       metadata.language || null,
      genres:         null,
      cover_mime:     metadata.cover_mime || null,
      cover_data:     metadata.cover_data || null,
      metadata_found: metadata.metadata_found || 0,
    });
  } catch (e) {
    return null;
  }
}

function collectFiles(dir, excluded) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name) && !entry.name.startsWith('.')) {
          results.push(...collectFiles(fullPath, excluded));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXT.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch (e) {
    // Directory not readable
  }
  return results;
}

function getImmediateFolder(filePath, scanRoot) {
  const parent = path.dirname(filePath);
  const folderName = path.basename(parent);
  if (scanRoot && path.resolve(parent) === path.resolve(scanRoot)) {
    return 'Root';
  }
  return folderName;
}

function parseFilename(name) {
  const zlib = name.match(/^(.+?)\s+\(([^)]+)\)\s+\(Z-Library\)/i);
  if (zlib) return { title: zlib[1].trim(), author: zlib[2].trim() };

  const dash = name.match(/^(.+?)\s+-\s+(.+)$/);
  if (dash) return { title: dash[1].trim(), author: dash[2].trim() };

  const paren = name.match(/^(.+?)\s+\(([^)]+)\)$/);
  if (paren) return { title: paren[1].trim(), author: paren[2].trim() };

  const raw = name.replace(/[_\-]+/g, ' ').trim();
  const titled = raw.replace(/\b\w/g, c => c.toUpperCase());
  return { title: titled, author: null };
}

function authorSort(name) {
  if (!name) return null;
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
  }
  return name;
}

module.exports = { scanAll, scanSingleFile, getScanRoot, SUPPORTED_EXT, normalizeExcluded };
