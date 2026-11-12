/**
 * A book as an EPUB 3 file, for other e-readers: one XHTML file per chapter, built from the same
 * index the reader shows (headings, bold and italics, scene breaks), a navigation document and an
 * NCX for older readers. The book's id is the EPUB's identifier (urn:uuid:…).
 */
import type { BookIndex, InlineMark } from '@temporis/book-parser';

export interface EpubInput {
  id: string;
  title: string;
  /** BCP 47, or null when unknown. */
  language: string | null;
  modified: Date;
  content: string;
  index: BookIndex;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function paragraphs(content: string, index: BookIndex): string[] {
  return index.paragraphOffsets.map((start, i) => {
    const next = index.paragraphOffsets[i + 1];
    return content.slice(start, next === undefined ? content.length : next - 1);
  });
}

/** Text with bold and italic ranges as <b> and <i> (cut at every boundary, so they always nest). */
export function inlineXhtml(text: string, marks: InlineMark[] = []): string {
  if (!marks.length) return escape(text);
  const cuts = [...new Set([0, text.length, ...marks.flatMap(([a, b]) => [a, b])])].filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  let out = '';
  for (let k = 0; k < cuts.length - 1; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    let piece = escape(text.slice(a, b));
    const on = (kind: 'b' | 'i') => marks.some(([s, e, m]) => m === kind && s <= a && e >= b);
    if (on('b')) piece = `<b>${piece}</b>`;
    if (on('i')) piece = `<i>${piece}</i>`;
    out += piece;
  }
  return out;
}

const xhtml = (lang: string, title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>${escape(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;

const STYLE = `body { margin: 0 5%; line-height: 1.6; }
h1, h2 { text-align: center; }
p { margin: 0 0 0.8em; }
hr.scene { border: none; margin: 1.4em 0; text-align: center; }
hr.scene::after { content: "*   *   *"; white-space: pre; }
`;

/** The EPUB's files, in order (mimetype first, as the format requires). */
export function epubFiles(book: EpubInput): [name: string, text: string][] {
  const lang = book.language || 'und';
  const all = paragraphs(book.content, book.index);
  const headings = new Set(book.index.headings);
  const breaks = new Set(book.index.breaks);
  const chapters = book.index.chapters.map((c, n) => {
    const parts: string[] = [];
    // The chapter's own heading as its title, or the chapter title when it doesn't open with one.
    let start = c.start;
    if (headings.has(c.start)) {
      parts.push(`<h1>${inlineXhtml(all[c.start], book.index.marks[c.start])}</h1>`);
      start++;
    } else parts.push(`<h1>${escape(c.title)}</h1>`);
    for (let p = start; p < c.end; p++) {
      if (breaks.has(p)) parts.push('<hr class="scene"/>');
      const tag = headings.has(p) ? 'h2' : 'p';
      parts.push(`<${tag}>${inlineXhtml(all[p], book.index.marks[p])}</${tag}>`);
    }
    return { file: `chapter-${String(n + 1).padStart(3, '0')}.xhtml`, title: c.title, html: xhtml(lang, c.title, `<section epub:type="chapter">\n${parts.join('\n')}\n</section>`) };
  });

  const id = `urn:uuid:${book.id}`;
  const modified = book.modified.toISOString().replace(/\.\d+Z$/, 'Z');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escape(id)}</dc:identifier>
<dc:title>${escape(book.title)}</dc:title>
<dc:language>${escape(lang)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="style" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('\n')}
</spine>
</package>
`;
  const nav = xhtml(
    lang,
    book.title,
    `<nav epub:type="toc" id="toc">\n<h1>${escape(book.title)}</h1>\n<ol>\n${chapters.map((c) => `<li><a href="${c.file}">${escape(c.title)}</a></li>`).join('\n')}\n</ol>\n</nav>`,
  );
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escape(id)}"/></head>
<docTitle><text>${escape(book.title)}</text></docTitle>
<navMap>
${chapters.map((c, i) => `<navPoint id="p${i + 1}" playOrder="${i + 1}"><navLabel><text>${escape(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`;
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
  return [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/toc.ncx', ncx],
    ['OEBPS/style.css', STYLE],
    ...chapters.map((c): [string, string] => [`OEBPS/${c.file}`, c.html]),
  ];
}

export function buildEpub(book: EpubInput): Uint8Array {
  return zip(epubFiles(book).map(([name, text]) => [name, new TextEncoder().encode(text)]), book.modified);
}

// A minimal ZIP writer: entries stored uncompressed (books are small; mimetype must be anyway).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(entries: [name: string, data: Uint8Array][], date = new Date()): Uint8Array {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const header = (central: boolean) => {
      const h = new DataView(new ArrayBuffer(central ? 46 : 30));
      let p = 0;
      const u32 = (v: number) => (h.setUint32(p, v, true), (p += 4));
      const u16 = (v: number) => (h.setUint16(p, v, true), (p += 2));
      u32(central ? 0x02014b50 : 0x04034b50);
      if (central) u16(20); // version made by
      u16(20); // version needed
      u16(0x0800); // UTF-8 names
      u16(0); // stored
      u16(dosTime);
      u16(dosDate);
      u32(crc);
      u32(data.length);
      u32(data.length);
      u16(nameBytes.length);
      u16(0); // extra
      if (central) {
        u16(0); // comment
        u16(0); // disk
        u16(0); // internal attributes
        u32(0); // external attributes
        u32(offset);
      }
      return new Uint8Array(h.buffer);
    };
    const local = header(false);
    locals.push(local, nameBytes, data);
    centrals.push(header(true), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
