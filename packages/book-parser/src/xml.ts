/**
 * A small, forgiving XML/XHTML tokenizer (pure, so EPUB parsing runs in Node unit tests too).
 * Not validating: unknown entities are kept as written, unclosed tags are tolerated by callers.
 */

export type XmlToken =
  | { type: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string };

/** Entities that XHTML in EPUBs commonly uses without declaring them. */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '­',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  middot: '·',
  bull: '•',
  dagger: '†',
  Dagger: '‡',
  sect: '§',
  para: '¶',
  times: '×',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  Uuml: 'Ü',
  Ouml: 'Ö',
  Auml: 'Ä',
  szlig: 'ß',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/** Strips a namespace prefix and lower-cases (XHTML element names are lower case anyway). */
const localName = (name: string) => name.slice(name.indexOf(':') + 1).toLowerCase();

const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of s.matchAll(ATTR)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

export function* tokenize(xml: string): Generator<XmlToken> {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      yield { type: 'text', text: decodeEntities(xml.slice(i)) };
      return;
    }
    if (lt > i) yield { type: 'text', text: decodeEntities(xml.slice(i, lt)) };

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      yield { type: 'text', text: xml.slice(lt + 9, end < 0 ? n : end) };
      i = end < 0 ? n : end + 3;
    } else if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      // Processing instruction or DOCTYPE (internal subsets with '>' inside are vanishingly rare in EPUBs).
      const end = xml.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      yield { type: 'close', name: localName(xml.slice(lt + 2, end < 0 ? n : end).trim()) };
      i = end < 0 ? n : end + 1;
    } else {
      // Find the closing '>' outside quoted attribute values.
      let j = lt + 1;
      let quote = '';
      for (; j < n; j++) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      const body = xml.slice(lt + 1, j);
      const selfClosing = body.endsWith('/');
      const inner = selfClosing ? body.slice(0, -1) : body;
      const nameEnd = inner.search(/[\s/]|$/);
      const name = inner.slice(0, nameEnd);
      if (!name) {
        // A stray '<' in text.
        yield { type: 'text', text: '<' };
        i = lt + 1;
        continue;
      }
      yield { type: 'open', name: localName(name), attrs: parseAttrs(inner.slice(nameEnd)), selfClosing };
      i = j + 1;
    }
  }
}

/** Attribute lookup that ignores namespace prefixes (`epub:type`, `xml:lang`, `opf:role`…). */
export function attr(attrs: Record<string, string>, name: string): string | undefined {
  if (name in attrs) return attrs[name];
  for (const [k, v] of Object.entries(attrs)) if (k.slice(k.indexOf(':') + 1) === name) return v;
  return undefined;
}
