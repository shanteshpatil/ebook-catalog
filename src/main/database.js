'use strict';

/**
 * Simple JSON-file database — no native modules, pure Node.js.
 *
 * Data structure: { books: Book[] }
 * Stored at: app.getPath('userData') / catalog.json
 *
 * Books are indexed by file_path for O(1) lookup.
 * The JSON file is written atomically (write temp → rename).
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let dbPath;
let data = { books: [] };
let indexByPath = new Map();
let nextId = 1;
let saveTimer = null;

function initDatabase() {
  dbPath = path.join(app.getPath('userData'), 'catalog.json');

  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf8');
      data = JSON.parse(raw);
      if (!Array.isArray(data.books)) data.books = [];
    } catch (e) {
      data = { books: [] };
    }
  }

  rebuildIndex();
  return true;
}

function rebuildIndex() {
  indexByPath = new Map();
  nextId = 1;
  for (let i = 0; i < data.books.length; i++) {
    const b = data.books[i];
    indexByPath.set(b.file_path, i);
    if (b.id >= nextId) nextId = b.id + 1;
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function saveNow() {
  const tmp = dbPath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, dbPath);
  } catch (e) {
    console.error('DB save error:', e);
  }
}

function normalizeBook(book) {
  // Convert Buffer cover_data to base64 string for JSON serialization
  if (book.cover_data && Buffer.isBuffer(book.cover_data)) {
    return { ...book, cover_data: book.cover_data.toString('base64') };
  }
  // Handle the {"type":"Buffer","data":[...]} form JSON.parse may produce
  if (book.cover_data && typeof book.cover_data === 'object' && book.cover_data.type === 'Buffer') {
    return { ...book, cover_data: Buffer.from(book.cover_data.data).toString('base64') };
  }
  return book;
}

function upsertBook(book) {
  const normalized = normalizeBook(book);
  const existing = indexByPath.get(normalized.file_path);

  if (existing !== undefined) {
    const old = data.books[existing];
    data.books[existing] = {
      ...normalized,
      id:         old.id,
      rating:     old.rating || 0,
      notes:      old.notes  || null,
      status:     old.status || 'unread',
      // Preserve existing cover if the new scan didn't produce one
      cover_data: normalized.cover_data || old.cover_data || null,
      cover_mime: normalized.cover_data ? normalized.cover_mime : (old.cover_mime || null),
      // Preserve manually-edited fields (locked by setMetadata)
      title:      old.title_locked ? old.title : (normalized.title || old.title || null),
      author:     old.author_locked ? old.author : (normalized.author || old.author || null),
      author_sort:old.author_locked ? old.author_sort : (normalized.author_sort || old.author_sort || null),
      title_locked:  old.title_locked  || false,
      author_locked: old.author_locked || false,
    };
    scheduleSave();
    return data.books[existing];
  } else {
    const newBook = { ...normalized, id: nextId++, rating: 0, notes: null, status: 'unread' };
    const idx = data.books.length;
    data.books.push(newBook);
    indexByPath.set(normalized.file_path, idx);
    scheduleSave();
    return newBook;
  }
}

function getBookByPath(filePath) {
  const idx = indexByPath.get(filePath);
  if (idx === undefined) return null;
  const b = data.books[idx];
  return { id: b.id, modified_at: b.modified_at, cover_data: b.cover_data || null };
}

function deleteBookByPath(filePath) {
  const idx = indexByPath.get(filePath);
  if (idx === undefined) return null;

  const id = data.books[idx].id;
  data.books.splice(idx, 1);
  rebuildIndex();
  scheduleSave();
  return id;
}

/**
 * Remove books whose file_path does not start with the given root.
 * This cleans up stale entries left over from a previous library path.
 * Returns the number of entries removed.
 */
function purgeOutsideRoot(scanRoot) {
  if (!scanRoot) return 0;
  const normalRoot = scanRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  const before = data.books.length;
  data.books = data.books.filter(b => {
    const p = (b.file_path || '').replace(/\\/g, '/');
    return p.startsWith(normalRoot);
  });
  const removed = before - data.books.length;
  if (removed > 0) {
    rebuildIndex();
    scheduleSave();
  }
  return removed;
}

/**
 * Remove books whose file_path passes through any of the given folder names.
 * This cleans up entries from folders the user has excluded.
 * Returns the number of entries removed.
 */
function purgeExcludedFolders(excludedNames) {
  if (!excludedNames || excludedNames.size === 0) return 0;
  const before = data.books.length;
  data.books = data.books.filter(b => {
    const parts = (b.file_path || '').replace(/\\/g, '/').split('/');
    for (const part of parts) {
      if (excludedNames.has(part)) return false;
    }
    return true;
  });
  const removed = before - data.books.length;
  if (removed > 0) {
    rebuildIndex();
    scheduleSave();
  }
  return removed;
}

/**
 * Remove books whose file no longer exists on disk.
 * Returns the number of entries removed.
 */
function purgeMissing() {
  const before = data.books.length;
  data.books = data.books.filter(b => {
    try { return fs.existsSync(b.file_path); } catch { return false; }
  });
  const removed = before - data.books.length;
  if (removed > 0) {
    rebuildIndex();
    scheduleSave();
  }
  return removed;
}

function getAllBooks(opts = {}) {
  const { folder, format, status, sort = 'title', dir = 'asc' } = opts;
  let result = data.books;

  if (folder && folder !== 'all') {
    result = result.filter(b => b.folder === folder);
  }
  if (format && format !== 'all') {
    result = result.filter(b => b.format === format);
  }
  if (status && status !== 'all') {
    result = result.filter(b => (b.status || 'unread') === status);
  }

  result = [...result].sort((a, b) => {
    let av = a[sort] ?? '';
    let bv = b[sort] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  return result;
}

function searchBooks(query) {
  if (!query || !query.trim()) return getAllBooks();
  const q = query.toLowerCase().trim();
  return data.books.filter(b =>
    (b.title  || '').toLowerCase().includes(q) ||
    (b.author || '').toLowerCase().includes(q) ||
    (b.series || '').toLowerCase().includes(q) ||
    (b.description || '').toLowerCase().includes(q)
  );
}

function getStats() {
  const total = data.books.length;
  const totalSize = data.books.reduce((sum, b) => sum + (b.file_size || 0), 0);

  const byFormat = {};
  const byFolder = {};
  for (const b of data.books) {
    byFormat[b.format] = (byFormat[b.format] || 0) + 1;
    if (b.folder) byFolder[b.folder] = (byFolder[b.folder] || 0) + 1;
  }

  return {
    total,
    totalSize,
    byFormat: Object.entries(byFormat).map(([format, count]) => ({ format, count })),
    byFolder: Object.entries(byFolder).map(([folder, count]) => ({ folder, count })),
  };
}

function setRating(id, rating) {
  const book = data.books.find(b => b.id === id);
  if (book) { book.rating = rating; scheduleSave(); }
}

function setNotes(id, notes) {
  const book = data.books.find(b => b.id === id);
  if (book) { book.notes = notes; scheduleSave(); }
}

function setStatus(id, status) {
  const book = data.books.find(b => b.id === id);
  if (book) { book.status = status; scheduleSave(); }
}

function setMetadata(id, fields) {
  const book = data.books.find(b => b.id === id);
  if (!book) return null;
  const allowed = ['title', 'author', 'year', 'publisher', 'series', 'series_index', 'language', 'description'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      book[key] = fields[key] || null;
      // Mark title/author as manually locked so rescans don't overwrite them
      if (key === 'title') book.title_locked = true;
      if (key === 'author') book.author_locked = true;
    }
  }
  // Keep author_sort in sync
  if (Object.prototype.hasOwnProperty.call(fields, 'author')) {
    if (fields.author) {
      const parts = fields.author.trim().split(/\s+/);
      book.author_sort = parts.length >= 2
        ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`
        : fields.author;
    } else {
      book.author_sort = null;
    }
  }
  scheduleSave();
  return book;
}

function getBookById(id) {
  return data.books.find(b => b.id === id) || null;
}

module.exports = {
  initDatabase,
  upsertBook,
  getBookByPath,
  deleteBookByPath,
  purgeOutsideRoot,
  purgeExcludedFolders,
  purgeMissing,
  getAllBooks,
  searchBooks,
  getStats,
  setRating,
  setNotes,
  setStatus,
  setMetadata,
  getBookById,
  saveNow,
};
