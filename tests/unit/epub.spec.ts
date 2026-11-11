import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { assembleBook, parseEpub, readEpubParagraphs, resolveHref, tokenize } from '@temporis/book-parser';
import { type SourceMeta } from '../../src/books/library';

const CHINESE = 'Ha Li _Bo Te Yu Li Xing Zhi Dao - Eliezer Yudkowsky.epub';
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test epubs/${name}`, import.meta.url)));

/** A minimal ZIP writer (deflate, or stored for `mimetype`), enough to build test EPUBs. */
export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const stored = name === 'mimetype';
    const data = stored ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dir, end]));
}

const CONTAINER = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const xhtml = (body: string, lang = 'fr') =>
  `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head><title>t</title><style>p { color: red }</style></head><body>${body}</body></html>`;

interface Doc {
  id: string;
  href: string;
  body: string;
  linear?: boolean;
}

/** An EPUB with the given spine documents and, optionally, a nav document and/or NCX. */
function makeEpub(options: { title?: string; language?: string; docs: Doc[]; nav?: string; ncx?: string; extra?: Record<string, string> }): Uint8Array {
  const manifest = options.docs.map((d) => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"/>`);
  if (options.nav) manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  if (options.ncx) manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  const spine = options.docs.map((d) => `<itemref idref="${d.id}"${d.linear === false ? ' linear="no"' : ''}/>`);
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${options.title === undefined ? '' : `<dc:title>${options.title}</dc:title>`}
    <dc:creator>Jean   Auteur</dc:creator>
    ${options.language ? `<dc:language>${options.language}</dc:language>` : ''}
  </metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine${options.ncx ? ' toc="ncx"' : ''}>${spine.join('')}</spine>
</package>`;
  const files: Record<string, string> = { mimetype: 'application/epub+zip', 'META-INF/container.xml': CONTAINER, 'OPS/book.opf': opf };
  for (const d of options.docs) files[`OPS/${decodeURIComponent(d.href)}`] = xhtml(d.body);
  if (options.nav) files['OPS/nav.xhtml'] = xhtml(options.nav);
  if (options.ncx) files['OPS/toc.ncx'] = options.ncx;
  return zip({ ...files, ...options.extra });
}

test.describe('real EPUBs', () => {
  test('French: Le comte de Monte-Cristo (EPUB 3, Project Gutenberg)', async () => {
    const book = await parseEpub(fixture('pg17989-images-3.epub'), 'fallback');
    expect(book.title).toBe('Le comte de Monte-Cristo, Tome I');
    expect(book.author).toBe('Alexandre Dumas, Auguste Maquet');
    expect(book.language).toBe('fr');
    // The title page (in Gutenberg's header file, after its "*** START" line) is kept; its contents
    // table isn't. The TOC's "I" and "Marseille.—L'arrivée." land on consecutive headings: one chapter.
    expect(book.chapters.slice(0, 4).map((c) => c.title)).toEqual([
      'LE COMTE DE MONTE-CRISTO · Alexandre Dumas · Tome I (1845-1846)',
      'I · Marseille.—L\'arrivée.',
      'II · Le père et le fils.',
      'III · Les Catalans.',
    ]);
    expect(book.paragraphs.slice(0, 5)).toEqual(['LE COMTE DE MONTE-CRISTO', 'Alexandre Dumas', 'Tome I (1845-1846)', 'I', 'Marseille.—L\'arrivée.']);
    expect(book.paragraphs).not.toContain('Table des matières');
    // 31 chapters plus the title page; "FIN DU TOME PREMIER" is nested under XXXI in the TOC, so stays in it.
    expect(book.chapters).toHaveLength(32);
    expect(book.chapters.at(-1)!.title).toBe("XXXI · Italie.—Simbad le marin.");
    expect(book.paragraphs[book.chapters[1].start + 2]).toMatch(/^Le 24 février 1815, la vigie de Notre-Dame de la Garde/);
    // Italics survive: "le <i>Pharaon</i>".
    const p = book.chapters[1].start + 2;
    const [start, end, kind] = book.marks[p][0];
    expect([book.paragraphs[p].slice(start, end), kind]).toEqual(['Pharaon', 'i']);
    // Gutenberg's English header and licence are left out.
    expect(book.paragraphs.some((t) => /Project Gutenberg/i.test(t))).toBe(false);
    // Chapters tile the book.
    book.chapters.forEach((c, i) => expect(c.start).toBe(i ? book.chapters[i - 1].end : 0));
    expect(book.chapters.at(-1)!.end).toBe(book.paragraphs.length);
  });

  test('German: Faust (verse lines are paragraphs)', async () => {
    const book = await parseEpub(fixture('pg2229-images-3.epub'), 'fallback');
    expect(book.title).toBe('Faust: Der Tragödie erster Teil');
    expect(book.author).toBe('Johann Wolfgang von Goethe');
    expect(book.language).toBe('de');
    expect(book.chapters.map((c) => c.title).slice(0, 5)).toEqual([
      'Faust: Der Tragödie erster Teil',
      'Zueignung',
      'Vorspiel auf dem Theater',
      'Prolog im Himmel',
      'FAUST: Der Tragödie erster Teil · Nacht',
    ]);
    expect(book.chapters.at(-1)!.title).toBe('Kerker');
    expect(book.paragraphs.slice(0, 5)).toEqual(['Faust:', 'Der Tragödie erster Teil', 'by Johann Wolfgang von Goethe', 'Zueignung', 'Ihr naht euch wieder, schwankende Gestalten,']);
    // The "Contents" TOC entry pointed at the left-out contents list.
    expect(book.chapters.some((c) => c.title.includes('Contents'))).toBe(false);
    expect(book.paragraphs.every((t) => t && !t.includes('\n'))).toBe(true);
    expect(book.paragraphs.some((t) => /Project Gutenberg/i.test(t))).toBe(false);
  });

  test('German: Kritik der reinen Vernunft (made from .txt: no TOC, no <h1>–<h6>)', async () => {
    const book = await parseEpub(fixture('pg6343-images-3.epub'), 'fallback');
    expect(book.title).toBe('Kritik der reinen Vernunft / Zweite hin und wieder verbesserte Auflage (1787)');
    // The book's opening shares a file with Gutenberg's header: only the header goes.
    expect(book.paragraphs[0]).toBe('This text has been derived from HTML files at "Projekt Gutenberg - DE"');
    expect(book.paragraphs.some((t) => /START OF THE PROJECT|END OF THE PROJECT|Project Gutenberg License/i.test(t))).toBe(false);
    // Headings come from Ebookmaker's margin-top on paragraphs that followed blank lines.
    expect(book.chapters.length).toBeGreaterThan(100);
    const titles = book.chapters.map((c) => c.title);
    expect(titles).toContain('Vorrede zur zweiten Auflage');
    expect(titles).toContain('Einleitung');
    // Lines of one heading (split by <br>) make one title.
    expect(titles).toContain('Der transzendentalen Ästhetik · Erster Abschnitt · Von dem Raume');
    expect(titles).toContain('§ 14 Übergang zur transz. Deduktion der Kategorien');
    expect(titles.at(-1)).toBe('Der transzendentalen Methodenlehre · Viertes Hauptstück · Die Geschichte der reinen Vernunft');
    expect(book.chapters.every((c) => book.headings.includes(c.start) || c.start === 0)).toBe(true);
  });

  test('Chinese: a Calibre EPUB 2 with ~720 split files, an NCX and a wrong language tag', async () => {
    const book = await parseEpub(fixture(CHINESE), 'fallback');
    expect(book.title).toBe('哈利·波特与理性之道');
    expect(book.author).toBe('Eliezer Yudkowsky');
    // Declared "en"; the library ignores unsupported tags and detects Chinese from the text instead.
    expect(book.language).toBe('en');
    expect(book.chapters).toHaveLength(128);
    expect(book.chapters.slice(0, 4).map((c) => c.title)).toEqual(['《哈利·波特与理性之道》', '前言', '第零章：预告', '第一章：极小概率的一天']);
    // Chapter titles are plain <p>s in this book; they match the TOC, so they become headings.
    expect(book.chapters.every((c) => book.headings.includes(c.start))).toBe(true);
    const first = book.chapters[3];
    expect(book.paragraphs[first.start]).toBe('第一章：极小概率的一天');
    // &nbsp; spacer paragraphs are dropped, and lines inside CJK text don't gain spaces.
    expect(book.paragraphs.every((t) => t.trim() === t && t.length > 0)).toBe(true);
    // Calibre's <span class="italic"> becomes marks.
    expect(Object.keys(book.marks).length).toBeGreaterThan(1000);
    // The generated "Table of Contents" page at the end isn't part of the text.
    expect(book.paragraphs).not.toContain('Table of Contents');
  });

  test('English: HPMOR (Calibre EPUB 2, books → chapters → sections in the NCX)', async () => {
    const book = await parseEpub(fixture('hpmor.epub'), 'fallback');
    expect(book.title).toBe('Harry Potter and the Methods of Rationality');
    const titles = book.chapters.map((c) => c.title);
    expect(titles.slice(0, 5)).toEqual([
      'Harry Potter and the Methods of Rationality',
      'Preface',
      // A section right under its chapter's heading reads as a subtitle.
      'Author’s introduction · Something, somewhere, somewhen, must have happened differently…',
      '1. Harry James Potter-Evans-Verres and the Methods of Rationality · 1. A Day of Very Low Probability',
      '2. Everything I Believe Is False',
    ]);
    expect(titles.at(-1)).toBe('123. Something to Protect: Hermione Granger');
    // Sections ("Aftermath", "Act 2", "Omake Files I: …") stay inside their chapters.
    expect(titles.filter((t) => /^(\d+\. )?(Aftermath|Act \d|Omake Files I:|Interlude$|Earlier$)/.test(t))).toEqual(['117. Aftermath, Something to Protect, Part 0']);
    expect(book.chapters).toHaveLength(127);
  });

  test('indexes into a book like any other source', async () => {
    const parsed = await parseEpub(fixture('pg2229-images-3.epub'), 'x');
    const source = { id: 's', title: parsed.title, format: 'epub', fileName: 'faust.epub', split: true, path: '', chapterCount: 0, paragraphCount: 0 } as SourceMeta;
    const { index, content } = assembleBook([{ source, parsed }]);
    expect(index.chapters).toHaveLength(parsed.chapters.length);
    expect(content.split('\n')).toHaveLength(parsed.paragraphs.length);
    expect(source.chapterCount).toBe(parsed.chapters.length);
  });
});

test.describe('reading one chapter from its own files', () => {
  // Every chapter of every test EPUB, read alone, is exactly what the full parse gives.
  for (const name of readdirSync(new URL('../test epubs/', import.meta.url))) {
    test(name, async () => {
      const bytes = fixture(name);
      const book = await parseEpub(bytes, 'x');
      for (const c of book.chapters) {
        const part = await readEpubParagraphs(bytes, book.layout, c.start, c.end);
        expect(part.paragraphs).toEqual(book.paragraphs.slice(c.start, c.end));
        expect(part.marks).toEqual(Object.fromEntries(Object.entries(book.marks).filter(([p]) => +p >= c.start && +p < c.end)));
      }
    });
  }

  test('a file that no longer matches its layout is refused', async () => {
    const book = await parseEpub(fixture('pg2229-images-3.epub'), 'x');
    const other = fixture('pg17989-images-3.epub');
    await expect(readEpubParagraphs(other, book.layout, 0, book.paragraphs.length)).rejects.toThrow('doesn’t match');
  });
});

test.describe('EPUB structure', () => {
  test('EPUB 3 nav: nested entries are flattened and fragments resolve', async () => {
    const book = await parseEpub(
      makeEpub({
        title: 'Livre',
        language: 'fr-FR',
        docs: [
          { id: 'a', href: 'text/one.xhtml', body: '<h1>Partie</h1><h2 id="c1">Un</h2><p>Premier.</p><h2 id="c2">Deux</h2><p>Second.</p>' },
          { id: 'b', href: 'text/two%20b.xhtml', body: '<section id="s"><h2>Trois</h2><p>Troisième.</p></section>' },
        ],
        nav: `<nav epub:type="landmarks"><ol><li><a href="text/one.xhtml">Start</a></li></ol></nav>
          <nav epub:type="toc"><ol>
            <li><a href="text/one.xhtml">Partie</a><ol>
              <li><a href="text/one.xhtml#c1"><span>Un</span></a></li>
              <li><a href="text/one.xhtml#c2">Deux</a></li></ol></li>
            <li><a href="text/two%20b.xhtml#s">Trois</a></li>
          </ol></nav>`,
      }),
      'x',
    );
    expect(book.language).toBe('fr-FR');
    expect(book.chapters).toEqual([
      { title: 'Partie · Un', start: 0, end: 3 },
      { title: 'Deux', start: 3, end: 5 },
      { title: 'Trois', start: 5, end: 7 },
    ]);
    expect(book.headings).toEqual([0, 1, 3, 5]);
  });

  test('EPUB 2 NCX is used when there is no nav document', async () => {
    const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="n1"><navLabel><text>Chapitre 1</text></navLabel><content src="c1.xhtml"/>
        <navPoint id="n1a"><navLabel><text>Scène</text></navLabel><content src="c1.xhtml#scene"/></navPoint>
      </navPoint>
      <navPoint id="n2"><navLabel><text>Chapitre 2</text></navLabel><content src="c2.xhtml"/></navPoint>
    </navMap></ncx>`;
    const book = await parseEpub(
      makeEpub({
        title: 'Vieux',
        docs: [
          { id: 'c1', href: 'c1.xhtml', body: '<p>Début.</p><p id="scene">Scène.</p>' },
          { id: 'c2', href: 'c2.xhtml', body: '<p>Fin.</p>' },
        ],
        ncx,
      }),
      'x',
    );
    expect(book.chapters.map((c) => [c.title, c.start])).toEqual([
      ['Chapitre 1', 0],
      ['Scène', 1],
      ['Chapitre 2', 2],
    ]);
  });

  test('TOC entries below the chapter level (sections inside a chapter file) only add subtitles', async () => {
    const point = (title: string, src: string, children = '') => `<navPoint><navLabel><text>${title}</text></navLabel><content src="${src}"/>${children}</navPoint>`;
    const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      ${point('Book One', 'c1.xhtml', [1, 2, 3, 4].map((n) => point(`${n}. Chapter`, `c${n}.xhtml`, point('Aftermath', `c${n}.xhtml#after`))).join(''))}
    </navMap></ncx>`;
    const docs = [1, 2, 3, 4].map((n) => ({ id: `c${n}`, href: `c${n}.xhtml`, body: `<h2>${n}. Chapter</h2><p>Text ${n}.</p><h3 id="after">Aftermath</h3><p>After ${n}.</p>` }));
    docs[0].body = `<h1>Book One</h1>${docs[0].body}`;
    const book = await parseEpub(makeEpub({ title: 'Nested', docs, ncx }), 'x');
    expect(book.chapters.map((c) => c.title)).toEqual(['Book One · 1. Chapter', '2. Chapter', '3. Chapter', '4. Chapter']);
    // The section headings are still headings in the text.
    expect(book.headings).toContain(book.paragraphs.indexOf('Aftermath'));
  });

  test('without a TOC, chapters come from headings; non-linear items are skipped', async () => {
    const book = await parseEpub(
      makeEpub({
        title: 'Sans TOC',
        docs: [
          { id: 'cover', href: 'cover.xhtml', body: '<p>Couverture</p>' },
          { id: 'a', href: 'a.xhtml', body: '<h1>Un</h1><p>Texte un.</p>' },
          { id: 'notes', href: 'notes.xhtml', body: '<p>Note.</p>', linear: false },
          { id: 'b', href: 'b.xhtml', body: '<h1>Deux</h1><p>Texte deux.</p>' },
        ],
      }),
      'x',
    );
    expect(book.paragraphs).toEqual(['Couverture', 'Un', 'Texte un.', 'Deux', 'Texte deux.']);
    expect(book.chapters.map((c) => c.title)).toEqual(['Sans TOC', 'Un', 'Deux']);
  });

  test('text before the first TOC entry gets its own chapter', async () => {
    const book = await parseEpub(
      makeEpub({
        title: 'T',
        docs: [
          { id: 'a', href: 'a.xhtml', body: '<p>Avant-propos.</p>' },
          { id: 'b', href: 'b.xhtml', body: '<h1>Un</h1><p>Texte.</p>' },
        ],
        nav: '<nav epub:type="toc"><ol><li><a href="b.xhtml">Un</a></li><li><a href="missing.xhtml">Perdu</a></li></ol></nav>',
      }),
      'x',
    );
    expect(book.chapters).toEqual([
      { title: 'Avant-propos.', start: 0, end: 1 },
      { title: 'Un', start: 1, end: 3 },
    ]);
  });

  test('a page of links into the book is a TOC and is left out; plain-<p> titles matching the TOC become headings', async () => {
    const tocPage = '<p>Contents</p>' + ['a', 'b', 'c'].map((x) => `<p><a href="${x}.xhtml">Chapter ${x}</a></p>`).join('');
    const book = await parseEpub(
      makeEpub({
        title: 'T',
        docs: [
          { id: 'toc', href: 'toc.xhtml', body: tocPage },
          { id: 'a', href: 'a.xhtml', body: '<p class="title">Chapter a</p><p>Text a, with a <a href="http://example.com">web link</a>.</p>' },
          { id: 'b', href: 'b.xhtml', body: '<p>Chapter b</p><p><a href="a.xhtml">See a</a> and more text here.</p>' },
          { id: 'c', href: 'c.xhtml', body: '<p>Not the title</p><p>Text c.</p>' },
        ],
        ncx: `<ncx><navMap>${['a', 'b', 'c'].map((x) => `<navPoint><navLabel><text>Chapter ${x}</text></navLabel><content src="${x}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`,
      }),
      'x',
    );
    expect(book.paragraphs[0]).toBe('Chapter a');
    expect(book.chapters.map((c) => [c.title, c.start])).toEqual([
      ['Chapter a', 0],
      ['Chapter b', 2],
      ['Chapter c', 4],
    ]);
    expect(book.headings).toEqual([0, 2]);
  });

  test('missing title falls back to the file name; language may be absent', async () => {
    const book = await parseEpub(makeEpub({ docs: [{ id: 'a', href: 'a.xhtml', body: '<p>Bonjour.</p>' }] }), 'mon-livre');
    expect(book.title).toBe('mon-livre');
    expect(book.author).toBe('Jean Auteur');
    expect(book.language).toBeNull();
  });
});

test.describe('Project Gutenberg and contents lists', () => {
  test('boilerplate is cut at the START/END lines, keeping text in the same files', async () => {
    const book = await parseEpub(
      makeEpub({
        title: 'T',
        docs: [
          { id: 'pg-header', href: 'h.xhtml', body: '<p>The Project Gutenberg eBook of T</p><div id="pg-start-separator"><span>*** START OF THE PROJECT GUTENBERG EBOOK T ***</span></div><p>Erster Satz.</p>' },
          { id: 'b', href: 'b.xhtml', body: '<p>Zweiter Satz.</p>' },
          { id: 'pg-footer', href: 'f.xhtml', body: '<p>Letzter Satz.</p><div id="pg-end-separator">*** END OF THE PROJECT GUTENBERG EBOOK T ***</div><p>THE FULL PROJECT GUTENBERG LICENSE</p>' },
        ],
      }),
      'x',
    );
    expect(book.paragraphs).toEqual(['Erster Satz.', 'Zweiter Satz.', 'Letzter Satz.']);
  });

  test('a contents list is dropped with its heading; headings that link back to it are kept', async () => {
    const links = ['a', 'b', 'c'].map((x) => `<tr><td><a href="${x}.xhtml#${x}">Kapitel ${x}</a></td></tr>`).join('');
    const book = await parseEpub(
      makeEpub({
        title: 'T',
        docs: [
          { id: 't', href: 't.xhtml', body: `<h1>Titel</h1><h2 id="toc">Inhalt</h2><table>${links}</table>` },
          ...['a', 'b', 'c'].map((x) => ({ id: x, href: `${x}.xhtml`, body: `<h2 id="${x}"><a href="t.xhtml#toc">Kapitel ${x}</a></h2><p>Text ${x}, mit <a href="t.xhtml#toc">Verweis</a>.</p>` })),
        ],
        nav: `<nav epub:type="toc"><ol><li><a href="t.xhtml">Titel</a></li><li><a href="t.xhtml#toc">Inhalt</a></li>${['a', 'b', 'c'].map((x) => `<li><a href="${x}.xhtml#${x}">Kapitel ${x}</a></li>`).join('')}</ol></nav>`,
      }),
      'x',
    );
    expect(book.paragraphs).toEqual(['Titel', 'Kapitel a', 'Text a, mit Verweis.', 'Kapitel b', 'Text b, mit Verweis.', 'Kapitel c', 'Text c, mit Verweis.']);
    // "Inhalt" pointed at the dropped list, and the title page doesn't merge into the next file's chapter.
    expect(book.chapters.map((c) => c.title)).toEqual(['Titel', 'Kapitel a', 'Kapitel b', 'Kapitel c']);
  });

  test('without TOC or h1–h6, spaced and "Chapter N" paragraphs are headings; lines of one paragraph join', async () => {
    const book = await parseEpub(
      makeEpub({
        title: 'T',
        docs: [
          {
            id: 'a',
            href: 'a.xhtml',
            body:
              '<p>Vorwort ohne Abstand.</p><p style="margin-top: 3em">Erster Teil<br/>Vom Raume</p><p>Text eins.</p>' +
              '<p style="margin-top: 4em">Zweiter Teil</p><p style="margin-top: 3em">Von der Zeit</p><p>Text zwei.</p>' +
              '<p>Chapter 3</p><p>Text drei.</p><p style="margin-top: 3em">' + 'Ein langer Absatz mit Abstand. '.repeat(10) + '</p>',
          },
        ],
        nav: '<nav epub:type="toc"><ol><li><a href="a.xhtml">T</a></li></ol></nav>',
      }),
      'Buch',
    );
    expect(book.chapters.map((c) => [c.title, c.start])).toEqual([
      ['T', 0],
      ['Erster Teil · Vom Raume', 1],
      ['Zweiter Teil', 4],
      ['Von der Zeit', 5],
      ['Chapter 3', 7],
    ]);
    expect(book.headings).toEqual([1, 2, 4, 5, 7]);
  });
});

test.describe('XHTML text', () => {
  const textOf = async (body: string) => {
    const book = await parseEpub(makeEpub({ title: 'T', docs: [{ id: 'a', href: 'a.xhtml', body }] }), 'x');
    return book;
  };

  test('whitespace collapses; <br> and blocks end paragraphs; entities decode', async () => {
    const book = await textOf(`<div>  Un\n   deux <span>trois</span>
      <p>Quatre&#160;! &amp; &lt;cinq&gt; &mdash; &#x263A; &eacute;t&eacute;&shy;s &unknown;</p>poème<br/>vers deux<br/><br/>
      <![CDATA[a < b]]><script>ignored()</script><ruby>漢<rt>kan</rt></ruby></div>`);
    expect(book.paragraphs).toEqual(['Un deux trois', 'Quatre ! & <cinq> — ☺ étés &unknown;', 'poème', 'vers deux', 'a < b漢']);
  });

  test('a line break between CJK characters is not a space', async () => {
    const book = await textOf('<p>今天早上，\n  阳光很好。Hello\nworld</p>');
    expect(book.paragraphs).toEqual(['今天早上，阳光很好。Hello world']);
  });

  test('bold and italic become marks, also across nested and unclosed tags', async () => {
    const book = await textOf('<p>Un <i>deux <b>trois</b></i> quatre <em>cinq</p><p>six</p><h2>Titre <i>ital</i></h2>');
    expect(book.paragraphs).toEqual(['Un deux trois quatre cinq', 'six', 'Titre ital']);
    expect(book.marks[0]).toEqual([
      [3, 13, 'i'],
      [8, 13, 'b'],
      [21, 25, 'i'],
    ]);
    // Headings never carry marks.
    expect(book.marks[2]).toBeUndefined();
    expect(book.headings).toEqual([2]);
  });

  test('blank (&nbsp;) paragraphs are dropped and indents trimmed; class="italic"/"bold" spans are marks', async () => {
    const book = await textOf('<p><span>&#160;</span></p><p>\u3000\u3000她说：<span class="italic">不是</span>。</p><p>&nbsp;</p><p><span class="calibre bold">粗</span>体</p>');
    expect(book.paragraphs).toEqual(['她说：不是。', '粗体']);
    expect(book.marks[0]).toEqual([[3, 5, 'i']]);
    expect(book.marks[1]).toEqual([[0, 1, 'b']]);
  });

  test('pre keeps its lines', async () => {
    const book = await textOf('<pre>line one\n  line two</pre>');
    expect(book.paragraphs).toEqual(['line one', 'line two']);
  });
});

test.describe('broken and protected files', () => {
  test('not a ZIP', async () => {
    await expect(parseEpub(new TextEncoder().encode('just text'), 'x')).rejects.toThrow('isn’t a valid EPUB');
  });

  test('a ZIP without a package document', async () => {
    await expect(parseEpub(zip({ 'hello.txt': 'hi' }), 'x')).rejects.toThrow('no package document');
  });

  test('no readable text', async () => {
    await expect(parseEpub(makeEpub({ title: 'T', docs: [{ id: 'a', href: 'a.xhtml', body: '<img src="x.png"/>' }] }), 'x')).rejects.toThrow('no readable text');
  });

  test('Adobe DRM (rights.xml)', async () => {
    const epub = makeEpub({ title: 'T', docs: [{ id: 'a', href: 'a.xhtml', body: '<p>x</p>' }], extra: { 'META-INF/rights.xml': '<rights/>' } });
    await expect(parseEpub(epub, 'x')).rejects.toThrow('DRM');
  });

  test('encrypted content documents are DRM, obfuscated fonts are fine', async () => {
    const encryption = (uri: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
    const docs = [{ id: 'a', href: 'a.xhtml', body: '<p>x</p>' }];
    await expect(parseEpub(makeEpub({ title: 'T', docs, extra: { 'META-INF/encryption.xml': encryption('OPS/a.xhtml') } }), 'x')).rejects.toThrow('DRM');
    const fonts = await parseEpub(makeEpub({ title: 'T', docs, extra: { 'META-INF/encryption.xml': encryption('OPS/font.otf') } }), 'x');
    expect(fonts.paragraphs).toEqual(['x']);
  });

  test('a spine item missing from the archive is skipped', async () => {
    const epub = makeEpub({ title: 'T', docs: [{ id: 'a', href: 'a.xhtml', body: '<p>x</p>' }] });
    const book = await parseEpub(epub, 'x');
    expect(book.paragraphs).toEqual(['x']);
  });

  test('trailing bytes after the archive (a changed checksum) still parse', async () => {
    const original = fixture('pg2229-images-3.epub');
    const padded = new Uint8Array([...original, 1, 2, 3]);
    expect((await parseEpub(padded, 'x')).title).toBe('Faust: Der Tragödie erster Teil');
  });
});

test('hrefs resolve relative to their document and are percent-decoded', () => {
  expect(resolveHref('OPS/text/', '../images/a%20b.png#x')).toBe('OPS/images/a b.png#x');
  expect(resolveHref('OPS/', '#frag')).toBe('#frag');
  expect(resolveHref('OPS/', '/root.xhtml')).toBe('root.xhtml');
});

test('tokenizer handles attributes with > in quotes and self-closing tags', () => {
  expect([...tokenize('<a title="x > y" href=\'h\'/>t</a>')]).toEqual([
    { type: 'open', name: 'a', attrs: { title: 'x > y', href: 'h' }, selfClosing: true },
    { type: 'text', text: 't' },
    { type: 'close', name: 'a' },
  ]);
});
