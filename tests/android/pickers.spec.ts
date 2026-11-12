/**
 * The Storage Access Framework: files and folders picked in the system UI stay usable after the
 * app restarts (persisted grants), which the web tests can only act out with stand-ins.
 * LinkedFilesPlugin.java (EPUBs read in place) and BackupFolderPlugin.java (automatic backups).
 */
import { readFileSync } from 'node:fs';
import { createBook, dismissLanguageReminder, expect, PKG, test } from './app';

const EPUB = 'temporis-test-monte-cristo.epub';
const FOLDER = 'TemporisTestBackups';

test('an EPUB picked in the system picker is read in place, again after a restart', async ({ app, device }) => {
  await device.push(readFileSync(new URL('../test epubs/pg17989-images-3.epub', import.meta.url)), `/sdcard/Download/${EPUB}`);
  try {
    const { page } = app;
    await page.getByRole('button', { name: 'Add book' }).click();
    await page.getByRole('menuitem', { name: 'Import a file' }).click();
    await app.pickDownload(EPUB);

    await app.toast('Imported “Le comte de Monte-Cristo, Tome I”');
    await expect(page.locator('.book-details')).toHaveText(/32 chapters · French$/);
    // Read where it is: no copy of the file in the app's storage.
    expect((await app.files()).filter((f) => f.endsWith('.epub'))).toEqual([]);

    await app.restart();
    await app.page.locator('.book-open').first().click();
    await dismissLanguageReminder(app.page);
    await expect(app.page.locator('.chapter-count')).toHaveText('Chapter 1 of 32');
    await expect(app.page.locator('.page-flow')).toContainText('LE COMTE DE MONTE-CRISTO');
  } finally {
    await app.shell(`rm -f /sdcard/Download/${EPUB}`);
  }
});

test('automatic backups go to a folder picked once, and keep going after a restart', async ({ app, device }) => {
  await app.shell(`rm -rf /sdcard/Download/${FOLDER} && mkdir -p /sdcard/Download/${FOLDER}`);
  try {
    await createBook(app.page, '安卓测试', '猫头鹰在晚上飞。');
    await app.page.getByRole('button', { name: 'Settings' }).click();
    await app.page.locator('[data-auto-backup]').getByRole('button', { name: 'Choose a folder' }).click();

    // The folder picker remembers where it was last time: start from the top of the storage
    // (named after the device; its breadcrumb, or the title when already there).
    await app.tap({ text: device.model() });
    await app.tap({ text: 'Download' });
    await app.tap({ text: FOLDER });
    await app.tap({ text: 'USE THIS FOLDER' });
    await app.tap({ text: 'ALLOW' });

    await app.toast('Backup saved');
    await expect(app.page.locator('[data-backup-folder]')).toHaveText(FOLDER);
    const listing = () => app.shell(`ls /sdcard/Download/${FOLDER}`);
    const [file] = (await listing()).split(/\s+/);
    expect(file).toMatch(/^temporis-auto-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(JSON.parse(await app.shell(`cat /sdcard/Download/${FOLDER}/${file}`)).library[0].title).toBe('安卓测试');

    // The grant outlives the process: backing up again after a restart needs no picker.
    await app.restart();
    await app.shell(`rm /sdcard/Download/${FOLDER}/${file}`);
    await app.page.getByRole('button', { name: 'Settings' }).click();
    const card = app.page.locator('[data-auto-backup]');
    await card.getByRole('button', { name: 'Back up now' }).click();
    await app.toast('Backup saved');
    await expect(card.getByRole('alert')).toHaveCount(0);
    expect(await listing()).toMatch(/^temporis-auto-backup-.+\.json$/);
  } finally {
    await app.shell(`rm -rf /sdcard/Download/${FOLDER}`);
  }
});

test('a created book is shared through the share sheet, and the file imports back from the picker', async ({ app, device }) => {
  // Short names: the picker's grid cuts long ones short, so they can't be found by their text.
  // Two of them: it can list a file overwritten in place under its old details.
  const SHARED = ['tt1.temporis.json', 'tt2.temporis.json'];
  const { page } = app;
  await createBook(page, 'Share test', '猫头鹰在晚上飞。\n它看见了月亮。');
  await page.getByRole('button', { name: 'Edit Share test' }).click();
  // Both formats are written for the share sheet, which is then closed without sending.
  for (const [format, file] of [
    ['Temporis book', 'Share test.temporis.json'],
    ['EPUB', 'Share test.epub'],
  ]) {
    await page.getByRole('button', { name: 'Share book' }).click();
    await page.getByRole('dialog', { name: 'Share book' }).getByRole('button', { name: format }).click();
    await expect.poll(() => app.asApp(`find cache/exports -type f`)).toContain(`cache/exports/${file}`);
    // The file is written before the share sheet shows: wait for the sheet, then close it.
    const focus = () => app.shell('dumpsys window | grep mCurrentFocus');
    await expect.poll(focus).not.toContain(PKG);
    await app.shell('input keyevent 4');
    await expect.poll(focus).toContain(PKG);
    await expect(page.getByRole('dialog', { name: 'Share book' })).toBeHidden();
    if (format === 'EPUB') expect(await app.asApp(`head -c 2 "cache/exports/${file}"`)).toBe('PK');
  }
  const shared = JSON.parse(await app.asApp('cat "cache/exports/Share test.temporis.json"'));
  await page.getByRole('button', { name: 'Close editor' }).click();
  expect(shared).toMatchObject({ app: 'temporis-reader', kind: 'book', title: 'Share test' });

  // The same file, picked: already there. A new version: replace it.
  const pick = async (json: object, name: string) => {
    await device.push(Buffer.from(JSON.stringify(json)), `/sdcard/Download/${name}`);
    await page.getByRole('button', { name: 'Add book' }).click();
    await page.getByRole('menuitem', { name: 'Import a file' }).click();
    await app.pickDownload(name);
  };
  try {
    await pick(shared, SHARED[0]);
    await app.toast('“Share test” is already in your library');
    await pick({ ...shared, title: 'Share test 2', modifiedAt: '2030-01-01T00:00:00.000Z' }, SHARED[1]);
    await page.getByRole('dialog', { name: 'Replace this book?' }).getByRole('button', { name: 'Replace' }).click();
    await app.toast('Replaced “Share test 2”');
    await expect(page.locator('.book-name')).toHaveText(['Share test 2']);
  } finally {
    await app.shell(`rm -f ${SHARED.map((name) => `/sdcard/Download/${name}`).join(' ')}`);
  }
});
