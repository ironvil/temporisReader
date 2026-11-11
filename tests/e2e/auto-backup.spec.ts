/**
 * Automatic backups to a chosen folder. On the web the folder is a stand-in in the app's storage
 * (/DATA/device-files/Backups); "days passing" is acted out by moving the last backup's date back.
 */
import { expect, test, type Page } from '@playwright/test';
import { closeSettings, importBook, nextPage, openFirstBook, withStorage } from './helpers';

const FOLDER = '/DATA/device-files/Backups/';

const folderFiles = (page: Page) =>
  withStorage(page, async (s, folder) => (await s.keys()).filter((k) => k.startsWith(folder)).map((k) => k.slice(folder.length)).sort(), FOLDER);

const readState = (page: Page) => withStorage(page, async (s) => JSON.parse((await s.get('/DATA/auto-backup.json')).content), null);

/** Rewrites auto-backup.json (e.g. to make the last backup older). */
async function patchState(page: Page, patch: (state: any) => any): Promise<void> {
  const state = await readState(page);
  await withStorage(
    page,
    async (s, content) => {
      const entry = await s.get('/DATA/auto-backup.json');
      await s.put({ ...entry, content });
    },
    JSON.stringify(patch(state)),
  );
}

async function turnOn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.locator('[data-auto-backup]');
  await expect(card).toContainText('Off. Choose a folder');
  await card.getByRole('button', { name: 'Choose a folder' }).click();
  await expect(page.locator('#toast')).toHaveText('Backup saved');
  await expect(card.locator('[data-backup-folder]')).toHaveText('Backups (browser storage)');
  await expect(card.locator('[data-last-backup]')).toHaveText(/^Last backup: .+ \(temporis-auto-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json\)$/);
  await closeSettings(page);
}

async function restart(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
}

test('choosing a folder saves a backup there straight away', async ({ page }) => {
  await importBook(page, '猫头鹰.txt', '第一章\n\n猫头鹰在晚上飞。');
  await turnOn(page);

  const [file] = await folderFiles(page);
  expect(file).toMatch(/^temporis-auto-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const backup = await withStorage(page, async (s, path) => JSON.parse((await s.get(path)).content), FOLDER + file);
  expect(backup.app).toBe('temporis-reader');
  expect(backup.library.map((b: { title: string }) => b.title)).toEqual(['猫头鹰']);
  expect(Object.values(backup.files)).toContain('第一章\n\n猫头鹰在晚上飞。');
  // The folder isn't part of what's backed up (it belongs to this install).
  expect(JSON.stringify(backup)).not.toContain('auto-backup');
});

test('a due backup is made at startup only if something changed', async ({ page }) => {
  await importBook(page, 'book.txt', '第一章\n\n' + '猫头鹰在晚上飞。'.repeat(400));
  await turnOn(page);
  const first = await folderFiles(page);
  const eightDaysAgo = (state: any) => ({ ...state, last: { ...state.last, at: new Date(Date.now() - 8 * 86400000).toISOString() } });

  // Not due yet (weekly): nothing happens.
  await restart(page);
  await page.waitForTimeout(2500);
  expect(await folderFiles(page)).toEqual(first);

  // Due, but nothing changed: only noted.
  await patchState(page, eightDaysAgo);
  await restart(page);
  await expect.poll(async () => (await readState(page)).checkedAt).not.toBeNull();
  expect(await folderFiles(page)).toEqual(first);

  // Due and changed (reading moved on): a new backup.
  await openFirstBook(page);
  await nextPage(page);
  await page.getByRole('button', { name: 'Library' }).click();
  await patchState(page, (state) => ({ ...eightDaysAgo(state), checkedAt: null }));
  // Renamed, so a backup made in the same minute doesn't replace it.
  await withStorage(page, async (s, path) => {
    const entry = await s.get(path);
    await s.remove(path);
    await s.put({ ...entry, path: path.replace(/\d{4}\.json$/, '0000.json') });
  }, FOLDER + first[0]);
  await restart(page);
  await expect.poll(() => folderFiles(page)).toHaveLength(2);
  expect((await readState(page)).checkedAt).toBeNull();
});

test('only the newest five automatic backups are kept, and other files are left alone', async ({ page }) => {
  await turnOn(page);
  await withStorage(page, async (s, folder) => {
    // Five older automatic backups in place of the first one, plus files that aren't ours.
    const first = (await s.keys()).find((k) => k.startsWith(folder))!;
    const template = await s.get(first);
    await s.remove(first);
    for (const name of ['temporis-auto-backup-2020-01-01-0000.json', 'temporis-auto-backup-2020-01-02-0000.json', 'temporis-auto-backup-2020-01-03-0000.json', 'temporis-auto-backup-2020-01-04-0000.json', 'temporis-auto-backup-2020-01-05-0000.json', 'temporis-backup-2020-01-01.json', 'notes.txt']) {
      await s.put({ ...template, path: folder + name });
    }
  }, FOLDER);
  expect(await folderFiles(page)).toHaveLength(7);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('[data-auto-backup]').getByRole('button', { name: 'Back up now' }).click();
  // The oldest goes, so five are left with the new one.
  await expect
    .poll(async () => (await folderFiles(page)).filter((f) => f.startsWith('temporis-auto-backup-2020')))
    .toEqual(['temporis-auto-backup-2020-01-02-0000.json', 'temporis-auto-backup-2020-01-03-0000.json', 'temporis-auto-backup-2020-01-04-0000.json', 'temporis-auto-backup-2020-01-05-0000.json']);
  const files = await folderFiles(page);
  expect(files.filter((f) => f.startsWith('temporis-auto-backup-'))).toHaveLength(5);
  expect(files).toContain('temporis-backup-2020-01-01.json');
  expect(files).toContain('notes.txt');
});

test('a folder that can no longer be written to is reported once, and in settings', async ({ page }) => {
  await turnOn(page);
  // As after restoring on another phone, or revoking access: the folder can't be used.
  await patchState(page, (state) => ({ ...state, folder: { uri: 'content://gone/tree/x', name: 'Drive' }, last: null }));
  await restart(page);
  await expect(page.locator('#toast')).toHaveText('Automatic backup failed: The backup folder was moved or deleted. See Settings → Backup.');

  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.locator('[data-auto-backup]');
  await expect(card.getByRole('alert')).toHaveText('The backup folder was moved or deleted. Choose the folder again to keep backing up.');
  await card.getByRole('button', { name: 'Change folder' }).click();
  await expect(page.locator('#toast')).toHaveText('Backup saved');
  await expect(card.getByRole('alert')).toHaveCount(0);
});

test('turning automatic backups off keeps the backups already made', async ({ page }) => {
  await turnOn(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.locator('[data-auto-backup]');
  await card.getByRole('button', { name: 'Turn off' }).click();
  await expect(card).toContainText('Off. Choose a folder');
  expect(await folderFiles(page)).toHaveLength(1);
  expect((await readState(page)).folder).toBeNull();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});
