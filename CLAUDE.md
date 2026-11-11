# Temporis Reader

Capacitor 8 + TypeScript + Vite reading app for language learners, shipped as an Android APK.
README.md describes the features, layout, toolchain and commands; read it first.

## Environment

The toolchain is user-local and not on PATH by default:

```sh
export JAVA_HOME=~/.local/opt/jdk21 ANDROID_HOME=~/.local/opt/android-sdk
export PATH=~/.local/opt/node/bin:$JAVA_HOME/bin:$PATH
```

## Checks

- `npm run typecheck` and `npm test` (unit + web e2e, ~15 s) for every change.
- `npm run check:parser-version` when `packages/book-parser` changed: bump `PARSER_VERSION` if
  books could get different paragraphs, headings or chapters (README → Parser version).
- **Android tests** (`npm run test:android`, tests/android): an emulator, about a minute with the
  build. Only run them when a change can affect Android behaviour:
  - anything under `android/` (manifest, plugins, backup rules, Gradle), `capacitor.config.json`,
    or Capacitor dependencies in package.json;
  - TypeScript that calls the native plugins or decides what's stored on disk:
    `src/books/linked-files.ts`, `src/auto-backup.ts`, `src/backup.ts`, `src/storage.ts`, and file
    paths in `src/books/library.ts` or elsewhere (they decide what Android's backup includes);
  - the Android tests and their runner.

  `npm run test:android -- --if-affected` makes that call from the diff against `main` (the list is
  `AFFECTS` in scripts/android-test.mjs; keep it in step with this one) and skips otherwise. Don't
  run them for web-only changes (reader UI, parsing, languages, styles). They never touch a real
  phone: only emulators are used, because the tests uninstall the app.

  The tests cover what the web build can only fake: the system file and folder pickers with their
  persisted grants (LinkedFilesPlugin, BackupFolderPlugin) and Android's Auto Backup rules. Add to
  them only for native behaviour; keep them few, as each one costs seconds of emulator time.

## Releases

- Bump `version` in package.json and `versionCode`/`versionName` in android/app/build.gradle.
- `npm run apk:release` builds the signed APK (the key is outside the repo: README → Release builds).
  When a build is asked for, it's this signed release APK, not the debug one.
- Commit messages: `vX.Y.Z: what changed` for releases.

## Conventions

- Storage paths, backup formats and dictionary paths never change once released; add migrations
  instead (e.g. `moveDerivedFiles` in src/books/library.ts).
- Files that can be rebuilt go in `derived/<id>/`, not `books/`: everything in `books/` is backed up.
- New native behaviour needs a web stand-in so the web e2e tests can cover the app's side of it
  (see the "device storage" stand-ins in linked-files.ts and auto-backup.ts).
- Licence: GPL-3.0-only with an app-store exception (README → Licence). Only add runtime dependencies
  that are permissive (MIT, BSD, ISC, Apache-2.0, MPL-2.0) or carry an equivalent exception: plain
  GPL code would keep the app off the App Store. Dev-only tools don't matter.
