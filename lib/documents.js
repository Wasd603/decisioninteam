const fs = require('fs/promises');
const path = require('path');

async function readDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return fs.readFile(filePath, 'utf-8');
}

module.exports = { readDocument };
