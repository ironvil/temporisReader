# Temporis Reader

A paginated foreign-language reader built with Capacitor 8 (Android). Tap a word to look it up.

- Imports `.txt` and `.md` files (UTF-8, UTF-16 or GB18030). On import, the text is split into paragraphs and chapters and an index is stored.
- Paginated reading using CSS columns, with swipe or button navigation and a page / pages-in-chapter indicator.
- Progress is saved as chapter, paragraph, word (and character offset for exact restore).
- Dictionaries are downloaded at runtime from Settings and are never bundled in the APK. Chinese uses CC-CEDICT.

## Layout

```
src/
  books/parse.ts        txt/md → paragraphs, headings, chapters (pure)
  books/library.ts      import, storage layout, progress
  reader/reader.ts      pagination, gestures, tap-to-lookup, progress tracking
  reader/popup.ts       dictionary popup
  languages/types.ts    LanguageModule + Dictionary interfaces
  languages/index.ts    language registry
  languages/zh/         Chinese: CC-CEDICT download/parse, pinyin, popup rendering
  ui/                   library and settings screens
```

To add a language, implement `LanguageModule` (and one or more `Dictionary`s) under `src/languages/<id>/` and register it in `src/languages/index.ts`.

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
