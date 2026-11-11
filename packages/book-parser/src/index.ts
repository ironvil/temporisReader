/**
 * Book parsing: .txt / .md text and EPUB files → paragraphs, headings, marks and chapters.
 * Pure TypeScript with no app dependencies, so it runs in the browser and in Node tests.
 */
export * from './parse';
export * from './assemble';
export * from './epub';
export * from './xml';
export * from './zip';
export { PARSER_VERSION } from './version';
