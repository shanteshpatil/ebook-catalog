'use strict';

const fs = require('fs');

// EXTH record types
const EXTH_TYPES = {
  100: 'author',
  101: 'publisher',
  103: 'description',
  104: 'isbn',
  108: 'creator',
  503: 'title',
};

async function extractMobi(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(78);
    const bytesRead = fs.readSync(fd, header, 0, 78, 0);

    if (bytesRead < 78) {
      fs.closeSync(fd);
      return null;
    }

    // PalmDB name (first 32 bytes, null-terminated)
    const palmName = header.slice(0, 32).toString('latin1').replace(/\0.*/, '').trim();
    const numRecords = header.readUInt16BE(76);

    if (numRecords === 0) {
      fs.closeSync(fd);
      return { title: palmName || null, metadata_found: 0 };
    }

    // Read record list (each record descriptor = 8 bytes)
    const recListSize = numRecords * 8;
    const recList = Buffer.alloc(recListSize);
    fs.readSync(fd, recList, 0, recListSize, 78);

    const record0Offset = recList.readUInt32BE(0);
    const record1Offset = numRecords > 1 ? recList.readUInt32BE(8) : null;
    const record0Size = record1Offset ? record1Offset - record0Offset : 4096;

    const record0 = Buffer.alloc(Math.min(record0Size, 65536));
    const r0Read = fs.readSync(fd, record0, 0, record0.length, record0Offset);
    fs.closeSync(fd);

    if (r0Read < 16) return null;

    // PalmDoc header is 16 bytes at start of record 0
    // MOBI header starts at offset 16
    const mobiHeaderOffset = 16;
    const mobiId = record0.slice(mobiHeaderOffset, mobiHeaderOffset + 4).toString('ascii');

    if (mobiId !== 'MOBI') {
      return { title: palmName || null, metadata_found: palmName ? 1 : 0 };
    }

    const mobiHeaderLen = record0.readUInt32BE(mobiHeaderOffset + 4);
    const fullTitleOffset = record0.readUInt32BE(mobiHeaderOffset + 84);
    const fullTitleLen = record0.readUInt32BE(mobiHeaderOffset + 88);

    let title = palmName;
    if (fullTitleOffset > 0 && fullTitleLen > 0 && fullTitleOffset + fullTitleLen <= record0.length) {
      title = record0.slice(fullTitleOffset, fullTitleOffset + fullTitleLen).toString('utf8').trim();
    }

    // EXTH block
    const exthOffset = mobiHeaderOffset + mobiHeaderLen;
    const exthData = {};

    if (exthOffset + 12 <= record0.length) {
      const exthId = record0.slice(exthOffset, exthOffset + 4).toString('ascii');
      if (exthId === 'EXTH') {
        const numExthRecords = record0.readUInt32BE(exthOffset + 8);
        let pos = exthOffset + 12;

        for (let i = 0; i < numExthRecords && pos + 8 <= record0.length; i++) {
          const recType = record0.readUInt32BE(pos);
          const recLen = record0.readUInt32BE(pos + 4);
          if (recLen < 8 || pos + recLen > record0.length) break;

          const recData = record0.slice(pos + 8, pos + recLen).toString('utf8').trim();
          const fieldName = EXTH_TYPES[recType];
          if (fieldName && recData) {
            exthData[fieldName] = recData;
          }
          pos += recLen;
        }
      }
    }

    const finalTitle = exthData.title || title || palmName;
    const author = exthData.author || null;

    return {
      title: finalTitle || null,
      author: author || null,
      author_sort: author ? authorSort(author) : null,
      description: exthData.description || null,
      publisher: exthData.publisher || null,
      year: null,
      language: null,
      series: null,
      series_index: null,
      cover_data: null,
      cover_mime: null,
      metadata_found: (finalTitle || author) ? 1 : 0,
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

module.exports = { extractMobi };
