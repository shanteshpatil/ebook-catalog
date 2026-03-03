'use strict';

const fs = require('fs');
const { getAllBooks } = require('./database');

function toCSV(destPath) {
  const books = getAllBooks();
  const header = 'Title,Author,Series,Series Index,Year,Publisher,Format,Folder,File Size (bytes),Rating,File Path';
  const rows = books.map(b => [
    csvEscape(b.title),
    csvEscape(b.author),
    csvEscape(b.series),
    b.series_index != null ? b.series_index : '',
    b.year || '',
    csvEscape(b.publisher),
    b.format || '',
    csvEscape(b.folder),
    b.file_size || '',
    b.rating || 0,
    csvEscape(b.file_path),
  ].join(','));

  const content = [header, ...rows].join('\r\n');
  fs.writeFileSync(destPath, '\uFEFF' + content, 'utf8'); // BOM for Excel
}

function toJSON(destPath) {
  const books = getAllBooks();
  const exportable = books.map(({ cover_data, cover_mime, ...rest }) => rest);
  fs.writeFileSync(destPath, JSON.stringify(exportable, null, 2), 'utf8');
}

function csvEscape(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

module.exports = { toCSV, toJSON };
