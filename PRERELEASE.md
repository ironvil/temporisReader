# 1.0 checklist

What still needs doing before version 1.0.

## Features

- [ ] **Word list screen**: per language, the known-words list by level (1 / 2 / ✓), with search, edit and delete. Today it can only be imported and exported as JSON.
- [ ] **Fix word splits by hand**: drag to look up any span, or split / join words, saved per book or for every book. Chinese and Japanese splitting is wrong roughly one tap in eight, and there's no way around it yet.
- [ ] **Layout settings**: font family, line spacing and margins as well as font size and theme. CJK text in particular depends on the font.
- [ ] **First run**: a new install should guide people to Settings → Languages, so the first tapped word doesn't seem to do nothing.

## Release

- [ ] **Lock the file formats**: storage paths, backups (`src/backup.ts`), shared books (`.temporis.json`), the known-words file and `derived/` never change after 1.0. Check that each has a version field and a shape worth keeping for good.
- [ ] **README up to date**: e.g. the sharing section still says books are shared from the editor's Share button; Export is in the library's ⋮ menu since 0.17.2.
- [ ] **Distribution**: decide whether 1.0 means the Play Store and/or iOS. The Play Store needs a privacy policy, screenshots and a listing. iOS needs iOS versions of the native plugins (linked files, backup folder). Being tried meanwhile: the web version on GitHub Pages (README → Web version), added to the home screen from Safari.
