/**
 * Builds the installable web version into dist-web/ (src/web-app.ts).
 *
 *   node scripts/build-web.mjs                  # the app only
 *   node scripts/build-web.mjs --dictionaries   # and copies of the dictionaries it serves itself
 *
 * Dictionary sites don't allow downloads from web pages, so the published web version carries its
 * own copies (CC BY-SA, redistributable with credit), fetched fresh at each publish. The APK keeps
 * downloading from the sites themselves.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

process.env.WEB_APP = '1';
await build();

if (process.argv.includes('--dictionaries')) {
  const dir = join('dist-web', 'dictionaries');
  mkdirSync(dir, { recursive: true });
  // Keep in step with MIRRORED_DICTIONARIES in src/web-app.ts and the URLs in cedict.ts / jmdict.ts.
  const sources = [
    ['cc-cedict.txt.gz', 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz', 'CC-CEDICT, CC BY-SA 4.0, MDBG: https://www.mdbg.net/chinese/dictionary?page=cc-cedict'],
    ['jmdict.gz', 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz', 'JMdict, CC BY-SA 4.0, the Electronic Dictionary Research and Development Group: https://www.edrdg.org/edrdg/licence.html'],
  ];
  for (const [name, url] of sources) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 1_000_000) throw new Error(`${url}: only ${bytes.length} bytes`);
    writeFileSync(join(dir, name), bytes);
    console.log(`${name}: ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
  writeFileSync(
    join(dir, 'README.txt'),
    `Unchanged copies of these dictionaries, for Temporis Reader's web version, fetched ${new Date().toISOString().slice(0, 10)}:\n\n` +
      sources.map(([name, url, credit]) => `${name}\n  from ${url}\n  ${credit}\n`).join('\n'),
  );
}
