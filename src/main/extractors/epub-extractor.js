'use strict';

const AdmZip = require('adm-zip');
const xml2js = require('xml2js');
const path = require('path');

const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });

async function extractEpub(filePath) {
  try {
    // Normalize to forward slashes — adm-zip can fail on Windows backslash paths
    const normalFile = filePath.replace(/\\/g, '/');
    const zip = new AdmZip(normalFile);

    // Step 1: Find OPF file from container.xml
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) return null;

    const containerXml = containerEntry.getData().toString('utf8');
    const container = await parser.parseStringPromise(containerXml);

    let opfPath;
    try {
      const rootfiles = container.container.rootfiles.rootfile;
      const rf = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
      opfPath = rf['$']['full-path'];
    } catch (e) {
      return null;
    }

    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) return null;

    const opfXml = opfEntry.getData().toString('utf8');
    const opf = await parser.parseStringPromise(opfXml);

    const pkg = opf.package || opf['opf:package'];
    if (!pkg) return null;

    const metadata = pkg.metadata || pkg['opf:metadata'];
    const manifest = pkg.manifest || pkg['opf:manifest'];

    // OPF directory — used to resolve relative hrefs
    // Use empty string (not '.') so path joining works cleanly
    const rawOpfDir = path.dirname(opfPath).replace(/\\/g, '/');
    const opfDir = (rawOpfDir === '.' || rawOpfDir === '') ? '' : rawOpfDir;

    // Extract basic dc metadata
    const get = (key) => {
      const variants = [key, `dc:${key.replace('dc:', '')}`, `opf:${key}`];
      for (const v of variants) {
        const val = metadata[v];
        if (!val) continue;
        if (typeof val === 'string') return val.trim();
        if (val['_']) return val['_'].trim();
        if (Array.isArray(val)) {
          const first = val[0];
          return typeof first === 'string' ? first.trim() : (first['_'] || '').trim();
        }
      }
      return null;
    };

    const title = get('dc:title') || get('title');
    const rawAuthor = get('dc:creator') || get('creator');
    const description = get('dc:description') || get('description');
    const publisher = get('dc:publisher') || get('publisher');
    const dateStr = get('dc:date') || get('date');
    const language = get('dc:language') || get('language');

    // Extract meta tags (Calibre series, EPUB3 collection)
    let series = null;
    let seriesIndex = null;
    const metas = metadata.meta || [];
    const metaArr = Array.isArray(metas) ? metas : [metas];

    for (const m of metaArr) {
      if (!m) continue;
      const attrs = m['$'] || {};
      const name = attrs.name || '';
      const property = attrs.property || '';
      const content = attrs.content || m['_'] || (typeof m === 'string' ? m : '');

      if (name === 'calibre:series') series = content;
      if (name === 'calibre:series_index') seriesIndex = parseFloat(content);
      if (property === 'belongs-to-collection') series = content;
      if (property === 'group-position') seriesIndex = parseFloat(content);
    }

    // ── Cover image extraction ────────────────────────────────────────
    let coverData = null;
    let coverMime = null;

    try {
      const items = manifest ? (manifest.item || []) : [];
      const itemArr = Array.isArray(items) ? items : [items];

      // Helper: resolve a manifest item href to a zip entry path
      function resolveEntry(href) {
        if (!href) return null;
        const decodedHref = decodeURIComponent(href);
        // Try with opfDir prefix first, then bare href
        const candidates = opfDir
          ? [`${opfDir}/${decodedHref}`, decodedHref, `${opfDir}/${href}`, href]
          : [decodedHref, href];
        for (const p of candidates) {
          const e = zip.getEntry(p);
          if (e) return e;
        }
        return null;
      }

      let coverItem = null;

      // 1. Look for explicit <meta name="cover" content="..."> — content is an item ID
      let coverId = null;
      for (const m of metaArr) {
        if (!m) continue;
        const attrs = m['$'] || {};
        if (attrs.name === 'cover') {
          coverId = attrs.content;
          break;
        }
      }

      if (coverId) {
        // Match by item id
        coverItem = itemArr.find(i => i['$'] && i['$'].id === coverId);

        // Some books set content to the href/filename instead of id (e.g. "cover.jpg")
        if (!coverItem) {
          coverItem = itemArr.find(i => {
            if (!i['$']) return false;
            const href = i['$'].href || '';
            return href === coverId ||
                   href.split('/').pop() === coverId ||
                   path.basename(href, path.extname(href)) === path.basename(coverId, path.extname(coverId));
          });
        }
      }

      // 2. EPUB3: properties="cover-image"
      if (!coverItem) {
        coverItem = itemArr.find(i => i['$'] && (i['$'].properties || '').split(/\s+/).includes('cover-image'));
      }

      // 3. id attribute heuristic
      if (!coverItem) {
        coverItem = itemArr.find(i => {
          if (!i['$']) return false;
          const id = (i['$'].id || '').toLowerCase();
          return id === 'cover' || id === 'cover-image' || id === 'coverimage';
        });
      }

      // 4. Href heuristic — filename contains "cover"
      if (!coverItem) {
        coverItem = itemArr.find(i => {
          if (!i['$']) return false;
          const mt = i['$']['media-type'] || '';
          if (!mt.startsWith('image/')) return false;
          const href = (i['$'].href || '').toLowerCase();
          return href.includes('cover');
        });
      }

      // 5. Last resort: first image in the manifest
      if (!coverItem) {
        coverItem = itemArr.find(i => i['$'] && (i['$']['media-type'] || '').startsWith('image/'));
      }

      if (coverItem) {
        const attrs = coverItem['$'] || {};
        const href = attrs.href;
        const mime = attrs['media-type'] || 'image/jpeg';

        if (href) {
          const entry = resolveEntry(href);
          if (entry) {
            const rawBuffer = entry.getData();
            coverData = resizeCover(rawBuffer, mime);
            coverMime = mime;
          }
        }
      }
    } catch (e) {
      // Cover extraction failed, continue without cover
    }

    return {
      title,
      author: normalizeAuthor(rawAuthor),
      author_sort: authorSort(rawAuthor),
      description,
      publisher,
      year: extractYear(dateStr),
      language,
      series,
      series_index: seriesIndex,
      cover_data: coverData,
      cover_mime: coverMime,
      metadata_found: title ? 1 : 0,
    };
  } catch (e) {
    return null;
  }
}

function resizeCover(buffer, mime) {
  if (!buffer || buffer.length === 0) return null;
  // Cap at 800KB — covers larger than that are unusual and waste DB space
  // We don't have a native resize available in the main process without canvas,
  // so just pass through; the renderer will display at CSS-constrained size.
  // Reject truly enormous raw bitmaps (>2MB) that might be uncompressed.
  if (buffer.length > 2 * 1024 * 1024) return null;
  return buffer;
}

function normalizeAuthor(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && raw['_']) return raw['_'].trim();
  return String(raw).trim();
}

function authorSort(raw) {
  const name = normalizeAuthor(raw);
  if (!name) return null;
  // Convert "First Last" to "Last, First" for sorting
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
  }
  return name;
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

module.exports = { extractEpub };
