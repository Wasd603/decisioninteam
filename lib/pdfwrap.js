// Minimal PDF wrapper: embeds a JPEG as a one-page PDF, so OpenRouter's
// file-parser plugin (engine: mistral-ocr) can OCR it server-side.

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('JPEG size not found');
}

function buildPdfFromJpeg(jpegBuf, width, height) {
  const pageW = Math.round(width);
  const pageH = Math.round(height);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    null,
    null
  ];

  const parts = [];
  let offset = 0;
  const offsets = [];
  const push = (s) => { parts.push(Buffer.from(s, 'latin1')); offset += Buffer.from(s, 'latin1').length; };

  push('%PDF-1.4\n');
  for (let n = 1; n <= objects.length; n++) {
    offsets.push(offset);
    if (n === 4) {
      const head = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuf.length} >>\nstream\n`;
      push(`${n} 0 obj\n${head}`);
      parts.push(jpegBuf); offset += jpegBuf.length;
      push('\nendstream\nendobj\n');
    } else if (n === 5) {
      const head = `<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
      push(`${n} 0 obj\n${head}`);
    } else {
      push(`${n} 0 obj\n${objects[n - 1]}\nendobj\n`);
    }
  }

  const xrefPos = offset;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets) {
    xref += off.toString().padStart(10, '0') + ' 00000 n \n';
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  return Buffer.concat(parts);
}

module.exports = { buildPdfFromJpeg, jpegSize };
