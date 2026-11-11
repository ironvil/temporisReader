# Temporis Reader

A paginated foreign-language reader built with Capacitor 8 (Android). Tap a word to look it up.

- Imports `.txt` and `.md` files (UTF-8, UTF-16 or GB18030) as books, with chapters detected from headings.
- Imports `.epub` (EPUB 2 and 3) as linked books: only metadata is stored (title, author, language, chapter counts, progress, and the file's location, size and SHA-256). The file is read from where it is each time the book opens, never copied. A different checksum means the file was edited: the book is re-indexed, keeping the reading position by chapter, with a notice. If the file was moved or deleted, or access was lost (e.g. a backup restored on another phone), the book offers to find it again (a file with different contents is only accepted after asking) or to remove it. Importing a file that's already in the library (same checksum) doesn't add it twice. DRM-protected EPUBs are refused. Chapters follow the table of contents, and a chapter's opening line that matches its TOC title is shown as a heading. Without a usable TOC they come from h1–h6 headings, and failing those (Gutenberg EPUBs made from a .txt file) from short paragraphs set off by a large top margin or that read like "Chapter 12". Left out of the text: Project Gutenberg's English header and licence (cut at its START/END lines), contents lists made of links, and blank spacer paragraphs. The language comes from the EPUB's metadata when it names a supported language, and is detected from the text otherwise (Calibre conversions often say "en" whatever the book is in). On Android the file is picked with the system picker and the app keeps a persistable read grant (`LinkedFilesPlugin.java`); in the web build a stand-in "device storage" folder plays that part.
- Big EPUBs open at the saved chapter straight away. After a full parse, `derived/<id>/layout.json` keeps the book's shape without its text: chapters, headings, character offsets, and which paragraphs of which spine documents were kept. All EPUB parsing runs in a Web Worker (`src/books/parse-worker.ts`); the file's bytes are transferred to it, not copied. Opening an unchanged file has the worker read just the saved chapter (the first, for a book never opened) and its neighbours from their own documents (`readEpubParagraphs`) and send them back at once, then parse the whole book. The partly loaded book has the whole book's offsets, so progress stays exact. Until the rest arrives, the page indicator (which opens the scrubber) is disabled and shows a spinner, and moving to a chapter that isn't loaded yet waits for it. A book imported before layouts existed gets one on its first open. A changed file, a new parser version or a layout that doesn't fit falls back to the full parse.
- Android lists the app under "Open with" and "Share" for EPUBs (intent filters for `application/epub+zip`). A file opened that way goes to the library and is imported there, like one picked with "Import a file"; if the sending app doesn't offer lasting access, the import says the file may need finding again later.
- Books can also be created empty and built chapter by chapter in the editor: add a chapter from a file or pasted text/markdown, rename, reorder and delete chapters. Reading progress follows its chapter when chapters move.
- A book is an ordered list of sources; on every change the sources are re-parsed into one index (paragraph offsets, headings, bold/italic marks, scene breaks, chapters).
- Paginated reading using CSS columns, with swipe navigation and a page / pages-in-chapter indicator.
- Tapping the indicator opens a scrubber over the whole book (by character position, chapter breaks marked). Dragging only estimates the page from the page size; the reader jumps — and paginates that one chapter — once the thumb has been still for 1 s.
- Progress is saved as chapter, paragraph, word (and character offset for exact restore).
- Languages are added in Settings → Languages → (language), each with its own page, which downloads their dictionaries (never bundled in the APK). Chinese uses CC-CEDICT. French uses English Wiktionary via kaikki.org: a ~60 MB download that is streamed through once on the phone and trimmed to ~6 MB (`src/languages/wiktionary/`, shared by any Wiktionary language; measure with `node scripts/measure-wiktionary.mjs <file.jsonl.gz> <code>`).
- German (Wiktionary, ~100 MB download → ~8 MB stored): separable verbs are joined with their clause-final particle (fängt … an → anfangen, tracked and counted as anfangen); compounds that aren't entries are shown as their parts (Donau + Dampfschiff + Kapitän) and not tracked; at a sentence start the lower-case word wins (Ich → ich).
- French: inflected forms show their dictionary form (mangeaient → manger) with the inflection note, and known words are tracked by dictionary form, so every form of a word shares one level. Elisions split off (l’homme → l’ + homme) and hyphenated entries stay whole (peut-être).
- Chinese word segmentation is dictionary-based (fewest-words split over CC-CEDICT), behind the `WordSegmenter` interface.
- Japanese uses JMdict (EDRDG: an 11 MB download, 63 MB of XML, streamed through once and stored trimmed as 11 MB gzipped, ~31 MB in memory: one compact line per entry plus a sorted key list for every spelling and reading, `src/languages/ja/jmdict-data.ts`). Readings are shown in the popup only, in kana or romaji (Hepburn, `romaji.ts`; Settings → Languages → Japanese); the text isn't changed. Conjugations are undone by rules (`deinflect.ts`: 食べました → 食べる, polite + past; 書かなかった → 書く; 勉強しました → 勉強), checked against JMdict's part of speech, and words are tracked by that dictionary form as written. Text is split by the same dictionary segmenter as Chinese, weighted: common spellings cost less (可愛い | です | ね, not 可愛 | いで | すね), a conjugated form is one word, and a katakana run JMdict doesn't have (a name) stays whole and untracked. A kanji word's bare reading isn't a word as written (はま isn't 浜), and set expressions and titles (これは, 雨が降る, 吾輩は猫である) are never split into, as they'd swallow particles: the popup shows them as phrases after the tapped word. Detection needs kana (at least a quarter of the kana + kanji), which is what tells Japanese from Chinese.
- Markdown bold and italics are rendered.
- Scene breaks are shown as a centred `*   *   *`: Markdown `---`/`***`, EPUB `<hr>`, and lines or paragraphs of only symbols (`* * *`, `＊＊＊`, `◇◇◇`, `⁂`) in any format. They aren't paragraphs: the index marks the paragraph after each one (`breaks`), and CSS draws the asterisks, so they can't be looked up or counted. Breaks at the start of a chapter, next to a heading or at the end are dropped. The asterisks are kept on the same page as the text after them.
- Known words per language: the lookup popup has 0 / 1 / 2 / ✓ buttons (✓ = 3, known); each tap records the level and today's date. Settings → Languages imports (merging, newer date wins; or replacing the list with an exact copy of the file) and exports the list as `known-words-<lang>-<date>.json` (`{version, updated, words: {word: [level, date]}}`) via the Android share sheet.
- Backups, three ways, all made of what can't be rebuilt: the library list, settings, known words and the texts of books made from .txt/.md (`books/`). Dictionaries are downloaded again; EPUBs are found again; indexes, layouts and word counts (`derived/<id>/`) are rebuilt.
  - Settings → Back up library / Restore from backup: one JSON file through the share sheet (`src/backup.ts`).
  - Automatic backups (`src/auto-backup.ts`): the same file, written to a folder the user picks once (any Storage Access Framework folder: phone, SD card, Google Drive…, with a persisted read/write grant, `BackupFolderPlugin.java`), daily or weekly, keeping the newest 5 `temporis-auto-backup-*.json` (other files in the folder are never touched). No background job: one is made when the app starts or returns to the foreground, if due and the backup's contents changed. A failure is toasted once and shown in settings until a backup works again.
  - Android's Auto Backup (Google Drive, nightly, 25 MB per app; over that, nothing is saved) and phone-to-phone transfer, restored on install. `res/xml/data_extraction_rules.xml` (Android 12+) and `backup_rules.xml` (older) include only the paths above; transfers also carry dictionaries. `tests/unit/backup-rules.spec.ts` keeps the two files in step. Test on a phone with Google's `bmgr` scripts (developer.android.com → Test backup and restore).
  - Files describing this install (`auto-backup.json`: the folder; `notices.json`) are in neither backup. After a restore, known words without their dictionary get a one-off "Add <language> again?" notice (`src/missing-dictionaries.ts`).
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
  backup.ts                 backup file: create, check, restore
  auto-backup.ts            automatic backups to a chosen folder
  missing-dictionaries.ts   after a restore: "add <language> again?"
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
  languages/ja/             Japanese: JMdict (parsing, storage), conjugation rules, popup, detection
  segmentation/             WordSegmenter interface; dictionary-based and Intl (ICU) implementations
  vocab/known-words.ts      known-word levels per language, file format
  vocab/book-stats.ts       known-word percentages per book and chapter
  ui/                       library, book editor and settings screens
```

### Adding a language

Implement `LanguageModule` under `src/languages/<id>/` and add it to `languages` in `src/languages/index.ts`. Settings, the reader, known words, percentages and highlighting all work through that interface:

- `segmenter` splits paragraphs into words; `wordKey(word)` says what a word is tracked under in the known-words list (the word itself, or its dictionary form), and the optional `contextKeys(text, spans)` does the same with the sentence as context (German separable verbs, sentence-initial capitals); `detect(sample)` scores text for auto-detection; `sampleText` is the settings preview.
- `dictionaries` are downloaded at runtime. Extend `DownloadedDictionary`: implement `process` (turn the download into data) and `decode` (load what was stored). Storage paths must never change once released. Each dictionary's `<id>.download.gz` needs an exclude in `data_extraction_rules.xml` (tests/unit/backup-rules.spec.ts checks).
- Languages written without spaces can use `DictionaryWordSegmenter` with a `WordList` (Chinese, Japanese); its optional `cost(word)` weighs words instead of taking the fewest (Japanese: common spellings, conjugated forms, unknown katakana).
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
npm run setup:test-books  # once: download the EPUBs the tests use into tests/test epubs/
npm run typecheck  # tsc
npm test           # unit + Playwright e2e tests against the production web build
npm run test:ui    # same, in Playwright's interactive UI
npm run test:android  # Android tests on an emulator (see below)
npm run apk        # build + cap sync + debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The real EPUBs the tests read (Project Gutenberg books and HPMOR) aren't in the repo: `npm run setup:test-books`
downloads them and checks their SHA-256 (`scripts/fetch-test-epubs.mjs`). The Chinese HPMOR translation has no
public download, so it's copied in by hand; without it, the tests that need it are skipped.

E2E tests intercept the CC-CEDICT download and serve a small fixture, so they never hit MDBG.

### Android tests

`npm run test:android` runs `tests/android` on an emulator: the system file and folder pickers
(persisted grants for EPUBs and the backup folder) and Android's Auto Backup restore (local
transport, as in Google's test script). It builds the debug APK, boots a headless emulator
(`temporis-test`, created on first run) unless one is already running, drives the app's WebView
and the system UI with Playwright's Android support, and shuts the emulator down again. About a
minute; `-- --if-affected` skips the run unless Android-related files changed since `main`, and
`-- --no-build` reuses the last APK. Real phones are never used (the tests uninstall the app).

One-off setup: `sdkmanager "emulator" "system-images;android-36.1;google_apis;x86_64"`, plus
hardware acceleration (KVM on Linux). Playwright's Android driver is installed by the script.

## Parser version

The parser lives in its own workspace package, `packages/book-parser`, so changes to it stand out in
a diff. Any change there that can give a book different paragraphs, headings or chapters must bump
`PARSER_VERSION` in `packages/book-parser/src/version.ts`. Books indexed by an older version are
re-indexed when they next open, with the reading position kept at the same place in the text.

That place is saved as a fraction of the book's text, so it only stays exact if the text is the same.
A parser change that adds or removes text must say how, so places saved against the old text can be
moved. Version 5 left out paragraphs of only symbols (`* * *`), which are now scene breaks: the parser
lists them in `removedBreaks`, and `oldTextOffset` turns an offset in the old text into one in the new.
The tests in `reader.spec.ts` and `epub.spec.ts` ("keeps its exact place") act out a book read with
version 4.

`npm run check:parser-version` fails if the package changed since this branch left `main` (or the
ref passed after `--`) without a bump. Run it before opening a PR. A change that can't affect
output (comments, refactoring) can ignore it.

## Release builds

`npm run apk:release` builds `android/app/build/outputs/apk/release/temporis-reader-<version>.apk`, signed with the
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

## Licence

GPL-3.0-only ([LICENSE](LICENSE)) with an app-store exception ([APP-STORE-EXCEPTION.md](APP-STORE-EXCEPTION.md)):
the app may be distributed through stores such as Apple's App Store, whose terms the plain GPL doesn't allow,
as long as the source stays available under the same terms. Contributions are accepted under the same licence,
including the exception.

The exception only covers code we own, so third-party code shipped in the app must be permissively licensed
(MIT, BSD, ISC, Apache-2.0, MPL-2.0, …) or carry an equivalent exception: plain GPL code would keep the app
out of the App Store, and GPLv2-only code can't be combined with it at all. Dictionaries are downloaded at
runtime, not bundled, and keep their own licences (CC-CEDICT and Wiktionary: CC BY-SA).
