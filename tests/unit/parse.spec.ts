import { expect, test } from '@playwright/test';
import { buildIndex } from '../../src/books/library';
import { buildChapters, decodeText, formatFromFileName, joinLines, parseBook, stripInlineMarkdown } from '../../src/books/parse';

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

test('buildIndex stores paragraph start offsets into the joined content', () => {
  const { content, index } = buildIndex(parseBook('第一章\n一二三\n四五', 'txt', 'X'));
  expect(content).toBe('第一章\n一二三\n四五');
  expect(index.paragraphOffsets).toEqual([0, 4, 8]);
  for (const [i, offset] of index.paragraphOffsets.entries()) {
    expect(content.slice(offset).split('\n')[0]).toBe(content.split('\n')[i]);
  }
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
