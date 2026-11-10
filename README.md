# Temporis Reader

A paginated foreign-language reader built with Capacitor 8 (Android). Tap a word to look it up.

- Imports `.txt` and `.md` files (UTF-8, UTF-16 or GB18030) as books, with chapters detected from headings.
- Books can also be created empty and built chapter by chapter in the editor: add a chapter from a file or pasted text/markdown, rename, reorder and delete chapters. Reading progress follows its chapter when chapters move.
- A book is an ordered list of sources; on every change the sources are re-parsed into one index (paragraph offsets, headings, bold/italic marks, chapters).
- Paginated reading using CSS columns, with swipe navigation and a page / pages-in-chapter indicator.
- Tapping the indicator opens a scrubber over the whole book (by character position, chapter breaks marked). Dragging only estimates the page from the page size; the reader jumps — and paginates that one chapter — once the thumb has been still for 2 s.
- Progress is saved as chapter, paragraph, word (and character offset for exact restore).
- Languages are added in Settings → Languages, which downloads their dictionaries (never bundled in the APK). Chinese uses CC-CEDICT.
- Chinese word segmentation is dictionary-based (fewest-words split over CC-CEDICT), behind the `WordSegmenter` interface.
- Markdown bold and italics are rendered.
- Known words per language: the lookup popup has 0 / 1 / 2 / ✓ buttons (✓ = 3, known); each tap records the level and today's date. Settings → Languages imports (merging, newer date wins; or replacing the list with an exact copy of the file) and exports the list as `known-words-<lang>-<date>.json` (`{version, updated, words: {word: [level, date]}}`) via the Android share sheet.
- Turning forward after at least 10 s on a page offers to mark that page's words as known: words starting on the page that have a dictionary entry, weren't looked up during the visit, and aren't already known. Lookups reset on every page turn; going back never prompts.

## Layout

```
src/
  books/parse.ts        txt/md → paragraphs, headings, chapters (pure)
  books/library.ts      sources → book index, import/create/edit, progress
  reader/reader.ts      pagination, gestures, tap-to-lookup, progress tracking
  reader/popup.ts       dictionary popup
  languages/types.ts    LanguageModule + Dictionary interfaces
  languages/index.ts    language registry
  languages/zh/         Chinese: CC-CEDICT download/parse, pinyin, popup rendering
  segmentation/         WordSegmenter interface; dictionary-based and Intl (ICU) implementations
  vocab/known-words.ts  known-word levels per language, file format
  ui/                   library, book editor and settings screens
```

To add a language, implement `LanguageModule` (with a `WordSegmenter` and one or more `Dictionary`s) under `src/languages/<id>/` and register it in `src/languages/index.ts`.

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
