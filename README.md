# Temporis Reader

A paginated foreign-language reader built with Capacitor 8 (Android). Tap a word to look it up.

- Imports `.txt` and `.md` files (UTF-8, UTF-16 or GB18030) as books, with chapters detected from headings.
- Imports `.epub` (EPUB 2 and 3) as linked books: only metadata is stored (title, author, language, chapter counts, progress, and the file's location, size and SHA-256). The file is read from where it is each time the book opens, never copied. A different checksum means the file was edited: the book is re-indexed, keeping the reading position by chapter, with a notice. If the file was moved or deleted, or access was lost (e.g. a backup restored on another phone), the book offers to find it again (a file with different contents is only accepted after asking) or to remove it. Importing a file that's already in the library (same checksum) doesn't add it twice. DRM-protected EPUBs are refused. Chapters follow the table of contents, and a chapter's opening line that matches its TOC title is shown as a heading. Without a usable TOC they come from h1–h6 headings, and failing those (Gutenberg EPUBs made from a .txt file) from short paragraphs set off by a large top margin or that read like "Chapter 12". Left out of the text: Project Gutenberg's English header and licence (cut at its START/END lines), contents lists made of links, and blank spacer paragraphs. The language comes from the EPUB's metadata when it names a supported language, and is detected from the text otherwise (Calibre conversions often say "en" whatever the book is in). On Android the file is picked with the system picker and the app keeps a persistable read grant (`LinkedFilesPlugin.java`); in the web build a stand-in "device storage" folder plays that part.
- Big EPUBs open at the saved chapter straight away. After a full parse, `books/<id>/layout.json` keeps the book's shape without its text: chapters, headings, character offsets, and which paragraphs of which spine documents were kept. All EPUB parsing runs in a Web Worker (`src/books/parse-worker.ts`); the file's bytes are transferred to it, not copied. Opening an unchanged file has the worker read just the saved chapter (the first, for a book never opened) and its neighbours from their own documents (`readEpubParagraphs`) and send them back at once, then parse the whole book. The partly loaded book has the whole book's offsets, so progress stays exact. Until the rest arrives, the page indicator (which opens the scrubber) is disabled and shows a spinner, and moving to a chapter that isn't loaded yet waits for it. A book imported before layouts existed gets one on its first open. A changed file, a new parser version or a layout that doesn't fit falls back to the full parse.
- Android lists the app under "Open with" and "Share" for EPUBs (intent filters for `application/epub+zip`). A file opened that way goes to the library and is imported there, like one picked with "Import a file"; if the sending app doesn't offer lasting access, the import says the file may need finding again later.
- Books can also be created empty and built chapter by chapter in the editor: add a chapter from a file or pasted text/markdown, rename, reorder and delete chapters. Reading progress follows its chapter when chapters move.
- A book is an ordered list of sources; on every change the sources are re-parsed into one index (paragraph offsets, headings, bold/italic marks, chapters).
- Paginated reading using CSS columns, with swipe navigation and a page / pages-in-chapter indicator.
- Tapping the indicator opens a scrubber over the whole book (by character position, chapter breaks marked). Dragging only estimates the page from the page size; the reader jumps — and paginates that one chapter — once the thumb has been still for 1 s.
- Progress is saved as chapter, paragraph, word (and character offset for exact restore).
- Languages are added in Settings → Languages → (language), each with its own page, which downloads their dictionaries (never bundled in the APK). Chinese uses CC-CEDICT. French uses English Wiktionary via kaikki.org: a ~60 MB download that is streamed through once on the phone and trimmed to ~6 MB (`src/languages/wiktionary/`, shared by any Wiktionary language; measure with `node scripts/measure-wiktionary.mjs <file.jsonl.gz> <code>`).
- German (Wiktionary, ~100 MB download → ~8 MB stored): separable verbs are joined with their clause-final particle (fängt … an → anfangen, tracked and counted as anfangen); compounds that aren't entries are shown as their parts (Donau + Dampfschiff + Kapitän) and not tracked; at a sentence start the lower-case word wins (Ich → ich).
- French: inflected forms show their dictionary form (mangeaient → manger) with the inflection note, and known words are tracked by dictionary form, so every form of a word shares one level. Elisions split off (l’homme → l’ + homme) and hyphenated entries stay whole (peut-être).
- Chinese word segmentation is dictionary-based (fewest-words split over CC-CEDICT), behind the `WordSegmenter` interface.
- Markdown bold and italics are rendered.
- Known words per language: the lookup popup has 0 / 1 / 2 / ✓ buttons (✓ = 3, known); each tap records the level and today's date. Settings → Languages imports (merging, newer date wins; or replacing the list with an exact copy of the file) and exports the list as `known-words-<lang>-<date>.json` (`{version, updated, words: {word: [level, date]}}`) via the Android share sheet.
- Turning forward after at least 10 s on a page offers to mark that page's words as known: words starting on the page that have a dictionary entry, weren't looked up during the visit, and aren't already known. Lookups reset on every page turn; going back never prompts.
- Lookups update a word's level, each with its own setting (Settings → Reading, both on by default): a known (✓) word moves back to 2, and a word not in the list yet starts at 1. Both stamp today. Tapping outside an open popup only closes it.

## Layout

```
packages/book-parser/       @temporis/book-parser: the parser, no app dependencies (see "Parser version")
  src/parse.ts              txt/md → paragraphs, headings, chapters
  src/epub.ts               EPUB → the same model; TOC chapters (with src/zip.ts and src/xml.ts)
  src/assemble.ts           a book's sources → one index (content offsets, chapters by source)
  src/version.ts            PARSER_VERSION
src/
  books/linked-files.ts     files read in place (EPUBs): pick, read, checksum, release
  books/parse-worker.ts     EPUB parsing off the main thread (books/parse-off-thread.ts is its client)
  books/library.ts          book storage, import/create/edit, progress
  reader/reader.ts          pagination, gestures, tap-to-lookup, progress tracking
  reader/scrubber.ts        book-wide position slider
  reader/chapter-list.ts    chapter list dialog with known-word percentages
  reader/mark-known.ts      "mark words as known?" prompt on page turns
  reader/word-status.ts     0/1/2/✓ buttons and level changes on lookup
  reader/language-reminder.ts  "Add <language>?" / unsupported-language notices
  reader/dom-text.ts        text offsets ↔ DOM, CSS highlights
  reader/popup.ts           dictionary popup
  languages/types.ts        LanguageModule + Dictionary interfaces
  languages/index.ts        language registry
  languages/downloaded-dictionary.ts  base class: download, progress, store, load, remove
  languages/wiktionary/     any Wiktionary language: kaikki.org data, dictionary, lookups + popup
  languages/zh/             Chinese: CC-CEDICT, pinyin, popup rendering
  languages/fr/             French: Wiktionary + elision/hyphen-aware segmenter, detection
  languages/de/             German: Wiktionary + separable verbs, compound splitting, detection
  segmentation/             WordSegmenter interface; dictionary-based and Intl (ICU) implementations
  vocab/known-words.ts      known-word levels per language, file format
  vocab/book-stats.ts       known-word percentages per book and chapter
  ui/                       library, book editor and settings screens
```

### Adding a language

Implement `LanguageModule` under `src/languages/<id>/` and add it to `languages` in `src/languages/index.ts`. Settings, the reader, known words, percentages and highlighting all work through that interface:

- `segmenter` splits paragraphs into words; `wordKey(word)` says what a word is tracked under in the known-words list (the word itself, or its dictionary form), and the optional `contextKeys(text, spans)` does the same with the sentence as context (German separable verbs, sentence-initial capitals); `detect(sample)` scores text for auto-detection; `sampleText` is the settings preview.
- `dictionaries` are downloaded at runtime. Extend `DownloadedDictionary`: implement `process` (turn the download into data) and `decode` (load what was stored). Storage paths must never change once released.
- Languages in English Wiktionary can extend `WiktionaryLanguage` with a `WiktionaryDictionary({ code, language, downloadSize, coverage })`: lookups, inflected forms → dictionary form and the popup are shared, so a new one only needs its segmenter, `detect` and any spelling normalisation (see `languages/fr/`). Measure the trimmed size first with `node scripts/measure-wiktionary.mjs <kaikki file> <code>`.

## Toolchain

Installed user-locally under `~/.local/opt` (Node, Temurin JDK 21, Android SDK). Add to your shell profile:

```sh
export JAVA_HOME=~/.local/opt/jdk21
export ANDROID_HOME=~/.local/opt/android-sdk
export PATH=~/.local/opt/node/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
```

## Commands

```sh
npm run dev        # web dev server
npm run typecheck  # tsc
npm test           # unit + Playwright e2e tests against the production web build
npm run test:ui    # same, in Playwright's interactive UI
npm run apk        # build + cap sync + debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

E2E tests intercept the CC-CEDICT download and serve a small fixture, so they never hit MDBG.

## Parser version

The parser lives in its own workspace package, `packages/book-parser`, so changes to it stand out in
a diff. Any change there that can give a book different paragraphs, headings or chapters must bump
`PARSER_VERSION` in `packages/book-parser/src/version.ts`. Books indexed by an older version are
re-indexed when they next open, with the reading position kept at the same place in the text.

`npm run check:parser-version` fails if the package changed since this branch left `main` (or the
ref passed after `--`) without a bump. Run it before opening a PR. A change that can't affect
output (comments, refactoring) can ignore it.

## Release builds

`npm run apk:release` builds `android/app/build/outputs/apk/release/app-release.apk`, signed with the
release key. The key is **not** in the repo: Gradle reads
`~/.config/temporis-reader/keystore.properties` (or the file named by `TEMPORIS_KEYSTORE_PROPERTIES`),
which points at `release.jks` and holds its password. Without it, release builds are unsigned.

Keep a copy of `~/.config/temporis-reader/` somewhere safe (password manager or offline backup).
Android only installs updates signed with the same key; losing it means uninstalling, which wipes
the app's data — back up the library from Settings first.

## App icon

The logo (an hourglass behind an open book) lives in `assets/logo/`: `foreground.svg` (adaptive-icon
foreground on a 108-unit canvas, artwork inside the 66-unit safe circle), `monochrome.svg` (Android 13+
themed icons) and `background-color.txt`. `npm run icons` renders every launcher size, the splash
images and `public/favicon.svg` from them.
