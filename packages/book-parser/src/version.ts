/**
 * Version of the parsing rules. Bump it in any change to this package that can change a book's
 * paragraphs, headings or chapters: books indexed by an older version are re-indexed when they
 * open, keeping the reading position at the same place in the text.
 * `npm run check:parser-version` fails if the package changed without a bump.
 */
export const PARSER_VERSION = 4;
