const { recognize } = require('tesseract.js');
const path = require('path');

const DEFAULT_LANG = 'ron+hun+eng';
const SUPPORTED_LANGS = new Set(['eng', 'ron', 'hun']);

function langPath() {
  return path.join(__dirname, '..', 'assets', 'lang');
}

function normalizeLang(lang) {
  const parts = String(lang || DEFAULT_LANG)
    .split('+')
    .map(p => p.trim().toLowerCase())
    .filter(p => SUPPORTED_LANGS.has(p));
  if (parts.length === 0) return DEFAULT_LANG;
  return parts.join('+');
}

async function runOcr(imageDataUrl, lang) {
  const result = await recognize(imageDataUrl, normalizeLang(lang), { langPath: langPath() });
  const text = (result.data.text || '').trim();
  if (!text) {
    throw new Error('OCR produced no text. Try a sharper capture or a different region.');
  }
  return text;
}

module.exports = { runOcr, normalizeLang };
