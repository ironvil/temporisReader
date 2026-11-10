# Temporis Reader

A paginated foreign-language reader built with Capacitor 8 (Android). Tap a word to look it up.

- Imports `.txt` and `.md` files (UTF-8, UTF-16 or GB18030) as books, with chapters detected from headings.
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
src/
  books/parse.ts            txt/md → paragraphs, headings, chapters (pure)
  books/library.ts          sources → book index, import/create/edit, progress
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
