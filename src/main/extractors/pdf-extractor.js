'use strict';

const fs = require('fs');
const path = require('path');

// Cache the mupdf module after first ESM import
let _mupdf = null;

async function getMupdf() {
  if (_mupdf) return _mupdf;

  // Locate the wasm file — works both in dev (node_modules) and packaged
  // (app.asar.unpacked). app.asar.unpacked takes priority when it exists.
  const possibleDirs = [
    // Packaged: unpacked beside the asar
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'mupdf', 'dist'),
    // Dev: project node_modules
    path.join(__dirname, '..', '..', '..', 'node_modules', 'mupdf', 'dist'),
  ];

  let wasmPath = null;
  for (const dir of possibleDirs) {
    const candidate = path.join(dir, 'mupdf-wasm.wasm');
    if (fs.existsSync(candidate)) {
      wasmPath = candidate;
      break;
    }
  }

  if (!wasmPath) {
    throw new Error('mupdf-wasm.wasm not found');
  }

  // Pre-read the wasm binary so mupdf doesn't need to resolve it via import.meta.url
  // (which breaks inside asar archives)
  const wasmBinary = fs.readFileSync(wasmPath);

  // Inject the wasm binary via the globalThis hook mupdf-wasm.js checks for
  globalThis['$libmupdf_wasm_Module'] = { wasmBinary };

  _mupdf = await import('mupdf');

  // Clean up
  delete globalThis['$libmupdf_wasm_Module'];

  return _mupdf;
}

// Skip cover extraction for PDFs larger than this (WASM heap limit)
const PDF_MAX_SIZE_FOR_COVER = 50 * 1024 * 1024; // 50 MB

async function renderPdfCover(filePath) {
  try {
    // Skip very large PDFs — loading them into WASM crashes the heap
    const stat = fs.statSync(filePath);
    if (stat.size > PDF_MAX_SIZE_FOR_COVER) return null;

    const mupdf = await getMupdf();

    const buf = fs.readFileSync(filePath);
    const doc = mupdf.Document.openDocument(buf, 'application/pdf');

    if (doc.countPages() === 0) { doc.destroy(); return null; }

    const page = doc.loadPage(0);
    const bounds = page.getBounds(); // [x0, y0, x1, y1]
    const pageW = bounds[2] - bounds[0];
    const pageH = bounds[3] - bounds[1];

    // Scale so the cover is at most 300px wide or 420px tall
    const scale = Math.min(300 / pageW, 420 / pageH, 1.5);
    const matrix = mupdf.Matrix.scale(scale, scale);

    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const jpegBuf = Buffer.from(pixmap.asJPEG(85, false));

    doc.destroy();

    if (jpegBuf.length === 0 || jpegBuf.length > 2 * 1024 * 1024) return null;

    return { data: jpegBuf.toString('base64'), mime: 'image/jpeg' };
  } catch (e) {
    // Reset the mupdf module cache so next call gets a fresh WASM instance
    _mupdf = null;
    return null;
  }
}

// Skip pdf-parse metadata extraction for PDFs larger than this
const PDF_MAX_SIZE_FOR_METADATA = 100 * 1024 * 1024; // 100 MB

async function extractPdf(filePath) {
  try {
    let title = null, author = null, subject = null, creator = null, dateStr = null;

    // Only run pdf-parse on reasonably sized files
    const fileSize = fs.statSync(filePath).size;
    if (fileSize <= PDF_MAX_SIZE_FOR_METADATA) {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer, { max: 1 });

      const info = parsed.info || {};
      title   = cleanTitle(info.Title);
      author  = cleanStr(info.Author);
      subject = cleanStr(info.Subject);
      creator = cleanStr(info.Creator) || cleanStr(info.Producer);
      dateStr = info.CreationDate || info.ModDate;
    }

    // Render first page as cover thumbnail via MuPDF
    const cover = await renderPdfCover(filePath);

    return {
      title:          title || null,
      author:         author || null,
      author_sort:    author ? authorSort(author) : null,
      description:    subject || null,
      publisher:      creator || null,
      year:           extractPdfYear(dateStr),
      language:       null,
      series:         null,
      series_index:   null,
      cover_data:     cover ? cover.data : null,
      cover_mime:     cover ? cover.mime : null,
      metadata_found: (title || author) ? 1 : 0,
    };
  } catch (e) {
    return null;
  }
}

function cleanStr(s) {
  if (!s || typeof s !== 'string') return null;
  const cleaned = s.trim().replace(/\0/g, '');
  if (cleaned.length === 0) return null;
  return cleaned;
}

function cleanTitle(s) {
  const t = cleanStr(s);
  if (!t) return null;
  // Reject titles that look like internal filenames or ISBN-based artefacts:
  // e.g. "9780711254541_WEBproof.pdf", "cover.pdf", "document.PDF"
  if (/\.(pdf|docx?|epub|mobi)$/i.test(t)) return null;
  // Reject titles that are purely numeric (ISBNs stored as title)
  if (/^\d[\d\-_]+$/.test(t)) return null;
  return t;
}

function authorSort(name) {
  if (!name) return null;
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
  }
  return name;
}

function extractPdfYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

module.exports = { extractPdf };
