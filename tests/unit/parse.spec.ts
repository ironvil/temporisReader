import { expect, test } from '@playwright/test';
import { assembleBook, type SourceMeta } from '../../src/books/library';
import { buildChapters, decodeText, formatFromFileName, joinLines, parseBook, parseInlineMarkdown, stripInlineMarkdown } from '../../src/books/parse';

test.describe('txt parsing', () => {
  test('one paragraph per line with Chinese chapter headings', () => {
    const book = parseBook('序\n\n第一章 开始\n　　今天早上。\n　　阳光。\r\n第二章 镜子\n她说。\n', 'txt', 'Fallback');
    expect(book.paragraphs).toEqual(['序', '第一章 开始', '今天早上。', '阳光。', '第二章 镜子', '她说。']);
    expect(book.headings).toEqual([1, 4]);
    expect(book.chapters).toEqual([
      { title: 'Fallback', start: 0, end: 1 },
      { title: '第一章 开始', start: 1, end: 4 },
      { title: '第二章 镜子', start: 4, end: 6 },
    ]);
  });

  test('hard-wrapped paragraphs separated by blank lines are joined', () => {
    const text = 'Chapter 1\n\nIt was a bright\ncold day in April.\n\nThe clocks were\nstriking thirteen.\n';
    const book = parseBook(text, 'txt', 'X');
    expect(book.paragraphs).toEqual(['Chapter 1', 'It was a bright cold day in April.', 'The clocks were striking thirteen.']);
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1']);
  });

  test('a file without headings is a single chapter', () => {
    const book = parseBook('一。\n二。\n', 'txt', 'My Book');
    expect(book.chapters).toEqual([{ title: 'My Book', start: 0, end: 2 }]);
  });

  test('long lines that start like headings are not headings', () => {
    const line = '第一章' + '很长的句子'.repeat(20);
    expect(parseBook(line, 'txt', 'X').headings).toEqual([]);
  });
});

test.describe('markdown parsing', () => {
  test('headings, inline formatting, lists and fences', () => {
    const md = [
      '# The Book',
      '',
      '## Chapter One',
      '',
      'Some **bold** and *italic* text with a [link](http://x).',
      'Continued line.',
      '',
      '- item one',
      '- item two',
      '',
      '---',
      '',
      '> quoted 文字',
      '',
      '```',
      'code line',
      '```',
      '',
      'Chapter Two',
      '===========',
      '',
      '中文第一行',
      '第二行',
    ].join('\n');
    const book = parseBook(md, 'md', 'X');
    expect(book.title).toBe('The Book');
    expect(book.paragraphs).toEqual([
      'The Book',
      'Chapter One',
      'Some bold and italic text with a link. Continued line.',
      '• item one',
      '• item two',
      'quoted 文字',
      'code line',
      'Chapter Two',
      '中文第一行第二行',
    ]);
    // "# The Book" + "## Chapter One" collapse into one chapter titled by the last heading.
    expect(book.chapters).toEqual([
      { title: 'Chapter One', start: 0, end: 7 },
      { title: 'Chapter Two', start: 7, end: 9 },
    ]);
  });

  test('strips inline markdown but keeps snake_case', () => {
    expect(stripInlineMarkdown('a_b_c and _it_ and ![img](x.png)`code`')).toBe('a_b_c and it and code');
  });
});

test.describe('inline markdown', () => {
  test('bold, italic and both', () => {
    expect(parseInlineMarkdown('a **bold** b *it* c ***both*** d')).toEqual({
      text: 'a bold b it c both d',
      marks: [
        [2, 6, 'b'],
        [9, 11, 'i'],
        [14, 18, 'i'],
        [14, 18, 'b'],
      ],
    });
  });

  test('underscores, but not inside words', () => {
    expect(parseInlineMarkdown('__b__ _i_ snake_case_name')).toEqual({ text: 'b i snake_case_name', marks: [[0, 1, 'b'], [2, 3, 'i']] });
  });

  test('CJK emphasis without spaces', () => {
    expect(parseInlineMarkdown('她的**头发**是*白金色*的')).toEqual({ text: '她的头发是白金色的', marks: [[2, 4, 'b'], [5, 8, 'i']] });
  });

  test('unmatched and spaced markers stay literal', () => {
    expect(parseInlineMarkdown('5 * 3 = 15 and **open')).toEqual({ text: '5 * 3 = 15 and **open', marks: [] });
    expect(parseInlineMarkdown('**a** and *b')).toEqual({ text: 'a and *b', marks: [[0, 1, 'b']] });
  });

  test('escapes, code and links', () => {
    expect(parseInlineMarkdown('\\*not\\* `*code*` [**link**](u)')).toEqual({ text: '*not* *code* link', marks: [[13, 17, 'b']] });
  });

  test('marks are stored per paragraph; headings stay plain', () => {
    const book = parseBook('# **Title**\n\nplain\n\nsome *style*', 'md', 'X');
    expect(book.paragraphs).toEqual(['Title', 'plain', 'some style']);
    expect(book.marks).toEqual({ 2: [[5, 10, 'i']] });
  });
});

test('joinLines adds spaces only between non-CJK text', () => {
  expect(joinLines(['hello', 'world'])).toBe('hello world');
  expect(joinLines(['你好', '世界'])).toBe('你好世界');
  expect(joinLines(['hello', '世界'])).toBe('hello世界');
});

test('buildChapters handles leading text and heading runs', () => {
  const paragraphs = ['intro', 'H1', 'H2', 'body', 'H3', 'body2'];
  expect(buildChapters(paragraphs, [1, 2, 4], 'Book')).toEqual([
    { title: 'Book', start: 0, end: 1 },
    { title: 'H2', start: 1, end: 4 },
    { title: 'H3', start: 4, end: 6 },
  ]);
});

const source = (id: string, title: string, split: boolean): SourceMeta => ({
  id,
  title,
  format: 'txt',
  fileName: null,
  split,
  path: `sources/${id}.txt`,
  chapterCount: 0,
  paragraphCount: 0,
});

test('assembleBook stores paragraph start offsets into the joined content', () => {
  const { content, index } = assembleBook([{ source: source('a', 'A', true), parsed: parseBook('第一章\n一二三\n四五', 'txt', 'X') }]);
  expect(content).toBe('第一章\n一二三\n四五');
  expect(index.paragraphOffsets).toEqual([0, 4, 8]);
  for (const [i, offset] of index.paragraphOffsets.entries()) {
    expect(content.slice(offset).split('\n')[0]).toBe(content.split('\n')[i]);
  }
});

test('assembleBook: split sources keep detected chapters, others are one chapter each', () => {
  const book = source('book', 'Book', true);
  const one = source('one', 'Extra', false);
  const empty = source('empty', 'Empty', false);
  const { content, index } = assembleBook([
    { source: one, parsed: parseBook('第一章 不是分章\n甲。\n乙。', 'txt', 'Extra') },
    { source: empty, parsed: parseBook('', 'txt', 'Empty') },
    { source: book, parsed: parseBook('第一章 一\n丙。\n第二章 二\n丁。', 'txt', 'Book') },
  ]);
  expect(content.split('\n')).toEqual(['第一章 不是分章', '甲。', '乙。', '第一章 一', '丙。', '第二章 二', '丁。']);
  expect(index.chapters).toEqual([
    { title: 'Extra', start: 0, end: 3, source: 'one', sourceChapter: 0 },
    { title: '第一章 一', start: 3, end: 5, source: 'book', sourceChapter: 0 },
    { title: '第二章 二', start: 5, end: 7, source: 'book', sourceChapter: 1 },
  ]);
  expect(index.headings).toEqual([0, 3, 5]);
  expect([one.chapterCount, empty.chapterCount, book.chapterCount]).toEqual([1, 0, 2]);
});

test('assembleBook offsets inline marks by the source position', () => {
  const { index } = assembleBook([
    { source: source('a', 'A', false), parsed: parseBook('一\n\n二', 'md', 'A') },
    { source: { ...source('b', 'B', false), format: 'md' }, parsed: parseBook('*斜体*', 'md', 'B') },
  ]);
  expect(index.marks).toEqual({ 2: [[0, 2, 'i']] });
});

test.describe('decodeText', () => {
  test('UTF-8 with and without BOM', () => {
    const bytes = new TextEncoder().encode('你好');
    expect(decodeText(bytes)).toBe('你好');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toBe('你好');
  });

  test('falls back to GB18030', () => {
    // "你好" in GBK/GB18030.
    expect(decodeText(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toBe('你好');
  });

  test('UTF-16LE with BOM', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))).toBe('你好');
  });
});

test('formatFromFileName', () => {
  expect(formatFromFileName('a.TXT')).toBe('txt');
  expect(formatFromFileName('a.markdown')).toBe('md');
  expect(formatFromFileName('a.epub')).toBeNull();
});
