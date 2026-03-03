'use strict';

const AdmZip = require('adm-zip');
const xml2js = require('xml2js');

const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });

async function extractDocx(filePath) {
  try {
    const zip = new AdmZip(filePath.replace(/\\/g, '/'));

    const coreEntry = zip.getEntry('docProps/core.xml');
    if (!coreEntry) return null;

    const coreXml = coreEntry.getData().toString('utf8');
    const core = await parser.parseStringPromise(coreXml);

    const props = core['cp:coreProperties'] || core.coreProperties || {};

    const get = (key) => {
      const val = props[key];
      if (!val) return null;
      if (typeof val === 'string') return val.trim();
      if (val['_']) return val['_'].trim();
      return null;
    };

    const title = get('dc:title');
    const author = get('dc:creator');
    const description = get('dc:description') || get('dc:subject');
    const dateStr = get('dcterms:created') || get('dcterms:modified');

    return {
      title: title || null,
      author: author || null,
      author_sort: author ? authorSort(author) : null,
      description: description || null,
      publisher: null,
      year: extractYear(dateStr),
      language: null,
      series: null,
      series_index: null,
      cover_data: null,
      cover_mime: null,
      metadata_found: (title || author) ? 1 : 0,
    };
  } catch (e) {
    return null;
  }
}

function authorSort(name) {
  if (!name) return null;
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

module.exports = { extractDocx };
